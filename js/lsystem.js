// lsystem.js — L-System (Lindenmayer Morphogenetic Grammar) model for FM-1 Pulses.
// Based on Aristid Lindenmayer's biological grammars and musical turtle interpretation.
//
// Generative Architecture:
// 1. Formal Grammar Rewriting G = (V, Sigma, omega, P) with variables (F, X, Y) and terminals (+, -, [, ], ^, v, |, *).
// 2. Stack-based musical turtle state vector S = (degree, octave, velFactor, angle, x, y).
// 3. Pre-allocated geometric tree cache and 64-step phrase generator quantized to active scale.
// 4. Strict 8-voice polyphony ceiling with oldest note stealing (M-VAVE FM-1 constraint).
// 5. Continuous FM-1 CC #74 Brightness modulation driven by branch stack depth.
// 6. Direct manipulation: clickable canvas nodes, interactive token ribbon, editable production rules.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals, computeOctaveShift } from "./scale.js?v=1";
import { syncRhythmGrid, randomizeRhythm } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import * as midi from "./midi.js";

// ---- Constants & Polyphony Ceiling ----
const MAX_VOICES = 8;
const MAX_EXPANDED_LEN = 4096;
const activeVoices = new Map(); // note -> timeoutId
let activeSoundingNote = null;

// Presets for classic and musical L-Systems
export const LSYSTEM_PRESETS = [
  {
    id: "canopy",
    name: "Fractal Canopy",
    desc: "Organic branching tree: central trunk splitting into self-similar harmonic canopy",
    axiom: "F",
    ruleF: "F[+F]F[-F][F]",
    ruleX: "X",
    ruleY: "Y",
    depth: 3,
    degreeStep: 1,
    angle: 25,
    decay: 85
  },
  {
    id: "dragon",
    name: "Dragon Curve",
    desc: "Heighway dragon: 90° paper-folding fractal with angular melodic leaps",
    axiom: "FX",
    ruleF: "F",
    ruleX: "X+YF+",
    ruleY: "-FX-Y",
    depth: 4,
    degreeStep: 2,
    angle: 90,
    decay: 90
  },
  {
    id: "sierpinski",
    name: "Sierpinski Arrowhead",
    desc: "Equilateral triangular fractal generating dense, cycling arpeggio networks",
    axiom: "YF",
    ruleF: "F",
    ruleX: "YF+XF+Y",
    ruleY: "XF-YF-X",
    depth: 3,
    degreeStep: 2,
    angle: 60,
    decay: 90
  },
  {
    id: "koch",
    name: "Koch Snowflake",
    desc: "Symmetric self-similar crystals with undulating triadic contours",
    axiom: "F",
    ruleF: "F+F--F+F",
    ruleX: "X",
    ruleY: "Y",
    depth: 3,
    degreeStep: 1,
    angle: 60,
    decay: 95
  },
  {
    id: "hilbert",
    name: "Hilbert Space-Filler",
    desc: "Continuous space-filling curve meandering harmonically without crossing itself",
    axiom: "X",
    ruleF: "F",
    ruleX: "-YF+XFX+FY-",
    ruleY: "+XF-YFY-FX+",
    depth: 2,
    degreeStep: 1,
    angle: 90,
    decay: 95
  },
  {
    id: "cantor",
    name: "Cantorian Nesting",
    desc: "Octave-displaced bracketed motifs creating nested contrapuntal echoes",
    axiom: "F",
    ruleF: "F[+F]vF[-F]^F",
    ruleX: "X",
    ruleY: "Y",
    depth: 3,
    degreeStep: 1,
    angle: 30,
    decay: 80
  },
  {
    id: "vine",
    name: "Polyrhythmic Vine",
    desc: "Dual-variable asymmetric vine with interwoven sub-branch clusters",
    axiom: "X",
    ruleF: "FF",
    ruleX: "F[+X][-X]FX",
    ruleY: "Y",
    depth: 3,
    degreeStep: 2,
    angle: 35,
    decay: 85
  },
  {
    id: "levy",
    name: "Levy C Curve",
    desc: "Self-similar decorative loops producing hypnotic, spiraling motifs",
    axiom: "F",
    ruleF: "+F--F+",
    ruleX: "X",
    ruleY: "Y",
    depth: 4,
    degreeStep: 1,
    angle: 45,
    decay: 90
  }
];

// ---- Compiled L-System & Simulation Cache ----
let compiledString = "F";
let compiledNotes = []; // Array of { note, vel, depth, symIndex, step }
let treeSegments = [];  // Array of { x1, y1, x2, y2, depth, symIndex, note }
let lastLiveStep = -1;
let animFrameId = null;

