// Articulated bus. Two sibling groups positioned in WORLD space each frame
// (front + rear), plus an accordion boot whose rings interpolate yaw between the
// two section headings — the visual payoff of the physics model.
//
// Local convention for both sections: forward = +X, right = +Z, up = +Y.
// Front group origin = drive axle. Rear group origin = articulation pivot.
//
// Geometry comes from one of two sources, decided by CFG.BUS_MODEL:
//   - paths unset (default) -> procedural boxes, built below
//   - paths set             -> GLB files from src/assets/
// Either way materials are assigned HERE from the grayscale palette; anything
// authored in the GLB is discarded. See rigWheels() for the node-name contract.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CFG } from './config.js';
import { G, lambert } from './palette.js';

const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

// geometry constants (m) — shape only; feel numbers live in config.js
const BODY_H = 2.55, BODY_Y = 1.675;   // main box 0.4 .. 2.95
const FRONT_LEN = 8.7, FRONT_CX = 4.25;  // front body -0.1 .. 8.6
const REAR_LEN = 7.1, REAR_CX = -3.9;   // rear body  -0.35 .. -7.45
const BOOT_A = -0.1;                     // boot attach, front-local X — procedural body
const BOOT_B = -0.35;                    // boot attach, rear-local X  — procedural body
const BOOT_RINGS = 6;

let front, rear, boot = [];
let steerPivots = [], wheelMeshes = [];

// Where the accordion meets each body. Defaults suit the procedural boxes; a
// GLB with different proportions overrides them via CFG.BUS_MODEL.
let bootA = BOOT_A, bootB = BOOT_B;
// Service doors. Same story: the model's doors win when one is loaded.
let doorSpecs = CFG.DOORS;
const doorsWorld = [];

// ---------------------------------------------------------------- materials

// Palette assignment for imported meshes, by node name (falls back to the
// material name in the file). First match wins, so keep BRIGHT before DARK.
const NAME_BRIGHT = /board|destination|sign|headlamp|headlight|number|plate/i;
const NAME_DARK = /glass|window|windshield|shield|dark|trim|grille|grill|mirror|door|boot|bellows|wheel|tyre|tire|rubber|bumper|axle|hub/i;

function makeMats(flat) {
  return {
    body: lambert(G.BUS, flat),
    dark: lambert(G.DARK, flat),
    board: lambert(0.99, flat),
  };
}

function pickMaterial(mesh, mats) {
  const n = `${mesh.name} ${mesh.material?.name ?? ''}`;
  if (NAME_BRIGHT.test(n)) return mats.board;
  if (NAME_DARK.test(n)) return mats.dark;
  return mats.body;
}

// Replace every authored material with a palette one and free what came in the
// file. Textures go too — the art direction is untextured by construction.
function applyPalette(root, mats) {
  const spent = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m) spent.add(m);
    }
    o.material = pickMaterial(o, mats);
    o.castShadow = true;
    o.receiveShadow = false;
  });
  for (const m of spent) {
    for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
    m.dispose();
  }
}

// ------------------------------------------------------------- GLB plumbing

// Node-name contract for imported sections:
//   *wheel* / *tyre* / *tire*  -> lifted into a spin group (rotates on local Z)
//   ...and additionally *steer* -> wrapped in a steering pivot (rotates on Y)
// Each wheel is re-parented to a fresh group at its own centre so spin and
// steer never clobber a transform baked into the file.
function rigWheels(group) {
  group.updateMatrixWorld(true);

  const found = [];
  group.traverse(o => { if (o.isMesh && /wheel|tyre|tire/i.test(o.name)) found.push(o); });

  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();

  for (const w of found) {
    local.multiplyMatrices(inv, w.matrixWorld).decompose(pos, quat, scl);

    const spin = new THREE.Group();
    w.removeFromParent();
    w.position.set(0, 0, 0);
    w.quaternion.copy(quat);
    w.scale.copy(scl);
    spin.add(w);
    wheelMeshes.push(spin);

    if (/steer/i.test(w.name)) {
      const pivot = new THREE.Group();
      pivot.position.copy(pos);
      pivot.add(spin);                 // spin stays at the pivot origin
      group.add(pivot);
      steerPivots.push(pivot);
    } else {
      spin.position.copy(pos);
      group.add(spin);
    }
  }

  return found.length;
}

