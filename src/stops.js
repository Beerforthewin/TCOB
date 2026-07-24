// Bus stops: procedural shelter/bay geometry + the boarding state machine.
//
//   IDLE ──bus within STOP_RADIUS and |v| < STOP_SPEED──▶ ALIGHTING
//        ──▶ BOARDING ──▶ DEPARTING ──bus leaves radius──▶ IDLE

import * as THREE from 'three';
import { CFG } from './config.js';
import { G, lambert } from './palette.js';
import { frameAt } from './track.js';
import { spawnWaiting, startBoarding, spawnAlighting } from './passengers.js';

export const IDLE = 0, ALIGHTING = 1, BOARDING = 2, DEPARTING = 3;
export const stops = [];

const RH = CFG.ROAD_HALF;

function buildStopMesh(scene, stop) {
  const g = new THREE.Group();
  g.position.copy(stop.pos);
  g.rotation.y = -stop.heading;          // local: forward = +X, right = +Z

  const padM = lambert(G.SIDEWALK);
  const postM = lambert(0.50, true);
  const canopyM = lambert(0.74, true);
  const panelM = lambert(0.66, true);
  const signM = lambert(0.95, true);
  const markM = lambert(G.BUS, false, {
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });

  const add = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // paved bay pad, extending the sidewalk outward at the stop
  add(new THREE.BoxGeometry(16, 0.13, 4.1), padM, 0, 0.065, RH + 2.15, false);

  // shelter: 4 posts, canopy, back panel
  for (const x of [-1.9, 1.9]) {
    for (const z of [RH + 1.0, RH + 3.2]) {
      add(new THREE.BoxGeometry(0.12, 2.5, 0.12), postM, x, 1.38, z);
    }
  }
  add(new THREE.BoxGeometry(4.4, 0.14, 2.6), canopyM, 0, 2.7, RH + 2.1);
  add(new THREE.BoxGeometry(4.4, 1.9, 0.1), panelM, 0, 1.2, RH + 3.25);

  // sign post + board
  add(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), postM, 2.95, 1.43, RH + 0.6);
  add(new THREE.BoxGeometry(0.07, 0.5, 0.55), signM, 2.95, 2.55, RH + 0.6);
  // stop number as 1-3 notches on the sign face (no fonts allowed)
  for (let i = 0; i <= stop.i; i++) {
    add(new THREE.BoxGeometry(0.03, 0.09, 0.34), lambert(G.DARK, true),
      3.0, 2.68 - i * 0.15, RH + 0.6);
  }

  // painted stop box in the right lane (4 thin bars)
  add(new THREE.BoxGeometry(14, 0.02, 0.16), markM, 0, 0.045, 0.5, false);
  add(new THREE.BoxGeometry(14, 0.02, 0.16), markM, 0, 0.045, 4.1, false);
  add(new THREE.BoxGeometry(0.16, 0.02, 3.6), markM, -7, 0.045, 2.3, false);
  add(new THREE.BoxGeometry(0.16, 0.02, 3.6), markM, 7, 0.045, 2.3, false);

  scene.add(g);
}

export function buildStops(scene) {
  const f = {};
  CFG.STOP_TS.forEach((t, i) => {
    frameAt(t, f);
    const stop = {
      i,
      t,
      pos: f.p.clone(),
      right: f.right.clone(),
      fwd: f.tan.clone(),
      heading: f.heading,
      queue: [],
      state: IDLE,
      timer: 0,
      dwell: 0,
      _slot: new THREE.Vector3(),
    };
    // queue base: on the sidewalk, just in front of the shelter
    stop.queueBase = stop.pos.clone()
      .addScaledVector(stop.right, RH + 1.35)
      .addScaledVector(stop.fwd, 1.6);
    stops.push(stop);
    buildStopMesh(scene, stop);
  });

  // stagger the first spawns so the stops don't pulse in lockstep
  stops.forEach((s, i) => { s.spawnIn = 1.5 + i * 2.2; });
}