// UI DOM references
let lsystemContainer = null;
let treeCanvas = null;
let ribbonContainer = null;
let axiomInput = null;
let ruleFInput = null;
let ruleXInput = null;
let ruleYInput = null;
let presetSelect = null;

// ---- Audio Dispatch & 8-Voice Polyphony Ceiling ----
function playLsystemVoice(note, vel, durMs, depth = 0) {
  if (activeVoices.size >= MAX_VOICES) {
    const oldest = activeVoices.keys().next().value;
    clearTimeout(activeVoices.get(oldest));
    liveNoteOff(oldest);
    activeVoices.delete(oldest);
  }

  if (activeSoundingNote !== null && activeSoundingNote !== note) {
    liveNoteOff(activeSoundingNote);
    activeVoices.delete(activeSoundingNote);
  }

  liveNoteOn(note, vel, durMs);
  activeSoundingNote = note;

  const tid = setTimeout(() => {
    activeVoices.delete(note);
    if (activeSoundingNote === note) activeSoundingNote = null;
  }, durMs);
  activeVoices.set(note, tid);

  // Modulate FM-1 CC #74 Brightness with branch stack depth
  const ccDest = state.lsystemCcDest ?? 74;
  const ccDepth = state.lsystemCcDepth ?? 80;
  if (ccDepth > 0) {
    // Top-level trunk = bright; deep branches = softer/darker filter
    const depthRatio = Math.max(0, 1 - depth * 0.2);
    const ccVal = Math.min(127, Math.max(10, Math.round(depthRatio * ccDepth + (127 - ccDepth) * 0.3)));
    try {
      midi.sendControlChange(ccDest, ccVal);
    } catch (_) {}
  }
}

// ---- String Expansion & Grammar Compilation ----
export function compileLSystem() {
  const axiom = (state.lsystemAxiom || "F").trim().toUpperCase();
  const ruleF = (state.lsystemRuleF || "F").trim().toUpperCase();
  const ruleX = (state.lsystemRuleX || "X").trim().toUpperCase();
  const ruleY = (state.lsystemRuleY || "Y").trim().toUpperCase();
  const depth = Math.min(5, Math.max(1, state.lsystemDepth ?? 3));

  let str = axiom;
  for (let d = 0; d < depth; d++) {
    let next = "";
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "F") next += ruleF;
      else if (ch === "X") next += ruleX;
      else if (ch === "Y") next += ruleY;
      else next += ch;

      if (next.length >= MAX_EXPANDED_LEN) break;
    }
    str = next;
    if (str.length >= MAX_EXPANDED_LEN) {
      str = str.slice(0, MAX_EXPANDED_LEN);
      break;
    }
  }

  compiledString = str.length > 0 ? str : "F";
  buildSimulationCache();
  renderRibbon();
  renderTreeCanvas();
}

/**
 * Builds the geometric tree coordinates and the 64-step sequence notes.
 */
