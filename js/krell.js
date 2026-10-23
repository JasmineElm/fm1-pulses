// krell.js — Buchla 266 "Krell Patch" Generative Dwell & Envelope Cross-Modulation Model for FM-1 Pulses.
// Inspired by Todd Barton's canonical Buchla patch and Bebe & Louis Barron's 1956 Forbidden Planet circuits.
//
// Circuit Architecture:
// 1. Dual Function Generators (Rise / Fall non-linear envelope integrators).
// 2. End-of-Cycle (EOC) pulses triggering a 266 Source of Uncertainty (Sample & Hold).
// 3. Pitch-to-time cross-modulation: sampled voltages dynamically warp the Rise & Fall slope durations.
// 4. Continuous MIDI CC #74 Brightness modulation streaming along the analog envelope trajectory.
// 5. Up to 4 parallel self-generating Krell voice cores with scale quantization via scale.js.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, getRootMidi, getActiveScaleIntervals } from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import * as midi from "./midi.js";

// ---- Constants & State ----
const MAX_VOICES = 4;
const SCOPE_POINTS = 160;

// Reusable colors matching tokens in style.md
const VOICE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];

// UI Elements
let krellContainer = null;
let krellCanvas = null;
let animFrameId = null;
let lastFrameTime = 0;
let isRunning = false;

// Presets for classic Krell configurations
export const KRELL_PRESETS = [
  {
    name: "Forbidden Planet",
    desc: "Authentic 1956 Barron soundtrack: slow cavernous drones with sporadic bird-like chirps",
    voices: 2, rise: 1.2, fall: 3.5, crossMod: 65, curve: "exp", dwell: 0.2, span: 3, ccDepth: 105
  },
  {
    name: "Alien Rainforest",
    desc: "Polyphonic dual-voice counterpoint with fluttering organic insect phrases",
    voices: 3, rise: 0.4, fall: 1.2, crossMod: 50, curve: "exp", dwell: 0.05, span: 3, ccDepth: 85
  },
  {
    name: "Deep Space Drone",
    desc: "Massive, slow-breathing swells with wide continuous FM-1 filter modulation",
    voices: 2, rise: 2.5, fall: 6.0, crossMod: 25, curve: "log", dwell: 0.0, span: 2, ccDepth: 120
  },
  {
    name: "Staccato Insects",
    desc: "Fast, twitchy micro-phrasing with sharp exponential attacks and quick release",
    voices: 3, rise: 0.12, fall: 0.35, crossMod: 80, curve: "exp", dwell: 0.08, span: 4, ccDepth: 70
  }
];

// ---- Krell Voice Class ----
export class KrellVoice {
  constructor(id) {
    this.id = id;
    this.color = VOICE_COLORS[id % VOICE_COLORS.length];
    this.stage = "REST"; // "RISE" | "FALL" | "REST"
    this.env = 0.0;
    this.rawEnv = 0.0;
    this.curRise = 0.8;
    this.curFall = 2.2;
    this.curDwell = 0.15;
    this.dwellTimer = 0.05 * id; // staggered start
    this.currentNote = null;
    this.currentVel = 80;
    this.sampledRandV = 0.5;

    // Rolling waveform history for oscilloscope display
    this.history = new Float32Array(SCOPE_POINTS);
    this.historyHead = 0;
  }

  // End-of-Cycle (EOC) sample & hold trigger
  triggerNewCycle() {
    if (this.currentNote !== null) {
      liveNoteOff(this.currentNote);
      this.currentNote = null;
    }

    // 1. Sample Source of Uncertainty fluctuating random voltage
    this.sampledRandV = Math.random();

    // 2. Quantize pitch to active scale
    const root = getRootMidi();
    const octaves = state.pitchSpan ?? state.krellSpan ?? 3;
    const intervals = getActiveScaleIntervals(state.scale || state.krellScale);
    const rawMidi = root + Math.round(this.sampledRandV * octaves * 12);
    this.currentNote = quantize(rawMidi, intervals, root);

    // 3. Modulate Rise & Fall times for the new cycle (Pitch-to-Time cross-modulation)
    const baseRise = state.krellRise ?? 0.8;
    const baseFall = state.krellFall ?? 2.2;
    const baseDwell = state.krellDwell ?? 0.15;
    const kMod = (state.krellCrossMod ?? 45) / 100;

    // modFactor: higher pitches produce shorter envelopes (staccato chirp); lower pitches produce long drone swells
    const centeredPitch = (this.sampledRandV - 0.5) * 2; // -1..1
    const modFactor = Math.exp(-kMod * centeredPitch * 1.8);

    this.curRise = Math.max(0.04, baseRise * modFactor);
    this.curFall = Math.max(0.08, baseFall * (1 / modFactor));
    this.curDwell = Math.max(0.0, baseDwell * (0.6 + this.sampledRandV * 0.8));

    // 4. Trigger Note On if audio/preview is active
    this.currentVel = Math.min(127, Math.max(35, 60 + Math.round(this.sampledRandV * 55)));
    const estDurationMs = (this.curRise + this.curFall) * 1000;
    if (isLive()) {
      liveNoteOn(this.currentNote, this.currentVel, estDurationMs);
    }

    this.stage = "RISE";
    this.rawEnv = 0.0;
    this.env = 0.0;
  }

