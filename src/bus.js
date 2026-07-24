// Procedural articulated bus. Two sibling groups positioned in WORLD space each
// frame (front + rear), plus an accordion boot whose rings interpolate yaw
// between the two section headings — the visual payoff of the physics model.
//
// Local convention for both sections: forward = +X, right = +Z, up = +Y.
// Front group origin = drive axle. Rear group origin = articulation pivot.

import * as THREE from 'three';
import { CFG } from './config.js';
import { G, lambert } from './palette.js';

const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

// geometry constants (m) — shape only; feel numbers live in config.js
const BODY_H = 2.55, BODY_Y = 1.675;   // main box 0.4 .. 2.95
const FRONT_LEN = 8.7, FRONT_CX = 4.25;  // front body -0.1 .. 8.6
const REAR_LEN = 7.1, REAR_CX = -3.9;   // rear body  -0.35 .. -7.45
const BOOT_A = -0.1;                     // boot attach, front-local X
const BOOT_B = -0.35;                    // boot attach, rear-local X
const BOOT_RINGS = 6;

let front, rear, boot = [];
let steerPivotL, steerPivotR, wheelMeshes = [], steerWheels = [];

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function createBus(scene) {
  const bodyM = lambert(G.BUS, true);
  const darkM = lambert(G.DARK, true);
  const boardM = lambert(0.99, true);
  const wheelM = lambert(G.DARK, true);

  const wheelGeo = new THREE.CylinderGeometry(CFG.WHEEL_R, CFG.WHEEL_R, 0.35, 12);
  wheelGeo.rotateX(Math.PI / 2); // cylinder axis -> Z (the axle)

  const mkWheel = () => {
    const w = new THREE.Mesh(wheelGeo, wheelM);
    w.castShadow = true;
    wheelMeshes.push(w);
    return w;
  };

  // ------------------------------------------------ front section
  front = new THREE.Group();
  front.add(box(FRONT_LEN, BODY_H, CFG.BUS_W, bodyM, FRONT_CX, BODY_Y, 0));           // body
  front.add(box(FRONT_LEN - 0.3, 0.3, 2.3, bodyM, FRONT_CX, 3.0, 0));                 // top bevel slab
  front.add(box(7.4, 0.95, CFG.BUS_W + 0.07, darkM, 4.0, 2.3, 0));                    // window band
  const shield = box(0.12, 1.15, 2.25, darkM, 8.62, 2.25, 0);                         // windshield
  shield.rotation.z = -0.14;
  front.add(shield);
  front.add(box(0.07, 0.35, 1.5, boardM, 8.64, 2.98, 0));                             // destination board
  front.add(box(0.06, 0.06, 0.5, darkM, 8.4, 2.62, 1.35));                            // mirror stalks
  front.add(box(0.06, 0.06, 0.5, darkM, 8.4, 2.62, -1.35));
  front.add(box(0.1, 0.3, 0.18, darkM, 8.5, 2.55, 1.62));                             // mirror heads
  front.add(box(0.1, 0.3, 0.18, darkM, 8.5, 2.55, -1.62));
  front.add(box(0.9, 0.1, 0.9, darkM, 2.5, 3.2, 0));                                  // roof hatch
  front.add(box(1.15, 2.0, 0.06, darkM, CFG.DOOR_X, 1.5, CFG.BUS_W / 2 + 0.02));      // front door
  front.add(box(1.15, 2.0, 0.06, darkM, 0.8, 1.5, CFG.BUS_W / 2 + 0.02));             // middle door

  // steer axle wheels: pivot groups so they visibly steer with delta
  steerPivotL = new THREE.Group(); steerPivotL.position.set(CFG.L1, CFG.WHEEL_R, -1.02);
  steerPivotR = new THREE.Group(); steerPivotR.position.set(CFG.L1, CFG.WHEEL_R, 1.02);
  const swl = mkWheel(), swr = mkWheel();
  steerPivotL.add(swl); steerPivotR.add(swr);
  steerWheels.push(swl, swr);
  front.add(steerPivotL, steerPivotR);

  // drive axle wheels
  const dwl = mkWheel(); dwl.position.set(0, CFG.WHEEL_R, -1.02);
  const dwr = mkWheel(); dwr.position.set(0, CFG.WHEEL_R, 1.02);
  front.add(dwl, dwr);

  // ------------------------------------------------ rear section
  rear = new THREE.Group();
  rear.add(box(REAR_LEN, BODY_H, CFG.BUS_W, bodyM, REAR_CX, BODY_Y, 0));              // body
  rear.add(box(REAR_LEN - 0.3, 0.3, 2.3, bodyM, REAR_CX, 3.0, 0));                    // top bevel slab
  rear.add(box(6.0, 0.95, CFG.BUS_W + 0.07, darkM, -3.6, 2.3, 0));                    // window band
  rear.add(box(1.15, 2.0, 0.06, darkM, -2.2, 1.5, CFG.BUS_W / 2 + 0.02));             // rear door
  rear.add(box(0.08, 1.6, 1.9, darkM, -7.47, 1.2, 0));                                // engine grille

  const rwl = mkWheel(); rwl.position.set(-CFG.L2, CFG.WHEEL_R, -1.02);
  const rwr = mkWheel(); rwr.position.set(-CFG.L2, CFG.WHEEL_R, 1.02);
  rear.add(rwl, rwr);

  // ------------------------------------------------ accordion boot
  const bootM = lambert(G.DARK, true);
  for (let i = 0; i < BOOT_RINGS; i++) {
    const even = i % 2 === 0;
    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, even ? 2.5 : 2.35, even ? 2.45 : 2.3), bootM);
    ring.position.y = BODY_Y;
    ring.castShadow = true;
    boot.push(ring);
    scene.add(ring);
  }

  front.rotation.order = 'YZX';
  rear.rotation.order = 'YZX';
  scene.add(front, rear);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// rs = interpolated render state {x, z, psi1, psiVis}; S = physics state (cosmetics)