export function buildSimulationCache() {
  compiledNotes = [];
  treeSegments = [];

  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const octSpan = Math.min(4, Math.max(1, state.pitchSpan ?? state.lsystemSpan ?? 3));
  const degreeStep = Math.min(7, Math.max(1, state.lsystemDegreeStep ?? 1));
  const angleRad = ((state.lsystemAngle ?? 25) * Math.PI) / 180;
  const decayRate = (state.lsystemBranchDecay ?? 85) / 100;
  const baseVel = state.velocity ?? 100;
  const octChance = (state.octave ?? 0) / 100;
  const octMode = state.octaveMode || "up";

  let currentDegree = 0;
  let currentOctave = 0;
  let currentAngle = -Math.PI / 2; // Point upwards
  let curX = 0;
  let curY = 0;
  let stepDir = 1;
  const stack = [];

  let noteCount = 0;
  const maxNotes = 64;

  for (let i = 0; i < compiledString.length && noteCount < maxNotes; i++) {
    const sym = compiledString[i];
    const depth = stack.length;

    switch (sym) {
      case "F": {
        // Step forward in space
        const len = Math.max(8, 38 / (depth + 1));
        const nextX = curX + Math.cos(currentAngle) * len;
        const nextY = curY + Math.sin(currentAngle) * len;

        // Map musical turtle state to scale-quantized pitch
        const intLen = intervals.length || 7;
        const deg = ((currentDegree % intLen) + intLen) % intLen;
        const octOffset = Math.floor(currentDegree / intLen) + currentOctave;
        const clampedOct = Math.min(octSpan - 1, Math.max(-1, octOffset));
        const octShift = computeOctaveShift(octChance, octMode);
        const rawPitch = root + clampedOct * 12 + (intervals[deg] || 0) + octShift;
        const note = quantize(rawPitch, intervals, root);

        // Velocity scaled by branch depth
        const velFactor = Math.pow(decayRate, depth);
        const vel = Math.min(127, Math.max(30, Math.round(baseVel * velFactor)));

        treeSegments.push({
          x1: curX, y1: curY,
          x2: nextX, y2: nextY,
          depth,
          symIndex: i,
          note,
          vel,
          step: noteCount
        });

        compiledNotes.push({
          note,
          vel,
          depth,
          symIndex: i,
          step: noteCount
        });

        curX = nextX;
        curY = nextY;
        noteCount++;
        break;
      }
      case "+":
        currentDegree += degreeStep * stepDir;
        currentAngle += angleRad;
        break;
      case "-":
        currentDegree -= degreeStep * stepDir;
        currentAngle -= angleRad;
        break;
      case "^":
        currentOctave = Math.min(3, currentOctave + (state.lsystemOctaveStep ?? 1));
        break;
      case "v":
        currentOctave = Math.max(-2, currentOctave - (state.lsystemOctaveStep ?? 1));
        break;
      case "[":
        stack.push({
          deg: currentDegree,
          oct: currentOctave,
          angle: currentAngle,
          x: curX,
          y: curY,
          dir: stepDir
        });
        break;
      case "]":
        if (stack.length > 0) {
          const s = stack.pop();
          currentDegree = s.deg;
          currentOctave = s.oct;
          currentAngle = s.angle;
          curX = s.x;
          curY = s.y;
          stepDir = s.dir;
        }
        break;
      case "|":
        stepDir = -stepDir;
        currentAngle += Math.PI;
        break;
      case "*":
        // Rest / silence step
        compiledNotes.push({
          note: null,
          vel: 0,
          depth,
          symIndex: i,
          step: noteCount
        });
        noteCount++;
        break;
    }
  }

  // If fewer than 64 notes were produced by a short grammar, cycle them to fill 64 steps
  if (compiledNotes.length > 0 && compiledNotes.length < 64) {
    const originalLen = compiledNotes.length;
    for (let s = originalLen; s < 64; s++) {
      const src = compiledNotes[s % originalLen];
      compiledNotes.push({
        ...src,
        step: s
      });
    }
  }
}

// ---- Core Bank Generator Contract ----
export function generateLsystemBank(targetState = state) {
  buildSimulationCache();
  const rate = targetState.rate !== undefined ? targetState.rate : 6;
  const seqLen = Math.min(64, Math.max(1, targetState.length || 64));

  const phrase = {
    length: seqLen,
    rate,
    steps: []
  };

  const activeNotes = compiledNotes.length > 0 ? compiledNotes : [{ note: 60, vel: 100, step: 0 }];

  for (let s = 0; s < 64; s++) {
    const item = activeNotes[s % activeNotes.length];
    if (item && item.note !== null) {
      phrase.steps.push({
        notes: [{ note: item.note, vel: item.vel }],
        _savedNote: { note: item.note, vel: item.vel }
      });
    } else {
      phrase.steps.push({
        notes: [],
        _savedNote: null
      });
    }
  }

  return [phrase];
}

export function randomizeLsystem() {
  const p = LSYSTEM_PRESETS[(Math.random() * LSYSTEM_PRESETS.length) | 0];
  state.lsystemPreset = p.id;
  state.lsystemAxiom = p.axiom;
  state.lsystemRuleF = p.ruleF;
  state.lsystemRuleX = p.ruleX;
  state.lsystemRuleY = p.ruleY;
  state.lsystemDepth = p.depth;
  state.lsystemDegreeStep = p.degreeStep;
  state.lsystemAngle = p.angle;
  state.lsystemBranchDecay = p.decay;

  // Perturb degree step or angle slightly for fresh variation
  if (Math.random() > 0.5) {
    state.lsystemDegreeStep = 1 + ((Math.random() * 3) | 0);
  }

  updateInputsFromState();
  compileLSystem();
  doGenerate(true);
  status(`L-System randomized: ${p.name}`, "ok");
}

export function syncLsystemFromRegen() {
  buildSimulationCache();
  renderTreeCanvas();
}

