// rungler.js — Rob Hordijk Rungler (Chaotic Stepped Shift Register) for FM-1 Pulses.
// Inspired by Rob Hordijk's Benjolin, Blippoo Box, and Eurorack Rungler circuits.
//
// Circuit Architecture:
// 1. Two cross-modulating analog triangle/pulse oscillators (Osc 1 and Osc 2).
// 2. A comparator comparing Osc 1 and Osc 2 with feedback to generate a chaotic bit stream.
// 3. A 16-bit shift register clocked by Osc 1 (or transport step clock in sync mode).
// 4. A 4-bit Rungler Digital-to-Analog Converter (DAC) decoded from 4 user-selectable tap bits.
// 5. Dual chaotic feedback loops: Rungler stepped voltage modulates Osc 1 and Osc 2 frequencies.
// 6. Scale-quantized MIDI notes and continuous FM-1 CC #74 Brightness modulation.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals } from "./scale.js?v=1";
import { syncRhythmGrid, randomizeRhythm } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import * as midi from "./midi.js";

// ---- Constants & State ----
const REGISTER_LEN = 16;
const MAX_VOICES = 8;
const activeVoices = new Map(); // note -> timeoutId

// 16-bit shift register
export const runglerBits = new Uint8Array(REGISTER_LEN);

// Default seed pattern
const DEFAULT_SEED = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0];
for (let i = 0; i < REGISTER_LEN; i++) runglerBits[i] = DEFAULT_SEED[i];

// 4-bit DAC taps (indices into shift register, 0..15)
export let runglerTaps = [12, 13, 14, 15];

// Oscillator simulation state
let osc1Phase = 0; // 0..2PI
let osc2Phase = 0; // 0..2PI
let lastLiveStep = -1;
let currentDacVal = 0;
let prevDacVal = 0;
let runningFreeLoop = false;
let animFrameId = null;
let lastFrameTime = 0;

// Phase history for Lissajous scope trace
const SCOPE_HISTORY_LEN = 120;
const scopeHistoryX = new Float32Array(SCOPE_HISTORY_LEN);
const scopeHistoryY = new Float32Array(SCOPE_HISTORY_LEN);
let scopeHead = 0;

// UI element references
let runglerContainer = null;
let bitButtons = [];
let runglerCanvas = null;
let modeToggleBtn = null;
let activeSoundingNote = null;

// Presets for classic Rob Hordijk Benjolin / Rungler configurations
export const RUNGLER_PRESETS = [
  {
    name: "Locked Riff",
    desc: "Harmonic 3:2 ratio with zero feedback, forming a repeating 16-step melodic ostinato",
    f1: 2.0, f2: 3.0, toOsc1: 0, toOsc2: 0, fb: 0, mode: "sync"
  },
  {
    name: "Benjolin Drift",
    desc: "Gentle chaotic cross-modulation: melodic loops slowly mutate and bifurcate",
    f1: 2.0, f2: 3.1415, toOsc1: 28, toOsc2: 45, fb: 30, mode: "sync"
  },
  {
    name: "Wild Blippoo",
    desc: "Deep feedback loops creating unpredictable, stepped microtonal leaps and fluttery gates",
    f1: 3.5, f2: 5.23, toOsc1: 65, toOsc2: 80, fb: 75, mode: "free"
  },
  {
    name: "Subharmonic Pulse",
    desc: "Slow bass pulse with subharmonic cross-frequency modulation",
    f1: 1.0, f2: 1.5, toOsc1: 40, toOsc2: 20, fb: 50, mode: "sync"
  }
];

// ---- Voice Allocation & MIDI Output ----
function playRunglerVoice(note, velocity, durMs) {
  if (activeVoices.size >= MAX_VOICES) {
    const oldest = activeVoices.keys().next().value;
    clearTimeout(activeVoices.get(oldest));
    liveNoteOff(oldest);
    activeVoices.delete(oldest);
  }

  // Also cut off previous monophonic lead note for clean articulate phrasing
  if (activeSoundingNote !== null && activeSoundingNote !== note) {
    liveNoteOff(activeSoundingNote);
    activeVoices.delete(activeSoundingNote);
  }

  liveNoteOn(note, velocity, durMs);
  activeSoundingNote = note;

  const tid = setTimeout(() => {
    activeVoices.delete(note);
    if (activeSoundingNote === note) activeSoundingNote = null;
  }, durMs);
  activeVoices.set(note, tid);

  // Send continuous FM-1 CC #74 (Brightness / Filter Cutoff)
  const ccDest = state.runglerCcDest ?? 74;
  const ccDepth = state.runglerCcDepth ?? 80;
  if (ccDepth > 0) {
    const ccVal = Math.min(127, Math.round((currentDacVal / 15) * ccDepth + (127 - ccDepth) * 0.3));
    try {
      midi.sendControlChange(ccDest, ccVal);
    } catch (_) {}
  }
}

