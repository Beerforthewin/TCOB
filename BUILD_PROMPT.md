# Build prompt — hand this to Fable 5

> Paste everything below the line into a fresh session in an empty project directory.

---

Build a complete, runnable browser game: **an isometric, strictly grayscale articulated-bus
driving sim on a small suburban block**. This is a proof of concept — it must be polished and
feel good, but scope is deliberately tight. Write every file in full. No TODOs, no placeholder
functions, no "left as an exercise". When you're done the game must run correctly on the first
try from a static file server.

## Stack — non-negotiable

- **three.js r169**, pinned, loaded via a CDN importmap. Nothing else.
- Plain ES modules. **No build step, no npm, no `node_modules`, no bundler.**
- **No physics engine** (no Rapier, cannon, ammo). Write the vehicle model by hand.
- **No external assets**: no GLTF/OBJ models, no texture files, no fonts, no audio. All geometry
  is procedural three.js primitives (`BoxGeometry`, `CylinderGeometry`, `ShapeGeometry`,
  `ExtrudeGeometry`, `LatheGeometry`).
- HUD is plain DOM + CSS overlaid on the canvas.

`index.html` importmap:

```html
<script type="importmap">
{ "imports": {
    "three": "https://unpkg.com/three@0.169.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.169.0/examples/jsm/"
} }
</script>
```

## File layout — use exactly this

```
index.html          importmap, canvas, HUD markup
style.css
src/main.js         bootstrap, fixed-step loop, module wiring
src/config.js       EVERY tunable number, exported as one frozen object
src/palette.js      gray() helper + named grayscale values
src/scene.js        renderer, orthographic camera, lights, shadows, follow-cam
src/track.js        road loop curve, road mesh, lane markings, stop transforms
src/world.js        buildings, sidewalks, curbs, trees, lamp posts
src/bus.js          procedural articulated bus mesh
src/physics.js      bicycle model + articulation + wobble filter
src/stops.js        stop meshes + boarding state machine
src/passengers.js   spawning, queues, walk/scatter animation
src/input.js        keyboard state
src/hud.js          DOM updates
```

`config.js` is important: the entire feel of this game lives in ~25 numbers and I need to tune
them without hunting through modules. Every magic number below belongs there, named and
commented with its unit.

---

## 1. Art direction — perfect grayscale, enforced

Create exactly one color helper and use it for **every** material, light, and clear color:

```js
export const gray = v => new THREE.Color(v, v, v);   // v ∈ [0,1]
```

No other color construction anywhere — no hex literals, no `setHSL`, no named colors. Lights are
pure white. Set `renderer.toneMapping = THREE.NoToneMapping` and
`renderer.outputColorSpace = THREE.SRGBColorSpace` so authored values render exactly as written.
Do **not** add a post-processing desaturation pass — discipline at the source is the requirement.

Value hierarchy, so the bus is always the brightest thing on screen:

```
0.10  wheels, window glass, articulation boot, tree trunks
0.28  road asphalt
0.35  passenger figures (vary 0.30–0.45 per person)
0.55  building walls (vary 0.45–0.70 per building)
0.72  grass / ground plane
0.82  sidewalks, curbs, bus-stop shelters
0.95  bus body, lane markings
```

Use `MeshLambertMaterial` throughout (cheap, matte, reads well in gray). `flatShading: true` on
the bus and props for a crisp low-poly look.

## 2. Camera — true isometric

- `THREE.OrthographicCamera`, frustum height ≈ **52 world units**, recomputed on resize from
  aspect ratio.
- Fixed viewing direction, never free-look. Offset from target: `normalize(1, 0.82, 1) * 120`,
  `lookAt(target)`. That's a slightly-flattened isometric that reads well for a road network.
- **Follow**: the camera target smoothly chases the bus's front section using exponential
  smoothing (`t = 1 - exp(-k*dt)`, k ≈ 3.5) — frame-rate independent, no springy overshoot.
  Add a small look-ahead offset in the direction of travel scaled by speed.
- **Q / E snap-rotate the isometric view by 90°**, animated over 0.35 s with ease-in-out. This is
  required, not optional — without it, driving the far side of the loop means driving into the
  screen. Controls stay **vehicle-relative** (W = throttle, A/D = steer), so camera rotation
  never affects input. Do not remap controls to camera space.

Lighting: one `DirectionalLight` (intensity 1.6) from roughly `(-0.6, 1, -0.4)`, casting shadows;
one `AmbientLight` (intensity 0.55); one weak `HemisphereLight` for ground bounce. The
directional light's **target follows the bus** with a tight shadow frustum (±45 units, 2048 map,
tuned `bias`/`normalBias`) — do not try to shadow the whole block at once.

## 3. World

**Road loop.** Build a closed rounded-rectangle centerline: 150 m × 110 m with 22 m corner radii.
Sample it into a `THREE.CatmullRomCurve3` with `closed: true` (≈ 220 points). This curve is the
single source of truth — road mesh, markings, stop placement, and the on-road test all derive
from it. Road width 9 m (two 4.5 m lanes). Generate the road as a triangle-strip ribbon by
offsetting sampled points along the curve normal in the XZ plane. Add a dashed white centerline
and solid edge lines slightly above the surface (use `polygonOffset` to avoid z-fighting).

