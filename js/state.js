// state.js — Central state, parameter definitions, and shared references.
import { generateBank } from "./generator.js?v=100";

export const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
export const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
export const SLOTS = 16;
export const PRESET_N = 5;
export const STATE_VERSION = 1;

export const DEFAULT = {
  randVel: false,
  randVelAmt: 0,
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, velMin: 1, velMax: 127, humanize: 0, gateQuant: 0, snapGrid: 4,
  gateBlend: 0, euclidRot: 0, euclidDiv: "auto",
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoShape: 0, lfoAmp: 50, lfoOffset: 0, lfoRate: 4, octave: 0, octaveMode: "up", gravity: 0, unipolar: false,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0, loop: 8, loopFrom: 1,
};

export const state = { ...DEFAULT };
export const refs = {};           // state key -> control element (has setValue)
export const locks = new Map();   // "slot:step" -> [{ note, vel }]

let selectedSlot = 0;
export function getSelected() { return selectedSlot; }
export function setSelected(s) { selectedSlot = Math.max(0, Math.min(SLOTS - 1, s)); }

let bank = [];
export function getBank() { return bank; }
export function setBank(b) { bank = b; }

let prevGateBlend = state.gateBlend > 0 ? state.gateBlend : 100;
export function getPrevGateBlend() { return prevGateBlend; }
export function setPrevGateBlend(v) { prevGateBlend = v; }

export function status(msg, cls = "") {
  const el = document.getElementById("status");
  if (el) { el.textContent = msg; el.className = "status " + cls; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Register a control under its state key; set(..., false) keeps it silent on sync
export function R(key, el) { refs[key] = el; return el; }

export const setState = (key, fn) => (v) => {
  state[key] = fn ? fn(v) : v;
  scheduleRegen();
};

// Regeneration hooks
let onRegenCallbacks = [];
export function onRegen(fn) { onRegenCallbacks.push(fn); }

let onTempoProbeCallbacks = [];
export function onTempoProbe(fn) { onTempoProbeCallbacks.push(fn); }

export function triggerRegenHooks() {
  for (const fn of onRegenCallbacks) fn();
}

export function doGenerate(newSeed = false) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  refs.seed?.setValue(state.seed, false);
  bank = generateBank(state, state.drift);
  triggerRegenHooks();
  status(`16 slots · seed ${state.seed >>> 0}`);
}

let regenTimer = null;
export function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    bank = generateBank(state, state.drift);
    triggerRegenHooks();
  }, 40);
  for (const fn of onTempoProbeCallbacks) fn();
}
