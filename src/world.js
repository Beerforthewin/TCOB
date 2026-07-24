import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { G, lambert } from './palette.js';
import { frameAt } from './track.js';

// Hand-placed block-interior buildings: x, z, width, depth, height, gray value.
const INNER = [
  { x: -42, z: -26, w: 24, d: 16, h: 14, g: 0.62 },
  { x: -10, z: -28, w: 22, d: 13, h: 20, g: 0.50 },
  { x: 24, z: -26, w: 22, d: 15, h: 9, g: 0.68 },
  { x: 50, z: -6, w: 16, d: 20, h: 16, g: 0.55 },
  { x: 22, z: 24, w: 24, d: 14, h: 7, g: 0.70 },
  { x: -12, z: 22, w: 18, d: 16, h: 22, g: 0.46 },
  { x: -44, z: 16, w: 18, d: 18, h: 11, g: 0.58 },
];

// Sparse outer ring so the horizon isn't empty (they sit in the fog).
const OUTER = [
  { x: -95, z: -40, w: 18, d: 14, h: 10, g: 0.56 },
  { x: -96, z: 0, w: 16, d: 18, h: 15, g: 0.50 },
  { x: -95, z: 40, w: 20, d: 14, h: 8, g: 0.62 },
  { x: 95, z: -35, w: 16, d: 16, h: 12, g: 0.54 },
  { x: 96, z: 10, w: 18, d: 14, h: 18, g: 0.48 },
  { x: 95, z: 45, w: 14, d: 14, h: 9, g: 0.60 },
  { x: -45, z: -78, w: 20, d: 16, h: 12, g: 0.52 },
  { x: 0, z: -80, w: 24, d: 14, h: 16, g: 0.58 },
  { x: 45, z: -78, w: 18, d: 14, h: 9, g: 0.64 },
  { x: -45, z: 78, w: 18, d: 14, h: 11, g: 0.55 },
  { x: 5, z: 80, w: 22, d: 16, h: 13, g: 0.50 },
  { x: 50, z: 78, w: 16, d: 14, h: 10, g: 0.62 },
];

const TREES = [
  [-60, -8], [-60, 12], [-24, -14], [4, -16], [40, -14], [60, 20],
  [44, 20], [2, 10], [-28, 8], [-26, 28], [6, 32], [40, 34],
];

export function buildWorld(scene) {
  // ground plane (grass)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), lambert(G.GRASS));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  buildBuildings(scene, INNER, true);
  buildBuildings(scene, OUTER, false);
  buildTrees(scene);
  buildLamps(scene);
}

function buildBuildings(scene, list, withWindows) {
  const winGeos = [];
  const winProto = new THREE.PlaneGeometry(1.1, 1.4);
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _e = new THREE.Euler();

  const addWindowRow = (cx, cz, len, y, yaw, ox, oz) => {
    // ox/oz: outward unit normal of the wall
    const n = Math.max(0, Math.floor((len - 2.4) / 2.6));
    if (n === 0) return;
    const start = -((n - 1) * 2.6) / 2;
    for (let i = 0; i < n; i++) {
      const along = start + i * 2.6;
      // wall runs perpendicular to its normal
      const ax = -oz, az = ox;
      _p.set(cx + ax * along + ox * 0.04, y, cz + az * along + oz * 0.04);
      _q.setFromEuler(_e.set(0, yaw, 0));
      _m.compose(_p, _q, _s);
      winGeos.push(winProto.clone().applyMatrix4(_m));
    }
  };

  for (const b of list) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), lambert(b.g));
    body.position.set(b.x, b.h / 2, b.z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.5, 0.35, b.d + 0.5), lambert(b.g * 0.8));
    roof.position.set(b.x, b.h + 0.1, b.z);
    roof.castShadow = true;
    scene.add(roof);

    if (withWindows) {
      for (let y = 1.7; y < b.h - 1.2; y += 3.0) {
        addWindowRow(b.x, b.z + b.d / 2, b.w, y, 0, 0, 1);            // +Z face
        addWindowRow(b.x, b.z - b.d / 2, b.w, y, Math.PI, 0, -1);     // -Z face
        addWindowRow(b.x + b.w / 2, b.z, b.d, y, Math.PI / 2, 1, 0);  // +X face
        addWindowRow(b.x - b.w / 2, b.z, b.d, y, -Math.PI / 2, -1, 0);// -X face
      }
    }
  }

  if (winGeos.length) {
    const windows = new THREE.Mesh(mergeGeometries(winGeos), lambert(0.14));
    scene.add(windows);
  }
}

function buildTrees(scene) {
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6);
  const cone1Geo = new THREE.ConeGeometry(1.5, 2.4, 7);
  const cone2Geo = new THREE.ConeGeometry(1.05, 1.9, 7);
  const trunkMat = lambert(G.DARK, true);
  const leafMat1 = lambert(0.44, true);
  const leafMat2 = lambert(0.50, true);
  for (const [x, z] of TREES) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.8;
    const c1 = new THREE.Mesh(cone1Geo, leafMat1);
    c1.position.y = 2.4;
    const c2 = new THREE.Mesh(cone2Geo, leafMat2);
    c2.position.y = 3.9;
    trunk.castShadow = c1.castShadow = c2.castShadow = true;
    t.add(trunk, c1, c2);
    const s = 0.85 + ((x * 13 + z * 7) % 10) / 30; // deterministic size variety
    t.scale.setScalar(s);
    t.position.set(x, 0, z);
    scene.add(t);
  }
}

function buildLamps(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6);
  const headGeo = new THREE.BoxGeometry(0.7, 0.15, 0.18);
  const poleMat = lambert(0.32, true);
  const headMat = lambert(0.20, true);
  const f = {};
  for (let k = 0; k < 16; k++) {
    const t = k / 16;
    // keep clear of the stops
    let nearStop = false;
    for (const ts of CFG.STOP_TS) {
      const d = Math.abs(t - ts);
      if (Math.min(d, 1 - d) < 0.025) { nearStop = true; break; }
    }
    if (nearStop) continue;
    frameAt(t, f);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(
      f.p.x + f.right.x * (CFG.ROAD_HALF + 3.1), 2.3,
      f.p.z + f.right.z * (CFG.ROAD_HALF + 3.1));
    pole.castShadow = true;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(
      pole.position.x - f.right.x * 0.4, 4.55,
      pole.position.z - f.right.z * 0.4);
    head.rotation.y = -f.heading;
    head.castShadow = true;
    scene.add(pole, head);
  }
}
