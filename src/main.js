import { CFG } from './config.js';
import { createScene, render, updateCamera, rotateView, snapCameraTo } from './scene.js';
import { buildTrack } from './track.js';
import { buildWorld } from './world.js';
import { createBus, updateBus, getDoors } from './bus.js';
import * as P from './physics.js';
import { initInput, sampleInput, consumeTaps } from './input.js';
import { buildStops, updateStops, stops, SERVING } from './stops.js';
import { initPassengers, updatePassengers, setDoors } from './passengers.js';
import { initHud, updateHud } from './hud.js';

const { scene } = createScene();
buildTrack(scene);
buildWorld(scene);
await createBus(scene);   // async: CFG.BUS_MODEL may put a GLB in flight
initPassengers(scene);
buildStops(scene);
initInput();
initHud();

const game = { delivered: 0, onboard: [] };   // onboard = array of destination stop indices

// module-scope scratch — nothing is allocated in the frame loop
const rs = { x: 0, z: 0, psi1: 0, psiVis: 0 };

P.resetToTrack(CFG.BUS_START_T);
P.getRenderState(1, rs);
updateBus(rs, P.state);
snapCameraTo(rs);

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;            // clamp after a tab switch
  acc += dt;

  const inp = sampleInput();
  for (const code of consumeTaps()) {
    if (code === 'KeyQ') rotateView(-1);
    else if (code === 'KeyE') rotateView(1);
    else if (code === 'KeyR') P.resetToNearest();
  }

  // fixed 60 Hz physics — the wobble filter requires a constant dt
  let steps = 0;
  while (acc >= CFG.STEP && steps < 6) { P.step(CFG.STEP, inp); acc -= CFG.STEP; steps++; }
  if (steps === 6) acc = 0;            // spiral-of-death backstop

  P.getRenderState(acc / CFG.STEP, rs);
  updateBus(rs, P.state);

  const doors = getDoors(rs);
  setDoors(doors);

  const prompt = updateStops(dt, rs, P.state.v, game, doors);
  updatePassengers(dt);
  updateCamera(dt, rs, P.state.v);
  updateHud(game, P.state, prompt);
  render();
}

requestAnimationFrame(frame);

// exposed for automated verification only
window.__game = { game, state: P.state, rs, scene, stops, getDoors, SERVING };
