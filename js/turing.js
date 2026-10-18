// turing.js — Turing Machine (Shift-Register Melody Generator) model for FM-1 Pulses.
// Inspired by Tom Whitwell's Music Thing Modular Turing Machine.
// Reuses the shared Global, Rhythm, Humanise, and Notes components.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { onStep, isLive } from "./player.js";
import { createNotesSection, SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS } from "./scale.js";
import { syncRhythmGrid, randomizeRhythm } from "./rhythm.js";
import { getActiveModel } from "./modes.js?v=236";
import { quantize, midiName, SCALES } from "./generator.js";
import { onBufferRender } from "./grid.js";

// Length options supported by Turing Machine
export const TURING_LENGTHS = [8, 16, 24, 32, 48, 64];

// Mutation Presets
export const MUTATION_PRESETS = [
  { label: "🔒 Lock (0%)", value: 0, tip: "100% Locked: loop repeats indefinitely without changing" },
  { label: "🌱 Subtle (5%)", value: 5, tip: "Subtle drift: evolves every few measures" },
  { label: "🌊 Evolve (15%)", value: 15, tip: "Organic evolution: steady melodic drift" },
  { label: "⚡ Drift (35%)", value: 35, tip: "Fast flux: frequent bit flips" },
  { label: "🎲 Random (100%)", value: 100, tip: "Continuous random walk: never repeats" },
];

// Classic Seed Bit Patterns
export const BIT_PATTERNS = [
  { name: "Alternating", pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { name: "Pulse Beat", pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { name: "Syncopated", pattern: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0] },
  { name: "Euclid 5/16", pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0] },
  { name: "Fibonacci", pattern: [1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1] },
];

// Internal shift register bit array (64 bits)
let turingBits = new Array(64).fill(0);

// Initialize with a musical, interesting pseudo-random sequence
function initDefaultBits() {
  const seedPattern = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1];
  for (let i = 0; i < 64; i++) {
    turingBits[i] = seedPattern[i % seedPattern.length];
  }
}
initDefaultBits();

// Track previous step for live playhead and mutation
let lastLiveStep = -1;
let turingContainer = null;
let turingNotesSection = null;

// UI element references
let bitButtons = [];
let dacCanvas = null;
let hudStep = null;
let hudRegister = null;
let hudDac = null;
let hudNote = null;
let hudLock = null;

/**
 * Returns whether a given step index has an active note trigger
 * according to the shared Rhythm div (Euclidean / Gate density / manual triggers).
 */
function isStepActive(stepIndex) {
  const b = getBank();
  const p = b[0];
  if (!p || !p.steps || !p.steps[stepIndex]) return true;
  return Boolean(p.steps[stepIndex].notes && p.steps[stepIndex].notes.length > 0);
}

/**
 * Calculate the 8-bit DAC value from the shift register window at a given step.
 */
function getDacValueAtStep(step) {
  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const dacBits = Math.min(8, len);
  let val = 0;
  for (let k = 0; k < dacBits; k++) {
    const bitIdx = (step + k + (state.turingSlip || 0)) % len;
    if (turingBits[bitIdx]) {
      val += (1 << k);
    }
  }
  return { val, dacBits, maxVal: (1 << dacBits) - 1 };
}

/**
 * Calculate the quantized note at a given step.
 */
function getNoteAtStep(step) {
  const { val, maxVal } = getDacValueAtStep(step);
  const norm = maxVal > 0 ? val / maxVal : 0;
  const spanSemitones = (state.turingSpan || 2) * 12;
  const semitones = Math.round(norm * spanSemitones);

  // Octave spread offset if configured
  let octShift = 0;
  if (state.turingOctave && state.turingOctave > 0) {
    const octProb = state.turingOctave / 100;
    // Derive deterministic octave shift for step
    const octRnd = (((step * 9301 + 49297) % 233280) / 233280);
    if (octRnd < octProb) {
      if (state.turingOctaveMode === "up") octShift = 12;
      else if (state.turingOctaveMode === "down") octShift = -12;
      else if (state.turingOctaveMode === "up2") octShift = 24;
      else if (state.turingOctaveMode === "down2") octShift = -24;
      else octShift = octRnd < octProb / 2 ? 12 : -12;
    }
  }

  const rawNote = (state.turingRoot || 48) + semitones + octShift;
  const quantNote = quantize(
    rawNote,
    state.turingScale || "pentMinor",
    state.turingQuantSteps ?? 100,
    state.turingCustomScale
  );

  return { note: Math.max(0, Math.min(127, quantNote)), val, norm };
}

