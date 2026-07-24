// Articulated bus vehicle model.
//
//   Front section — kinematic bicycle model, state at the drive axle:
//       v̇  = throttle·A_MAX − brake·B_MAX − C_DRAG·v·|v| − C_ROLL·v
//       ψ̇₁ = (v / L1) · tan(δ)
//       ẋ  = v·cos(ψ₁)        ż = v·sin(ψ₁)
//
//   Rear section — tractor-trailer kinematics give the TARGET heading:
//       ψ̇₂ = (v / L2)·sin(ψ₁ − ψ₂) − (d / L2)·cos(ψ₁ − ψ₂)·ψ̇₁
//
//   The wobble — the RENDERED rear heading ψ_vis follows ψ₂ through an
//   underdamped second-order filter (semi-implicit Euler, fixed 60 Hz):
//       ψ̈_vis = K_WOBBLE·(ψ₂ − ψ_vis) − C_WOBBLE·ψ̇_vis
//
// All angle differences are wrapped to [-π, π] before use.

import { CFG } from './config.js';
import { nearestSample, frameAt } from './track.js';

const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

export const state = {
  x: 0, z: 0,          // drive axle position (m)
  psi1: 0,             // front heading (rad)
  v: 0,                // signed speed (m/s)
  delta: 0,            // steer angle (rad)
  gear: 'D',
  psi2: 0,             // rear kinematic target heading (rad)
  psiVis: 0,           // rendered rear heading (rad)
  psiVisW: 0,          // wobble filter angular velocity (rad/s)
  roll: 0, pitch: 0,   // smoothed cosmetic body angles (rad)
  wheelSpin: 0,        // accumulated wheel rotation (rad)
  offroad: false,
  latA: 0,
};

const prev = { x: 0, z: 0, psi1: 0, psiVis: 0 };
let revT = 0, fwdT = 0;

function snap() {
  prev.x = state.x; prev.z = state.z;
  prev.psi1 = state.psi1; prev.psiVis = state.psiVis;
}

export function resetToTrack(t) {
  const f = frameAt(t);
  state.x = f.p.x + f.right.x * CFG.LANE_OFFSET;
  state.z = f.p.z + f.right.z * CFG.LANE_OFFSET;
  state.psi1 = state.psi2 = state.psiVis = f.heading;
  state.v = 0; state.delta = 0; state.psiVisW = 0;
  state.gear = 'D'; state.roll = 0; state.pitch = 0;
  state.offroad = false; state.latA = 0;
  revT = fwdT = 0;
  snap();
}

export function resetToNearest() {
  const ns = nearestSample(state.x, state.z);
  resetToTrack(isFinite(ns.t) ? ns.t : 0);
}

