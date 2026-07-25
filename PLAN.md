# THE CIRCLE OF BUS — Build Plan

Proof-of-concept: drive an articulated bus around a suburban block loop, pick up and drop
off passengers at 3 stops, count deliveries. Isometric, strictly grayscale.

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Rendering | **three.js r169** (pinned), WebGL2 | Only real option for 3D in-browser; orthographic camera gives true iso |
| Module loading | **ES modules + `<script type="importmap">` from CDN** | Zero install, zero build step, zero `node_modules` |
| Physics | **Custom kinematic model** (~180 lines) | A rigid-body engine is the wrong tool for a scripted-feel arcade bus; hand-rolled model is deterministic, tunable, and stable |
| Geometry | **100% procedural** (Box/Cylinder/Extrude/Shape) | No asset pipeline, no textures, no loaders — matches the flat grayscale art direction |
| UI/HUD | **Plain DOM + CSS** overlaid on the canvas | Crisper text than canvas/sprite HUD, trivial to style |
| Audio | None | Out of scope for POC |

**Explicitly not used:** Rapier/cannon/ammo, React/R3F, Vite/webpack, GLTF models, texture files,
tween libraries, physics debug renderers.

Total external dependency surface: **one CDN URL.**

---

## 2. Scene & world layout

```
             ┌──────────── 150 m ────────────┐
             ╭───────────────────────────────╮   ← corner radius 22 m
             │        ▓ buildings ▓          │
   110 m     │   [S1]                  [S2]  │   ← road width 9 m
             │        ▓ buildings ▓          │      (2 lanes × 4.5 m)
             ╰──────────────[S3]─────────────╯
```

- **Road loop** — a closed rounded-rectangle centerline built as a `CatmullRomCurve3`
  (`closed: true`). The curve is the single source of truth: road mesh, lane markings,
  stop placement, and the on-road/off-road test all derive from it.
- Corner radius **22 m** — an 18 m articulated bus has a ~12 m minimum turning radius, so
  22 m corners are comfortably drivable without being trivially wide.
- **Interior block**: 6–8 procedural buildings of varying height/footprint, plus sidewalk
  slabs, a few trees (cylinder + cone), and lamp posts.
- **Exterior**: a ground plane and a low fence of outer buildings so the horizon isn't empty.
- Off-road is soft-penalized (extra rolling resistance + lower grip), never blocking.

## 3. Grayscale discipline

Every material color goes through one helper:

```js
export const gray = v => new THREE.Color(v, v, v);   // v ∈ [0,1]
```

No other color constructor is permitted anywhere in the codebase. Lights are pure white.
Tone mapping is `NoToneMapping` and output is `SRGBColorSpace` so authored values render
exactly as specified. This guarantees perfect grayscale without a post-processing pass.

Value hierarchy (dark → light) so the bus always reads as the focal point:

```
0.10  wheels, windows, articulation boot
0.28  road surface
0.35  passengers (varied 0.30–0.45)
0.55  building walls (varied 0.45–0.70)
0.72  grass / ground
0.82  sidewalk, curbs
0.95  bus body, lane markings   ← brightest thing on screen
```

## 4. Driving model

Two rigid sections joined at a pivot. Front section drives; rear section follows and wobbles.

**Front section** — kinematic bicycle model, state at the drive axle:

```
v̇   = throttle·a_max − brake·b_max − c_drag·v|v| − c_roll·v
ψ̇₁  = (v / L₁) · tan(δ)
ẋ   = v·cos ψ₁        ż = v·sin ψ₁
```

Steering `δ` is rate-limited and speed-sensitive (≈42° lock at standstill → ≈10° at top speed),
which is what makes a bus feel heavy rather than twitchy.

**Rear section** — standard tractor-trailer kinematics give the *target* heading:

```
ψ̇₂ = (v / L₂)·sin(ψ₁ − ψ₂) − (d / L₂)·cos(ψ₁ − ψ₂)·ψ̇₁
```