/**
 * Core Bank Generator for Turing Machine model.
 * Produces a 64-step phrase for the M-VAVE FM-1 pattern bank.
 */
export function generateTuringBank() {
  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const rate = state.rate !== undefined ? state.rate : 6;
  const currentBank = getBank();
  const existingSteps = currentBank[0]?.steps || null;
  const hasExistingRhythm = existingSteps && existingSteps.some((st) => (st.notes && st.notes.length > 0) || st._savedNote);

  const phrase = {
    length: 64,
    rate,
    steps: []
  };

  for (let s = 0; s < 64; s++) {
    const { note, val } = getNoteAtStep(s);
    const simNote = { note, vel: state.velocity || 100 };

    let isStepActive = true;
    if (hasExistingRhythm && existingSteps[s]) {
      isStepActive = Boolean(existingSteps[s].notes && existingSteps[s].notes.length > 0);
    }

    const stepObj = {
      notes: isStepActive ? [simNote] : [],
      _savedNote: simNote,
      rate,
      dacVal: val
    };

    phrase.steps.push(stepObj);
  }

  setBank([phrase]);
  updateHud(lastLiveStep >= 0 ? lastLiveStep : 0);
  renderDacContour();
  return [phrase];
}

/**
 * Randomize hook triggered by the shared Global Randomise button.
 * Randomizes shift register bits, rhythm pattern, notes, and mutation parameters.
 */
export function randomizeTuring() {
  // 1. Generate new randomized shift register bits
  const density = 0.4 + Math.random() * 0.3; // 40% - 70% ones
  for (let i = 0; i < 64; i++) {
    turingBits[i] = Math.random() < density ? 1 : 0;
  }

  // 2. Randomize scale or pick melodic preset
  const scaleKeys = Object.keys(SCALES);
  state.turingScale = scaleKeys[Math.floor(Math.random() * scaleKeys.length)];

  // 3. Randomize pitch span (1, 2, or 3 octaves)
  state.turingSpan = Math.floor(Math.random() * 3) + 1;
  if (refs.turingSpan) refs.turingSpan.setValue(state.turingSpan, false);

  // 4. Randomize length (prefer 8, 16, or 32)
  const lens = [8, 16, 16, 16, 24, 32];
  state.turingLength = lens[Math.floor(Math.random() * lens.length)];
  if (refs.turingLength) refs.turingLength.setValue(state.turingLength, false);

  // 5. Randomize write probability (mostly 0% to 20%)
  const probPresets = [0, 0, 5, 10, 15, 25];
  state.turingProb = probPresets[Math.floor(Math.random() * probPresets.length)];
  if (refs.turingProb) refs.turingProb.setValue(state.turingProb, false);

  state.turingSlip = 0;

  // 6. Randomize the shared Rhythm controls
  randomizeRhythm();

  // 7. Sync sections
  if (turingNotesSection) turingNotesSection.sync();

  doGenerate(true);
  syncRhythmGrid();
  renderBitGrid();
  renderDacContour();
  status(`Turing randomized · ${state.turingLength} steps · ${state.turingScale}`);
}

/**
 * Update the Turing HUD readout elements.
 */