export function step(dt, inp) {
  snap();
  const S = state;

  // ---- steering: rate-limited, speed-sensitive lock, slow self-centering ----
  const sfRaw = clamp(Math.abs(S.v) / CFG.VMAX, 0, 1);
  const sf = sfRaw * sfRaw * (3 - 2 * sfRaw); // smoothstep
  const lock = CFG.STEER_LOCK_LOW + (CFG.STEER_LOCK_HIGH - CFG.STEER_LOCK_LOW) * sf;
  let auth = 1;
  if (S.offroad) auth *= CFG.OFFROAD_STEER_MUL;
  if (inp.handbrake) auth *= 0.6;
  const dTarget = inp.steer * lock * auth;
  // analog stick input can be fractional — treat anything past the deadzone as steering
  const rate = Math.abs(inp.steer) > 0.01 ? CFG.STEER_RATE : CFG.STEER_CENTER_RATE;
  S.delta += clamp(dTarget - S.delta, -rate * dt, rate * dt);

  // ---- longitudinal: gear logic + forces ----
  const th = inp.throttle, br = inp.brake;
  let a = 0;
  if (S.gear === 'D') {
    a += th * CFG.A_MAX;
    if (S.v > 0.01) a -= br * CFG.B_MAX;
    // reverse engages only when nearly stopped with brake held
    if (S.v < 0.15 && br > 0 && th === 0) { revT += dt; if (revT > 0.3) { S.gear = 'R'; revT = 0; } }
    else revT = 0;
  } else {
    a -= br * CFG.A_REV;
    if (S.v < -0.01) a += th * CFG.B_MAX;
    if (S.v > -0.15 && th > 0 && br === 0) { fwdT += dt; if (fwdT > 0.15) { S.gear = 'D'; fwdT = 0; } }
    else fwdT = 0;
  }
  const rollC = CFG.C_ROLL * (S.offroad ? CFG.OFFROAD_ROLL_MUL : 1);
  a -= CFG.C_DRAG * S.v * Math.abs(S.v) + rollC * S.v;
  if (inp.handbrake && Math.abs(S.v) > 0.05) a -= Math.sign(S.v) * CFG.HANDBRAKE_DECEL;

  const vPrev = S.v;
  S.v += a * dt;
  // gear is the sign authority — no accidental zero-crossing
  S.v = S.gear === 'D' ? clamp(S.v, 0, CFG.VMAX) : clamp(S.v, -CFG.VMAX_REV, 0);

  // ---- front section: bicycle model ----
  const psi1dot = (S.v / CFG.L1) * Math.tan(S.delta);
  S.psi1 += psi1dot * dt;
  S.x += S.v * Math.cos(S.psi1) * dt;
  S.z += S.v * Math.sin(S.psi1) * dt;

  // ---- rear section: kinematic target heading ----
  let g = wrapPi(S.psi1 - S.psi2);
  S.psi2 += ((S.v / CFG.L2) * Math.sin(g) - (CFG.HITCH_D / CFG.L2) * Math.cos(g) * psi1dot) * dt;
  g = wrapPi(S.psi1 - S.psi2);
  if (g > CFG.JACKKNIFE) S.psi2 = S.psi1 - CFG.JACKKNIFE;
  else if (g < -CFG.JACKKNIFE) S.psi2 = S.psi1 + CFG.JACKKNIFE;

  // ---- the wobble: underdamped 2nd-order follow of psi2 ----
  const err = wrapPi(S.psi2 - S.psiVis);
  S.psiVisW += (CFG.K_WOBBLE * err - CFG.C_WOBBLE * S.psiVisW) * dt; // semi-implicit Euler
  S.psiVis += S.psiVisW * dt;
  const gv = wrapPi(S.psi1 - S.psiVis);
  if (gv > CFG.JACKKNIFE) { S.psiVis = S.psi1 - CFG.JACKKNIFE; S.psiVisW = 0; }
  else if (gv < -CFG.JACKKNIFE) { S.psiVis = S.psi1 + CFG.JACKKNIFE; S.psiVisW = 0; }

  // ---- off-road test against the loop centerline ----
  const ns = nearestSample(S.x, S.z);
  S.offroad = ns.dist > CFG.OFFROAD_DIST;

  // ---- cosmetic roll / pitch / wheel spin ----
  S.latA = S.v * psi1dot;
  const rollT = clamp(-S.latA * CFG.ROLL_GAIN, -CFG.ROLL_MAX, CFG.ROLL_MAX);
  S.roll += (rollT - S.roll) * (1 - Math.exp(-CFG.ROLL_SMOOTH * dt));
  const longA = (S.v - vPrev) / dt;
  const pitchT = clamp(longA * CFG.PITCH_GAIN, -CFG.PITCH_MAX, CFG.PITCH_MAX);
  S.pitch += (pitchT - S.pitch) * (1 - Math.exp(-CFG.PITCH_SMOOTH * dt));
  S.wheelSpin += (S.v / CFG.WHEEL_R) * dt;

  // ---- NaN guard (belt and braces) ----
  if (!isFinite(S.x + S.z + S.psi1 + S.psiVis + S.v + S.delta)) resetToNearest();
}

// Interpolated state for rendering between fixed steps.
export function getRenderState(alpha, out) {
  out.x = prev.x + (state.x - prev.x) * alpha;
  out.z = prev.z + (state.z - prev.z) * alpha;
  out.psi1 = prev.psi1 + wrapPi(state.psi1 - prev.psi1) * alpha;
  out.psiVis = prev.psiVis + wrapPi(state.psiVis - prev.psiVis) * alpha;
  return out;
}