22 m corners matter: an 18 m articulated bus has a ~12 m minimum turning radius, so this is
comfortably drivable without feeling like a parking lot.

**Block interior**: 6–8 buildings of varied footprint and height (6–22 m), simple extruded boxes
with a slightly darker roof slab and rows of inset dark window quads. Sidewalk slabs following
the inside of the loop, with a raised curb. A handful of trees (cylinder trunk + 2 stacked cones)
and lamp posts (thin cylinder + small box head).

**Exterior**: a large ground plane, plus a sparse ring of outer buildings so the horizon isn't
empty. Light distance fog matched to the background gray.

**Off-road** is soft-penalized, never blocking: if the bus's distance from the curve exceeds
half the road width, multiply rolling resistance by ~3 and reduce steering authority by ~30%.
Player can always drive back on.

## 4. The bus — geometry

An 18 m articulated (bendy) bus, two sections joined by a concertina boot.

```
      front section (11 m)                rear section (7 m)
  ┌────────────────────────────┐╫┌──────────────────────┐
  │  ▪▪  ▪▪  ▪▪  ▪▪  ▪▪  ▪▪    │╫│  ▪▪  ▪▪  ▪▪  ▪▪      │
  └──○─────────────○───────────┘╫└──────────○───────────┘
   steer axle    drive axle    pivot      trailing axle
```

- Width 2.55 m, height 3.2 m, floor 0.4 m off the ground.
- Body = rounded box (chamfer the top edges with a few extra segments or a simple bevel), body
  gray 0.95.
- Window band = a continuous dark (0.10) inset strip around both sections at 1.8–2.7 m height,
  plus a windshield quad angled slightly back.
- **Articulation boot**: a dark (0.10) segmented cylinder/accordion of ~6 rings between the
  sections. It must be **rebuilt or skewed each frame** to span the actual joint angle — each ring
  interpolates its yaw between the two section headings. This is the visual payoff of the whole
  physics model; don't fake it with a static block.
- Wheels: dark cylinders, rotated `Math.PI/2` on Z. Front pair visibly steers with `δ`. All
  wheels spin at a rate proportional to `v / wheelRadius`.
- Small details: a roof hatch box, two mirror stalks, a destination-board quad on the front.
- Bus casts shadows; road and ground receive them.

Group hierarchy: `busRoot > frontGroup` and `busRoot > rearGroup` as siblings positioned in world
space each frame (not nested), so the joint angle is trivially expressible.

## 5. The bus — physics (write this exactly)

Fixed timestep, **60 Hz**, accumulator pattern, decoupled from render. This is required — the
wobble filter goes unstable on variable `dt`. Clamp the accumulator to avoid spiral-of-death
after a tab switch.

**Constants** (in `config.js`):

```
L1 = 5.9   // front section: steer axle → drive axle (m)
L2 = 5.5   // rear section: pivot → trailing axle (m)
d  = 0.5   // drive axle → pivot, positive = behind axle (m)
```

**Front section**, kinematic bicycle model with state at the drive axle:

```
v̇  = throttle·A_MAX − brake·B_MAX − C_DRAG·v·|v| − C_ROLL·v
ψ̇₁ = (v / L1) · tan(δ)
ẋ  = v·cos(ψ₁)        ż = v·sin(ψ₁)
```