export function updateBus(rs, S) {
  const c1 = Math.cos(rs.psi1), s1 = Math.sin(rs.psi1);
  const c2 = Math.cos(rs.psiVis), s2 = Math.sin(rs.psiVis);

  front.position.set(rs.x, 0, rs.z);
  front.rotation.set(S.roll, -rs.psi1, S.pitch);

  // pivot sits HITCH_D behind the drive axle
  const px = rs.x - CFG.HITCH_D * c1;
  const pz = rs.z - CFG.HITCH_D * s1;
  rear.position.set(px, 0, pz);
  rear.rotation.set(S.roll * 1.25, -rs.psiVis, S.pitch * 0.5);

  // wheels
  for (const p of [steerPivotL, steerPivotR]) p.rotation.y = -S.delta;
  for (const w of wheelMeshes) w.rotation.z = S.wheelSpin;

  // boot rings: interpolate position and yaw across the real joint angle
  _a.set(rs.x + BOOT_A * c1, 0, rs.z + BOOT_A * s1);
  _b.set(px + BOOT_B * c2, 0, pz + BOOT_B * s2);
  const dyaw = wrapPi(rs.psiVis - rs.psi1);
  for (let i = 0; i < BOOT_RINGS; i++) {
    const t = (i + 0.5) / BOOT_RINGS;
    const ring = boot[i];
    ring.position.x = _a.x + (_b.x - _a.x) * t;
    ring.position.z = _a.z + (_b.z - _a.z) * t;
    ring.rotation.y = -(rs.psi1 + dyaw * t);
  }
}

// world position of the front door (for passenger walk targets)
export function getDoorWorld(rs, out) {
  const c = Math.cos(rs.psi1), s = Math.sin(rs.psi1);
  out.set(
    rs.x + CFG.DOOR_X * c - CFG.DOOR_Z * s, 0,
    rs.z + CFG.DOOR_X * s + CFG.DOOR_Z * c);
  return out;
}

// world right vector of the front section (door side)
export function getRightWorld(rs, out) {
  out.set(-Math.sin(rs.psi1), 0, Math.cos(rs.psi1));
  return out;
}