// ---- Live Step Handler ----
export function onLsystemLiveStep(stepIndex) {
  lastLiveStep = stepIndex;

  const currentItem = compiledNotes[stepIndex % (compiledNotes.length || 1)];
  if (currentItem && currentItem.note !== null) {
    const durMs = state.lsystemGateLen ?? 180;
    playLsystemVoice(currentItem.note, currentItem.vel, durMs, currentItem.depth);
  }

  highlightActiveRibbon(stepIndex);
  renderTreeCanvas();
}

// ---- Visualizer: Flat Workbench 2D Turtle Canvas ----
export function renderTreeCanvas() {
  if (!treeCanvas) return;
  const ctx = treeCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = treeCanvas.clientWidth || 480;
  const h = treeCanvas.clientHeight || 280;

  if (treeCanvas.width !== Math.round(w * dpr) || treeCanvas.height !== Math.round(h * dpr)) {
    treeCanvas.width = Math.round(w * dpr);
    treeCanvas.height = Math.round(h * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  // Dynamic semantic color tokens
  const styles = getComputedStyle(document.documentElement);
  const colBg = styles.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = styles.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = styles.getPropertyValue("--line").trim() || "#333846";
  const colAccent = styles.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = styles.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colFg = styles.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = styles.getPropertyValue("--dim").trim() || "#9ca3af";
  const colOk = styles.getPropertyValue("--ok").trim() || "#22c55e";

  // Flat background (Strictly NO gradients)
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  if (treeSegments.length === 0) {
    ctx.fillStyle = colDim;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Compiling L-System grammar...", w / 2, h / 2);
    ctx.restore();
    return;
  }

  // Calculate bounding box to fit tree nicely in canvas
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const seg of treeSegments) {
    if (seg.x1 < minX) minX = seg.x1;
    if (seg.x2 < minX) minX = seg.x2;
    if (seg.x1 > maxX) maxX = seg.x1;
    if (seg.x2 > maxX) maxX = seg.x2;
    if (seg.y1 < minY) minY = seg.y1;
    if (seg.y2 < minY) minY = seg.y2;
    if (seg.y1 > maxY) maxY = seg.y1;
    if (seg.y2 > maxY) maxY = seg.y2;
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const padding = 28;
  const scale = Math.min((w - padding * 2) / spanX, (h - padding * 2) / spanY);
  const offsetX = (w - spanX * scale) / 2 - minX * scale;
  const offsetY = (h - spanY * scale) / 2 - minY * scale;

  // 1. Draw structural branches
  for (let i = 0; i < treeSegments.length; i++) {
    const seg = treeSegments[i];
    const sx1 = seg.x1 * scale + offsetX;
    const sy1 = seg.y1 * scale + offsetY;
    const sx2 = seg.x2 * scale + offsetX;
    const sy2 = seg.y2 * scale + offsetY;

    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.lineWidth = Math.max(1, 3.5 - seg.depth * 0.7);

    if (seg.depth === 0) ctx.strokeStyle = colAccent2;
    else if (seg.depth === 1) ctx.strokeStyle = colLine;
    else ctx.strokeStyle = colPanel2;

    ctx.stroke();
  }

  // 2. Draw note trigger nodes
  for (let i = 0; i < treeSegments.length; i++) {
    const seg = treeSegments[i];
    const sx = seg.x2 * scale + offsetX;
    const sy = seg.y2 * scale + offsetY;
    const isNow = isLive() && lastLiveStep === seg.step;

    ctx.beginPath();
    ctx.arc(sx, sy, isNow ? 5.5 : 2.5, 0, Math.PI * 2);

    if (isNow) {
      ctx.fillStyle = colAccent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colFg;
      ctx.stroke();
    } else {
      ctx.fillStyle = seg.depth === 0 ? colAccent : colLine;
      ctx.fill();
    }
  }

  // 3. Status text watermark
  ctx.fillStyle = colDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`AXIOM: ${state.lsystemAxiom} · DEPTH: ${state.lsystemDepth} · NOTES: ${compiledNotes.length}`, 8, 14);

  if (lastLiveStep >= 0 && compiledNotes[lastLiveStep]) {
    const cur = compiledNotes[lastLiveStep];
    ctx.textAlign = "right";
    ctx.fillStyle = colAccent;
    ctx.fillText(`STEP #${String(lastLiveStep + 1).padStart(2, "0")} · ${midiName(cur.note)} · DEPTH ${cur.depth}`, w - 8, 14);
  }

  ctx.restore();
}

// ---- Token Ribbon Component ----
function renderRibbon() {
  if (!ribbonContainer) return;
  ribbonContainer.innerHTML = "";

  const frag = document.createDocumentFragment();
  const maxDisplay = Math.min(180, compiledString.length);

  for (let i = 0; i < maxDisplay; i++) {
    const ch = compiledString[i];
    const chip = document.createElement("span");
    chip.className = "lsystem-chip";
    chip.dataset.idx = String(i);
    chip.textContent = ch;

    if (ch === "F") chip.classList.add("chip-f");
    else if (ch === "+" || ch === "-") chip.classList.add("chip-turn");
    else if (ch === "[" || ch === "]") chip.classList.add("chip-bracket");
    else if (ch === "^" || ch === "v") chip.classList.add("chip-oct");
    else chip.classList.add("chip-var");

    chip.title = `Symbol #${i}: '${ch}'`;
    chip.addEventListener("click", () => {
      // Find matching note step if symbol is 'F'
      const match = compiledNotes.find((n) => n.symIndex === i);
      if (match && match.note !== null) {
        playLsystemVoice(match.note, match.vel, 220, match.depth);
        lastLiveStep = match.step;
        highlightActiveRibbon(match.step);
        renderTreeCanvas();
      }
    });

    frag.appendChild(chip);
  }

  if (compiledString.length > maxDisplay) {
    const more = document.createElement("span");
    more.className = "lsystem-chip chip-more";
    more.textContent = `+${compiledString.length - maxDisplay}…`;
    frag.appendChild(more);
  }

  ribbonContainer.appendChild(frag);
}

function highlightActiveRibbon(stepIndex) {
  if (!ribbonContainer) return;
  const curNote = compiledNotes[stepIndex % (compiledNotes.length || 1)];
  if (!curNote) return;

  const targetIdx = String(curNote.symIndex);
  ribbonContainer.querySelectorAll(".lsystem-chip.is-active").forEach((el) => {
    el.classList.remove("is-active");
  });

  const activeChip = ribbonContainer.querySelector(`.lsystem-chip[data-idx="${targetIdx}"]`);
  if (activeChip) {
    activeChip.classList.add("is-active");
    // Scroll only the ribbonContainer horizontally, preventing window/page scrolling
    const chipLeft = activeChip.offsetLeft;
    const chipWidth = activeChip.offsetWidth;
    const containerWidth = ribbonContainer.clientWidth;
    ribbonContainer.scrollTo({
      left: chipLeft - (containerWidth / 2) + (chipWidth / 2),
      behavior: "smooth"
    });
  }
}

function updateInputsFromState() {
  if (axiomInput) axiomInput.value = state.lsystemAxiom || "F";
  if (ruleFInput) ruleFInput.value = state.lsystemRuleF || "F";
  if (ruleXInput) ruleXInput.value = state.lsystemRuleX || "X";
  if (ruleYInput) ruleYInput.value = state.lsystemRuleY || "Y";
  if (presetSelect) presetSelect.value = state.lsystemPreset || "canopy";
}

// ---- UI Assembly & Model Initialization ----
export function initLsystem() {
  lsystemContainer = document.getElementById("model-lsystem");
  if (!lsystemContainer) return;
  lsystemContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout lsystem-layout";

  // --- Left Module: Controls & Rule Editor ---
  const module = document.createElement("div");
  module.className = "module lsystem-module";

  // Card 1: Presets & Action Buttons
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.gap = "8px";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<h3 style="margin:0; font-size:11px; font-weight:700; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">L-System Grammar</h3>`;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  const btnCompile = document.createElement("button");
  btnCompile.className = "btn-action primary";
  btnCompile.style.fontSize = "10px";
  btnCompile.style.padding = "3px 8px";
  btnCompile.textContent = "Compile";
  btnCompile.title = "Recompile expanded grammar and sync sequence bank";
  btnCompile.addEventListener("click", () => {
    compileLSystem();
    doGenerate(true);
  });

  const btnMutate = document.createElement("button");
  btnMutate.className = "btn-action";
  btnMutate.style.fontSize = "10px";
  btnMutate.style.padding = "3px 8px";
  btnMutate.textContent = "Mutate";
  btnMutate.title = "Randomly mutate grammar rules or select next preset";
  btnMutate.addEventListener("click", () => {
    randomizeLsystem();
  });

  actionsGroup.append(btnCompile, btnMutate);
  topRow.append(titleGroup, actionsGroup);

  // Preset Selector Dropdown
  const presetRow = document.createElement("div");
  presetRow.style.marginTop = "8px";
  presetRow.style.display = "flex";
  presetRow.style.gap = "6px";
  presetRow.style.alignItems = "center";

  const presetLabel = document.createElement("span");
  presetLabel.style.fontSize = "9px";
  presetLabel.style.color = "var(--dim)";
  presetLabel.style.fontWeight = "700";
  presetLabel.textContent = "PRESET:";

  presetSelect = document.createElement("select");
  presetSelect.className = "lsystem-select";
  presetSelect.style.flex = "1";

  for (const p of LSYSTEM_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.desc.split(":")[0]})`;
    presetSelect.appendChild(opt);
  }

  presetSelect.value = state.lsystemPreset || "canopy";
  presetSelect.addEventListener("change", (e) => {
    const chosen = LSYSTEM_PRESETS.find((p) => p.id === e.target.value);
    if (chosen) {
      state.lsystemPreset = chosen.id;
      state.lsystemAxiom = chosen.axiom;
      state.lsystemRuleF = chosen.ruleF;
      state.lsystemRuleX = chosen.ruleX;
      state.lsystemRuleY = chosen.ruleY;
      state.lsystemDepth = chosen.depth;
      state.lsystemDegreeStep = chosen.degreeStep;
      state.lsystemAngle = chosen.angle;
      state.lsystemBranchDecay = chosen.decay;

      updateInputsFromState();
      compileLSystem();
      doGenerate(true);
    }
  });

  presetRow.append(presetLabel, presetSelect);
  headerCard.append(topRow, presetRow);

  // Card 2: Production Rules Editor
  const ruleCard = document.createElement("div");
  ruleCard.className = "card";
  ruleCard.style.padding = "8px 12px";
  ruleCard.style.marginTop = "8px";

  const ruleHeading = document.createElement("div");
  ruleHeading.style.fontSize = "9.5px";
  ruleHeading.style.fontWeight = "700";
  ruleHeading.style.color = "var(--dim)";
  ruleHeading.style.letterSpacing = "1px";
  ruleHeading.style.textTransform = "uppercase";
  ruleHeading.style.marginBottom = "6px";
  ruleHeading.textContent = "Production Rewrite Rules";

  const ruleGrid = document.createElement("div");
  ruleGrid.className = "lsystem-rule-grid";

  // Axiom Row
  const axiomRow = document.createElement("div");
  axiomRow.className = "lsystem-rule-row";
  axiomRow.innerHTML = `<span class="lsystem-rule-lhs">ω (Axiom):</span>`;
  axiomInput = document.createElement("input");
  axiomInput.type = "text";
  axiomInput.className = "lsystem-rule-input";
  axiomInput.value = state.lsystemAxiom || "F";
  axiomInput.spellcheck = false;
  axiomInput.addEventListener("input", (e) => {
    state.lsystemAxiom = e.target.value;
    compileLSystem();
    doGenerate(true);
  });
  axiomRow.appendChild(axiomInput);

  // Rule F Row
  const ruleFRow = document.createElement("div");
  ruleFRow.className = "lsystem-rule-row";
  ruleFRow.innerHTML = `<span class="lsystem-rule-lhs">F →</span>`;
  ruleFInput = document.createElement("input");
  ruleFInput.type = "text";
  ruleFInput.className = "lsystem-rule-input";
  ruleFInput.value = state.lsystemRuleF || "F[+F]F[-F][F]";
  ruleFInput.spellcheck = false;
  ruleFInput.addEventListener("input", (e) => {
    state.lsystemRuleF = e.target.value;
    compileLSystem();
    doGenerate(true);
  });
  ruleFRow.appendChild(ruleFInput);

  // Rule X Row
  const ruleXRow = document.createElement("div");
  ruleXRow.className = "lsystem-rule-row";
  ruleXRow.innerHTML = `<span class="lsystem-rule-lhs">X →</span>`;
  ruleXInput = document.createElement("input");
  ruleXInput.type = "text";
  ruleXInput.className = "lsystem-rule-input";
  ruleXInput.value = state.lsystemRuleX || "X";
  ruleXInput.spellcheck = false;
  ruleXInput.addEventListener("input", (e) => {
    state.lsystemRuleX = e.target.value;
    compileLSystem();
    doGenerate(true);
  });
  ruleXRow.appendChild(ruleXInput);

  // Rule Y Row
  const ruleYRow = document.createElement("div");
  ruleYRow.className = "lsystem-rule-row";
  ruleYRow.innerHTML = `<span class="lsystem-rule-lhs">Y →</span>`;
  ruleYInput = document.createElement("input");
  ruleYInput.type = "text";
  ruleYInput.className = "lsystem-rule-input";
  ruleYInput.value = state.lsystemRuleY || "Y";
  ruleYInput.spellcheck = false;
  ruleYInput.addEventListener("input", (e) => {
    state.lsystemRuleY = e.target.value;
    compileLSystem();
    doGenerate(true);
  });
  ruleYRow.appendChild(ruleYInput);

  ruleGrid.append(axiomRow, ruleFRow, ruleXRow, ruleYRow);
  ruleCard.append(ruleHeading, ruleGrid);

  // Card 3: Knobs & Morphogenetic Parameters
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.marginTop = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "lsystem-param-grid";

  const kDepth = knob({
    label: "DEPTH",
    min: 1, max: 5, step: 1,
    value: state.lsystemDepth ?? 3,
    unit: "",
    title: "Grammar recursion depth (1 to 5)",
    onChange: (v) => {
      state.lsystemDepth = v;
      compileLSystem();
      doGenerate(true);
    }
  });
  R("lsystemDepth", kDepth);

  const kStep = knob({
    label: "DEG STEP",
    min: 1, max: 7, step: 1,
    value: state.lsystemDegreeStep ?? 1,
    unit: "deg",
    title: "Scale degree step per +/- turn",
    onChange: (v) => {
      state.lsystemDegreeStep = v;
      compileLSystem();
      doGenerate(true);
    }
  });
  R("lsystemDegreeStep", kStep);

  const kAngle = knob({
    label: "ANGLE",
    min: 10, max: 90, step: 5,
    value: state.lsystemAngle ?? 25,
    unit: "°",
    title: "Visual geometric branch angle (degrees)",
    onChange: (v) => {
      state.lsystemAngle = v;
      compileLSystem();
    }
  });
  R("lsystemAngle", kAngle);

  const kDecay = knob({
    label: "BR DECAY",
    min: 50, max: 100, step: 5,
    value: state.lsystemBranchDecay ?? 85,
    unit: "%",
    title: "Velocity retention per branch stack depth level",
    onChange: (v) => {
      state.lsystemBranchDecay = v;
      compileLSystem();
      doGenerate(true);
    }
  });
  R("lsystemBranchDecay", kDecay);

  const kSpan = knob({
    label: "OCTAVES",
    min: 1, max: 4, step: 1,
    value: state.lsystemSpan ?? state.pitchSpan ?? 3,
    unit: "oct",
    title: "Pitch octave span across active scale",
    onChange: (v) => {
      state.lsystemSpan = v;
      state.pitchSpan = v;
      if (refs.pitchSpan?.setValue) refs.pitchSpan.setValue(v, false);
      compileLSystem();
      doGenerate(true);
    }
  });
  R("lsystemSpan", kSpan);

  const kCc = knob({
    label: "FM CC#74",
    min: 0, max: 127, step: 1,
    value: state.lsystemCcDepth ?? 80,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth from branch stack depth",
    onChange: (v) => { state.lsystemCcDepth = v; }
  });
  R("lsystemCcDepth", kCc);

  const kGate = knob({
    label: "GATE",
    min: 50, max: 600, step: 10,
    value: state.lsystemGateLen ?? 180,
    unit: "ms",
    title: "Gate length duration in milliseconds",
    onChange: (v) => { state.lsystemGateLen = v; }
  });
  R("lsystemGateLen", kGate);

  paramGrid.append(kDepth, kStep, kAngle, kDecay, kSpan, kCc, kGate);
  paramCard.appendChild(paramGrid);

  module.append(headerCard, ruleCard, paramCard);

  // --- Right Display: Interactive 2D Turtle Canvas & Token Ribbon ---
  const display = document.createElement("div");
  display.className = "display lsystem-display";

  // Canvas card
  const canvasCard = document.createElement("div");
  canvasCard.className = "card lsystem-canvas-card";
  canvasCard.style.padding = "8px 12px";

  const canvasHeader = document.createElement("div");
  canvasHeader.style.display = "flex";
  canvasHeader.style.justifyContent = "space-between";
  canvasHeader.style.alignItems = "center";
  canvasHeader.style.marginBottom = "6px";
  canvasHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Fractal Turtle Geometric Lattice</span>
    <span style="font-size:9px; color:var(--dim);">Click nodes to audition notes</span>
  `;

  treeCanvas = document.createElement("canvas");
  treeCanvas.className = "lsystem-canvas";
  treeCanvas.style.width = "100%";
  treeCanvas.style.height = "250px";
  treeCanvas.style.display = "block";
  treeCanvas.style.borderRadius = "4px";
  treeCanvas.style.cursor = "crosshair";

  // Canvas click listener to find closest node and audition
  treeCanvas.addEventListener("click", (e) => {
    const rect = treeCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const w = rect.width;
    const h = rect.height;

    if (treeSegments.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const seg of treeSegments) {
      if (seg.x1 < minX) minX = seg.x1;
      if (seg.x2 < minX) minX = seg.x2;
      if (seg.x1 > maxX) maxX = seg.x1;
      if (seg.x2 > maxX) maxX = seg.x2;
      if (seg.y1 < minY) minY = seg.y1;
      if (seg.y2 < minY) minY = seg.y2;
      if (seg.y1 > maxY) maxY = seg.y1;
      if (seg.y2 > maxY) maxY = seg.y2;
    }

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const padding = 28;
    const scale = Math.min((w - padding * 2) / spanX, (h - padding * 2) / spanY);
    const offsetX = (w - spanX * scale) / 2 - minX * scale;
    const offsetY = (h - spanY * scale) / 2 - minY * scale;

    let closestSeg = null;
    let closestDist = 20; // 20px threshold

    for (const seg of treeSegments) {
      const sx = seg.x2 * scale + offsetX;
      const sy = seg.y2 * scale + offsetY;
      const dist = Math.hypot(clickX - sx, clickY - sy);
      if (dist < closestDist) {
        closestDist = dist;
        closestSeg = seg;
      }
    }

    if (closestSeg && closestSeg.note !== null) {
      playLsystemVoice(closestSeg.note, closestSeg.vel, 250, closestSeg.depth);
      lastLiveStep = closestSeg.step;
      highlightActiveRibbon(closestSeg.step);
      renderTreeCanvas();
    }
  });

  canvasCard.append(canvasHeader, treeCanvas);

  // Ribbon card
  const ribbonCard = document.createElement("div");
  ribbonCard.className = "card lsystem-ribbon-card";
  ribbonCard.style.padding = "8px 12px";
  ribbonCard.style.marginTop = "8px";

  const ribbonHeader = document.createElement("div");
  ribbonHeader.style.display = "flex";
  ribbonHeader.style.justifyContent = "space-between";
  ribbonHeader.style.alignItems = "center";
  ribbonHeader.style.marginBottom = "6px";
  ribbonHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Expanded String Ribbon</span>
    <span style="font-size:9px; color:var(--dim);">F=Note · +=Right · -=Left · [ ]=Branch · ^=Oct+ · v=Oct-</span>
  `;

  ribbonContainer = document.createElement("div");
  ribbonContainer.className = "lsystem-ribbon";

  ribbonCard.append(ribbonHeader, ribbonContainer);
  display.append(canvasCard, ribbonCard);

  layout.append(module, display);
  lsystemContainer.appendChild(layout);

  compileLSystem();
}

