import * as THREE from 'three';
import { CFG } from './config.js';
import { gray, G } from './palette.js';

// Light intensities are balanced so a horizontal surface receives ~1.0 total —
// authored gray values then render as themselves (NoToneMapping).
const DIR_I = 0.65, AMB_I = 0.38, HEMI_I = 0.12;
const LDIR = new THREE.Vector3(-0.6, 1, -0.4).normalize();

let renderer, scene, camera, dirLight;

// camera follow state
const camTarget = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _offset = new THREE.Vector3();
const CAM_BASE = new THREE.Vector3(1, 0.82, 1).normalize().multiplyScalar(CFG.CAM_DIST);

// Q/E view rotation tween
let yawFrom = 0, yawTo = 0, yawT = 1;

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const currentYaw = () => yawFrom + (yawTo - yawFrom) * easeInOut(Math.min(yawT, 1));

export function createScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = gray(G.SKY);
  scene.fog = new THREE.Fog(gray(G.SKY), 170, 430);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
  applyFrustum();

  scene.add(new THREE.AmbientLight(gray(1), AMB_I));
  scene.add(new THREE.HemisphereLight(gray(1), gray(0.45), HEMI_I));

  dirLight = new THREE.DirectionalLight(gray(1), DIR_I);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  const sc = dirLight.shadow.camera;
  sc.left = -CFG.SHADOW_SPAN; sc.right = CFG.SHADOW_SPAN;
  sc.top = CFG.SHADOW_SPAN; sc.bottom = -CFG.SHADOW_SPAN;
  sc.near = 10; sc.far = 300;
  dirLight.shadow.bias = -0.0004;
  dirLight.shadow.normalBias = 0.6;
  scene.add(dirLight);
  scene.add(dirLight.target);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    applyFrustum();
  });

  return { scene, renderer, camera };
}

function applyFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  const hh = CFG.FRUSTUM_H / 2, hw = hh * aspect;
  camera.left = -hw; camera.right = hw;
  camera.top = hh; camera.bottom = -hh;
  camera.updateProjectionMatrix();
}

export function rotateView(dir) {
  yawFrom = currentYaw();
  yawTo = yawTo + dir * Math.PI / 2;
  // keep the pair bounded
  const k = Math.floor(yawTo / (Math.PI * 2));
  yawTo -= k * Math.PI * 2; yawFrom -= k * Math.PI * 2;
  yawT = 0;
}

export function snapCameraTo(rs) {
  camTarget.set(rs.x, 0, rs.z);
  updateCamera(0, rs, 0);
}

export function updateCamera(dt, rs, v) {
  if (yawT < 1) yawT = Math.min(yawT + dt / CFG.CAM_TWEEN, 1);
  const yaw = currentYaw();

  // follow target: bus + speed-scaled look-ahead, exponential smoothing
  const look = Math.max(-CFG.CAM_LOOKAHEAD_MAX, Math.min(v * CFG.CAM_LOOKAHEAD, CFG.CAM_LOOKAHEAD_MAX));
  _desired.set(rs.x + Math.cos(rs.psi1) * look, 0, rs.z + Math.sin(rs.psi1) * look);
  const k = dt > 0 ? 1 - Math.exp(-CFG.CAM_SMOOTH * dt) : 1;
  camTarget.lerp(_desired, k);

  // rotate the iso offset about Y by the view yaw
  const c = Math.cos(yaw), s = Math.sin(yaw);
  _offset.set(CAM_BASE.x * c + CAM_BASE.z * s, CAM_BASE.y, -CAM_BASE.x * s + CAM_BASE.z * c);
  camera.position.copy(camTarget).add(_offset);
  camera.lookAt(camTarget);

  // shadow frustum follows the action
  dirLight.position.copy(camTarget).addScaledVector(LDIR, 110);
  dirLight.target.position.copy(camTarget);
  dirLight.target.updateMatrixWorld();
}

export function render() {
  renderer.render(scene, camera);
}
