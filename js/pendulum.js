// pendulum.js — Chaotic Double Pendulum Sequencer Model for FM-1 Pulses.
// Simulates deterministic chaos via Runge-Kutta 4th-order (RK4) integration of Euler-Lagrange equations.
// Divides the pendulum reach circle into 36 radial sectors, each representing a scale-quantized note.
// Notes trigger directly in real-time when either pendulum (Bob 1 or Bob 2) sweeps into an active sector.
// Gates are controlled entirely by the angle as bobs enter/exit active sectors (no discrete 64-step clock).
// Note positions across the 36 sectors are randomized/shuffled upon pressing the Random button.
// Users can toggle sectors directly by clicking/painting on the canvas ring or via rack buttons.

import { state, refs, status, setModelGenerator, setModelRandomizer, onRegen } from "./state.js";
import { liveNoteOn, liveNoteOff, panicPreview, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { registerModel } from "./snapshot.js";
import { getActiveModel } from "./modes.js";
import { SCALES, quantize, midiName } from "./generator.js";
import { knob, dropdown } from "./controls.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";
import { getRootMidi, getActiveScaleIntervals } from "./scale.js";

// ---- Mathematical & Physics Constants ----
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
export const NUM_SECTORS = 36;
const SECTOR_RAD = (2 * Math.PI) / NUM_SECTORS; // 10 degrees in radians

// Simulation State
let simTheta1 = 120 * DEG2RAD;
let simTheta2 = 110 * DEG2RAD;
let simOmega1 = 0;
let simOmega2 = 0;

let loopMode = state.pendulumLoopMode || "loop"; // "loop" | "free"
let loopFrameCounter = 0;
const LOOP_CYCLE_FRAMES = 600; // ~10 seconds at 60 FPS in loop mode
let attractorTrail = [];
const MAX_TRAIL_LENGTH = 100;

// Transport & Animation State
let isRunning = false;
let animFrameId = null;

// Real-time Angle-Controlled Gate Tracking
const sectorFlashTimers = new Uint8Array(NUM_SECTORS);
let livePrevSector1 = -1;
let livePrevSector2 = -1;
let bob1HeldNote = null;
let bob2HeldNote = null;
let bob1NoteAge = 0;
let bob2NoteAge = 0;
const activeSoundingNotes = new Set();
let triggerFlashTimer = 0;

// UI & Interaction State
let containerEl = null;
let canvas = null;
let ctx = null;
let hoverCoordEl = null;
let sectorBadgeEl = null;
let sectorBtnEls = [];

// Dragging modes: 0: none, 1: Bob 1, 2: Bob 2, 3: Sector Ring Painting
let dragMode = 0;
let dragSectorVal = 1; // 1: enabling, 0: disabling
let lastDraggedSector = -1;

// Reusable DOM refs
const pendulumRefs = {};
function R(k, el) {
  pendulumRefs[k] = el;
  refs[k] = el;
  return el;
}

// Ensure pendulumSectors array is initialized
export function getSectors() {
  if (!Array.isArray(state.pendulumSectors) || state.pendulumSectors.length !== NUM_SECTORS) {
    state.pendulumSectors = Array(NUM_SECTORS).fill(1);
  }
  return state.pendulumSectors;
}

/**
 * Generates an ordered array of 36 scale-quantized notes spanning the octave range defined by main pitch controls.
 */
export function generateOrderedSectorNotes() {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const octaves = Number(state.pitchSpan ?? 3);
  const spanSemitones = octaves * 12;
  const notes = [];
  for (let i = 0; i < NUM_SECTORS; i++) {
    const raw = root + Math.round((i / (NUM_SECTORS - 1)) * spanSemitones);
    notes.push(quantize(raw, intervals, root));
  }
  return notes;
}

/**
 * Re-quantizes and updates the 36 sector notes according to the main pitch controls
 * (scale, root, pitchSpan) while preserving the current shuffled layout permutation.
 */
export function updateSectorNotesFromMainControls() {
  const ordered = generateOrderedSectorNotes();
  if (!Array.isArray(state.pendulumSectorPermutation) || state.pendulumSectorPermutation.length !== NUM_SECTORS) {
    shuffleSectorNotes();
    return;
  }
  state.pendulumSectorNotes = state.pendulumSectorPermutation.map((idx) => ordered[idx % ordered.length]);
  updateSectorUI();
  renderCanvas();
}

/**
 * Shuffles note positions across the 36 sectors on the circle.
 * Invoked on Random button press or user request.
 */
export function shuffleSectorNotes() {
  const ordered = generateOrderedSectorNotes();
  const perm = Array.from({ length: NUM_SECTORS }, (_, i) => i);
  // Fisher-Yates shuffle
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  state.pendulumSectorPermutation = perm;
  state.pendulumSectorNotes = perm.map((idx) => ordered[idx]);
  updateSectorUI();
  renderCanvas();
  status("Shuffled 36 sector notes across the circle", "ok");
}

/**
 * Returns the scale-quantized note mapped to a given sector index 0..35.
 */
export function getSectorNote(sectorIdx) {
  if (!Array.isArray(state.pendulumSectorNotes) || state.pendulumSectorNotes.length !== NUM_SECTORS) {
    shuffleSectorNotes();
  }
  return state.pendulumSectorNotes[sectorIdx] ?? (getRootMidi() + sectorIdx);
}

// Preset Curated States
export const PENDULUM_PRESETS = [
  {
    name: "36 Radial Bells",
    desc: "All 36 sectors active: continuous chaotic bell sweeps triggered whenever Bob 1 or Bob 2 sweeps through a sector",
    setup: () => {
      state.pendulumL1 = 100;
      state.pendulumL2 = 90;
      state.pendulumM1 = 14;
      state.pendulumM2 = 10;
      state.pendulumGravity = 10;
      state.pendulumDamping = 0.0008;
      state.pendulumDrive = 0.15;
      state.pendulumInitTheta1 = 135;
      state.pendulumInitTheta2 = 115;
      state.pendulumSectors = Array(NUM_SECTORS).fill(1);
    }
  },
  {
    name: "Alternating Bells",
    desc: "Even-numbered sectors active (18 notes), creating rhythmic gaps and syncopated melodies",
    setup: () => {
      state.pendulumL1 = 100;
      state.pendulumL2 = 85;
      state.pendulumM1 = 16;
      state.pendulumM2 = 9;
      state.pendulumGravity = 11;
      state.pendulumDamping = 0.001;
      state.pendulumDrive = 0.2;
      state.pendulumInitTheta1 = 140;
      state.pendulumInitTheta2 = 120;
      state.pendulumSectors = Array.from({ length: NUM_SECTORS }, (_, i) => (i % 2 === 0 ? 1 : 0));
    }
  },
  {
    name: "Quarter Triads",
    desc: "Every 3rd sector active (12 notes corresponding to diatonic and triadic intervals), forming sparse harmonic chimes",
    setup: () => {
      state.pendulumL1 = 95;
      state.pendulumL2 = 95;
      state.pendulumM1 = 14;
      state.pendulumM2 = 14;
      state.pendulumGravity = 9.8;
      state.pendulumDamping = 0.0005;
      state.pendulumDrive = 0.0;
      state.pendulumInitTheta1 = 70;
      state.pendulumInitTheta2 = 60;
      state.pendulumSectors = Array.from({ length: NUM_SECTORS }, (_, i) => (i % 3 === 0 ? 1 : 0));
    }
  },
  {
    name: "Compass Cardinals",
    desc: "Only the 4 quadrants (North, East, South, West sectors) active, acting as rhythmic boundary gates",
    setup: () => {
      state.pendulumL1 = 105;
      state.pendulumL2 = 85;
      state.pendulumM1 = 18;
      state.pendulumM2 = 10;
      state.pendulumGravity = 10;
      state.pendulumDamping = 0.001;
      state.pendulumDrive = 0.1;
      state.pendulumInitTheta1 = 120;
      state.pendulumInitTheta2 = 100;
      state.pendulumSectors = Array.from({ length: NUM_SECTORS }, (_, i) => (i % 9 === 0 ? 1 : 0));
    }
  },
  {
    name: "Chaotic Whip",
    desc: "Light outer bob with violent flips and rapid pitch cascades across all sectors",
    setup: () => {
      state.pendulumL1 = 100;
      state.pendulumL2 = 85;
      state.pendulumM1 = 18;
      state.pendulumM2 = 8;
      state.pendulumGravity = 12;
      state.pendulumDamping = 0.001;
      state.pendulumDrive = 0.2;
      state.pendulumInitTheta1 = 140;
      state.pendulumInitTheta2 = 125;
      state.pendulumSectors = Array(NUM_SECTORS).fill(1);
    }
  },
  {
    name: "Orbital Micro-G",
    desc: "Low gravity and minimal drag creating slow, floating somersaults through the sector ring",
    setup: () => {
      state.pendulumL1 = 110;
      state.pendulumL2 = 85;
      state.pendulumM1 = 12;
      state.pendulumM2 = 12;
      state.pendulumGravity = 2.0;
      state.pendulumDamping = 0.0002;
      state.pendulumDrive = 0.05;
      state.pendulumInitTheta1 = 175;
      state.pendulumInitTheta2 = 160;
      state.pendulumSectors = Array(NUM_SECTORS).fill(1);
    }
  }
];

// ---- Sector & Polar Geometry Helpers ----

/**
 * Calculates polar angle [0, 2*PI) measured clockwise starting from 12 o'clock (top).
 */
export function getPolarAngleFromTop(x, y) {
  let a = Math.atan2(x, -y);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

/**
 * Maps Cartesian offset (x, y) relative to pivot into a sector index 0..35.
 */
export function getSectorIndex(x, y) {
  const a = getPolarAngleFromTop(x, y);
  return Math.min(NUM_SECTORS - 1, Math.max(0, Math.floor((a / (2 * Math.PI)) * NUM_SECTORS)));
}

// ---- Physics Engine: Euler-Lagrange via 4th-Order Runge-Kutta (RK4) ----

function getDerivatives(th1, th2, w1, w2, L1, L2, m1, m2, g, damping) {
  const dTh = th1 - th2;
  const sinDTh = Math.sin(dTh);
  const cosDTh = Math.cos(dTh);
  const mu = 1 + m1 / m2;

  let denom1 = L1 * (mu - cosDTh * cosDTh);
  let denom2 = L2 * (mu - cosDTh * cosDTh);
  if (Math.abs(denom1) < 1e-6) denom1 = Math.sign(denom1) * 1e-6 || 1e-6;
  if (Math.abs(denom2) < 1e-6) denom2 = Math.sign(denom2) * 1e-6 || 1e-6;

  const num1 = g * (Math.sin(th2) * cosDTh - mu * Math.sin(th1))
             - (L2 * w2 * w2 + L1 * w1 * w1 * cosDTh) * sinDTh;
  const num2 = g * mu * (Math.sin(th1) * cosDTh - Math.sin(th2))
             + (mu * L1 * w1 * w1 + L2 * w2 * w2 * cosDTh) * sinDTh;

  const alpha1 = (num1 / denom1) - (damping * w1);
  const alpha2 = (num2 / denom2) - (damping * w2);

  return [w1, w2, alpha1, alpha2];
}

function rk4Step(th1, th2, w1, w2, dt, L1, L2, m1, m2, g, damping) {
  const k1 = getDerivatives(th1, th2, w1, w2, L1, L2, m1, m2, g, damping);

  const th1_k2 = th1 + 0.5 * dt * k1[0];
  const th2_k2 = th2 + 0.5 * dt * k1[1];
  const w1_k2 = w1 + 0.5 * dt * k1[2];
  const w2_k2 = w2 + 0.5 * dt * k1[3];
  const k2 = getDerivatives(th1_k2, th2_k2, w1_k2, w2_k2, L1, L2, m1, m2, g, damping);

  const th1_k3 = th1 + 0.5 * dt * k2[0];
  const th2_k3 = th2 + 0.5 * dt * k2[1];
  const w1_k3 = w1 + 0.5 * dt * k2[2];
  const w2_k3 = w2 + 0.5 * dt * k2[3];
  const k3 = getDerivatives(th1_k3, th2_k3, w1_k3, w2_k3, L1, L2, m1, m2, g, damping);

  const th1_k4 = th1 + dt * k3[0];
  const th2_k4 = th2 + dt * k3[1];
  const w1_k4 = w1 + dt * k3[2];
  const w2_k4 = w2 + dt * k3[3];
  const k4 = getDerivatives(th1_k4, th2_k4, w1_k4, w2_k4, L1, L2, m1, m2, g, damping);

  const nextTh1 = th1 + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  const nextTh2 = th2 + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  const nextW1 = w1 + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  const nextW2 = w2 + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

  return [nextTh1, nextTh2, nextW1, nextW2];
}

// Reset the simulation coordinates to initial angle parameters
function resetSimulationToInitial() {
  simTheta1 = Number(state.pendulumInitTheta1 ?? 120) * DEG2RAD;
  simTheta2 = Number(state.pendulumInitTheta2 ?? 110) * DEG2RAD;
  simOmega1 = 0;
  simOmega2 = 0;
  attractorTrail = [];
  livePrevSector1 = -1;
  livePrevSector2 = -1;
  loopFrameCounter = 0;
  releasePendulumNotes();
}

// ---- Transport & Real-time Gate Control ----

export function isPendulumRunning() {
  return isRunning;
}

function releasePendulumNotes() {
  if (bob1HeldNote !== null) {
    liveNoteOff(bob1HeldNote);
    audio.noteOff(bob1HeldNote);
    bob1HeldNote = null;
  }
  if (bob2HeldNote !== null) {
    liveNoteOff(bob2HeldNote);
    audio.noteOff(bob2HeldNote);
    bob2HeldNote = null;
  }
  for (const n of activeSoundingNotes) {
    liveNoteOff(n);
    audio.noteOff(n);
  }
  activeSoundingNotes.clear();
  panicPreview();
}

export function startPendulum() {
  isRunning = true;
  const btn = document.getElementById("audition");
  if (btn) {
    btn.textContent = "■ Stop";
    btn.classList.add("playing");
  }
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(stepPendulumLoop);
  }
  status("Pendulum simulation running — gates triggered by angle", "ok");
}

export function stopPendulum() {
  isRunning = false;
  releasePendulumNotes();
  const btn = document.getElementById("audition");
  if (btn) {
    btn.textContent = "▶ Play";
    btn.classList.remove("playing");
  }
  status("Pendulum stopped");
  renderCanvas();
}

export function togglePendulumRunning() {
  if (isRunning) {
    stopPendulum();
    return false;
  } else {
    startPendulum();
    return true;
  }
}

// Randomizer callback for 'R' / 'G' key / Random button
export function randomizePendulum() {
  state.pendulumInitTheta1 = Math.round(30 + Math.random() * 280);
  state.pendulumInitTheta2 = Math.round(20 + Math.random() * 300);
  state.pendulumL1 = Math.round(75 + Math.random() * 50);
  state.pendulumL2 = Math.round(70 + Math.random() * 45);
  state.pendulumM1 = Math.round(6 + Math.random() * 20);
  state.pendulumM2 = Math.round(5 + Math.random() * 18);
  state.pendulumGravity = Math.round((4 + Math.random() * 16) * 10) / 10;
  
  // Shuffle note positions around the circle
  shuffleSectorNotes();

  resetSimulationToInitial();
  syncAllControls();
  renderCanvas();
  status("Randomized Pendulum parameters and shuffled sector notes", "ok");
}

// ---- Main Continuous Physics & Audio Loop ----

function stepPendulumLoop() {
  if (isRunning && dragMode === 0) {
    const L1 = Number(state.pendulumL1 ?? 100);
    const L2 = Number(state.pendulumL2 ?? 90);
    const m1 = Number(state.pendulumM1 ?? 10);
    const m2 = Number(state.pendulumM2 ?? 10);
    const g = Number(state.pendulumGravity ?? 9.8);
    const damping = Number(state.pendulumDamping ?? 0.001);
    const drive = Number(state.pendulumDrive ?? 0);
    const baseVel = Number(state.pendulumVelocity ?? state.velocity ?? 100);
    const sectors = getSectors();

    // In loop mode, reset to initial parameters periodically
    if (loopMode === "loop") {
      loopFrameCounter++;
      if (loopFrameCounter >= LOOP_CYCLE_FRAMES) {
        loopFrameCounter = 0;
        resetSimulationToInitial();
      }
    }

    const dt = 0.02;
    const subTicks = 4;
    for (let t = 0; t < subTicks; t++) {
      [simTheta1, simTheta2, simOmega1, simOmega2] = rk4Step(
        simTheta1, simTheta2, simOmega1, simOmega2,
        dt, L1, L2, m1, m2, g, damping
      );
    }

    if (drive > 0) {
      simOmega2 += drive * 0.015;
    }

    const x1 = L1 * Math.sin(simTheta1);
    const y1 = L1 * Math.cos(simTheta1);
    const x2 = x1 + L2 * Math.sin(simTheta2);
    const y2 = y1 + L2 * Math.cos(simTheta2);

    // Record Bob 2 in phase trail
    attractorTrail.push({ x: x2, y: y2 });
    if (attractorTrail.length > MAX_TRAIL_LENGTH) {
      attractorTrail.shift();
    }

    const sec1 = getSectorIndex(x1, y1);
    const sec2 = getSectorIndex(x2, y2);

    const triggerBob = state.pendulumTriggerBob || "both";
    const allowBob1 = triggerBob === "both" || triggerBob === "bob1";
    const allowBob2 = triggerBob === "both" || triggerBob === "bob2";

    // Angle-controlled gate for Bob 1 (Inner Arm 1)
    if (allowBob1) {
      if (sec1 !== livePrevSector1) {
        livePrevSector1 = sec1;
        if (bob1HeldNote !== null) {
          liveNoteOff(bob1HeldNote);
          audio.noteOff(bob1HeldNote);
          activeSoundingNotes.delete(bob1HeldNote);
          bob1HeldNote = null;
        }
        bob1NoteAge = 0;
        if (sectors[sec1]) {
          const note1 = getSectorNote(sec1);
          const vel1 = Math.max(30, Math.min(127, Math.round(baseVel * (0.6 + 0.4 * Math.min(1, Math.abs(simOmega1) / 3)))));
          liveNoteOn(note1, vel1);
          audio.noteOn(note1, vel1);
          bob1HeldNote = note1;
          activeSoundingNotes.add(note1);
          sectorFlashTimers[sec1] = 8;
          triggerFlashTimer = 6;
        }
      } else if (bob1HeldNote !== null) {
        bob1NoteAge++;
        if (bob1NoteAge > 24) { // Release after ~400ms if bob lingers
          liveNoteOff(bob1HeldNote);
          audio.noteOff(bob1HeldNote);
          activeSoundingNotes.delete(bob1HeldNote);
          bob1HeldNote = null;
        }
      }
    } else {
      livePrevSector1 = sec1;
      if (bob1HeldNote !== null) {
        liveNoteOff(bob1HeldNote);
        audio.noteOff(bob1HeldNote);
        activeSoundingNotes.delete(bob1HeldNote);
        bob1HeldNote = null;
      }
    }

    // Angle-controlled gate for Bob 2 (Outer Arm 2)
    if (allowBob2) {
      if (sec2 !== livePrevSector2) {
        livePrevSector2 = sec2;
        if (bob2HeldNote !== null) {
          liveNoteOff(bob2HeldNote);
          audio.noteOff(bob2HeldNote);
          activeSoundingNotes.delete(bob2HeldNote);
          bob2HeldNote = null;
        }
        bob2NoteAge = 0;
        if (sectors[sec2]) {
          const note2 = getSectorNote(sec2);
          const vel2 = Math.max(30, Math.min(127, Math.round(baseVel * (0.7 + 0.3 * Math.min(1, Math.abs(simOmega2) / 4)))));
          liveNoteOn(note2, vel2);
          audio.noteOn(note2, vel2);
          bob2HeldNote = note2;
          activeSoundingNotes.add(note2);
          sectorFlashTimers[sec2] = 8;
          triggerFlashTimer = 6;
        }
      } else if (bob2HeldNote !== null) {
        bob2NoteAge++;
        if (bob2NoteAge > 24) { // Release after ~400ms if bob lingers
          liveNoteOff(bob2HeldNote);
          audio.noteOff(bob2HeldNote);
          activeSoundingNotes.delete(bob2HeldNote);
          bob2HeldNote = null;
        }
      }
    } else {
      livePrevSector2 = sec2;
      if (bob2HeldNote !== null) {
        liveNoteOff(bob2HeldNote);
        audio.noteOff(bob2HeldNote);
        activeSoundingNotes.delete(bob2HeldNote);
        bob2HeldNote = null;
      }
    }
  }

  renderCanvas();
  animFrameId = requestAnimationFrame(stepPendulumLoop);
}

// ---- Canvas Rendering & Direct Manipulation ----

function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(rect.width || 600);
  const h = Math.floor(rect.height || 420);

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  renderCanvas();
}