// ---- Model Activation Lifecycle ----
export function activateLsystemModel() {
  setModelGenerator(generateLsystemBank);
  setModelRandomizer(randomizeLsystem);
  setModelStepHandler(onLsystemLiveStep);

  compileLSystem();
  doGenerate(true);
  syncRhythmGrid();
  renderTreeCanvas();
}

export function deactivateLsystemModel() {
  panicPreview();
  setModelStepHandler(null);
  activeVoices.clear();
  activeSoundingNote = null;
  lastLiveStep = -1;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "lsystem",
  version: 1,
  migrations: {},
  capture() {
    return {
      axiom: state.lsystemAxiom,
      ruleF: state.lsystemRuleF,
      ruleX: state.lsystemRuleX,
      ruleY: state.lsystemRuleY,
      depth: state.lsystemDepth,
      degreeStep: state.lsystemDegreeStep,
      angle: state.lsystemAngle,
      decay: state.lsystemBranchDecay,
      span: state.lsystemSpan,
      preset: state.lsystemPreset
    };
  },
  restore(h) {
    if (h?.axiom !== undefined) state.lsystemAxiom = h.axiom;
    if (h?.ruleF !== undefined) state.lsystemRuleF = h.ruleF;
    if (h?.ruleX !== undefined) state.lsystemRuleX = h.ruleX;
    if (h?.ruleY !== undefined) state.lsystemRuleY = h.ruleY;
    if (h?.depth !== undefined) state.lsystemDepth = h.depth;
    if (h?.degreeStep !== undefined) state.lsystemDegreeStep = h.degreeStep;
    if (h?.angle !== undefined) state.lsystemAngle = h.angle;
    if (h?.decay !== undefined) state.lsystemBranchDecay = h.decay;
    if (h?.span !== undefined) state.lsystemSpan = h.span;
    if (h?.preset !== undefined) state.lsystemPreset = h.preset;

    updateInputsFromState();
    compileLSystem();
  }
});