- `A_MAX ≈ 2.2 m/s²`, `B_MAX ≈ 6.0 m/s²`, top speed ≈ 14 m/s forward, ≈ 4 m/s reverse.
- Reverse engages only when nearly stopped and brake is held (don't let S flip instantly).

**Steering** — this is what makes it feel like a bus and not a go-kart:

- Target `δ` from A/D input, **rate-limited** to ≈ 1.4 rad/s (the wheel takes time to turn).
- **Speed-sensitive lock**: max `δ` interpolates from ≈ 42° at standstill down to ≈ 10° at top
  speed. Use a smooth curve, not a hard clamp.
- Self-centering when no steer input, at a rate slightly slower than the input rate.

**Rear section** — standard tractor-trailer kinematics give the *target* heading:

```
ψ̇₂ = (v / L2)·sin(ψ₁ − ψ₂) − (d / L2)·cos(ψ₁ − ψ₂)·ψ̇₁
```

**The wobble** — do not render `ψ₂` directly. The rendered rear heading `ψ_vis` follows `ψ₂`
through an **underdamped second-order filter**:

```
ψ̈_vis = K_WOBBLE·(ψ₂ − ψ_vis) − C_WOBBLE·ψ̇_vis

K_WOBBLE = 60,  C_WOBBLE = 9    →  ω ≈ 7.75 rad/s, ζ ≈ 0.58
```

The tail overshoots on turn-in and settles over roughly a second. It self-gates correctly: at low
speed `ψ₂` barely moves, so there's nothing to overshoot and the parked bus sits perfectly still.
Integrate with semi-implicit Euler. Always wrap angle differences to `[-π, π]` before using them —
getting this wrong makes the tail spin wildly when heading crosses ±π.

Clamp the hitch angle `|ψ₁ − ψ_vis|` to **50°** (jackknife limit); when clamped, zero the wobble
velocity so it doesn't fight the clamp.

**Juice** (small, subtle — none of it should be obvious, only felt):

- Body roll: each section rolls by `−clamp(lateral_accel · ROLL_GAIN, ±4°)`, itself smoothed.
- Pitch: nose dips under braking, squats under acceleration, ±1.5°.
- Rear section gets slightly more roll than the front.

**Controls**: `W`/`↑` throttle, `S`/`↓` brake-then-reverse, `A`/`D`/`←`/`→` steer, `Space`
handbrake (strong brake + steering authority drop), `Q`/`E` rotate view, `R` reset bus to nearest
point on the loop.

## 6. Bus stops and passengers

**Three stops**, placed at roughly 15%, 45%, and 78% along the loop curve, on the **right-hand
side** of the direction of travel (so doors face the sidewalk). Each stop is: a paved bay pad, a
shelter (4 thin posts + a flat canopy + a back panel), a sign post, and a painted stop marker on
the road.

**Spawning**: each stop spawns a waiting passenger every 6–9 s (randomized), queue capped at 12.
Waiting passengers stand in a neat line beside the shelter with a slight idle sway. Every
passenger is assigned a **destination stop** at spawn (random, never its own origin).

**Passenger figures**: simple capsule body + sphere head, ~1.7 m tall, gray 0.30–0.45, flat shaded.
Give each a slight random height/width variation so the queue doesn't look cloned.

**Boarding state machine**, per stop:

```
IDLE
  └─ bus front section within 9 m of stop AND |v| < 0.5 m/s
       ▼
ALIGHTING   passengers whose destination == this stop exit, 0.35 s each
       ▼
BOARDING    queue boards, 0.40 s each, stops when bus hits capacity 24
       ▼
DEPARTING   holds until bus leaves the 9 m radius, then → IDLE
```

- Minimum door dwell of 1.0 s even if nobody moves, so quick stops still read as a stop.
- **Alighting animation**: each exiting passenger spawns at the door, walks off in a randomized
  scatter direction (2–5 m) with a subtle walk bob, then fades out over ~0.6 s and despawns.
  Increment the **delivered** counter as each one exits.
- **Boarding animation**: each queued passenger walks from their queue slot to the door, then
  vanishes; onboard count increments. Remaining queue members shuffle forward one slot.
- If the bus is full, boarding stops and the leftovers stay queued — this is the pressure that
  makes the loop a game.

## 7. HUD (DOM, top-left and bottom-center)

- **Delivered: N** — large, the primary score.
- **Onboard: N / 24** — with a horizontal fill bar that turns to an outlined "FULL" state at cap.
- **Speed** in km/h, and a small gear indicator (D / R / N).
- Contextual prompt when in a stop zone: `▼ STOP 2 — 3 boarding, 1 alighting` or
  `▼ STOP 2 — slow to a stop`.
- A small controls legend in the corner, dimmed.
- Style it to match: monospace, grayscale only, thin 1px borders, subtle translucent black
  backing panels. It should look like part of the same object as the game.

## 8. Quality bar

- **60 fps** on integrated graphics at 1080p. Reuse geometries/materials across repeated props;
  do not allocate in the render loop (no `new THREE.Vector3()` per frame — use module-scope
  scratch vectors).
- Handle window resize correctly (ortho frustum + pixel ratio, capped at 2).
- No console errors or warnings.
- Comment the physics module properly — the equations above should be identifiable in the code.
- Everything else: keep it readable and boring. Small modules, plain functions, no clever
  abstractions, no class hierarchies where a function will do.

## 9. Acceptance checklist — verify each before you report done

1. Opens from a static server with zero install steps and renders immediately.
2. The scene is *perfectly* grayscale — every material traces back to `gray()`.
3. The bus drives with visible weight: slow to accelerate, wide turns, steering that takes time.
4. On a hard corner entry the rear section visibly **swings wide and oscillates once or twice
   before settling**. Parked, it is completely still.
5. The concertina boot deforms to match the real joint angle at all times.
6. Q/E rotate the view in 90° steps and driving controls are unaffected.
7. Passengers accumulate at all three stops over time.
8. Stopping at a stop: destination-matched passengers exit and scatter, the queue boards, the
   stop's waiting count visibly drops, onboard count rises.
9. The delivered counter increases and never decreases.
10. Filling to 24 leaves passengers behind at the stop.
11. Drive the full loop twice with no errors, no NaN in any transform, no visual glitch.

Finally, write a short `README.md` with how to run it and a table of the tuning knobs in
`config.js` (name, unit, default, what changing it feels like).