export function renderCanvas() {
  if (!canvas || !ctx) return;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 420;
  if (w <= 0 || h <= 0) return;

  const style = getComputedStyle(document.documentElement);
  const colPanel = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";

  // Flat canvas background
  ctx.fillStyle = colPanel2;
  ctx.fillRect(0, 0, w, h);

  const originX = w / 2;
  const originY = h * 0.44;

  const L1 = Number(state.pendulumL1 ?? 100);
  const L2 = Number(state.pendulumL2 ?? 90);
  const m1 = Number(state.pendulumM1 ?? 10);
  const m2 = Number(state.pendulumM2 ?? 10);
  const maxReach = L1 + L2;

  const sectors = getSectors();

  // Current Bob Coordinates
  const x1 = originX + L1 * Math.sin(simTheta1);
  const y1 = originY + L1 * Math.cos(simTheta1);
  const x2 = x1 + L2 * Math.sin(simTheta2);
  const y2 = y1 + L2 * Math.cos(simTheta2);

  const curSec1 = getSectorIndex(x1 - originX, y1 - originY);
  const curSec2 = getSectorIndex(x2 - originX, y2 - originY);

  const triggerBob = state.pendulumTriggerBob || "both";
  const allowBob1 = triggerBob === "both" || triggerBob === "bob1";
  const allowBob2 = triggerBob === "both" || triggerBob === "bob2";

  // 1. Draw 36 Radial Sectors Ring
  const ringInner = Math.max(20, maxReach - 10);
  const ringOuter = maxReach + 24;

  ctx.save();
  for (let i = 0; i < NUM_SECTORS; i++) {
    // Angular span: 0 radians at top (-PI/2), moving clockwise
    const aStart = -Math.PI / 2 + i * SECTOR_RAD;
    const aEnd = -Math.PI / 2 + (i + 1) * SECTOR_RAD;

    const isEnabled = Boolean(sectors[i]);
    const isFlash = sectorFlashTimers[i] > 0;
    const isBob1In = curSec1 === i && allowBob1;
    const isBob2In = curSec2 === i && allowBob2;

    // Decrement flash timer
    if (sectorFlashTimers[i] > 0) sectorFlashTimers[i]--;

    ctx.beginPath();
    ctx.arc(originX, originY, ringOuter, aStart, aEnd);
    ctx.arc(originX, originY, ringInner, aEnd, aStart, true);
    ctx.closePath();

    if (isFlash) {
      ctx.fillStyle = colFg;
      ctx.fill();
    } else if (isBob1In && isBob2In && isEnabled) {
      ctx.fillStyle = colFg;
      ctx.fill();
    } else if (isBob2In && isEnabled) {
      ctx.fillStyle = colAccent2;
      ctx.fill();
    } else if (isBob1In && isEnabled) {
      ctx.fillStyle = colAccent;
      ctx.fill();
    } else if (isEnabled) {
      ctx.fillStyle = colPanel;
      ctx.fill();
    } else {
      ctx.fillStyle = colPanel2;
      ctx.fill();
    }

    // Sector radial dividers & borders
    ctx.strokeStyle = isEnabled ? colLineFocus : colLine;
    ctx.lineWidth = isEnabled ? 1 : 0.5;
    ctx.stroke();

    // Note label every 3rd sector (12 key clock markers around the circle)
    if (i % 3 === 0) {
      const midAngle = (aStart + aEnd) / 2;
      const tx = originX + (ringOuter + 10) * Math.cos(midAngle);
      const ty = originY + (ringOuter + 10) * Math.sin(midAngle);
      const noteName = midiName(getSectorNote(i));

      ctx.fillStyle = isEnabled ? colDim : colLineFocus;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(noteName, tx, ty);
    }
  }
  ctx.restore();

  // 2. Reach Rings & Center Guides
  ctx.save();
  ctx.strokeStyle = colLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);

  // Inner reach ring
  ctx.beginPath();
  ctx.arc(originX, originY, L1, 0, 2 * Math.PI);
  ctx.stroke();

  // Center vertical axis
  ctx.beginPath();
  ctx.moveTo(originX, originY - maxReach);
  ctx.lineTo(originX, originY + maxReach);
  ctx.stroke();
  ctx.restore();

  // 3. Attractor Phase Trail
  if (attractorTrail.length > 1) {
    ctx.save();
    ctx.lineWidth = 1.5;
    for (let i = 1; i < attractorTrail.length; i++) {
      const alpha = (i / attractorTrail.length) * 0.75;
      ctx.strokeStyle = colAccent2;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(originX + attractorTrail[i - 1].x, originY + attractorTrail[i - 1].y);
      ctx.lineTo(originX + attractorTrail[i].x, originY + attractorTrail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. Pendulum Rods
  ctx.save();
  ctx.strokeStyle = colFg;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  // Rod 1 (Anchor to Bob 1)
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // Rod 2 (Bob 1 to Bob 2)
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();

  // Pivot Anchor
  ctx.fillStyle = colLineFocus;
  ctx.beginPath();
  ctx.arc(originX, originY, 4.5, 0, 2 * Math.PI);
  ctx.fill();

  // 5. Bob 1
  const r1 = Math.max(5, Math.min(18, Math.round(Math.sqrt(m1) * 3)));
  ctx.save();
  ctx.fillStyle = allowBob1 ? colAccent : colLine;
  ctx.beginPath();
  ctx.arc(x1, y1, r1, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = dragMode === 1 ? 2.5 : 1;
  ctx.strokeStyle = colFg;
  ctx.stroke();

  // Note Trigger Flash Ring around Bob 1
  if (triggerFlashTimer > 0 && allowBob1 && curSec1 === livePrevSector1 && sectors[curSec1]) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = colFg;
    ctx.beginPath();
    ctx.arc(x1, y1, r1 + 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  // 6. Bob 2
  const r2 = Math.max(5, Math.min(18, Math.round(Math.sqrt(m2) * 3)));
  ctx.save();
  ctx.fillStyle = allowBob2 ? colAccent2 : colLine;
  ctx.beginPath();
  ctx.arc(x2, y2, r2, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = dragMode === 2 ? 2.5 : 1;
  ctx.strokeStyle = colFg;
  ctx.stroke();

  // Note Trigger Flash Ring around outer bob
  if (triggerFlashTimer > 0 && allowBob2 && curSec2 === livePrevSector2 && sectors[curSec2]) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = colFg;
    ctx.beginPath();
    ctx.arc(x2, y2, r2 + 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (triggerFlashTimer > 0) triggerFlashTimer--;
  ctx.restore();

  // 7. HUD Status Readout (Bottom-Left)
  ctx.save();
  ctx.fillStyle = colDim;
  ctx.font = "10px monospace";
  const note1 = midiName(getSectorNote(curSec1));
  const note2 = midiName(getSectorNote(curSec2));
  const b1Status = allowBob1 ? `Sec ${curSec1 + 1} (${note1})` : "Muted";
  const b2Status = allowBob2 ? `Sec ${curSec2 + 1} (${note2})` : "Muted";
  const trigLabel = triggerBob === "both" ? "Bob 1 & 2" : (triggerBob === "bob1" ? "Bob 1 Only" : "Bob 2 Only");
  ctx.fillText(`Bob 1: ${b1Status}  ·  Bob 2: ${b2Status}  ·  Trigger: ${trigLabel}`, 12, h - 14);
  ctx.restore();
}

function updateSectorUI() {
  const sectors = getSectors();
  const activeCount = sectors.reduce((acc, v) => acc + (v ? 1 : 0), 0);

  if (sectorBadgeEl) {
    sectorBadgeEl.textContent = `${activeCount}/${NUM_SECTORS} ON`;
  }

  sectorBtnEls.forEach((btn, idx) => {
    btn.classList.toggle("is-active", Boolean(sectors[idx]));
    const nName = midiName(getSectorNote(idx));
    btn.title = `Sector ${idx + 1} (${idx * 10}°) → ${nName} — Click to toggle`;
  });
}

function setupCanvasInteraction() {
  if (!canvas) return;

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const pos = getMousePos(e);
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 420;
    const originX = w / 2;
    const originY = h * 0.44;

    const L1 = Number(state.pendulumL1 ?? 100);
    const L2 = Number(state.pendulumL2 ?? 90);
    const maxReach = L1 + L2;

    const x1 = originX + L1 * Math.sin(simTheta1);
    const y1 = originY + L1 * Math.cos(simTheta1);
    const x2 = x1 + L2 * Math.sin(simTheta2);
    const y2 = y1 + L2 * Math.cos(simTheta2);

    const distBob1 = Math.hypot(pos.x - x1, pos.y - y1);
    const distBob2 = Math.hypot(pos.x - x2, pos.y - y2);
    const distOrigin = Math.hypot(pos.x - originX, pos.y - originY);

    const ringInner = Math.max(20, maxReach - 14);
    const ringOuter = maxReach + 32;

    // Check Sector Ring Click
    if (distOrigin >= ringInner && distOrigin <= ringOuter && distBob1 > 20 && distBob2 > 20) {
      dragMode = 3;
      canvas.setPointerCapture(e.pointerId);

      const secIdx = getSectorIndex(pos.x - originX, pos.y - originY);
      const sectors = getSectors();
      dragSectorVal = sectors[secIdx] ? 0 : 1;
      sectors[secIdx] = dragSectorVal;
      lastDraggedSector = secIdx;

      updateSectorUI();
      renderCanvas();

      const nName = midiName(getSectorNote(secIdx));
      status(`Sector ${secIdx + 1} (${nName}): ${dragSectorVal ? "ON" : "OFF"}`);
      return;
    }

    // Check Bob 2 Drag
    if (distBob2 <= 22) {
      dragMode = 2;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    // Check Bob 1 Drag
    if (distBob1 <= 22) {
      dragMode = 1;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = getMousePos(e);
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 420;
    const originX = w / 2;
    const originY = h * 0.44;

    const L1 = Number(state.pendulumL1 ?? 100);
    const L2 = Number(state.pendulumL2 ?? 90);
    const maxReach = L1 + L2;

    const x1 = originX + L1 * Math.sin(simTheta1);
    const y1 = originY + L1 * Math.cos(simTheta1);

    if (dragMode === 3) {
      // Painting sectors across circle
      const secIdx = getSectorIndex(pos.x - originX, pos.y - originY);
      if (secIdx !== lastDraggedSector) {
        lastDraggedSector = secIdx;
        const sectors = getSectors();
        sectors[secIdx] = dragSectorVal;
        updateSectorUI();
        renderCanvas();
      }
      return;
    }

    if (dragMode === 1) {
      // Aiming Bob 1
      const dx = pos.x - originX;
      const dy = pos.y - originY;
      simTheta1 = Math.atan2(dx, dy);
      simOmega1 = 0;
      state.pendulumInitTheta1 = Math.round(((simTheta1 * RAD2DEG) % 360 + 360) % 360);
      pendulumRefs.pendulumInitTheta1?.setValue?.(state.pendulumInitTheta1, false);
      renderCanvas();
      return;
    }

    if (dragMode === 2) {
      // Aiming Bob 2
      const dx = pos.x - x1;
      const dy = pos.y - y1;
      simTheta2 = Math.atan2(dx, dy);
      simOmega2 = 0;
      state.pendulumInitTheta2 = Math.round(((simTheta2 * RAD2DEG) % 360 + 360) % 360);
      pendulumRefs.pendulumInitTheta2?.setValue?.(state.pendulumInitTheta2, false);
      renderCanvas();
      return;
    }

    // Hover feedback
    const x2 = x1 + L2 * Math.sin(simTheta2);
    const y2 = y1 + L2 * Math.cos(simTheta2);
    const distBob1 = Math.hypot(pos.x - x1, pos.y - y1);
    const distBob2 = Math.hypot(pos.x - x2, pos.y - y2);
    const distOrigin = Math.hypot(pos.x - originX, pos.y - originY);

    const ringInner = Math.max(20, maxReach - 14);
    const ringOuter = maxReach + 32;

    if (distOrigin >= ringInner && distOrigin <= ringOuter) {
      canvas.style.cursor = "pointer";
      const secIdx = getSectorIndex(pos.x - originX, pos.y - originY);
      const isEn = Boolean(getSectors()[secIdx]);
      const nName = midiName(getSectorNote(secIdx));
      if (hoverCoordEl) {
        hoverCoordEl.textContent = `Sector ${secIdx + 1} (${secIdx * 10}°) → ${nName} [${isEn ? "ON" : "OFF"}]`;
      }
    } else if (distBob1 <= 22 || distBob2 <= 22) {
      canvas.style.cursor = "grab";
      if (hoverCoordEl) hoverCoordEl.textContent = distBob2 <= 22 ? "Bob 2 (Drag to aim)" : "Bob 1 (Drag to aim)";
    } else {
      canvas.style.cursor = "crosshair";
      if (hoverCoordEl) hoverCoordEl.textContent = "—";
    }
  });

  const onPointerUp = (e) => {
    if (dragMode > 0) {
      dragMode = 0;
      lastDraggedSector = -1;
      canvas.style.cursor = "crosshair";
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderCanvas();
    }
  };

  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  canvas.addEventListener("mouseleave", () => {
    if (hoverCoordEl) hoverCoordEl.textContent = "—";
  });
}

function syncAllControls() {
  for (const [k, el] of Object.entries(pendulumRefs)) {
    if (el?.setValue && state[k] !== undefined) {
      el.setValue(state[k], false);
    }
  }
  updateSectorUI();
}

// ---- Lifecycle Activation & Deactivation ----

export function activatePendulumModel() {
  setModelGenerator(() => {
    return Array.from({ length: 16 }, () => ({
      length: 0,
      rate: 6,
      steps: []
    }));
  });
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: togglePendulumRunning,
    stop: stopPendulum,
    start: startPendulum,
    isRunning: isPendulumRunning
  });
  setModelRandomizer(randomizePendulum);

  stopPendulum();
  resetSimulationToInitial();
  syncAllControls();
  if (!Array.isArray(state.pendulumSectorNotes) || state.pendulumSectorNotes.length !== NUM_SECTORS) {
    shuffleSectorNotes();
  }
  updateSectorUI();
  setTimeout(resizeCanvas, 20);

  if (!animFrameId) {
    animFrameId = requestAnimationFrame(stepPendulumLoop);
  }
  status("Double Pendulum Engine: Ready (Press Play to swing pendulum)", "ok");
}

export function deactivatePendulumModel() {
  stopPendulum();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  setModelStepHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelTransportHandler(null);
}

// ---- UI Construction ----

export function initPendulum() {
  containerEl = document.getElementById("model-pendulum");
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout particle-layout pendulum-layout";

  // LEFT COLUMN: Control Modules Rack
  const module = document.createElement("div");
  module.className = "module particle-module pendulum-module";

  // 1. Sector Bell Pattern Section (36 Radial Bells)
  const sectorSect = document.createElement("section");
  sectorSect.className = "sect particle-sect";

  sectorSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Radial Note Sectors (36 Bells)</h3>
      <span class="particle-badge" id="pendulum-sector-badge">36/36 ON</span>
    </div>
  `;

  const sectorActionsRow = document.createElement("div");
  sectorActionsRow.className = "particle-btn-row";
  sectorActionsRow.style.marginBottom = "6px";

  const makeSecAction = (label, fn, tip) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action-btn";
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", () => {
      fn();
      updateSectorUI();
      renderCanvas();
    });
    return b;
  };

  sectorActionsRow.append(
    makeSecAction("Shuffle Notes", () => shuffleSectorNotes(), "Shuffle note positions randomly around the circle"),
    makeSecAction("All On", () => getSectors().fill(1), "Enable all 36 sectors"),
    makeSecAction("Clear", () => getSectors().fill(0), "Disable all sectors"),
    makeSecAction("Invert", () => {
      const s = getSectors();
      for (let i = 0; i < NUM_SECTORS; i++) s[i] = s[i] ? 0 : 1;
    }, "Invert active sectors"),
    makeSecAction("Even", () => {
      const s = getSectors();
      for (let i = 0; i < NUM_SECTORS; i++) s[i] = (i % 2 === 0 ? 1 : 0);
    }, "Enable even-numbered sectors (18 notes)"),
    makeSecAction("Odd", () => {
      const s = getSectors();
      for (let i = 0; i < NUM_SECTORS; i++) s[i] = (i % 2 !== 0 ? 1 : 0);
    }, "Enable odd-numbered sectors (18 notes)"),
    makeSecAction("Triplets", () => {
      const s = getSectors();
      for (let i = 0; i < NUM_SECTORS; i++) s[i] = (i % 3 === 0 ? 1 : 0);
    }, "Enable every 3rd sector (12 notes)"),
    makeSecAction("Quarters", () => {
      const s = getSectors();
      for (let i = 0; i < NUM_SECTORS; i++) s[i] = (i % 4 === 0 ? 1 : 0);
    }, "Enable every 4th sector (9 notes)")
  );

  // 36-Button Matrix
  const sectorMatrix = document.createElement("div");
  sectorMatrix.className = "pendulum-sector-matrix";
  sectorBtnEls = [];

  const sectors = getSectors();
  for (let i = 0; i < NUM_SECTORS; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pendulum-sector-btn${sectors[i] ? " is-active" : ""}`;
    btn.textContent = String(i + 1);
    const nName = midiName(getSectorNote(i));
    btn.title = `Sector ${i + 1} (${i * 10}°) → ${nName} — Click to toggle`;

    btn.addEventListener("click", () => {
      sectors[i] = sectors[i] ? 0 : 1;
      updateSectorUI();
      renderCanvas();
      status(`Sector ${i + 1} (${nName}): ${sectors[i] ? "ON" : "OFF"}`);
    });

    sectorBtnEls.push(btn);
    sectorMatrix.appendChild(btn);
  }

  sectorSect.append(sectorActionsRow, sectorMatrix);

  // 2. Arm Dimensions & Physics Section
  const physSect = document.createElement("section");
  physSect.className = "sect particle-sect";
  physSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Physics &amp; Dimensions</h3>
    </div>
  `;

  const physGrid = document.createElement("div");
  physGrid.className = "particle-grid-2col";

  const l1Knob = R("pendulumL1", knob({
    label: "Arm 1 Length",
    min: 50,
    max: 150,
    step: 1,
    value: state.pendulumL1 || 100,
    def: 100,
    size: "sm",
    format: (v) => `${Math.round(v)}px`,
    onInput: (v) => {
      state.pendulumL1 = Math.round(v);
      renderCanvas();
    },
    tip: "Length of the inner primary pendulum arm."
  }));

  const l2Knob = R("pendulumL2", knob({
    label: "Arm 2 Length",
    min: 40,
    max: 140,
    step: 1,
    value: state.pendulumL2 || 90,
    def: 90,
    size: "sm",
    format: (v) => `${Math.round(v)}px`,
    onInput: (v) => {
      state.pendulumL2 = Math.round(v);
      renderCanvas();
    },
    tip: "Length of the outer chaotic pendulum arm."
  }));

  const m1Knob = R("pendulumM1", knob({
    label: "Mass 1",
    min: 2,
    max: 30,
    step: 1,
    value: state.pendulumM1 || 10,
    def: 10,
    size: "sm",
    format: (v) => `${Math.round(v)}kg`,
    onInput: (v) => {
      state.pendulumM1 = Math.round(v);
      renderCanvas();
    },
    tip: "Mass of the inner bob."
  }));

  const m2Knob = R("pendulumM2", knob({
    label: "Mass 2",
    min: 2,
    max: 30,
    step: 1,
    value: state.pendulumM2 || 10,
    def: 10,
    size: "sm",
    format: (v) => `${Math.round(v)}kg`,
    onInput: (v) => {
      state.pendulumM2 = Math.round(v);
      renderCanvas();
    },
    tip: "Mass of the outer chaotic bob."
  }));

  const gKnob = R("pendulumGravity", knob({
    label: "Gravity (G)",
    min: -15,
    max: 25,
    step: 0.5,
    value: state.pendulumGravity !== undefined ? state.pendulumGravity : 9.8,
    def: 9.8,
    size: "sm",
    format: (v) => `${v.toFixed(1)}`,
    onInput: (v) => {
      state.pendulumGravity = Number(v);
      renderCanvas();
    },
    tip: "Gravitational acceleration (zero = micro-gravity, negative = inverted zenith)."
  }));

  const dampKnob = R("pendulumDamping", knob({
    label: "Air Drag",
    min: 0,
    max: 0.005,
    step: 0.0002,
    value: state.pendulumDamping || 0.001,
    def: 0.001,
    size: "sm",
    format: (v) => `${(v * 1000).toFixed(1)}k`,
    onInput: (v) => {
      state.pendulumDamping = Number(v);
    },
    tip: "Friction / air drag dissipating kinetic energy over time."
  }));

  const driveKnob = R("pendulumDrive", knob({
    label: "Kick Impulse",
    min: 0,
    max: 1.0,
    step: 0.05,
    value: state.pendulumDrive || 0,
    def: 0,
    size: "sm",
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      state.pendulumDrive = Number(v);
    },
    tip: "Continuous torque impulse to keep chaotic movement perpetual."
  }));

  const cycleCtrl = R("pendulumLoopMode", dropdown({
    label: "Cycle Mode",
    options: [
      { v: "loop", t: "Loop (Reset Cycle)" },
      { v: "free", t: "Free Run (Continuous Chaos)" }
    ],
    value: loopMode,
    onInput: (v) => {
      loopMode = v;
      state.pendulumLoopMode = v;
      if (v === "loop") resetSimulationToInitial();
      renderCanvas();
      status(`Cycle Mode: ${v === "loop" ? "Loop Reset" : "Continuous Chaos"}`);
    },
    tip: "Loop mode resets to initial angles periodically; Free run wanders infinitely."
  }));
  cycleCtrl.classList.add("particle-span-full");

  physGrid.append(l1Knob, l2Knob, m1Knob, m2Knob, gKnob, dampKnob, driveKnob, cycleCtrl);
  physSect.append(physGrid);

  // 3. Initial Release Angles Section
  const angleSect = document.createElement("section");
  angleSect.className = "sect particle-sect";
  angleSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Initial Release Angles</h3>
    </div>
  `;

  const angleGrid = document.createElement("div");
  angleGrid.className = "particle-grid-2col";

  const th1Knob = R("pendulumInitTheta1", knob({
    label: "Angle 1 (θ1)",
    min: 0,
    max: 360,
    step: 5,
    value: state.pendulumInitTheta1 ?? 120,
    def: 120,
    size: "sm",
    format: (v) => `${Math.round(v)}°`,
    onInput: (v) => {
      state.pendulumInitTheta1 = Math.round(v);
      simTheta1 = state.pendulumInitTheta1 * DEG2RAD;
      renderCanvas();
    },
    tip: "Starting angle of arm 1 (or direct-drag the blue bob on canvas)."
  }));

  const th2Knob = R("pendulumInitTheta2", knob({
    label: "Angle 2 (θ2)",
    min: 0,
    max: 360,
    step: 5,
    value: state.pendulumInitTheta2 ?? 110,
    def: 110,
    size: "sm",
    format: (v) => `${Math.round(v)}°`,
    onInput: (v) => {
      state.pendulumInitTheta2 = Math.round(v);
      simTheta2 = state.pendulumInitTheta2 * DEG2RAD;
      renderCanvas();
    },
    tip: "Starting angle of arm 2 (or direct-drag the gold bob on canvas)."
  }));

  angleGrid.append(th1Knob, th2Knob);
  angleSect.append(angleGrid);

  // 4. Zone Trigger Section
  const mapSect = document.createElement("section");
  mapSect.className = "sect particle-sect";
  mapSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Zone Trigger</h3>
    </div>
  `;

  const mapGrid = document.createElement("div");
  mapGrid.className = "particle-grid-2col";

  const trigBobCtrl = R("pendulumTriggerBob", dropdown({
    label: "Trigger Pendulum",
    options: [
      { v: "both", t: "Both Bobs (Inner & Outer)" },
      { v: "bob1", t: "Bob 1 Only (Inner Arm 1)" },
      { v: "bob2", t: "Bob 2 Only (Outer Arm 2)" }
    ],
    value: state.pendulumTriggerBob || "both",
    onInput: (v) => {
      state.pendulumTriggerBob = v;
      if (v === "bob1" && bob2HeldNote !== null) {
        liveNoteOff(bob2HeldNote);
        audio.noteOff(bob2HeldNote);
        bob2HeldNote = null;
      } else if (v === "bob2" && bob1HeldNote !== null) {
        liveNoteOff(bob1HeldNote);
        audio.noteOff(bob1HeldNote);
        bob1HeldNote = null;
      }
      renderCanvas();
      const labelMap = { both: "Both Bobs (Inner & Outer)", bob1: "Bob 1 Only (Inner)", bob2: "Bob 2 Only (Outer)" };
      status(`Zone Trigger: ${labelMap[v] || v}`);
    },
    tip: "Trigger notes when either pendulum enters a zone, Bob 1 only, or Bob 2 only."
  }));

  const shuffleBtn = document.createElement("button");
  shuffleBtn.type = "button";
  shuffleBtn.className = "action-btn";
  shuffleBtn.style.height = "34px";
  shuffleBtn.style.alignSelf = "center";
  shuffleBtn.textContent = "🎲 Shuffle Notes";
  shuffleBtn.title = "Shuffle the 36 scale notes across the circle ring";
  shuffleBtn.addEventListener("click", () => {
    shuffleSectorNotes();
  });

  mapGrid.append(trigBobCtrl, shuffleBtn);
  mapSect.append(mapGrid);

  // 5. Presets Library Section
  const presetSect = document.createElement("section");
  presetSect.className = "sect particle-sect";
  presetSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Chaotic Presets</h3>
    </div>
  `;

  const presetGrid = document.createElement("div");
  presetGrid.className = "particle-preset-grid";

  PENDULUM_PRESETS.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "particle-preset-btn";
    btn.textContent = p.name;
    btn.title = `${p.name}: ${p.desc}`;
    btn.addEventListener("click", () => {
      p.setup();
      resetSimulationToInitial();
      syncAllControls();
      renderCanvas();
      status(`Loaded Preset: ${p.name}`, "ok");
    });
    presetGrid.appendChild(btn);
  });

  presetSect.append(presetGrid);

  module.append(sectorSect, physSect, angleSect, mapSect, presetSect);

  // RIGHT COLUMN: 2D Interactive Canvas Display
  const display = document.createElement("div");
  display.className = "display particle-display";

  display.innerHTML = `
    <div class="particle-canvas-wrap">
      <canvas id="pendulum-canvas" class="particle-canvas"></canvas>
    </div>
    <div class="particle-display-footer">
      <span class="particle-hint-inline">💡 Click/drag ring sectors to toggle on/off · Drag Bobs to aim · Space to Play</span>
      <span id="pendulum-step-hover" class="particle-step-hover">—</span>
    </div>
  `;

  layout.append(module, display);
  containerEl.appendChild(layout);

  canvas = display.querySelector("#pendulum-canvas");
  ctx = canvas.getContext("2d");
  hoverCoordEl = display.querySelector("#pendulum-step-hover");
  sectorBadgeEl = sectorSect.querySelector("#pendulum-sector-badge");

  setupCanvasInteraction();
  window.addEventListener("resize", resizeCanvas);
  updateSectorUI();

  onRegen(() => {
    if (getActiveModel() === "pendulum") {
      updateSectorNotesFromMainControls();
    }
  });
}

// ---- Session Snapshot Registry (see snapshot.js) ----

registerModel({
  id: "pendulum",
  version: 1,
  migrations: {},
  capture() {
    return {
      phase: {
        theta1: simTheta1,
        theta2: simTheta2,
        omega1: simOmega1,
        omega2: simOmega2,
      },
      sectors: [...getSectors()],
      sectorNotes: Array.isArray(state.pendulumSectorNotes) ? [...state.pendulumSectorNotes] : null,
      sectorPermutation: Array.isArray(state.pendulumSectorPermutation) ? [...state.pendulumSectorPermutation] : null,
      triggerBob: state.pendulumTriggerBob || "both",
      loopMode,
      trail: attractorTrail.slice(-60)
    };
  },
  restore(h) {
    if (!h) return;
    if (h.phase) {
      simTheta1 = Number(h.phase.theta1) || (120 * DEG2RAD);
      simTheta2 = Number(h.phase.theta2) || (110 * DEG2RAD);
      simOmega1 = Number(h.phase.omega1) || 0;
      simOmega2 = Number(h.phase.omega2) || 0;
    }
    if (Array.isArray(h.sectors)) {
      state.pendulumSectors = h.sectors.map((v) => (v ? 1 : 0));
    }
    if (Array.isArray(h.sectorPermutation) && h.sectorPermutation.length === NUM_SECTORS) {
      state.pendulumSectorPermutation = [...h.sectorPermutation];
    }
    if (Array.isArray(h.sectorNotes) && h.sectorNotes.length === NUM_SECTORS) {
      state.pendulumSectorNotes = [...h.sectorNotes];
    }
    if (h.triggerBob) {
      state.pendulumTriggerBob = h.triggerBob;
    }
    loopMode = h.loopMode === "free" ? "free" : "loop";
    state.pendulumLoopMode = loopMode;
    if (Array.isArray(h.trail)) {
      attractorTrail = h.trail.slice(-60);
    }
    syncAllControls();
    updateSectorUI();
    renderCanvas();
  }
});