function updateHud(step = 0) {
  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const activeStep = step % len;
  const { val } = getDacValueAtStep(activeStep);
  const { note } = getNoteAtStep(activeStep);
  const prob = state.turingProb ?? 0;

  if (hudStep) {
    hudStep.textContent = `${activeStep + 1} / ${len}`;
  }

  if (hudRegister) {
    // Show register state as hex byte or bit string
    let hexVal = 0;
    for (let k = 0; k < Math.min(16, len); k++) {
      if (turingBits[k]) hexVal |= (1 << k);
    }
    hudRegister.textContent = `0x${hexVal.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  if (hudDac) {
    hudDac.textContent = `${val} / 255`;
  }

  if (hudNote) {
    const isNoteActive = isStepActive(activeStep);
    hudNote.textContent = isNoteActive ? `${midiName(note)} (${note})` : "Rest (—)";
    hudNote.className = `ca-hud-val ${isNoteActive ? "ca-hud-highlight" : ""}`;
  }

  if (hudLock) {
    if (prob === 0) {
      hudLock.textContent = "🔒 LOCKED (0%)";
      hudLock.style.color = "var(--ok)";
    } else if (prob < 25) {
      hudLock.textContent = `🌱 EVOLVING (${prob}%)`;
      hudLock.style.color = "var(--accent)";
    } else {
      hudLock.textContent = `⚡ FLUX (${prob}%)`;
      hudLock.style.color = "var(--accent2)";
    }
  }
}

/**
 * Render the interactive shift register bit matrix.
 */
function renderBitGrid() {
  const grid = document.getElementById("turing-bit-grid");
  if (!grid) return;
  grid.innerHTML = "";
  bitButtons = [];

  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const dacBits = Math.min(8, len);
  const currentStep = lastLiveStep >= 0 ? lastLiveStep % len : 0;

  for (let i = 0; i < len; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `turing-bit-btn ${turingBits[i] ? "is-one" : "is-zero"}`;
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(Boolean(turingBits[i])));
    btn.setAttribute("aria-label", `Bit ${i + 1}: ${turingBits[i]}`);
    btn.title = `Bit ${i + 1}: Click to toggle (${turingBits[i] ? "1" : "0"})`;

    const numSpan = document.createElement("span");
    numSpan.className = "turing-bit-num";
    numSpan.textContent = String(i + 1);

    const valSpan = document.createElement("span");
    valSpan.className = "turing-bit-val";
    valSpan.textContent = turingBits[i] ? "1" : "0";

    btn.append(numSpan, valSpan);

    // Click to toggle bit state manually
    btn.addEventListener("click", () => {
      turingBits[i] = turingBits[i] ? 0 : 1;
      btn.className = `turing-bit-btn ${turingBits[i] ? "is-one" : "is-zero"}`;
      btn.setAttribute("aria-checked", String(Boolean(turingBits[i])));
      valSpan.textContent = turingBits[i] ? "1" : "0";
      generateTuringBank();
      status(`Bit ${i + 1} set to ${turingBits[i]}`);
    });

    // Check if bit is in current DAC tap window
    const inDacWindow = ((i - currentStep - (state.turingSlip || 0)) % len + len) % len < dacBits;
    if (inDacWindow) {
      btn.classList.add("in-dac");
    }

    // Playhead highlight
    if (lastLiveStep >= 0 && i === currentStep) {
      btn.classList.add("now");
    }

    grid.appendChild(btn);
    bitButtons.push(btn);
  }
}

/**
 * Update playhead position on the bit matrix without recreating DOM.
 */
function updatePlayheadBit(step) {
  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const dacBits = Math.min(8, len);
  const activeStep = step >= 0 ? step % len : -1;

  for (let i = 0; i < bitButtons.length; i++) {
    const btn = bitButtons[i];
    if (!btn) continue;

    // Playhead cursor
    if (activeStep >= 0 && i === activeStep) {
      btn.classList.add("now");
    } else {
      btn.classList.remove("now");
    }

    // DAC window
    const inDac = activeStep >= 0 && (((i - activeStep - (state.turingSlip || 0)) % len + len) % len < dacBits);
    if (inDac) {
      btn.classList.add("in-dac");
    } else {
      btn.classList.remove("in-dac");
    }
  }
}

/**
 * Render melodic contour and DAC output preview canvas.
 */
function renderDacContour() {
  if (!dacCanvas) return;
  const ctx = dacCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = dacCanvas.clientWidth || 400;
  const h = dacCanvas.clientHeight || 70;

  dacCanvas.width = Math.round(w * dpr);
  dacCanvas.height = Math.round(h * dpr);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isLight = document.documentElement.dataset.theme === "light";
  const bg = isLight ? "#ffffff" : "#18191f";
  const lineCol = isLight ? "#d1d5db" : "#333846";
  const accent = isLight ? "#2563eb" : "#3b82f6";
  const dimCol = isLight ? "#4b5563" : "#9ca3af";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const len = Math.max(2, Math.min(64, state.turingLength || 16));
  const colW = w / len;
  const currentStep = lastLiveStep >= 0 ? lastLiveStep % len : -1;

  // Grid line dividers
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < len; i++) {
    const x = Math.round(i * colW);
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  ctx.stroke();

  // Pitch bars
  for (let i = 0; i < len; i++) {
    const { val, norm } = getDacValueAtStep(i);
    const { note } = getNoteAtStep(i);
    const active = isStepActive(i);
    const barH = Math.max(4, Math.round(norm * (h - 18)));
    const x = i * colW + 2;
    const barW = Math.max(2, colW - 4);
    const y = h - barH - 4;

    if (active) {
      ctx.fillStyle = i === currentStep ? "var(--fg)" : accent;
      ctx.fillRect(x, y, barW, barH);
    } else {
      ctx.fillStyle = lineCol;
      ctx.fillRect(x, h - 6, barW, 2);
    }

    // Step number on bottom
    if (colW >= 14 || i % 2 === 0) {
      ctx.fillStyle = dimCol;
      ctx.font = "8px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), i * colW + colW / 2, h - 2);
    }
  }

  // Playhead line
  if (currentStep >= 0) {
    ctx.strokeStyle = isLight ? "#111827" : "#f3f4f6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const px = currentStep * colW + colW / 2;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Initialize the Turing Machine sequencer model DOM inside #model-turing.
 */
export function initTuring() {
  const container = document.getElementById("model-turing");
  if (!container) return;
  turingContainer = container;
  container.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "turing-layout";

  // ==========================================
  // LEFT COLUMN: Controls & Sound Parameters
  // ==========================================
  const moduleCol = document.createElement("div");
  moduleCol.className = "turing-module";

  // 1. Shift Register Engine Section
  const engineSect = document.createElement("section");
  engineSect.className = "sect turing-sect";
  engineSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Shift Register Engine</h3>
      <span class="ca-rule-badge">Turing Machine</span>
    </div>
  `;

  const engineControls = document.createElement("div");
  engineControls.className = "sgrid";
  engineControls.style.gridTemplateColumns = "repeat(3, 1fr)";

  // Mutation Knob (0% Lock to 100% Random)
  const probKnob = R("turingProb", knob({
    label: "Mutation",
    min: 0,
    max: 100,
    value: state.turingProb ?? 0,
    def: 0,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state.turingProb = Math.round(v);
      updateHud(lastLiveStep >= 0 ? lastLiveStep : 0);
      status(`Write Mutation: ${Math.round(v)}% (${v === 0 ? "Locked" : v === 100 ? "Random" : "Evolving"})`);
    },
    tip: "Write probability: chance circulating bits mutate. 0% = locked repeating loop; 100% = pure random walk; 5%–15% = slow organic evolution."
  }));

  // Register Length Knob (8, 16, 24, 32, 48, 64)
  const lenKnob = R("turingLength", knob({
    label: "Length",
    min: 8,
    max: 64,
    step: 8,
    value: state.turingLength ?? 16,
    def: 16,
    format: (v) => `${Math.round(v)} st`,
    onInput: (v) => {
      state.turingLength = Math.round(v);
      generateTuringBank();
      renderBitGrid();
      renderDacContour();
      status(`Register Length: ${state.turingLength} steps`);
    },
    tip: "Number of steps circulating in the shift register loop before repeating."
  }));

  // Pitch Span Knob (1 to 4 Octaves)
  const spanKnob = R("turingSpan", knob({
    label: "Pitch Span",
    min: 1,
    max: 4,
    value: state.turingSpan ?? 2,
    def: 2,
    format: (v) => `${Math.round(v)} Oct`,
    onInput: (v) => {
      state.turingSpan = Math.round(v);
      generateTuringBank();
      status(`Pitch Span: ${state.turingSpan} Octaves`);
    },
    tip: "Keyboard pitch span (in octaves) spanned by the 8-bit DAC ladder."
  }));

  engineControls.append(probKnob, lenKnob, spanKnob);

  // Mutation Presets Pill Row
  const probRow = document.createElement("div");
  probRow.className = "humanise-presets-row";
  probRow.style.marginTop = "8px";
  probRow.style.gridColumn = "1 / -1";

  const probTag = document.createElement("span");
  probTag.className = "humanise-preset-tag";
  probTag.textContent = "Lock / Mutate:";
  probRow.appendChild(probTag);

  MUTATION_PRESETS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `humanise-pill-btn ${state.turingProb === p.value ? "is-active" : ""}`;
    btn.textContent = p.label;
    btn.title = p.tip;
    btn.addEventListener("click", () => {
      state.turingProb = p.value;
      if (refs.turingProb) refs.turingProb.setValue(p.value, false);
      probRow.querySelectorAll(".humanise-pill-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      updateHud(lastLiveStep >= 0 ? lastLiveStep : 0);
      status(`Mutation: ${p.label}`);
    });
    probRow.appendChild(btn);
  });

  // Bit Slip & Bit Actions Row
  const bitActionsRow = document.createElement("div");
  bitActionsRow.className = "ca-edit-actions";
  bitActionsRow.style.gridColumn = "1 / -1";
  bitActionsRow.style.marginTop = "6px";

  const btnSlipLeft = actionBtn("◀ Slip -1", () => {
    const len = Math.max(2, Math.min(64, state.turingLength || 16));
    state.turingSlip = ((state.turingSlip || 0) - 1 + len) % len;
    generateTuringBank();
    renderBitGrid();
    renderDacContour();
    status("Bit slip -1");
  }, "Rotate bit pattern left 1 step");

  const btnSlipRight = actionBtn("Slip +1 ▶", () => {
    const len = Math.max(2, Math.min(64, state.turingLength || 16));
    state.turingSlip = ((state.turingSlip || 0) + 1) % len;
    generateTuringBank();
    renderBitGrid();
    renderDacContour();
    status("Bit slip +1");
  }, "Rotate bit pattern right 1 step");

  const btnInvert = actionBtn("Invert Bits", () => {
    const len = Math.max(2, Math.min(64, state.turingLength || 16));
    for (let i = 0; i < len; i++) turingBits[i] ^= 1;
    generateTuringBank();
    renderBitGrid();
    renderDacContour();
    status("Bits inverted (0 ↔ 1)");
  }, "Invert all active bits");

  bitActionsRow.append(btnSlipLeft, btnSlipRight, btnInvert);

  engineSect.append(engineControls, probRow, bitActionsRow);

  // 2. REUSED NOTES SECTION (Root Note, Root Octave, Scale Quantizer, Note Selector, Octave Spread)
  turingNotesSection = createNotesSection({
    title: "Notes",
    scaleKey: "turingScale",
    customScaleKey: "turingCustomScale",
    rootKey: "turingRoot",
    rootNoteKey: "turingRootNote",
    rootOctaveKey: "turingRootOctave",
    quantKey: "turingQuantSteps",
    octaveKey: "turingOctave",
    octaveModeKey: "turingOctaveMode",
    defaultOctave: 3,
    scaleLabel: "Scale Quantize",
    onChange: () => {
      generateTuringBank();
    }
  });

  moduleCol.append(engineSect, turingNotesSection.sectEl);

  // ==========================================
  // RIGHT COLUMN: Shift Register Display & Contour
  // ==========================================
  const displayCol = document.createElement("div");
  displayCol.className = "ca-display";

  // HUD Readout Bar
  const hudBar = document.createElement("div");
  hudBar.className = "ca-hud-bar";

  hudStep = document.createElement("span");
  hudStep.className = "ca-hud-val";
  hudStep.textContent = "1 / 16";

  hudRegister = document.createElement("span");
  hudRegister.className = "ca-hud-val";
  hudRegister.textContent = "0x0000";

  hudDac = document.createElement("span");
  hudDac.className = "ca-hud-val";
  hudDac.textContent = "0 / 255";

  hudNote = document.createElement("span");
  hudNote.className = "ca-hud-val ca-hud-highlight";
  hudNote.textContent = "—";

  hudLock = document.createElement("span");
  hudLock.className = "ca-hud-val";
  hudLock.textContent = "🔒 LOCKED (0%)";

  const mkHudItem = (label, valEl) => {
    const item = document.createElement("div");
    item.className = "ca-hud-item";
    const lbl = document.createElement("span");
    lbl.className = "ca-hud-lbl";
    lbl.textContent = label;
    item.append(lbl, valEl);
    return item;
  };

  hudBar.append(
    mkHudItem("Step", hudStep),
    mkHudItem("Register", hudRegister),
    mkHudItem("DAC", hudDac),
    mkHudItem("Note", hudNote),
    mkHudItem("Mode", hudLock)
  );

  // Shift Register Bit Matrix (Tape) Container
  const tapeWrap = document.createElement("div");
  tapeWrap.className = "turing-tape-wrap";
  tapeWrap.innerHTML = `
    <div class="turing-tape-header">
      <h4>Shift Register Bits</h4>
      <span class="turing-tape-hint">Click bit to toggle · Orange box = 8-Bit DAC Tap</span>
    </div>
    <div id="turing-bit-grid" class="turing-bit-grid"></div>
  `;

  // DAC Melody Contour Visualizer Canvas
  const contourWrap = document.createElement("div");
  contourWrap.className = "turing-contour-wrap";
  contourWrap.innerHTML = `
    <div class="turing-tape-header">
      <h4>Melodic Contour &amp; Quantized Pitch</h4>
      <span class="turing-tape-hint">Active Steps · Sounding Notes</span>
    </div>
  `;
  dacCanvas = document.createElement("canvas");
  dacCanvas.className = "turing-dac-canvas";
  dacCanvas.style.height = "76px";
  dacCanvas.style.width = "100%";
  contourWrap.appendChild(dacCanvas);

  // Bit Seed Presets Library
  const presetBox = document.createElement("div");
  presetBox.className = "ca-sect";
  presetBox.style.marginTop = "8px";
  presetBox.innerHTML = `
    <div class="ca-sect-head">
      <h3>Shift Register Seed Presets</h3>
      <span class="ca-hint-inline">Click to load pattern</span>
    </div>
  `;

  const presetGrid = document.createElement("div");
  presetGrid.className = "ca-preset-grid";

  BIT_PATTERNS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ca-preset-btn";
    btn.textContent = p.name;
    btn.title = `Load ${p.name} bit pattern`;
    btn.addEventListener("click", () => {
      const len = Math.max(2, Math.min(64, state.turingLength || 16));
      for (let i = 0; i < len; i++) {
        turingBits[i] = p.pattern[i % p.pattern.length];
      }
      generateTuringBank();
      renderBitGrid();
      renderDacContour();
      status(`Loaded Turing Seed: ${p.name}`);
    });
    presetGrid.appendChild(btn);
  });

  presetBox.appendChild(presetGrid);

  displayCol.append(hudBar, tapeWrap, contourWrap, presetBox);

  layout.append(moduleCol, displayCol);
  container.appendChild(layout);

  // Hook live playhead & mutation on step ticks
  onStep((stepIndex) => {
    if (stepIndex === null) {
      lastLiveStep = -1;
      updatePlayheadBit(-1);
      renderDacContour();
      return;
    }

    if (getActiveModel && getActiveModel() !== "turing") return;
    if (container.style.display === "none") return;

    lastLiveStep = stepIndex;
    const len = Math.max(2, Math.min(64, state.turingLength || 16));
    const activeStep = stepIndex % len;

    // Live Mutation Engine: test bit mutation if running with prob > 0
    const prob = state.turingProb ?? 0;
    if (isLive() && prob > 0) {
      // Chance to mutate a bit on step wrap or continuous flux
      const chance = (prob / 100) * 0.35;
      if (Math.random() < chance) {
        const mutateBitIdx = Math.floor(Math.random() * len);
        turingBits[mutateBitIdx] ^= 1;
        generateTuringBank();
        renderBitGrid();
      }
    }

    updateHud(activeStep);
    updatePlayheadBit(activeStep);
    renderDacContour();
  });

  // Watch for theme changes (Dark / Light) to instantly update canvas colors
  const themeObserver = new MutationObserver(() => {
    if (container.style.display !== "none") {
      renderDacContour();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/**
 * When activating the Turing Machine model.
 */
export function activateTuringModel() {
  setSelected(0);
  setModelGenerator(generateTuringBank);
  setModelRandomizer(randomizeTuring);

  if (state.rate === undefined) state.rate = 6;
  if (refs.rate) refs.rate.setValue(state.rate);

  if (turingNotesSection) turingNotesSection.sync();

  doGenerate(false);
  syncRhythmGrid();
  renderBitGrid();
  renderDacContour();
  updateHud(0);
}

/**
 * When deactivating the Turing Machine model.
 */
export function deactivateTuringModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
}

// Sync DAC contour when rhythm grid gates change
onBufferRender(() => {
  if (getActiveModel && getActiveModel() === "turing") {
    renderDacContour();
    updateHud(lastLiveStep >= 0 ? lastLiveStep : 0);
  }
});

// Re-render contour on window resize
window.addEventListener("resize", () => {
  if (getActiveModel && getActiveModel() === "turing") {
    renderDacContour();
  }
});