  update(dt) {
    if (this.stage === "RISE") {
      this.rawEnv += dt / this.curRise;
      if (this.rawEnv >= 1.0) {
        this.rawEnv = 1.0;
        this.stage = "FALL";
      }
    } else if (this.stage === "FALL") {
      this.rawEnv -= dt / this.curFall;
      if (this.rawEnv <= 0.0) {
        this.rawEnv = 0.0;
        if (this.currentNote !== null) {
          liveNoteOff(this.currentNote);
          this.currentNote = null;
        }

        if (this.curDwell > 0.01) {
          this.stage = "REST";
          this.dwellTimer = this.curDwell;
        } else {
          this.triggerNewCycle();
        }
      }
    } else if (this.stage === "REST") {
      this.dwellTimer -= dt;
      if (this.dwellTimer <= 0) {
        this.triggerNewCycle();
      }
    }

    // Compute non-linear shaped envelope voltage
    const curve = state.krellCurve || "exp";
    if (curve === "exp") {
      // Exponential rise and decay
      this.env = this.stage === "RISE"
        ? 1.0 - Math.exp(-3.5 * this.rawEnv)
        : Math.pow(Math.max(0, this.rawEnv), 1.8);
    } else if (curve === "log") {
      this.env = this.stage === "RISE"
        ? Math.pow(Math.max(0, this.rawEnv), 1.6)
        : 1.0 - Math.exp(-3.5 * (1.0 - Math.max(0, this.rawEnv)));
    } else {
      // Linear
      this.env = Math.max(0, Math.min(1, this.rawEnv));
    }

    // Record to rolling scope buffer
    this.history[this.historyHead] = this.env;
    this.historyHead = (this.historyHead + 1) % SCOPE_POINTS;
  }

  stop() {
    if (this.currentNote !== null) {
      liveNoteOff(this.currentNote);
      this.currentNote = null;
    }
    this.stage = "REST";
    this.rawEnv = 0.0;
    this.env = 0.0;
  }
}

// Voices array (1 to 4 voices)
export const krellVoices = Array.from({ length: MAX_VOICES }, (_, i) => new KrellVoice(i));

// ---- Real-Time Simulation Loop ----
function krellTick(time) {
  if (!isRunning) return;

  if (!lastFrameTime) lastFrameTime = time;
  const dt = Math.min(0.05, (time - lastFrameTime) / 1000);
  lastFrameTime = time;

  const numVoices = Math.min(MAX_VOICES, Math.max(1, state.krellVoices ?? 2));
  let maxEnv = 0;

  for (let i = 0; i < numVoices; i++) {
    krellVoices[i].update(dt);
    if (krellVoices[i].env > maxEnv) maxEnv = krellVoices[i].env;
  }

  // Stream continuous MIDI CC #74 (Filter Cutoff / Brightness)
  const ccDest = state.krellCcDest ?? 74;
  const ccDepth = state.krellCcDepth ?? 95;
  if (ccDepth > 0 && isLive()) {
    const ccVal = Math.min(127, Math.round(maxEnv * ccDepth + (127 - ccDepth) * 0.25));
    try {
      midi.sendControlChange(ccDest, ccVal);
    } catch (_) {}
  }

  renderKrellVisualizer();
  animFrameId = requestAnimationFrame(krellTick);
}

