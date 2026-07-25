// Every tunable number in the game, in one place. Units in comments.
export const CFG = Object.freeze({
  STEP: 1 / 60,              // s     — fixed physics timestep (wobble filter requires it)

  // ---------- track / world ----------
  LOOP_W: 150,               // m     — block width (road centerline rect)
  LOOP_H: 110,               // m     — block height
  LOOP_R: 22,                // m     — corner radius (artic bus min turn ~12 m)
  ROAD_HALF: 4.5,            // m     — half road width (two 4.5 m lanes)
  LANE_OFFSET: 2.25,         // m     — right-lane center offset from centerline

  // ---------- bus dimensions ----------
  // Measured off the Blender model — these ARE the handling geometry, not just
  // where the wheels are drawn. Re-measure if you move an axle again.
  L1: 4.444,                 // m     — front section: steer axle -> drive axle
  L2: 6.0,                   // m     — rear section: pivot -> trailing axle
  HITCH_D: 1.956,            // m     — drive axle -> pivot (positive = behind axle)
  BUS_W: 2.55,               // m     — body width
  WHEEL_R: 0.5,              // m     — wheel radius
  DOOR_X: 4.6,               // m     — front door, local X from drive axle
  DOOR_Z: 1.45,              // m     — front door, local Z (right side)

  // Service doors, bus-local metres. `sec` says which section the door is bolted
  // to — a 'rear' door swings with the trailing unit, so its world position has
  // to come off the rear pose, not the front. `use` is 'exit' or 'board':
  // passengers get off through the exit door and on through the others, at the
  // same time. These match the procedural body; a GLB overrides them below.
  DOORS: [
    { sec: 'front', x: 4.6, z: 1.45, use: 'exit' },
    { sec: 'front', x: 0.8, z: 1.45, use: 'board' },
    { sec: 'rear', x: -2.2, z: 1.45, use: 'board' },
  ],

  // ---------- bus geometry source ----------
  // null = procedural boxes (see bus.js). Point front/rear at GLB files under
  // src/assets/ to swap in modelled geometry; MATERIALS ARE ALWAYS CODE-SIDE,
  // whatever the file contains is discarded. Model to the dimensions above:
  // forward +X, right +Z, up +Y; front origin at the drive axle, rear origin at
  // the articulation pivot. Name wheel nodes *wheel*, and the two steering ones
  // *wheel_steer* — they get spin and steer groups built around them on load.
  BUS_MODEL: {
    front: 'assets/bus-front.glb',
    rear: 'assets/bus-rear.glb',
    bootRing: null,          // optional single accordion ring; else a box
    scale: 1,                //       — uniform correction if not modelled in metres
    frontOffset: [0, 0, 0],  // m     — origin correction, front-local
    rearOffset: [0, 0, 0],   // m     — origin correction, rear-local
    flatShading: false,      //       — GLB only; true to facet it like the rest of the world
    bootA: -1.556,           // m     — front body rear face, drive-axle local (null = procedural)
    bootB: -0.85,            // m     — rear body front face, pivot local     (null = procedural)
    // Measured off the REF_passenger_door_* empties in the .blend.
    doors: [
      { sec: 'front', x: 6.096, z: 1.45, use: 'exit' },
      { sec: 'front', x: 1.292, z: 1.45, use: 'board' },
      { sec: 'rear', x: -2.695, z: 1.45, use: 'board' },
    ],
  },

  // ---------- longitudinal ----------
  A_MAX: 2.2,                // m/s²  — max acceleration
  B_MAX: 6.0,                // m/s²  — max service braking
  A_REV: 1.6,                // m/s²  — reverse acceleration
  VMAX: 14,                  // m/s   — forward speed clamp (~50 km/h; drag settles ~44)
  VMAX_REV: 4,               // m/s   — reverse speed clamp
  C_DRAG: 0.010,             // 1/m   — quadratic drag coefficient
  C_ROLL: 0.06,              // 1/s   — rolling resistance coefficient
  HANDBRAKE_DECEL: 8,        // m/s²  — extra decel while SPACE held

  // ---------- steering ----------
  STEER_RATE: 1.4,           // rad/s — wheel turn rate under input
  STEER_CENTER_RATE: 1.0,    // rad/s — self-centering rate (slower than input)
  STEER_LOCK_LOW: 0.733,     // rad   — 42° max lock at standstill
  STEER_LOCK_HIGH: 0.175,    // rad   — 10° max lock at VMAX (smoothstep between)

  // ---------- articulation ----------
  JACKKNIFE: 0.873,          // rad   — 50° hitch angle clamp
  K_WOBBLE: 60,              // 1/s²  — wobble filter stiffness  (ω ≈ 7.75 rad/s)
  C_WOBBLE: 9,               // 1/s   — wobble filter damping    (ζ ≈ 0.58, underdamped)

  // ---------- off-road ----------
  OFFROAD_DIST: 4.8,         // m     — centerline distance beyond which bus is off-road
  OFFROAD_ROLL_MUL: 3.0,     //       — rolling resistance multiplier off-road
  OFFROAD_STEER_MUL: 0.7,    //       — steering authority multiplier off-road

  // ---------- cosmetic body motion ----------
  ROLL_GAIN: 0.018,          // rad per m/s² lateral — body roll
  ROLL_MAX: 0.070,           // rad   — ±4°
  ROLL_SMOOTH: 8,            // 1/s   — roll smoothing rate
  PITCH_GAIN: 0.008,         // rad per m/s² longitudinal — brake dive / accel squat
  PITCH_MAX: 0.026,          // rad   — ±1.5°
  PITCH_SMOOTH: 6,           // 1/s   — pitch smoothing rate

  // ---------- camera ----------
  FRUSTUM_H: 52,             // world units — ortho frustum height
  CAM_DIST: 120,             // m     — camera offset distance along iso direction
  CAM_SMOOTH: 3.5,           // 1/s   — follow smoothing (t = 1 - exp(-k dt))
  CAM_LOOKAHEAD: 0.7,        // s     — look-ahead = v * this
  CAM_LOOKAHEAD_MAX: 9,      // m     — look-ahead clamp
  CAM_TWEEN: 0.35,           // s     — Q/E 90° rotation duration
  SHADOW_SPAN: 45,           // m     — half-extent of the follow shadow frustum

  // ---------- game loop ----------
  // Stop positions as fraction along the loop. Chosen to sit at the CENTRE of
  // three straights (bottom / right / top) — the spec's 0.45 and 0.76 fall on
  // corner arcs, which would put the shelters in the roadway.
  STOP_TS: [0.11, 0.36, 0.61],
  STOP_RADIUS: 9,            // m     — service zone radius around a stop bay
  STOP_SPEED: 0.5,           // m/s   — must be slower than this to serve a stop
  CAPACITY: 24,              //       — bus passenger capacity
  QUEUE_MAX: 12,             //       — waiting queue cap per stop
  SPAWN_MIN: 6,              // s     — min spawn interval per stop
  SPAWN_MAX: 9,              // s     — max spawn interval per stop
  ALIGHT_EVERY: 0.35,        // s     — one passenger exits per this
  BOARD_EVERY: 0.40,         // s     — one passenger boards per this
  MIN_DWELL: 1.0,            // s     — minimum door-open dwell
  WALK_SPEED: 1.7,           // m/s   — passenger walk speed
  SCATTER_MIN: 2,            // m     — alighting scatter distance min
  SCATTER_MAX: 5,            // m     — alighting scatter distance max
  FADE_TIME: 0.6,            // s     — alighting fade-out duration
  BUS_START_T: 0.06,         //       — initial bus position along the loop
});