function slotPos(stop, i, out) {
  return out.copy(stop.queueBase).addScaledVector(stop.fwd, -i * 0.85);
}

const _door = new THREE.Vector3();
const _right = new THREE.Vector3();

// dt: real seconds. rs: interpolated bus render state. v: signed speed.
// game: { delivered, onboard[] }. Returns a HUD prompt string or null.
export function updateStops(dt, rs, v, game, doorWorld, rightWorld) {
  _door.copy(doorWorld);
  _right.copy(rightWorld);
  let prompt = null;

  for (const stop of stops) {
    // ---- spawning ----
    stop.spawnIn -= dt;
    if (stop.spawnIn <= 0) {
      stop.spawnIn = CFG.SPAWN_MIN + Math.random() * (CFG.SPAWN_MAX - CFG.SPAWN_MIN);
      if (stop.queue.length < CFG.QUEUE_MAX) {
        let dest = stop.i;
        while (dest === stop.i) dest = Math.floor(Math.random() * stops.length);
        stop.queue.push(spawnWaiting(stop, dest, slotPos(stop, stop.queue.length, stop._slot)));
      }
    }

    // keep queue slots current (handles shuffle-forward after boarding)
    for (let k = 0; k < stop.queue.length; k++) {
      slotPos(stop, k, stop.queue[k].slot);
    }

    // ---- service test ----
    const dx = rs.x - stop.pos.x, dz = rs.z - stop.pos.z;
    const inZone = Math.hypot(dx, dz) < CFG.STOP_RADIUS;
    const slow = Math.abs(v) < CFG.STOP_SPEED;

    if (!inZone) {
      stop.state = IDLE;
      stop.timer = stop.dwell = 0;
    } else {
      const waitingHere = () => game.onboard.reduce((n, d) => n + (d === stop.i ? 1 : 0), 0);

      switch (stop.state) {
        case IDLE:
          if (slow) { stop.state = ALIGHTING; stop.timer = 0; stop.dwell = 0; }
          break;

        case ALIGHTING:
          stop.dwell += dt;
          stop.timer += dt;
          if (stop.timer >= CFG.ALIGHT_EVERY) {
            stop.timer -= CFG.ALIGHT_EVERY;
            const idx = game.onboard.indexOf(stop.i);
            if (idx >= 0) {
              game.onboard.splice(idx, 1);
              game.delivered++;
              spawnAlighting(_door, _right);
            }
          }
          if (waitingHere() === 0) { stop.state = BOARDING; stop.timer = 0; }
          break;

        case BOARDING:
          stop.dwell += dt;
          stop.timer += dt;
          if (stop.timer >= CFG.BOARD_EVERY) {
            stop.timer -= CFG.BOARD_EVERY;
            if (stop.queue.length > 0 && game.onboard.length < CFG.CAPACITY) {
              const p = stop.queue.shift();
              game.onboard.push(p.dest);
              startBoarding(p);
            }
          }
          if ((stop.queue.length === 0 || game.onboard.length >= CFG.CAPACITY)
            && stop.dwell >= CFG.MIN_DWELL) {
            stop.state = DEPARTING;
          }
          break;

        case DEPARTING:
          break; // held until the bus leaves the zone
      }

      // ---- HUD prompt for the stop we're at ----
      const n = stop.i + 1;
      if (!slow && stop.state === IDLE) {
        prompt = `▼ STOP ${n} — slow to a stop`;
      } else if (stop.state === ALIGHTING || stop.state === BOARDING) {
        const boarding = Math.min(stop.queue.length, CFG.CAPACITY - game.onboard.length);
        prompt = `▼ STOP ${n} — ${boarding} boarding, ${waitingHere()} alighting`;
      } else if (stop.state === DEPARTING) {
        prompt = game.onboard.length >= CFG.CAPACITY && stop.queue.length > 0
          ? `▼ STOP ${n} — BUS FULL · ${stop.queue.length} left behind`
          : `▼ STOP ${n} — done · drive on`;
      }
    }
  }
  return prompt;
}