// Returns a group whose transform is owned by the physics, with the imported
// scene nested inside carrying the authoring offset/scale.
async function loadSection(url, mats) {
  const gltf = await new GLTFLoader().loadAsync(new URL(url, import.meta.url).href);
  const M = CFG.BUS_MODEL;
  const inner = gltf.scene;
  inner.scale.setScalar(M.scale);
  inner.position.fromArray(url === M.front ? M.frontOffset : M.rearOffset);
  applyPalette(inner, mats);

  const g = new THREE.Group();
  g.add(inner);
  rigWheels(g);
  return g;
}

// ------------------------------------------------------------- procedural

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function makeWheelFactory(wheelM) {
  const wheelGeo = new THREE.CylinderGeometry(CFG.WHEEL_R, CFG.WHEEL_R, 0.35, 12);
  wheelGeo.rotateX(Math.PI / 2); // cylinder axis -> Z (the axle)
  return () => {
    const w = new THREE.Mesh(wheelGeo, wheelM);
    w.castShadow = true;
    wheelMeshes.push(w);
    return w;
  };
}

function buildFront(mats) {
  const { body: bodyM, dark: darkM, board: boardM } = mats;
  const mkWheel = makeWheelFactory(darkM);

  const g = new THREE.Group();
  g.add(box(FRONT_LEN, BODY_H, CFG.BUS_W, bodyM, FRONT_CX, BODY_Y, 0));           // body
  g.add(box(FRONT_LEN - 0.3, 0.3, 2.3, bodyM, FRONT_CX, 3.0, 0));                 // top bevel slab
  g.add(box(7.4, 0.95, CFG.BUS_W + 0.07, darkM, 4.0, 2.3, 0));                    // window band
  const shield = box(0.12, 1.15, 2.25, darkM, 8.62, 2.25, 0);                     // windshield
  shield.rotation.z = -0.14;
  g.add(shield);
  g.add(box(0.07, 0.35, 1.5, boardM, 8.64, 2.98, 0));                             // destination board
  g.add(box(0.06, 0.06, 0.5, darkM, 8.4, 2.62, 1.35));                            // mirror stalks
  g.add(box(0.06, 0.06, 0.5, darkM, 8.4, 2.62, -1.35));
  g.add(box(0.1, 0.3, 0.18, darkM, 8.5, 2.55, 1.62));                             // mirror heads
  g.add(box(0.1, 0.3, 0.18, darkM, 8.5, 2.55, -1.62));
  g.add(box(0.9, 0.1, 0.9, darkM, 2.5, 3.2, 0));                                  // roof hatch
  g.add(box(1.15, 2.0, 0.06, darkM, CFG.DOOR_X, 1.5, CFG.BUS_W / 2 + 0.02));      // front door
  g.add(box(1.15, 2.0, 0.06, darkM, 0.8, 1.5, CFG.BUS_W / 2 + 0.02));             // middle door

  // steer axle wheels: pivot groups so they visibly steer with delta
  const pl = new THREE.Group(); pl.position.set(CFG.L1, CFG.WHEEL_R, -1.02);
  const pr = new THREE.Group(); pr.position.set(CFG.L1, CFG.WHEEL_R, 1.02);
  pl.add(mkWheel()); pr.add(mkWheel());
  steerPivots.push(pl, pr);
  g.add(pl, pr);

  // drive axle wheels
  const dwl = mkWheel(); dwl.position.set(0, CFG.WHEEL_R, -1.02);
  const dwr = mkWheel(); dwr.position.set(0, CFG.WHEEL_R, 1.02);
  g.add(dwl, dwr);

  return g;
}

function buildRear(mats) {
  const { body: bodyM, dark: darkM } = mats;
  const mkWheel = makeWheelFactory(darkM);

  const g = new THREE.Group();
  g.add(box(REAR_LEN, BODY_H, CFG.BUS_W, bodyM, REAR_CX, BODY_Y, 0));             // body
  g.add(box(REAR_LEN - 0.3, 0.3, 2.3, bodyM, REAR_CX, 3.0, 0));                   // top bevel slab
  g.add(box(6.0, 0.95, CFG.BUS_W + 0.07, darkM, -3.6, 2.3, 0));                   // window band
  g.add(box(1.15, 2.0, 0.06, darkM, -2.2, 1.5, CFG.BUS_W / 2 + 0.02));            // rear door
  g.add(box(0.08, 1.6, 1.9, darkM, -7.47, 1.2, 0));                               // engine grille

  const rwl = mkWheel(); rwl.position.set(-CFG.L2, CFG.WHEEL_R, -1.02);
  const rwr = mkWheel(); rwr.position.set(-CFG.L2, CFG.WHEEL_R, 1.02);
  g.add(rwl, rwr);

  return g;
}