// ---- Visualizer Canvas ----
function renderKrellVisualizer() {
  if (!krellCanvas) return;
  const ctx = krellCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = krellCanvas.clientWidth || 600;
  const h = krellCanvas.clientHeight || 130;

  if (krellCanvas.width !== Math.round(w * dpr) || krellCanvas.height !== Math.round(h * dpr)) {
    krellCanvas.width = Math.round(w * dpr);
    krellCanvas.height = Math.round(h * dpr);
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

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const numVoices = Math.min(MAX_VOICES, Math.max(1, state.krellVoices ?? 2));
  const scopeW = Math.round(w * 0.62);

  // Divider
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scopeW + 0.5, 0);
  ctx.lineTo(scopeW + 0.5, h);
  ctx.stroke();

  // 1. Envelope Oscilloscope
  const padding = 16;
  const scopeInnerW = scopeW - padding * 2;
  const scopeInnerH = h - 28;
  const zeroY = h - 14;

  // Horizontal reference baseline & grid
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, zeroY);
  ctx.lineTo(padding + scopeInnerW, zeroY);
  ctx.moveTo(padding, zeroY - scopeInnerH);
  ctx.lineTo(padding + scopeInnerW, zeroY - scopeInnerH);
  ctx.stroke();

  ctx.fillStyle = dim;
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("VOLTAGE ENVELOPES (RISE / FALL OSCILLOSCOPE)", padding, 12);

  // Draw each active voice's envelope history curve
  for (let v = 0; v < numVoices; v++) {
    const voice = krellVoices[v];
    const head = voice.historyHead;

    ctx.strokeStyle = voice.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let pt = 0; pt < SCOPE_POINTS; pt++) {
      const idx = (head + pt) % SCOPE_POINTS;
      const x = padding + (pt / (SCOPE_POINTS - 1)) * scopeInnerW;
      const y = zeroY - voice.history[idx] * scopeInnerH;
      if (pt === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glowing head point
    const curHeadX = padding + scopeInnerW;
    const curHeadY = zeroY - voice.env * scopeInnerH;
    ctx.fillStyle = voice.color;
    ctx.beginPath();
    ctx.arc(curHeadX, curHeadY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Right Side: Voice Status Cards
  const statusX = scopeW + 14;
  const statusW = w - statusX - 14;
  const rowH = Math.floor((h - 22) / numVoices);

  ctx.fillStyle = dim;
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("SOURCE OF UNCERTAINTY (VOICES)", statusX, 12);

  for (let v = 0; v < numVoices; v++) {
    const voice = krellVoices[v];
    const y = 18 + v * rowH;

    // Enclosure card
    ctx.fillStyle = panel2;
    ctx.fillRect(statusX, y + 2, statusW, rowH - 4);
    ctx.strokeStyle = line;
    ctx.strokeRect(statusX, y + 2, statusW, rowH - 4);

    // Voice color marker
    ctx.fillStyle = voice.color;
    ctx.fillRect(statusX + 2, y + 4, 3, rowH - 8);

    // Text info
    const noteName = voice.currentNote !== null ? midiName(voice.currentNote) : "--";
    const noteMidi = voice.currentNote !== null ? `(${voice.currentNote})` : "";
    const stageStr = voice.stage;

    ctx.fillStyle = fg;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(`V${v + 1}: ${noteName} ${noteMidi}`, statusX + 10, y + rowH * 0.48);

    // Stage badge
    ctx.fillStyle = voice.stage === "RISE" ? accent : (voice.stage === "FALL" ? "#f59e0b" : dim);
    ctx.font = "bold 8px ui-monospace, monospace";
    ctx.fillText(`${stageStr} · ${(voice.curRise + voice.curFall).toFixed(1)}s`, statusX + 10, y + rowH * 0.85);

    // S&H Voltage Bar indicator on the right of the row
    const barW = Math.min(60, statusW * 0.35);
    const barX = statusX + statusW - barW - 8;
    const barY = y + 7;
    const barH = rowH - 14;

    ctx.fillStyle = bg;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = voice.color;
    ctx.fillRect(barX, barY, barW * voice.env, barH);
    ctx.strokeStyle = line;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  ctx.restore();
}

// ---- Lifecycle & Rack Hook Handlers ----

export function randomizeKrell() {
  state.krellRise = Number((0.2 + Math.random() * 2.0).toFixed(2));
  state.krellFall = Number((0.5 + Math.random() * 4.0).toFixed(2));
  state.krellCrossMod = Math.round(20 + Math.random() * 65);
  state.krellDwell = Number((Math.random() * 0.4).toFixed(2));
  state.krellSpan = Math.floor(Math.random() * 3) + 2;

  if (refs.krellRise?.setValue) refs.krellRise.setValue(state.krellRise, false);
  if (refs.krellFall?.setValue) refs.krellFall.setValue(state.krellFall, false);
  if (refs.krellCrossMod?.setValue) refs.krellCrossMod.setValue(state.krellCrossMod, false);
  if (refs.krellDwell?.setValue) refs.krellDwell.setValue(state.krellDwell, false);
  if (refs.krellSpan?.setValue) refs.krellSpan.setValue(state.krellSpan, false);

  krellVoices.forEach(v => v.triggerNewCycle());
  doGenerate(true);
  renderKrellVisualizer();
  status(`Krell randomized · Rise: ${state.krellRise}s · Fall: ${state.krellFall}s`);
}

export function generateKrellBank() {
  const steps = [];
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals(state.scale || state.krellScale);
  const octaves = state.pitchSpan ?? state.krellSpan ?? 3;

  for (let s = 0; s < 64; s++) {
    const rand = Math.random();
    const rawMidi = root + Math.round(rand * octaves * 12);
    const note = quantize(rawMidi, intervals, root);
    steps.push({
      notes: [note],
      velocity: 60 + Math.round(rand * 50),
      gate: 0.8
    });
  }

  const bank = [{ length: 64, steps, rate: state.rate ?? 6 }];
  setBank(bank);
  return bank;
}

export function activateKrellModel() {
  setSelected(0);
  setModelGenerator(generateKrellBank);
  setModelRandomizer(randomizeKrell);

  isRunning = true;
  lastFrameTime = 0;

  // Stagger voice starts
  const numVoices = Math.min(MAX_VOICES, Math.max(1, state.krellVoices ?? 2));
  for (let i = 0; i < numVoices; i++) {
    krellVoices[i].dwellTimer = i * 0.35;
    krellVoices[i].stage = "REST";
  }

  animFrameId = requestAnimationFrame(krellTick);
  doGenerate(false);
  renderKrellVisualizer();
}

export function deactivateKrellModel() {
  isRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  krellVoices.forEach(v => v.stop());
  panicPreview();
  setModelGenerator(null);
  setModelRandomizer(null);
}

// ---- UI Panel Construction ----
export function initKrell() {
  krellContainer = document.getElementById("model-krell");
  if (!krellContainer) return;
  krellContainer.innerHTML = "";

  // 1. Header Card
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
  title.textContent = "BUCHLA 266 KRELL GENERATIVE PATCH";

  const sub = document.createElement("span");
  sub.style.fontSize = "8.5px";
  sub.style.color = "var(--dim)";
  sub.textContent = "DUAL FUNCTION GENERATORS · SOURCE OF UNCERTAINTY · NON-METRIC AMBIENT";
  titleBox.append(title, sub);

  const controlsBox = document.createElement("div");
  controlsBox.style.display = "flex";
  controlsBox.style.alignItems = "center";
  controlsBox.style.gap = "6px";

  // Preset Selector
  const presetSelect = document.createElement("select");
  presetSelect.className = "btn";
  presetSelect.style.padding = "2px 6px";
  presetSelect.style.fontSize = "9px";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "Presets...";
  presetSelect.appendChild(defOpt);
  KRELL_PRESETS.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  });

  presetSelect.addEventListener("change", () => {
    const p = KRELL_PRESETS[Number(presetSelect.value)];
    if (!p) return;
    state.krellVoices = p.voices;
    state.krellRise = p.rise;
    state.krellFall = p.fall;
    state.krellCrossMod = p.crossMod;
    state.krellCurve = p.curve;
    state.krellDwell = p.dwell;
    state.krellSpan = p.span;
    state.krellCcDepth = p.ccDepth;

    if (refs.krellVoices?.setValue) refs.krellVoices.setValue(p.voices, false);
    if (refs.krellRise?.setValue) refs.krellRise.setValue(p.rise, false);
    if (refs.krellFall?.setValue) refs.krellFall.setValue(p.fall, false);
    if (refs.krellCrossMod?.setValue) refs.krellCrossMod.setValue(p.crossMod, false);
    if (refs.krellDwell?.setValue) refs.krellDwell.setValue(p.dwell, false);
    if (refs.krellSpan?.setValue) refs.krellSpan.setValue(p.span, false);

    krellVoices.forEach(v => v.triggerNewCycle());
    renderKrellVisualizer();
    status(`Loaded Krell preset: ${p.name} · ${p.desc}`);
    presetSelect.value = "";
  });

  // Retrigger Button
  const retriggerBtn = document.createElement("button");
  retriggerBtn.type = "button";
  retriggerBtn.className = "btn";
  retriggerBtn.style.padding = "3px 8px";
  retriggerBtn.style.fontSize = "9px";
  retriggerBtn.textContent = "Retrigger";
  retriggerBtn.title = "Force End-of-Cycle pulse on all active voices";
  retriggerBtn.addEventListener("click", () => {
    const numVoices = Math.min(MAX_VOICES, Math.max(1, state.krellVoices ?? 2));
    for (let i = 0; i < numVoices; i++) {
      krellVoices[i].triggerNewCycle();
    }
    status("Krell voices retriggered");
  });

  controlsBox.append(presetSelect, retriggerBtn);
  headRow.append(titleBox, controlsBox);
  headerCard.appendChild(headRow);

  // 2. Interactive Controls Grid Card
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "10px 14px";
  paramCard.style.marginBottom = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.style.display = "grid";
  paramGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(78px, 1fr))";
  paramGrid.style.gap = "8px";
  paramGrid.style.alignItems = "center";

  // Knobs
  const kVoices = knob({
    label: "VOICES",
    min: 1, max: 4, step: 1,
    value: state.krellVoices ?? 2,
    unit: "",
    title: "Number of parallel Krell function generator voices (1 to 4)",
    onChange: (v) => {
      state.krellVoices = v;
      renderKrellVisualizer();
    }
  });
  R("krellVoices", kVoices);

  const kRise = knob({
    label: "RISE",
    min: 0.05, max: 5.0, step: 0.05,
    value: state.krellRise ?? 0.8,
    unit: "s",
    title: "Base rise / attack duration",
    onChange: (v) => { state.krellRise = v; }
  });
  R("krellRise", kRise);

  const kFall = knob({
    label: "FALL",
    min: 0.1, max: 8.0, step: 0.1,
    value: state.krellFall ?? 2.2,
    unit: "s",
    title: "Base fall / decay duration",
    onChange: (v) => { state.krellFall = v; }
  });
  R("krellFall", kFall);

  const kCrossMod = knob({
    label: "CROSS-MOD",
    min: -100, max: 100, step: 1,
    value: state.krellCrossMod ?? 45,
    unit: "%",
    title: "Pitch-to-time cross-modulation depth (high pitches chirp fast, low pitches drone)",
    onChange: (v) => { state.krellCrossMod = v; }
  });
  R("krellCrossMod", kCrossMod);

  const kDwell = knob({
    label: "DWELL",
    min: 0.0, max: 2.5, step: 0.05,
    value: state.krellDwell ?? 0.15,
    unit: "s",
    title: "Rest / pause duration between envelope cycles",
    onChange: (v) => { state.krellDwell = v; }
  });
  R("krellDwell", kDwell);

  const kSpan = knob({
    label: "SPAN",
    min: 1, max: 4, step: 1,
    value: state.krellSpan ?? state.pitchSpan ?? 3,
    unit: "oct",
    title: "Octave range across active scale intervals",
    onChange: (v) => {
      state.krellSpan = v;
      state.pitchSpan = v;
      if (refs.pitchSpan?.setValue) refs.pitchSpan.setValue(v, false);
      renderKrellVisualizer();
    }
  });
  R("krellSpan", kSpan);

  const kCc = knob({
    label: "FM CC#74",
    min: 0, max: 127, step: 1,
    value: state.krellCcDepth ?? 95,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth from envelope trajectory",
    onChange: (v) => { state.krellCcDepth = v; }
  });
  R("krellCcDepth", kCc);

  paramGrid.append(kVoices, kRise, kFall, kCrossMod, kDwell, kSpan, kCc);
  paramCard.appendChild(paramGrid);

  // 3. Canvas Card (Oscilloscope & S&H Status)
  const canvasCard = document.createElement("div");
  canvasCard.className = "card";
  canvasCard.style.padding = "8px 12px";

  krellCanvas = document.createElement("canvas");
  krellCanvas.style.width = "100%";
  krellCanvas.style.height = "120px";
  krellCanvas.style.display = "block";
  krellCanvas.style.borderRadius = "4px";
  krellCanvas.style.background = "var(--panel)";

  canvasCard.appendChild(krellCanvas);

  krellContainer.append(headerCard, paramCard, canvasCard);
  renderKrellVisualizer();
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "krell",
  version: 1,
  migrations: {},
  capture() {
    return {
      voices: state.krellVoices,
      rise: state.krellRise,
      fall: state.krellFall,
      crossMod: state.krellCrossMod,
      dwell: state.krellDwell,
      curve: state.krellCurve,
      span: state.krellSpan
    };
  },
  restore(h) {
    if (h?.voices !== undefined) state.krellVoices = h.voices;
    if (h?.rise !== undefined) state.krellRise = h.rise;
    if (h?.fall !== undefined) state.krellFall = h.fall;
    if (h?.crossMod !== undefined) state.krellCrossMod = h.crossMod;
    if (h?.dwell !== undefined) state.krellDwell = h.dwell;
    if (h?.curve) state.krellCurve = h.curve;
    if (h?.span !== undefined) state.krellSpan = h.span;

    krellVoices.forEach(v => v.triggerNewCycle());
    renderKrellVisualizer();
  }
});
