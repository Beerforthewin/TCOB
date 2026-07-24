import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { G, lambert } from './palette.js';

// ---------------------------------------------------------------------------
// The closed road-loop centerline. Single source of truth for the road mesh,
// markings, stop placement, lamp placement and the on-road test.
// ---------------------------------------------------------------------------

function makeLoopPoints() {
  const W = CFG.LOOP_W / 2, H = CFG.LOOP_H / 2, R = CFG.LOOP_R;
  const sx = W - R, sz = H - R;
  const pts = [];
  // straight segment, last point excluded (next segment supplies it)
  const seg = (x0, z0, x1, z1) => {
    const dx = x1 - x0, dz = z1 - z0;
    const n = Math.max(1, Math.round(Math.hypot(dx, dz) / 6));
    for (let i = 0; i < n; i++) {
      const s = i / n;
      pts.push(new THREE.Vector3(x0 + dx * s, 0, z0 + dz * s));
    }
  };
  // quarter arc, last point excluded
  const arc = (cx, cz, a0, a1) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push(new THREE.Vector3(cx + R * Math.cos(a), 0, cz + R * Math.sin(a)));
    }
  };
  // clockwise on screen (interior of the block is on the RIGHT of travel)
  seg(-sx, -H, sx, -H);
  arc(sx, -sz, -Math.PI / 2, 0);
  seg(W, -sz, W, sz);
  arc(sx, sz, 0, Math.PI / 2);
  seg(sx, H, -sx, H);
  arc(-sx, sz, Math.PI / 2, Math.PI);
  seg(-W, sz, -W, -sz);
  arc(-sx, -sz, Math.PI, Math.PI * 1.5);
  return pts;
}

export const curve = new THREE.CatmullRomCurve3(makeLoopPoints(), true, 'catmullrom', 0.5);
export const LOOP_LEN = curve.getLength();

// Fine sample table for nearest-point queries (600 x float compare per physics
// step — trivial).
const N_SAMPLES = 600;
const samples = [];
for (let i = 0; i < N_SAMPLES; i++) {
  const t = i / N_SAMPLES;
  samples.push({
    t,
    p: curve.getPointAt(t, new THREE.Vector3()),
    tan: curve.getTangentAt(t, new THREE.Vector3()),
  });
}

const _near = { t: 0, dist: 0, point: null, tan: null };
export function nearestSample(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N_SAMPLES; i++) {
    const p = samples[i].p;
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  const s = samples[best];
  _near.t = s.t;
  _near.dist = Math.sqrt(bd);
  _near.point = s.p;
  _near.tan = s.tan;
  return _near;
}

// Frame (point / tangent / right vector / heading) at loop parameter t.
// "right" points to the right of the direction of travel = block interior.
export function frameAt(t, out = {}) {
  const tw = ((t % 1) + 1) % 1;
  out.p = curve.getPointAt(tw, out.p || new THREE.Vector3());
  out.tan = curve.getTangentAt(tw, out.tan || new THREE.Vector3());
  out.right = (out.right || new THREE.Vector3()).set(-out.tan.z, 0, out.tan.x);
  out.heading = Math.atan2(out.tan.z, out.tan.x);
  return out;
}

// Ribbon strip along the curve between offsets o1..o2 (m, +right), at height y.
export function stripGeometry(t0, t1, segs, o1, o2, y) {
  const pos = [], norm = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = (((t0 + (t1 - t0) * (i / segs)) % 1) + 1) % 1;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    const rx = -tan.z, rz = tan.x;
    pos.push(p.x + rx * o1, y, p.z + rz * o1, p.x + rx * o2, y, p.z + rz * o2);
    norm.push(0, 1, 0, 0, 1, 0);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(idx);
  return g;
}

export function buildTrack(scene) {
  const RH = CFG.ROAD_HALF;

  // road surface
  const road = new THREE.Mesh(stripGeometry(0, 1, 360, -RH, RH, 0.02), lambert(G.ASPHALT));
  road.receiveShadow = true;
  scene.add(road);

  const markMat = lambert(G.BUS, false, {
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  // dashed centerline
  const dashGeos = [];
  const period = 6, dash = 2.8;
  for (let s = 0; s < LOOP_LEN - period; s += period) {
    dashGeos.push(stripGeometry(s / LOOP_LEN, (s + dash) / LOOP_LEN, 4, -0.14, 0.14, 0.05));
  }
  const dashes = new THREE.Mesh(mergeGeometries(dashGeos), markMat);
  dashes.receiveShadow = true;
  scene.add(dashes);

  // solid edge lines
  for (const [a, b] of [[-RH + 0.08, -RH + 0.30], [RH - 0.30, RH - 0.08]]) {
    const line = new THREE.Mesh(stripGeometry(0, 1, 360, a, b, 0.045), markMat);
    line.receiveShadow = true;
    scene.add(line);
  }

  // inner sidewalk + curb (block interior is on the +right side)
  const sidewalk = new THREE.Mesh(stripGeometry(0, 1, 360, RH + 0.1, RH + 2.7, 0.12), lambert(G.SIDEWALK));
  sidewalk.receiveShadow = true;
  scene.add(sidewalk);
  const curb = new THREE.Mesh(stripGeometry(0, 1, 360, RH - 0.05, RH + 0.2, 0.14), lambert(G.CURB));
  curb.receiveShadow = true;
  scene.add(curb);
}
