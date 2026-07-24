# LOOP LINE

An isometric, strictly grayscale articulated-bus driving sim on a small suburban block.
Drive the loop, pick passengers up at three stops, drop them at their destination, keep the
delivered counter climbing.

Proof of concept. three.js only — no build step, no npm, no assets.

## Run it

Any static file server from this directory:

```
npx serve .
# or
python -m http.server 8000
```

Then open the printed URL. ES modules need `http://`, so opening `index.html` from the
filesystem directly will not work.

three.js r169 is pulled from unpkg via an importmap, so the first load needs a network
connection. There is nothing to install.

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake; hold at a standstill for ~0.3 s to select reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (strong brake, reduced steering authority) |
| `Q` / `E` | Rotate the isometric view 90°. Controls stay vehicle-relative — rotating the view never changes what `W`/`A`/`D` do |
| `R` | Reset the bus to the nearest point on the loop |

Stop within 9 m of a stop and slow below 0.5 m/s to open the doors. Passengers bound for that
stop get off first, then the queue boards until the bus hits 24.

### Touch / mobile

Semi-transparent on-screen controls appear automatically on any device with a coarse pointer.
Append `?touch=1` to the URL to force them on for testing on a desktop.

| Control | Where | Notes |
|---|---|---|
| Steering stick | Bottom-left | Floating — it jumps to wherever your thumb lands. **Analog**, and constrained to the horizontal axis, so it steers only and never sneaks in throttle. 14% deadzone |
| `GAS` | Bottom-right, outermost | Held under the resting right thumb |
| `BRAKE` | Bottom-right, inboard | Hold at a standstill to select reverse, same as the keyboard |
| Rotate view | Swipe horizontally across the middle band | Each ~70 px (or 12% of screen width) steps the view 90°; a long drag re-arms and steps again. Swipe right rotates anticlockwise — flip the two key codes in `initTouch()` to reverse |
| `R` | Top-right | Reset to the nearest point on the loop. Kept because there's no keyboard on a phone |

The stick is analog, which the steering model consumes directly (`δ` target = `steer × lock`),
so touch steering is actually finer-grained than the keyboard's ±1. Gas and brake are on/off.

The swipe band (20%–55% of screen height) and the stick zone (bottom 45%) are strictly
adjacent with no overlap, so a steering drag can never rotate the camera by accident.
All three inputs work simultaneously via separate pointer IDs — you can steer, hold gas, and
brake at once.

## How it works

The bus is **not** a rigid-body simulation. It's a hand-written kinematic model in
`src/physics.js`:

- The front section is a bicycle model: `ψ̇₁ = (v / L₁)·tan(δ)`, with rate-limited,
  speed-sensitive steering (42° lock at a standstill falling to 10° at top speed) — that
  speed-sensitivity is most of what makes it feel like a bus rather than a go-kart.
- The rear section follows standard tractor-trailer kinematics,
  `ψ̇₂ = (v/L₂)·sin(ψ₁−ψ₂) − (d/L₂)·cos(ψ₁−ψ₂)·ψ̇₁`, which gives a *target* heading.
- **The wobble**: the rendered rear heading doesn't use that target directly. It chases it
  through an underdamped second-order filter, `ψ̈ = K·(ψ₂−ψ) − C·ψ̇` (ζ ≈ 0.58), so the tail
  overshoots on turn-in and settles over about a second. It self-gates — at a standstill the
  target isn't moving, so there's nothing to overshoot and the bus sits perfectly still.

Physics runs at a fixed 60 Hz on an accumulator, decoupled from rendering. This is required,
not stylistic: the wobble filter goes unstable on a variable timestep. Rendering interpolates
between the last two physics states.

Grayscale is enforced at the source. `src/palette.js` exports the only color constructor in
the codebase, `gray(v)`; there are no hex literals anywhere. Tone mapping is off and output is
sRGB, so authored values render exactly as written — no desaturation pass involved.

## Tuning

Everything that governs feel lives in `src/config.js`. The ones worth touching first:

| Knob | Unit | Default | What raising it feels like |
|---|---|---|---|
| `K_WOBBLE` | 1/s² | 60 | Tail snaps to position faster and wobbles at a higher frequency. **Lower this first if the tail looks rubbery** — don't reach for `C_WOBBLE` |
| `C_WOBBLE` | 1/s | 9 | Damps the wobble out. Past ~15 the overshoot disappears entirely and the tail just lags |
| `JACKKNIFE` | rad | 0.873 (50°) | Allows a sharper bend before the hitch clamps. Above ~60° the boot geometry starts to self-intersect |
| `STEER_LOCK_LOW` | rad | 0.733 (42°) | Tighter low-speed turning circle. Raising it much past 45° makes the loop trivially easy |
| `STEER_LOCK_HIGH` | rad | 0.175 (10°) | Twitchier at speed. This is the main "bus vs. car" dial |
| `STEER_RATE` | rad/s | 1.4 | Steering responds quicker. Lower values feel like heavier, slower steering |
| `A_MAX` / `B_MAX` | m/s² | 2.2 / 6.0 | Acceleration and braking authority |
| `VMAX` | m/s | 14 | Top speed (~50 km/h). Drag settles it around 44 km/h in practice |
| `ROLL_GAIN` / `ROLL_MAX` | rad | 0.018 / 0.070 | Body lean in corners. `ROLL_MAX` is a hard clamp at ~4°; past ~8° it reads as cartoonish |
| `STOP_RADIUS` | m | 9 | How forgiving stop alignment is |
| `STOP_SPEED` | m/s | 0.5 | How completely you must stop before the doors open |
| `CAPACITY` | — | 24 | Seats. Lower it to make the route pressure bite sooner |
| `SPAWN_MIN` / `SPAWN_MAX` | s | 6 / 9 | Passenger arrival rate per stop. **Lower these for a busier game** — the defaults are deliberately gentle |
| `QUEUE_MAX` | — | 12 | Queue cap per stop |
| `FRUSTUM_H` | world units | 52 | Zoom. Higher = more of the block visible, smaller bus |
| `CAM_SMOOTH` | 1/s | 3.5 | Camera follow tightness. Lower feels floatier |

## Notes on the spec

Two things differ from the original build spec, both deliberate:

1. **Stop positions.** The spec suggested placing stops at 15% / 45% / 78% along the loop.
   On this geometry (two 106 m straights, two 66 m straights, four 34.6 m corner arcs,
   482 m total) the 45% and 78% marks land mid-corner, which would put shelters in the
   roadway. `STOP_TS` is `[0.11, 0.36, 0.61]` instead — the centres of the bottom, right and
   top straights. This also spaces them 25% / 25% / 50% around the loop, so the long left
   straight gives you a run between circuits.

2. **`DEPARTING` holds while you're parked.** Per the specified state machine, once a stop
   finishes boarding it sits in `DEPARTING` until the bus leaves the 9 m radius. If you park
   at a stop and wait, newly-spawned passengers will queue up and *not* board until you pull
   away and come back. This is spec-correct but can read as a bug. To change it, allow
   `DEPARTING → BOARDING` in `src/stops.js` when the bus is stationary and there's capacity.

## Verified

Checked in Chrome against the acceptance list: loads with zero install and no console output;
82 materials audited programmatically, all grayscale; ~9.7k triangles across 190 meshes at
59.5 fps; hitch angle peaks at 22.2° and settles to 18.7° on a hard turn-in (one overshoot
crossing); zero drift when parked; boarding halts at 24 leaving the remainder queued; two full
autopilot laps (965 m) with no NaN and never more than 4.05 m from the centreline.

Touch controls verified in Chrome via `?touch=1` with synthetic pointer events: gas drives the
bus (0 → 2.52 m/s), brake decelerates and then engages reverse, the stick reports full lock at
1.0 / partial 0.208 / zero inside the deadzone, multi-touch holds gas and steering together,
a 160 px swipe steps the view twice, and dragging the steering stick produces zero camera
rotations. On a desktop (fine pointer) the overlay stays hidden and the keyboard legend
remains.

Known cosmetic limitation: tall foreground buildings can occlude the bus at some camera
angles. Rotate the view — `Q`/`E` on desktop, swipe the middle band on touch. Fading
occluders was out of scope for the POC.
