import { CFG } from './config.js';

let elDelivered, elOnboard, elBar, elSpeed, elGear, elPrompt, elScore;
const last = { delivered: -1, onboard: -1, speed: -1, gear: '', prompt: null };

export function initHud() {
  elScore = document.getElementById('score');
  elDelivered = document.getElementById('delivered');
  elOnboard = document.getElementById('onboard');
  elBar = document.getElementById('onboardBar');
  elSpeed = document.getElementById('speed');
  elGear = document.getElementById('gear');
  elPrompt = document.getElementById('prompt');
}

export function updateHud(game, state, prompt) {
  if (game.delivered !== last.delivered) {
    last.delivered = game.delivered;
    elDelivered.textContent = game.delivered;
  }

  const n = game.onboard.length;
  if (n !== last.onboard) {
    last.onboard = n;
    elOnboard.textContent = `${n} / ${CFG.CAPACITY}`;
    elBar.style.width = `${(n / CFG.CAPACITY) * 100}%`;
    elScore.classList.toggle('full', n >= CFG.CAPACITY);
  }

  const kmh = Math.round(Math.abs(state.v) * 3.6);
  if (kmh !== last.speed) {
    last.speed = kmh;
    elSpeed.textContent = kmh;
  }

  const gear = Math.abs(state.v) < 0.05 ? 'N' : state.gear;
  if (gear !== last.gear) {
    last.gear = gear;
    elGear.textContent = gear;
  }

  if (prompt !== last.prompt) {
    last.prompt = prompt;
    if (prompt) { elPrompt.textContent = prompt; elPrompt.hidden = false; }
    else elPrompt.hidden = true;
  }
}
