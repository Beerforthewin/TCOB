# Builds the three deployable variants of THE CIRCLE OF BUS.
#
# The site itself still has no build step — these are packaging only, and the
# repo root remains directly servable. Each variant is capped at ONE subfolder
# deep, which is why assets and the addons are flattened out of src/ and
# vendor/addons/ and two file references get rewritten on the way through.
#
#   dist\      three.js vendored in full        ~1.5 MB   works offline
#   dist-cdn\  three.js fetched from unpkg      ~141 KB   needs a network
#   dist-min\  tree-shaken three.js bundle      ~713 KB   works offline
#
# Usage:  powershell -ExecutionPolicy Bypass -File build-dist.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$three = 'https://unpkg.com/three@0.169.0'

function Reset-Dir($path) {
    if (Test-Path $path) { Get-ChildItem $path -Force | Remove-Item -Recurse -Force -Confirm:$false }
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

# Shared payload: markup, styles, game modules, and the models — with assets
# lifted to a top-level folder so nothing sits deeper than one level.
function Copy-Common($dest) {
    New-Item -ItemType Directory -Force -Path "$dest\src", "$dest\assets" | Out-Null
    Copy-Item "$root\index.html" $dest
    Copy-Item "$root\style.css"  $dest
    Copy-Item "$root\src\*.js"   "$dest\src"
    Copy-Item "$root\src\assets\*.glb" "$dest\assets"

    # bus.js resolves model paths against its own URL (src\), so the assets
    # having moved up a level has to be reflected in the copied config.
    $cfg = "$dest\src\config.js"
    (Get-Content $cfg -Raw).Replace("'assets/bus-", "'../assets/bus-") |
        Set-Content $cfg -Encoding utf8 -NoNewline
}

function Set-ImportMap($dest, $map) {
    $file = "$dest\index.html"
    $html = Get-Content $file -Raw
    $pattern = '(?s)\{ "imports": \{.*?\} \}'
    if ($html -notmatch $pattern) { throw "importmap not found in $file" }
    [System.Text.RegularExpressions.Regex]::Replace($html, $pattern, $map) |
        Set-Content $file -Encoding utf8 -NoNewline
}

function Show-Size($label, $path) {
    $f = Get-ChildItem $path -Recurse -File
    $deepest = ($f | ForEach-Object {
        ($_.FullName.Substring($path.Length + 1).Split('\').Count - 1)
    } | Measure-Object -Maximum).Maximum
    '{0,-9} {1,3} files  {2,8:N0} KB  depth {3}' -f $label, $f.Count,
        (($f | Measure-Object Length -Sum).Sum / 1KB), $deepest
}

# ---------------------------------------------------------------- dist (full)
$dist = "$root\dist"
Reset-Dir $dist
Copy-Common $dist
New-Item -ItemType Directory -Force -Path "$dist\vendor" | Out-Null
Copy-Item "$root\vendor\three.module.js" "$dist\vendor"
Copy-Item "$root\vendor\addons\utils\BufferGeometryUtils.js" "$dist\vendor"
Copy-Item "$root\vendor\addons\loaders\GLTFLoader.js" "$dist\vendor"

# GLTFLoader reaches sideways for '../utils/BufferGeometryUtils.js'. Flattening
# addons\ into vendor\ breaks that relative hop, so point it next door instead.
$gl = "$dist\vendor\GLTFLoader.js"
$src = Get-Content $gl -Raw
if ($src -notmatch [regex]::Escape("'../utils/BufferGeometryUtils.js'")) {
    throw 'GLTFLoader import path not found — three.js version changed?'
}
$src.Replace("'../utils/BufferGeometryUtils.js'", "'./BufferGeometryUtils.js'") |
    Set-Content $gl -Encoding utf8 -NoNewline

Set-ImportMap $dist @'
{ "imports": {
    "three": "./vendor/three.module.js",
    "three/addons/utils/BufferGeometryUtils.js": "./vendor/BufferGeometryUtils.js",
    "three/addons/loaders/GLTFLoader.js": "./vendor/GLTFLoader.js"
} }
'@

# ------------------------------------------------------------------- dist-cdn
$cdn = "$root\dist-cdn"
Reset-Dir $cdn
Copy-Common $cdn
Set-ImportMap $cdn @"
{ "imports": {
    "three": "$three/build/three.module.js",
    "three/addons/": "$three/examples/jsm/"
} }
"@

# ------------------------------------------------------------------- dist-min
# One esbuild bundle holding only the 27 three.js symbols src/ imports, plus
# GLTFLoader and mergeGeometries. All three specifiers map to that one file, so
# there are no relative imports left to break.
$min = "$root\dist-min"
Reset-Dir $min
Copy-Common $min
New-Item -ItemType Directory -Force -Path "$min\vendor" | Out-Null

$symbols = (Select-String -Path "$root\src\*.js" -Pattern 'THREE\.([A-Za-z0-9_]+)' -AllMatches).Matches |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
Write-Host "tree-shaking to $($symbols.Count) three.js symbols"

$entry = Join-Path $env:TEMP 'three.entry.js'
@"
export {
$($symbols -join ",`n")
} from 'three';
export { mergeGeometries } from '$($root -replace '\\','/')/vendor/addons/utils/BufferGeometryUtils.js';
export { GLTFLoader } from '$($root -replace '\\','/')/vendor/addons/loaders/GLTFLoader.js';
"@ | Set-Content $entry -Encoding utf8

& npx --yes esbuild@0.24.0 $entry --bundle --minify --format=esm `
    "--alias:three=$($root -replace '\\','/')/vendor/three.module.js" `
    --legal-comments=eof --outfile="$min\vendor\three.custom.min.js"
if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }
Remove-Item $entry -Force

Set-ImportMap $min @'
{ "imports": {
    "three": "./vendor/three.custom.min.js",
    "three/addons/utils/BufferGeometryUtils.js": "./vendor/three.custom.min.js",
    "three/addons/loaders/GLTFLoader.js": "./vendor/three.custom.min.js"
} }
'@

Write-Host ''
Show-Size 'dist'     $dist
Show-Size 'dist-cdn' $cdn
Show-Size 'dist-min' $min
