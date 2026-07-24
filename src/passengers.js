// Passenger figures: spawning, queue walking, boarding, alighting scatter, fade.
// Geometry is shared; each figure gets its own material (gray variance + fade).

import * as THREE from 'three';
import { CFG } from './config.js';
import { lambert } from './palette.js';

const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.85, 4, 8); // total 1.33 m
const headGeo = new THREE.SphereGeometry(0.18, 8, 6);

const UP = new THREE.Vector3(0, 1, 0);
const list = [];
const doorPos = new THREE.Vector3();
let sceneRef = null;

export function initPassengers(scene) { sceneRef = scene; }

// Live front-door world position — boarding walkers steer toward it.
export function setDoorPos(v) { doorPos.copy(v); }

function makeFigure(gval) {
  const mat = lambert(gval, true);
  const grp = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.665;
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 1.47;
  body.castShadow = head.castShadow = true;
  grp.add(body, head);
  const s = 0.94 + Math.random() * 0.12;
  grp.scale.set(s * (0.96 + Math.random() * 0.08), s, s * (0.96 + Math.random() * 0.08));
  sceneRef.add(grp);
  return { grp, mat };
}

// A passenger waiting at `stop`, bound for stop index `dest`.
export function spawnWaiting(stop, dest, slot) {
  const f = makeFigure(0.30 + Math.random() * 0.15);
  const p = {
    ...f,
    mode: 'wait',
    dest,
    stopHeading: stop.heading,
    slot: slot.clone(),
    target: new THREE.Vector3(),
    phase: Math.random() * Math.PI * 2,
    walk: 0,
    fadeT: 0,
    dead: false,
  };
  // enter from behind the queue and walk up to the slot
  p.grp.position.copy(slot).addScaledVector(stop.fwd, -2.2);
  p.grp.rotation.y = -stop.heading;
  list.push(p);
  return p;
}

export function startBoarding(p) {
  p.mode = 'board';
}

// Cosmetic figure that steps out of the door and scatters.
export function spawnAlighting(door, right) {
  const f = makeFigure(0.30 + Math.random() * 0.15);
  const a = Math.random() * Math.PI - Math.PI / 2;   // ±90° about the door side
  const dist = CFG.SCATTER_MIN + Math.random() * (CFG.SCATTER_MAX - CFG.SCATTER_MIN);
  const dir = right.clone().applyAxisAngle(UP, a);
  const p = {
    ...f,
    mode: 'alight',
    dest: -1,
    stopHeading: 0,
    slot: new THREE.Vector3(),
    target: door.clone().addScaledVector(dir, dist),
    phase: Math.random() * Math.PI * 2,
    walk: 0,
    fadeT: 0,
    dead: false,
  };
  p.grp.position.copy(door);
  list.push(p);
  return p;
}

// Constant-speed step toward a target on the ground plane. Returns distance left.
const _d = new THREE.Vector3();
function stepToward(p, target, dt, speed) {
  _d.set(target.x - p.grp.position.x, 0, target.z - p.grp.position.z);
  const dist = _d.length();
  if (dist > 1e-4) {
    const move = Math.min(speed * dt, dist);
    p.grp.position.addScaledVector(_d.divideScalar(dist), move);
    p.grp.rotation.y = -Math.atan2(_d.z, _d.x);
    p.walk += move;
  }
  return dist;
}

function kill(p) {
  p.dead = true;
  sceneRef.remove(p.grp);
  p.mat.dispose();
}

export function updatePassengers(dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];

    if (p.mode === 'wait') {
      const dist = stepToward(p, p.slot, dt, CFG.WALK_SPEED);
      if (dist < 0.05) {
        // settled: idle sway, facing the road
        p.phase += dt * 1.3;
        p.grp.rotation.y = -p.stopHeading + Math.sin(p.phase) * 0.10;
        p.grp.position.y = 0;
      } else {
        p.grp.position.y = Math.abs(Math.sin(p.walk * 5)) * 0.035;
      }

    } else if (p.mode === 'board') {
      const dist = stepToward(p, doorPos, dt, CFG.WALK_SPEED);
      p.grp.position.y = Math.abs(Math.sin(p.walk * 5)) * 0.045;
      if (dist < 0.4) kill(p);

    } else if (p.mode === 'alight') {
      const dist = stepToward(p, p.target, dt, CFG.WALK_SPEED);
      p.grp.position.y = Math.abs(Math.sin(p.walk * 5)) * 0.045;
      if (dist < 0.08) { p.mode = 'fade'; p.mat.transparent = true; p.mat.needsUpdate = true; }

    } else { // fade
      p.fadeT += dt;
      p.mat.opacity = Math.max(0, 1 - p.fadeT / CFG.FADE_TIME);
      p.grp.position.y = (p.fadeT / CFG.FADE_TIME) * 0.25;
      if (p.fadeT >= CFG.FADE_TIME) kill(p);
    }

    if (p.dead) list.splice(i, 1);
  }
}
