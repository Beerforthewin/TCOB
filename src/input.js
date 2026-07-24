// Keyboard + touch input.
//
// Keyboard yields ±1; the on-screen stick yields ANALOG values, which the
// steering model consumes directly (delta target = steer * lock). Sources are
// merged: max() for the pedals, clamped sum for steering.

const pressed = new Set();
const taps = [];

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
const TAPS = new Set(['KeyQ', 'KeyE', 'KeyR']);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// analog steering contribution from the on-screen stick
const touch = { steer: 0 };

export function initInput() {
  window.addEventListener('keydown', e => {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    pressed.add(e.code);
    if (TAPS.has(e.code)) taps.push(e.code);
  });
  window.addEventListener('keyup', e => pressed.delete(e.code));
  window.addEventListener('blur', () => { pressed.clear(); releaseStick(); releasePedals(); });

  initTouch();
}

const sample = { steer: 0, throttle: 0, brake: 0, handbrake: false };

export function sampleInput() {
  const has = c => pressed.has(c);
  const kThrottle = (has('KeyW') || has('ArrowUp')) ? 1 : 0;
  const kBrake = (has('KeyS') || has('ArrowDown')) ? 1 : 0;
  const kSteer = ((has('KeyD') || has('ArrowRight')) ? 1 : 0) - ((has('KeyA') || has('ArrowLeft')) ? 1 : 0);

  sample.throttle = Math.max(kThrottle, gasId !== null ? 1 : 0);
  sample.brake = Math.max(kBrake, brakeId !== null ? 1 : 0);
  sample.steer = clamp(kSteer + touch.steer, -1, 1);
  sample.handbrake = has('Space');
  return sample;
}

export function consumeTaps() {
  return taps.splice(0);
}

// ---------------------------------------------------------------------------
// On-screen touch controls:
//   bottom-left  — floating steering stick (horizontal axis only)
//   bottom-right — two pedal rectangles, BRAKE then GAS (gas outermost, under
//                  the resting right thumb)
//   middle band  — horizontal swipe steps the isometric view 90°
// ---------------------------------------------------------------------------

const DEADZONE = 0.14;          // fraction of stick radius ignored around centre
const SWIPE_MAX_PX = 70;        // swipe distance for one 90° step (or 12% of width)

let elTouch, elZone, elBase, elKnob, elGas, elBrake, elSwipe;
let stickId = null, gasId = null, brakeId = null, swipeId = null;
let baseX = 0, radius = 70, swipeX = 0;

function touchWanted() {
  if (new URLSearchParams(location.search).has('touch')) return true;   // desktop testing
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return 'ontouchstart' in window && navigator.maxTouchPoints > 0;
}

function initTouch() {
  elTouch = document.getElementById('touch');
  if (!elTouch || !touchWanted()) return;

  elZone = document.getElementById('stickZone');
  elBase = document.getElementById('stickBase');
  elKnob = document.getElementById('stickKnob');
  elGas = document.getElementById('gasPad');
  elBrake = document.getElementById('brakePad');
  elSwipe = document.getElementById('swipeZone');

  elTouch.hidden = false;
  document.body.classList.add('touch-mode');
  restBase();
  window.addEventListener('resize', restBase);

  // ---- stick ----
  elZone.addEventListener('pointerdown', e => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    capture(elZone, e.pointerId);
    radius = (elBase.offsetWidth - elKnob.offsetWidth) / 2;
    baseX = e.clientX;
    placeBase(e.clientX, e.clientY);
    elTouch.classList.add('stick-active');
    moveKnob(e.clientX);
    e.preventDefault();
  });
  elZone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    moveKnob(e.clientX);
    e.preventDefault();
  });
  elZone.addEventListener('pointerup', e => { if (e.pointerId === stickId) releaseStick(); });
  elZone.addEventListener('pointercancel', e => { if (e.pointerId === stickId) releaseStick(); });

  // ---- pedals ----
  const pedal = (el, set, get) => {
    el.addEventListener('pointerdown', e => {
      if (get() !== null) return;
      set(e.pointerId);
      capture(el, e.pointerId);
      el.classList.add('on');
      e.preventDefault();
    });
    const off = e => { if (e.pointerId === get()) { set(null); el.classList.remove('on'); } };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  };
  pedal(elGas, v => { gasId = v; }, () => gasId);
  pedal(elBrake, v => { brakeId = v; }, () => brakeId);

  // ---- middle-band swipe: rotate the isometric view ----
  elSwipe.addEventListener('pointerdown', e => {
    if (swipeId !== null) return;
    swipeId = e.pointerId;
    swipeX = e.clientX;
    capture(elSwipe, e.pointerId);
    e.preventDefault();
  });
  elSwipe.addEventListener('pointermove', e => {
    if (e.pointerId !== swipeId) return;
    const dx = e.clientX - swipeX;
    const threshold = Math.min(SWIPE_MAX_PX, window.innerWidth * 0.12);
    if (Math.abs(dx) >= threshold) {
      // swipe right drags the world right => view steps anticlockwise.
      // Flip these two codes to reverse the direction.
      taps.push(dx > 0 ? 'KeyQ' : 'KeyE');
      swipeX = e.clientX;                 // re-arm so a long drag can step again
      elSwipe.classList.add('used');
    }
    e.preventDefault();
  });
  const endSwipe = e => { if (e.pointerId === swipeId) swipeId = null; };
  elSwipe.addEventListener('pointerup', endSwipe);
  elSwipe.addEventListener('pointercancel', endSwipe);

  // ---- reset button (no keyboard on a phone) ----
  const elReset = document.getElementById('resetBtn');
  elReset.addEventListener('pointerdown', e => { taps.push('KeyR'); elReset.classList.add('on'); e.preventDefault(); });
  const offReset = () => elReset.classList.remove('on');
  elReset.addEventListener('pointerup', offReset);
  elReset.addEventListener('pointercancel', offReset);
}

// Pointer capture keeps a drag alive outside the element. It throws if the
// pointer is already gone, which we neither can nor need to prevent.
function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* pointer already released */ }
}

function placeBase(x, y) {
  elBase.style.left = `${x}px`;
  elBase.style.top = `${y}px`;
}

// resting position of the stick when untouched
function restBase() {
  if (!elBase) return;
  radius = (elBase.offsetWidth - elKnob.offsetWidth) / 2;
  placeBase(radius + window.innerWidth * 0.045, window.innerHeight - radius - window.innerHeight * 0.06);
  elKnob.style.transform = 'translate(-50%, -50%)';
}

// Steering only: the knob is constrained to the horizontal axis, which makes it
// obvious the stick does not also drive the throttle.
function moveKnob(cx) {
  const dx = clamp(cx - baseX, -radius, radius);
  elKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;

  const nx = dx / radius;
  touch.steer = Math.abs(nx) < DEADZONE ? 0 : (nx - Math.sign(nx) * DEADZONE) / (1 - DEADZONE);
}

function releaseStick() {
  stickId = null;
  touch.steer = 0;
  if (!elTouch) return;
  elTouch.classList.remove('stick-active');
  restBase();
}

function releasePedals() {
  gasId = brakeId = null;
  if (elGas) elGas.classList.remove('on');
  if (elBrake) elBrake.classList.remove('on');
}