// The boot always stays code-driven: each ring is placed and yawed
// individually every frame, so it is a deformation, not a rigid part.
function buildBoot(scene, mats, ringModel) {
  for (let i = 0; i < BOOT_RINGS; i++) {
    const even = i % 2 === 0;
    let ring;
    if (ringModel) {
      ring = ringModel.clone(true);
      ring.scale.multiplyScalar(even ? 1 : 0.94);
    } else {
      ring = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, even ? 2.5 : 2.35, even ? 2.45 : 2.3), mats.dark);
      ring.castShadow = true;
    }
    ring.position.y = BODY_Y;
    boot.push(ring);
    scene.add(ring);
  }
}

// ------------------------------------------------------------------ public

// Async because a GLB may be in flight. Any section that fails to load falls
// back to its procedural build, so a missing or broken file degrades to the
// box bus instead of an empty scene.
export async function createBus(scene) {
  const M = CFG.BUS_MODEL;
  // The procedural bus is flat-shaded by art direction; imported geometry gets
  // its own set so a modelled curve is not forced into facets.
  const mats = makeMats(true);
  const glbMats = makeMats(M.flatShading);

  const section = async (url, fallback) => {
    if (!url) return fallback(mats);
    try {
      return await loadSection(url, glbMats);
    } catch (err) {
      console.warn(`bus: could not load ${url}, using procedural geometry —`, err.message);
      return fallback(mats);
    }
  };

  let ringModel = null;
  if (M.bootRing) {
    try {
      const gltf = await new GLTFLoader().loadAsync(new URL(M.bootRing, import.meta.url).href);
      ringModel = gltf.scene;
      ringModel.scale.setScalar(M.scale);
      applyPalette(ringModel, glbMats);
    } catch (err) {
      console.warn(`bus: could not load ${M.bootRing}, using procedural rings —`, err.message);
    }
  }

  [front, rear] = await Promise.all([
    section(M.front, buildFront),
    section(M.rear, buildRear),
  ]);

  // Modelled proportions differ from the boxes, so the boot attach points and
  // the boarding door come from the model when one is in use.
  if (M.bootA !== null) bootA = M.bootA;
  if (M.bootB !== null) bootB = M.bootB;
  if (M.doors) doorSpecs = M.doors;

  for (const d of doorSpecs) {
    doorsWorld.push({ use: d.use, sec: d.sec, pos: new THREE.Vector3(), right: new THREE.Vector3() });
  }

  buildBoot(scene, mats, ringModel);

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
  for (const p of steerPivots) p.rotation.y = -S.delta;
  for (const w of wheelMeshes) w.rotation.z = S.wheelSpin;

  // boot rings: interpolate position and yaw across the real joint angle
  _a.set(rs.x + bootA * c1, 0, rs.z + bootA * s1);
  _b.set(px + bootB * c2, 0, pz + bootB * s2);
  const dyaw = wrapPi(rs.psiVis - rs.psi1);
  for (let i = 0; i < BOOT_RINGS; i++) {
    const t = (i + 0.5) / BOOT_RINGS;
    const ring = boot[i];
    ring.position.x = _a.x + (_b.x - _a.x) * t;
    ring.position.z = _a.z + (_b.z - _a.z) * t;
    ring.rotation.y = -(rs.psi1 + dyaw * t);
  }
}

// Live world pose of every service door — updated in place, no allocation.
// Front doors ride the front section; rear doors ride the trailing unit, which
// is at the pivot and yawed by psiVis, so at full articulation the rear door
// can be metres away from where the front pose would put it.
export function getDoors(rs) {
  const c1 = Math.cos(rs.psi1), s1 = Math.sin(rs.psi1);
  const c2 = Math.cos(rs.psiVis), s2 = Math.sin(rs.psiVis);
  const px = rs.x - CFG.HITCH_D * c1;
  const pz = rs.z - CFG.HITCH_D * s1;

  for (let i = 0; i < doorSpecs.length; i++) {
    const d = doorSpecs[i], w = doorsWorld[i];
    const rearSide = d.sec === 'rear';
    const ox = rearSide ? px : rs.x, oz = rearSide ? pz : rs.z;
    const c = rearSide ? c2 : c1, s = rearSide ? s2 : s1;
    w.pos.set(ox + d.x * c - d.z * s, 0, oz + d.x * s + d.z * c);
    w.right.set(-s, 0, c);
  }
  return doorsWorld;
}