// ---- Core Circuit Simulation ----

/**
 * Returns current triangle waveform output from a phase in [0, 2PI).
 * Range: [-1, 1].
 */
function getTriangleWave(phase) {
  // Triangle from phase: 0 -> 0, PI/2 -> 1, PI -> 0, 3PI/2 -> -1
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

/**
 * Decodes the 4-bit Rungler DAC value from the active tap bits.
 * Returns integer in [0, 15] and normalized float in [0, 1].
 */
export function getRunglerDac() {
  let val = 0;
  for (let i = 0; i < 4; i++) {
    const tapIdx = (runglerTaps[i] ?? (12 + i)) % REGISTER_LEN;
    if (runglerBits[tapIdx]) {
      val += (1 << i);
    }
  }
  return { val, norm: val / 15 };
}

/**
 * Quantizes current DAC value to a scale-accurate MIDI note.
 */
export function getRunglerNote(dacVal = currentDacVal) {
  const norm = dacVal / 15;
  const root = getRootMidi();
  const octaves = state.pitchSpan ?? state.runglerSpan ?? 2;
  const intervals = getActiveScaleIntervals(state.scale || state.runglerScale);

  const rawMidi = root + Math.round(norm * octaves * 12);
  const note = quantize(rawMidi, intervals, root);
  return { note, rawMidi, norm };
}

/**
 * Shifts the register forward by one step, inserting the comparator output bit at bit 0.
 */
export function clockShiftRegister() {
  const tri1 = getTriangleWave(osc1Phase);
  const tri2 = getTriangleWave(osc2Phase);

  // Hordijk comparator: compare Osc 1 and Osc 2, mixed with feedback
  const fbDepth = (state.runglerFeedback ?? 45) / 100;
  const fbBit = runglerBits[runglerTaps[3] ?? 15];
  const compThreshold = fbDepth * (fbBit ? 0.35 : -0.35);
  const comparatorBit = (tri1 - tri2 > compThreshold) ? 1 : 0;

  // Shift right (b0 receives new bit, b15 discarded)
  for (let i = REGISTER_LEN - 1; i > 0; i--) {
    runglerBits[i] = runglerBits[i - 1];
  }
  runglerBits[0] = comparatorBit;

  // Update current DAC
  prevDacVal = currentDacVal;
  currentDacVal = getRunglerDac().val;

  return comparatorBit;
}

/**
 * Returns whether a given step index has an active note trigger
 * according to the shared Rhythm grid.
 */
function isStepActive(stepIndex) {
  const b = getBank();
  const p = b[0];
  if (!p || !p.steps || !p.steps[stepIndex]) return true;
  return Boolean(p.steps[stepIndex].notes && p.steps[stepIndex].notes.length > 0);
}

/**
 * Ticked on transport sequencer step (when runglerMode === "sync").
 */
function handleRunglerStep(stepIndex) {
  if (state.runglerMode === "free") return;

  if (stepIndex === null) {
    lastLiveStep = -1;
    updateBitGrid();
    renderRunglerVisualizer();
    return;
  }

  const seqLen = Math.max(1, Math.min(64, state.length || 16));
  if (stepIndex >= seqLen) return;

  lastLiveStep = stepIndex % REGISTER_LEN;

  // Advance oscillator 2 by ratio frequency
  const f2 = state.runglerFreq2 ?? 3.14;
  osc2Phase = (osc2Phase + f2 * 0.4) % (Math.PI * 2);

  // Shift and decode
  clockShiftRegister();

  // Send continuous CC#74 for FM-1 brightness
  const ccDest = state.runglerCcDest ?? 74;
  const ccDepth = state.runglerCcDepth ?? 80;
  if (ccDepth > 0) {
    const ccVal = Math.min(127, Math.round((currentDacVal / 15) * ccDepth + (127 - ccDepth) * 0.3));
    try { midi.sendControlChange(ccDest, ccVal); } catch (_) {}
  }

  // Update current step note in bank so player.js plays the exact Rungler note if gate is active
  const currentBank = getBank();
  const p = currentBank[0];
  if (p && p.steps && p.steps[stepIndex]) {
    const st = p.steps[stepIndex];
    if (st.notes && st.notes.length > 0) {
      const { note } = getRunglerNote();
      const vel = Math.min(127, Math.max(40, 75 + Math.round(getTriangleWave(osc2Phase) * 35)));
      st.notes[0] = { note, vel };
      st._savedNote = { note, vel };
    }
  }

  updateBitGrid();
  renderRunglerVisualizer();
}

/**
 * Free-running real-time physics loop (when runglerMode === "free").
 */
function freeRunningTick(time) {
  if (!runningFreeLoop) return;

  if (!lastFrameTime) lastFrameTime = time;
  const dt = Math.min(0.05, (time - lastFrameTime) / 1000);
  lastFrameTime = time;

  // Modulate frequencies via Rungler stepped voltage
  const { norm } = getRunglerDac();
  const centeredNorm = (norm - 0.5) * 2; // -1..1

  const mod1 = Math.pow(2, ((state.runglerToOsc1 ?? 35) / 100) * centeredNorm * 1.5);
  const mod2 = Math.pow(2, ((state.runglerToOsc2 ?? 55) / 100) * centeredNorm * 1.5);

  const f1 = Math.max(0.1, (state.runglerFreq1 ?? 2.0) * mod1);
  const f2 = Math.max(0.1, (state.runglerFreq2 ?? 3.14) * mod2);

  const prevP1 = osc1Phase;
  osc1Phase = (osc1Phase + 2 * Math.PI * f1 * dt) % (2 * Math.PI);
  osc2Phase = (osc2Phase + 2 * Math.PI * f2 * dt) % (2 * Math.PI);

  // Store scope trajectory
  scopeHistoryX[scopeHead] = getTriangleWave(osc1Phase);
  scopeHistoryY[scopeHead] = getTriangleWave(osc2Phase);
  scopeHead = (scopeHead + 1) % SCOPE_HISTORY_LEN;

  // Osc 1 cycle wrap trigger
  if (osc1Phase < prevP1) {
    lastLiveStep = (lastLiveStep + 1) % REGISTER_LEN;
    clockShiftRegister();

    // Trigger note if live audio or transport is running
    if (isLive()) {
      const { note } = getRunglerNote();
      const vel = Math.min(127, Math.max(40, 75 + Math.round(getTriangleWave(osc2Phase) * 35)));
      const dur = state.runglerGateLen ?? 180;
      playRunglerVoice(note, vel, dur);
    }

    updateBitGrid();
  }

  renderRunglerVisualizer();
  animFrameId = requestAnimationFrame(freeRunningTick);
}

// ---- UI Rendering & Controls ----

function updateBitGrid() {
  if (!bitButtons.length) return;

  const currentStep = lastLiveStep >= 0 ? lastLiveStep % REGISTER_LEN : 0;

  for (let i = 0; i < REGISTER_LEN; i++) {
    const btn = bitButtons[i];
    if (!btn) continue;

    const isOne = Boolean(runglerBits[i]);
    btn.className = `rungler-bit-btn ${isOne ? "is-one" : "is-zero"}`;
    btn.setAttribute("aria-checked", String(isOne));

    const valSpan = btn.querySelector(".rungler-bit-val");
    if (valSpan) valSpan.textContent = isOne ? "1" : "0";

    // Playhead highlight
    if (lastLiveStep >= 0 && i === currentStep) {
      btn.classList.add("now");
    } else {
      btn.classList.remove("now");
    }

    // Tap indicator
    const tapPos = runglerTaps.indexOf(i);
    if (tapPos !== -1) {
      btn.classList.add("in-dac", "is-tap");
    } else {
      btn.classList.remove("in-dac", "is-tap");
    }
  }
}

function renderBitGrid() {
  const grid = document.getElementById("rungler-bit-grid");
  if (!grid) return;
  grid.innerHTML = "";
  bitButtons = [];

  for (let i = 0; i < REGISTER_LEN; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rungler-bit-btn ${runglerBits[i] ? "is-one" : "is-zero"}`;
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(Boolean(runglerBits[i])));
    btn.setAttribute("aria-label", `Bit ${i + 1}: ${runglerBits[i]}`);
    btn.title = `Bit ${i + 1}: Click to flip · Shift+Click to assign Tap`;

    const numSpan = document.createElement("span");
    numSpan.className = "rungler-bit-num";
    numSpan.textContent = String(i + 1);

    const valSpan = document.createElement("span");
    valSpan.className = "rungler-bit-val";
    valSpan.textContent = runglerBits[i] ? "1" : "0";

    btn.append(numSpan, valSpan);

    btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        // Cycle this bit into one of the 4 tap positions
        const existingTap = runglerTaps.indexOf(i);
        if (existingTap !== -1) {
          status(`Bit ${i + 1} is already DAC Tap T${existingTap + 1}`);
        } else {
          runglerTaps[3] = runglerTaps[2];
          runglerTaps[2] = runglerTaps[1];
          runglerTaps[1] = runglerTaps[0];
          runglerTaps[0] = i;
          status(`Assigned Bit ${i + 1} as DAC Tap T1 (Taps: ${runglerTaps.map(t => t + 1).join(", ")})`);
        }
      } else {
        runglerBits[i] ^= 1;
        currentDacVal = getRunglerDac().val;
        status(`Bit ${i + 1} flipped to ${runglerBits[i]}`);
      }
      updateBitGrid();
      renderRunglerVisualizer();
      doGenerate(false);
    });

    grid.appendChild(btn);
    bitButtons.push(btn);
  }

  updateBitGrid();
}

/**
 * Flat workbench canvas visualizer (strictly conforming to style.md).
 * Left: Dual Oscillator Lissajous Phase Plot.
 * Right: 16-Level Stepped Rungler Voltage Ladder.
 */
function renderRunglerVisualizer() {
  if (!runglerCanvas) return;
  const ctx = runglerCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = runglerCanvas.clientWidth || 600;
  const h = runglerCanvas.clientHeight || 120;

  if (runglerCanvas.width !== Math.round(w * dpr) || runglerCanvas.height !== Math.round(h * dpr)) {
    runglerCanvas.width = Math.round(w * dpr);
    runglerCanvas.height = Math.round(h * dpr);
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue("--panel").trim() || "#18191f";
  const panel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const line = style.getPropertyValue("--line").trim() || "#333846";
  const fg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const dim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const accent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const accent2 = style.getPropertyValue("--accent2").trim() || "#f59e0b";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Divider between Lissajous plot and Ladder
  const scopeW = Math.round(w * 0.45);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scopeW + 0.5, 0);
  ctx.lineTo(scopeW + 0.5, h);
  ctx.stroke();

  // ---- 1. Lissajous Scope (Osc 1 vs Osc 2) ----
  const cx = scopeW / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 12;

  // Crosshairs
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Phase history line
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < SCOPE_HISTORY_LEN; i++) {
    const idx = (scopeHead + i) % SCOPE_HISTORY_LEN;
    const px = cx + scopeHistoryX[idx] * radius;
    const py = cy - scopeHistoryY[idx] * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Current head point
  const curX = cx + getTriangleWave(osc1Phase) * radius;
  const curY = cy - getTriangleWave(osc2Phase) * radius;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(curX, curY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Scope label
  ctx.fillStyle = dim;
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("OSC 1 vs OSC 2", 8, 12);

  // ---- 2. 16-Level Stepped Rungler Voltage Ladder ----
  const ladderX = scopeW + 16;
  const ladderW = w - ladderX - 16;
  const colW = ladderW / 16;

  // Header readout
  const { note } = getRunglerNote();
  ctx.fillStyle = fg;
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.fillText(`DAC: ${currentDacVal} / 15 · ${midiName(note)} (${note}) · TAPS: [${runglerTaps.map(t => t + 1).join(",")}]`, ladderX, 14);

  // Stepped bar chart for all 16 levels
  for (let lvl = 0; lvl < 16; lvl++) {
    const bx = ladderX + lvl * colW;
    const barH = Math.max(3, Math.round(((lvl + 1) / 16) * (h - 38)));
    const by = h - barH - 8;

    if (lvl === currentDacVal) {
      ctx.fillStyle = accent2; // Current active level highlighted
      ctx.fillRect(bx + 1, by, colW - 2, barH);

      // Value label on top
      ctx.fillStyle = fg;
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(lvl), bx + colW / 2, by - 3);
    } else {
      ctx.fillStyle = panel2;
      ctx.fillRect(bx + 1, by, colW - 2, barH);
      ctx.strokeStyle = line;
      ctx.strokeRect(bx + 1, by, colW - 2, barH);
    }
  }
  ctx.textAlign = "left";

  ctx.restore();
}

// ---- Model Lifecycle & Rack Generator ----

export function randomizeRungler() {
  // Randomize bits
  for (let i = 0; i < REGISTER_LEN; i++) {
    runglerBits[i] = Math.random() < 0.5 ? 1 : 0;
  }

  // Shuffle taps
  const available = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  available.sort(() => Math.random() - 0.5);
  runglerTaps = available.slice(0, 4);

  // Randomize frequencies and feedback depths
  state.runglerFreq1 = Number((1.0 + Math.random() * 4.0).toFixed(1));
  state.runglerFreq2 = Number((1.5 + Math.random() * 6.0).toFixed(2));
  state.runglerToOsc1 = Math.round((Math.random() - 0.2) * 80);
  state.runglerToOsc2 = Math.round((Math.random() - 0.2) * 90);
  state.runglerFeedback = Math.round(20 + Math.random() * 60);

  if (refs.runglerFreq1?.setValue) refs.runglerFreq1.setValue(state.runglerFreq1, false);
  if (refs.runglerFreq2?.setValue) refs.runglerFreq2.setValue(state.runglerFreq2, false);
  if (refs.runglerToOsc1?.setValue) refs.runglerToOsc1.setValue(state.runglerToOsc1, false);
  if (refs.runglerToOsc2?.setValue) refs.runglerToOsc2.setValue(state.runglerToOsc2, false);
  if (refs.runglerFeedback?.setValue) refs.runglerFeedback.setValue(state.runglerFeedback, false);

  currentDacVal = getRunglerDac().val;
  randomizeRhythm();
  doGenerate(true);
  updateBitGrid();
  renderRunglerVisualizer();
  status(`Rungler randomized · F1: ${state.runglerFreq1}Hz · F2: ${state.runglerFreq2}Hz`);
}

export function generateRunglerBank() {
  const seqLen = Math.max(1, Math.min(64, state.length || 16));
  const steps = [];
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals(state.scale || state.runglerScale);
  const octaves = state.pitchSpan ?? state.runglerSpan ?? 2;

  const currentBank = getBank();
  const existingSteps = currentBank[0]?.steps || null;
  const hasExistingRhythm = existingSteps && existingSteps.some((st) => (st.notes && st.notes.length > 0) || st._savedNote);

  // Simulate 64 steps forward for the bank overview
  const simBits = new Uint8Array(runglerBits);
  let p1 = osc1Phase;
  let p2 = osc2Phase;

  for (let s = 0; s < 64; s++) {
    // Decode DAC
    let dac = 0;
    for (let k = 0; k < 4; k++) {
      if (simBits[runglerTaps[k] % REGISTER_LEN]) dac += (1 << k);
    }
    const rawMidi = root + Math.round((dac / 15) * octaves * 12);
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.min(127, Math.max(40, 75 + Math.round(getTriangleWave(p2) * 35)));
    const simNote = { note, vel };

    // Respect global length and rhythm gates
    let isStepOn = s < seqLen;
    if (hasExistingRhythm && existingSteps[s]) {
      isStepOn = s < seqLen && Boolean(existingSteps[s].notes && existingSteps[s].notes.length > 0);
    }

    steps.push({
      notes: isStepOn ? [simNote] : [],
      _savedNote: simNote,
      velocity: vel,
      gate: 0.6,
      rate: state.rate ?? 6
    });

    // Advance simulated oscillators
    p1 = (p1 + Math.PI / 2) % (Math.PI * 2);
    p2 = (p2 + (state.runglerFreq2 ?? 3.14) * 0.4) % (Math.PI * 2);
    const bit = (getTriangleWave(p1) > getTriangleWave(p2)) ? 1 : 0;
    for (let i = REGISTER_LEN - 1; i > 0; i--) simBits[i] = simBits[i - 1];
    simBits[0] = bit;
  }

  const bank = [{ length: seqLen, steps, rate: state.rate ?? 6 }];
  setBank(bank);
  return bank;
}

export function activateRunglerModel() {
  setSelected(0);
  setModelGenerator(generateRunglerBank);
  setModelRandomizer(randomizeRungler);

  if (state.runglerMode === "free") {
    setModelStepHandler(null);
    runningFreeLoop = true;
    lastFrameTime = 0;
    animFrameId = requestAnimationFrame(freeRunningTick);
  } else {
    setModelStepHandler(handleRunglerStep);
    runningFreeLoop = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
  }

  doGenerate(false);
  updateBitGrid();
  renderRunglerVisualizer();
}

export function deactivateRunglerModel() {
  runningFreeLoop = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  setModelStepHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);
  panicPreview();
  activeVoices.forEach((tid, note) => {
    clearTimeout(tid);
    liveNoteOff(note);
  });
  activeVoices.clear();
  activeSoundingNote = null;
}

export function initRungler() {
  runglerContainer = document.getElementById("model-rungler");
  if (!runglerContainer) return;
  runglerContainer.innerHTML = "";

  // 1. Module Enclosure Header
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "10px 14px";
  headerCard.style.marginBottom = "8px";

  const headRow = document.createElement("div");
  headRow.style.display = "flex";
  headRow.style.justifyContent = "space-between";
  headRow.style.alignItems = "center";
  headRow.style.flexWrap = "wrap";
  headRow.style.gap = "8px";

  const titleBox = document.createElement("div");
  const title = document.createElement("h2");
  title.style.margin = "0";
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0.6px";
  title.style.textTransform = "uppercase";
  title.textContent = "ROB HORDIJK RUNGLER";

  const sub = document.createElement("span");
  sub.style.fontSize = "8.5px";
  sub.style.color = "var(--dim)";
  sub.textContent = "DUAL CHAOTIC OSCILLATORS · 16-BIT SHIFT REGISTER · 4-BIT DAC";
  titleBox.append(title, sub);

  const controlsBox = document.createElement("div");
  controlsBox.style.display = "flex";
  controlsBox.style.alignItems = "center";
  controlsBox.style.gap = "6px";

  // Mode Toggle (Sync vs Free)
  modeToggleBtn = document.createElement("button");
  modeToggleBtn.type = "button";
  modeToggleBtn.className = "btn";
  modeToggleBtn.style.padding = "3px 8px";
  modeToggleBtn.style.fontSize = "9px";
  modeToggleBtn.style.fontWeight = "600";
  const isSync = (state.runglerMode || "sync") === "sync";
  modeToggleBtn.textContent = isSync ? "MODE: SYNC (TEMPO)" : "MODE: FREE (ANALOG)";
  modeToggleBtn.title = "Toggle between Step-Clock Sync and Free-Running Continuous Analog Physics";

  modeToggleBtn.addEventListener("click", () => {
    const nextMode = (state.runglerMode === "sync") ? "free" : "sync";
    state.runglerMode = nextMode;
    modeToggleBtn.textContent = nextMode === "sync" ? "MODE: SYNC (TEMPO)" : "MODE: FREE (ANALOG)";
    if (getActiveModel() === "rungler") {
      activateRunglerModel();
    }
    status(`Rungler timing switched to ${nextMode.toUpperCase()}`);
  });

  // Preset Dropdown
  const presetSelect = document.createElement("select");
  presetSelect.className = "btn";
  presetSelect.style.padding = "2px 6px";
  presetSelect.style.fontSize = "9px";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "Presets...";
  presetSelect.appendChild(defOpt);
  RUNGLER_PRESETS.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  });

  presetSelect.addEventListener("change", () => {
    const p = RUNGLER_PRESETS[Number(presetSelect.value)];
    if (!p) return;
    state.runglerFreq1 = p.f1;
    state.runglerFreq2 = p.f2;
    state.runglerToOsc1 = p.toOsc1;
    state.runglerToOsc2 = p.toOsc2;
    state.runglerFeedback = p.fb;
    state.runglerMode = p.mode;

    modeToggleBtn.textContent = p.mode === "sync" ? "MODE: SYNC (TEMPO)" : "MODE: FREE (ANALOG)";

    if (refs.runglerFreq1?.setValue) refs.runglerFreq1.setValue(p.f1, false);
    if (refs.runglerFreq2?.setValue) refs.runglerFreq2.setValue(p.f2, false);
    if (refs.runglerToOsc1?.setValue) refs.runglerToOsc1.setValue(p.toOsc1, false);
    if (refs.runglerToOsc2?.setValue) refs.runglerToOsc2.setValue(p.toOsc2, false);
    if (refs.runglerFeedback?.setValue) refs.runglerFeedback.setValue(p.fb, false);

    if (getActiveModel() === "rungler") activateRunglerModel();
    status(`Loaded preset: ${p.name} · ${p.desc}`);
    presetSelect.value = "";
  });

  // Seed / Clear Buttons
  const seedBtn = document.createElement("button");
  seedBtn.type = "button";
  seedBtn.className = "btn";
  seedBtn.style.padding = "3px 8px";
  seedBtn.style.fontSize = "9px";
  seedBtn.textContent = "Reseed";
  seedBtn.addEventListener("click", () => {
    for (let i = 0; i < REGISTER_LEN; i++) runglerBits[i] = Math.random() < 0.5 ? 1 : 0;
    updateBitGrid();
    renderRunglerVisualizer();
    status("Rungler shift register reseeded");
  });

  controlsBox.append(modeToggleBtn, presetSelect, seedBtn);
  headRow.append(titleBox, controlsBox);
  headerCard.appendChild(headRow);

  // 2. Interactive 16-Bit Shift Register Card
  const bitCard = document.createElement("div");
  bitCard.className = "card";
  bitCard.style.padding = "10px 14px";
  bitCard.style.marginBottom = "8px";

  const bitHeader = document.createElement("div");
  bitHeader.style.display = "flex";
  bitHeader.style.justifyContent = "space-between";
  bitHeader.style.marginBottom = "6px";

  const bitTitle = document.createElement("span");
  bitTitle.style.fontSize = "9px";
  bitTitle.style.fontWeight = "700";
  bitTitle.style.color = "var(--accent)";
  bitTitle.textContent = "16-BIT SHIFT REGISTER (CLICK BIT TO FLIP · SHIFT+CLICK TO SET TAP)";

  const tapHint = document.createElement("span");
  tapHint.style.fontSize = "8.5px";
  tapHint.style.color = "var(--accent2, #f59e0b)";
  tapHint.textContent = `TAPS: T1=${runglerTaps[0] + 1}, T2=${runglerTaps[1] + 1}, T3=${runglerTaps[2] + 1}, T4=${runglerTaps[3] + 1}`;
  bitHeader.append(bitTitle, tapHint);

  const gridDiv = document.createElement("div");
  gridDiv.id = "rungler-bit-grid";
  gridDiv.className = "rungler-bit-grid";

  bitCard.append(bitHeader, gridDiv);

  // 3. Dual Oscillators & Chaotic Cross-Modulation Controls Card
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "10px 14px";
  paramCard.style.marginBottom = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.style.display = "grid";
  paramGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(76px, 1fr))";
  paramGrid.style.gap = "8px";
  paramGrid.style.alignItems = "center";

  // Knobs
  const kF1 = knob({
    label: "FREQ 1",
    min: 0.2, max: 12.0, step: 0.1,
    value: state.runglerFreq1 ?? 2.0,
    unit: "Hz",
    title: "Oscillator 1 base frequency / clock driver",
    onChange: (v) => { state.runglerFreq1 = v; }
  });
  R("runglerFreq1", kF1);

  const kF2 = knob({
    label: "FREQ 2",
    min: 0.2, max: 20.0, step: 0.1,
    value: state.runglerFreq2 ?? 3.14,
    unit: "Hz",
    title: "Oscillator 2 modulation frequency",
    onChange: (v) => { state.runglerFreq2 = v; }
  });
  R("runglerFreq2", kF2);

  const kToOsc1 = knob({
    label: "R → OSC1",
    min: -100, max: 100, step: 1,
    value: state.runglerToOsc1 ?? 35,
    unit: "%",
    title: "Rungler stepped voltage to Osc 1 frequency modulation depth",
    onChange: (v) => { state.runglerToOsc1 = v; }
  });
  R("runglerToOsc1", kToOsc1);

  const kToOsc2 = knob({
    label: "R → OSC2",
    min: -100, max: 100, step: 1,
    value: state.runglerToOsc2 ?? 55,
    unit: "%",
    title: "Rungler stepped voltage to Osc 2 frequency modulation depth",
    onChange: (v) => { state.runglerToOsc2 = v; }
  });
  R("runglerToOsc2", kToOsc2);

  const kFb = knob({
    label: "FEEDBACK",
    min: 0, max: 100, step: 1,
    value: state.runglerFeedback ?? 45,
    unit: "%",
    title: "Comparator feedback injection depth",
    onChange: (v) => { state.runglerFeedback = v; }
  });
  R("runglerFeedback", kFb);

  const kSpan = knob({
    label: "OCTAVES",
    min: 1, max: 4, step: 1,
    value: state.runglerSpan ?? state.pitchSpan ?? 2,
    unit: "oct",
    title: "Pitch octave span across active scale",
    onChange: (v) => {
      state.runglerSpan = v;
      state.pitchSpan = v;
      if (refs.pitchSpan?.setValue) refs.pitchSpan.setValue(v, false);
      renderRunglerVisualizer();
    }
  });
  R("runglerSpan", kSpan);

  const kCc = knob({
    label: "FM CC#74",
    min: 0, max: 127, step: 1,
    value: state.runglerCcDepth ?? 80,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth from Rungler voltage",
    onChange: (v) => { state.runglerCcDepth = v; }
  });
  R("runglerCcDepth", kCc);

  const kGate = knob({
    label: "GATE",
    min: 50, max: 600, step: 10,
    value: state.runglerGateLen ?? 180,
    unit: "ms",
    title: "Gate length duration in milliseconds",
    onChange: (v) => { state.runglerGateLen = v; }
  });
  R("runglerGateLen", kGate);

  paramGrid.append(kF1, kF2, kToOsc1, kToOsc2, kFb, kSpan, kCc, kGate);
  paramCard.appendChild(paramGrid);

  // 4. Lissajous Scope & 4-Bit Stepped DAC Ladder Canvas Card
  const canvasCard = document.createElement("div");
  canvasCard.className = "card";
  canvasCard.style.padding = "8px 12px";

  runglerCanvas = document.createElement("canvas");
  runglerCanvas.style.width = "100%";
  runglerCanvas.style.height = "110px";
  runglerCanvas.style.display = "block";
  runglerCanvas.style.borderRadius = "4px";
  runglerCanvas.style.background = "var(--panel)";

  canvasCard.appendChild(runglerCanvas);

  runglerContainer.append(headerCard, bitCard, paramCard, canvasCard);

  renderBitGrid();
  renderRunglerVisualizer();
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "rungler",
  version: 1,
  migrations: {},
  capture() {
    return {
      bits: Array.from(runglerBits),
      taps: [...runglerTaps],
      mode: state.runglerMode || "sync",
      freq1: state.runglerFreq1,
      freq2: state.runglerFreq2,
      toOsc1: state.runglerToOsc1,
      toOsc2: state.runglerToOsc2,
      feedback: state.runglerFeedback
    };
  },
  restore(h) {
    if (Array.isArray(h?.bits)) {
      for (let i = 0; i < REGISTER_LEN; i++) runglerBits[i] = h.bits[i] ? 1 : 0;
    }
    if (Array.isArray(h?.taps) && h.taps.length === 4) {
      runglerTaps = [...h.taps];
    }
    if (h?.mode) state.runglerMode = h.mode;
    if (h?.freq1 !== undefined) state.runglerFreq1 = h.freq1;
    if (h?.freq2 !== undefined) state.runglerFreq2 = h.freq2;
    if (h?.toOsc1 !== undefined) state.runglerToOsc1 = h.toOsc1;
    if (h?.toOsc2 !== undefined) state.runglerToOsc2 = h.toOsc2;
    if (h?.feedback !== undefined) state.runglerFeedback = h.feedback;

    currentDacVal = getRunglerDac().val;
    updateBitGrid();
    renderRunglerVisualizer();
  }
});
