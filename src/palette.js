import * as THREE from 'three';

// The ONLY color constructor in the entire codebase. Perfect grayscale by construction.
export const gray = v => new THREE.Color(v, v, v);

// Named values of the grayscale hierarchy (dark -> light).
export const G = Object.freeze({
  DARK:      0.10,   // wheels, windows, boot, tree trunks
  ASPHALT:   0.28,
  PAX:       0.35,   // passengers vary 0.30-0.45
  WALL:      0.55,   // buildings vary 0.45-0.70
  GRASS:     0.72,
  SIDEWALK:  0.82,
  CURB:      0.88,
  BUS:       0.95,   // bus body, lane markings
  SKY:       0.90,   // background / fog
});

// Shared material factory — MeshLambertMaterial everywhere, per the art direction.
export function lambert(v, flat = false, opts = {}) {
  return new THREE.MeshLambertMaterial({ color: gray(v), flatShading: flat, ...opts });
}