**The wobble** — the rendered rear heading is not `ψ₂` directly. It follows `ψ₂` through an
underdamped second-order filter:

```
ψ̈_vis = k·(ψ₂ − ψ_vis) − c·ψ̇_vis          k = 60, c = 9   →  ζ ≈ 0.58
```

The tail overshoots on turn-in and settles over ~1 s. It self-gates: at low speed `ψ₂` changes
slowly, so there's nothing to overshoot and the bus sits still. Hitch angle is clamped to ±50°
(jackknife limit), and the accordion boot between sections is rebuilt each frame to span the
actual joint angle.

Fixed **60 Hz timestep** with an accumulator, decoupled from render — essential, because the
wobble filter goes unstable on variable `dt`.

## 5. Passenger loop

Per-stop state machine, driven by proximity + speed:

```
IDLE ──bus within 9 m and |v| < 0.5 m/s──▶ ALIGHTING ──▶ BOARDING ──▶ DEPARTING ──▶ IDLE
                                          0.35 s/pax     0.40 s/pax    bus leaves radius
```

- Each stop spawns a passenger every 6–9 s (jittered), queue capped at 12, rendered as a
  neat line of capsule figures beside the shelter.
- Every passenger carries a **destination stop** (random, never its origin).
- On arrival: passengers whose destination matches disembark first and scatter — they walk
  off in randomized directions with a small bob, then fade out and despawn.
- Then the queue boards: each figure walks to the door, vanishes, and increments the onboard
  count. Capacity **24**; boarding stops when full and the remainder stays queued.
- Delivered counter increments per alighting passenger. That's the score.

## 6. File layout

```
index.html          importmap, canvas, HUD markup
style.css           HUD, fonts, letterboxing
src/
  main.js           bootstrap, fixed-step loop, wiring
  config.js         ★ every tunable number in one place
  palette.js        gray() helper + named values
  scene.js          renderer, ortho camera, lights, shadows, follow-cam
  track.js          loop curve, road mesh, lane markings, stop transforms
  world.js          buildings, sidewalks, trees, props
  bus.js            procedural bus mesh (2 sections + boot + wheels)
  physics.js        bicycle model + articulation + wobble filter
  stops.js          stop meshes + boarding state machine
  passengers.js     spawning, queues, walk/scatter animation
  input.js          keyboard state
  hud.js            DOM updates
```

`config.js` matters more than it looks — the whole feel of this thing lives in about 25
numbers, and they need to be adjustable without hunting through modules.

## 7. Milestones

| # | Deliverable | Done when |
|---|---|---|
| 1 | Scaffold + iso scene | Gray ground renders under an orthographic camera at a fixed iso angle; 60 fps |
| 2 | Track + world | Closed road loop with markings, sidewalks, buildings, shadows |
| 3 | Bus mesh | Two-section articulated bus assembled from primitives, wheels turn with steering |
| 4 | Driving | WASD drives it; front unit handles like a bus; rear section tracks and wobbles |
| 5 | Camera + HUD | Smooth iso follow, Q/E 90° view snap, HUD showing speed / onboard / delivered |
| 6 | Stops + passengers | Full pickup→dropoff loop working, counter increments |
| 7 | Tuning pass | Wobble reads clearly on corners without looking rubbery; queues balanced |

## 8. Risks / decisions already made

- **Camera rotation vs. controls** — Q/E rotate the iso view in 90° steps, but input stays
  vehicle-relative (W = throttle, A/D = steer). No remapping needed, no conflict. Without
  this, driving the far side of the loop means driving "into" the screen.
- **Wobble vs. instability** — mitigated by fixed timestep + hitch clamp. If it ever looks
  rubbery, lower `k` before raising `c`.
- **Shadow acne on a large block** — directional light target follows the bus with a tight
  ±45 m shadow frustum rather than covering the whole map.
- **Passenger count** — stays under ~60 meshes, so no instancing needed. Don't pre-optimize.

---

The build prompt for Fable 5 is in `BUILD_PROMPT.md`.
