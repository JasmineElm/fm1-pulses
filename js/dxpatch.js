/**
 * js/dxpatch.js — DX Patch Generator Workbench for FM-1 Pulses.
 * 6-Operator FM Voice Synthesis, 32-Voice Cartridge Bank & SysEx I/O.
 */

import {
  ALGORITHMS,
  getAlgorithm,
  DX7Bank,
  DX7Patch,
  clamp,
  encodeSingleVoiceSysex,
  parseSysexBytes,
} from "./dx7.js";
import {
  GenerationOptions,
  PatchMutator,
  SeededRNG,
  getGenerator,
} from "./dxgenerator.js";
import { WebAudioPlayer } from "./dxaudio.js";
import * as midi from "./midi.js";

const OP_NUM_COLUMNS = [
  ["freq_coarse", 0, 31],
  ["freq_fine", 0, 99],
  ["detune", 0, 14],
  ["key_vel_sens", 0, 7],
  ["rate_scaling", 0, 7],
  ["eg_rate_1", 0, 99],
  ["eg_rate_2", 0, 99],
  ["eg_rate_3", 0, 99],
  ["eg_rate_4", 0, 99],
  ["eg_level_1", 0, 99],
  ["eg_level_2", 0, 99],
  ["eg_level_3", 0, 99],
  ["eg_level_4", 0, 99],
];

const LFO_WAVE_NAMES = ["Triangle", "Saw Down", "Saw Up", "Square", "Sine", "S&H"];

const PIANO_NOTES = [
  { midi: 48, label: "C3", key: "A", black: false },
  { midi: 49, label: "C#", key: "W", black: true },
  { midi: 50, label: "D", key: "S", black: false },
  { midi: 51, label: "D#", key: "E", black: true },
  { midi: 52, label: "E", key: "D", black: false },
  { midi: 53, label: "F", key: "F", black: false },
  { midi: 54, label: "F#", key: "T", black: true },
  { midi: 55, label: "G", key: "G", black: false },
  { midi: 56, label: "G#", key: "Y", black: true },
  { midi: 57, label: "A", key: "H", black: false },
  { midi: 58, label: "A#", key: "U", black: true },
  { midi: 59, label: "B", key: "J", black: false },
  { midi: 60, label: "C4", key: "K", black: false },
  { midi: 61, label: "C#", key: "O", black: true },
  { midi: 62, label: "D", key: "L", black: false },
  { midi: 63, label: "D#", key: "P", black: true },
  { midi: 64, label: "E", key: ";", black: false },
  { midi: 65, label: "F", key: "'", black: false },
  { midi: 66, label: "F#", key: "", black: true },
  { midi: 67, label: "G", key: "", black: false },
  { midi: 68, label: "G#", key: "", black: true },
  { midi: 69, label: "A", key: "", black: false },
  { midi: 70, label: "A#", key: "", black: true },
  { midi: 71, label: "B", key: "", black: false },
  { midi: 72, label: "C5", key: "", black: false },
];

const PIANO_KEY_MAP = Object.fromEntries(
  PIANO_NOTES.filter((n) => n.key).map((n) => [n.key, n.midi])
);

const BANK_CATEGORIES = [
  "keys", "bass", "pad", "percussive", "lead", "bell", "brass", "pluck", "fx", "constrained"
];

let initialized = false;
let active = false;
let bank = new DX7Bank();
let currentSlot = 1;
let currentPatch = null;
let currentAlgInfo = null;
let selectedEnvOp = 1;
let hoveredBreakpoint = null;
let isDraggingBreakpoint = false;
let draggedBreakpoint = null;
let lastDrawnPoints = {};
let envelopeCurves = {};
let algNodePositions = {};
let audioPlayer = null;
let autoSendOnGenerate = true;
let midiChannel = 0;
let auditionMode = "auto";

export function initDxPatch() {
  if (initialized) return;
  initialized = true;

  audioPlayer = new WebAudioPlayer();

  const forceAlgSelect = document.getElementById("dxpatch-force-alg-select");
  if (forceAlgSelect) {
    forceAlgSelect.innerHTML = `<option value="">Auto (Category Default)</option>`;
    for (let i = 1; i <= 32; i++) {
      const alg = ALGORITHMS[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Alg ${i} — ${alg.carriers.length} Carrier${alg.carriers.length > 1 ? "s" : ""} (FB OP${alg.feedback_op})`;
      forceAlgSelect.appendChild(opt);
    }
  }

  // Bind macro sliders with live value text
  for (const [sliderId, labelId] of [
    ["dxpatch-slider-brightness", "dxpatch-val-brightness"],
    ["dxpatch-slider-dissonance", "dxpatch-val-dissonance"],
    ["dxpatch-slider-env-speed", "dxpatch-val-env-speed"],
    ["dxpatch-slider-detune", "dxpatch-val-detune"],
    ["dxpatch-slider-mutation", "dxpatch-val-mutation"],
  ]) {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (slider && label) {
      slider.addEventListener("input", () => {
        label.textContent = Number(slider.value).toFixed(2);
      });
    }
  }

  // Primary Action buttons
  document.getElementById("dxpatch-btn-generate")?.addEventListener("click", () => generatePatch());
  document.getElementById("dxpatch-btn-mutate")?.addEventListener("click", () => mutateCurrentPatch());
  document.getElementById("dxpatch-btn-add-bank")?.addEventListener("click", () => addCurrentToBank());

  // Download SysEx buttons
  document.getElementById("dxpatch-btn-dl-voice")?.addEventListener("click", () => downloadSingleVoiceSyx());
  document.getElementById("dxpatch-dl-voice")?.addEventListener("click", () => downloadSingleVoiceSyx());
  document.getElementById("dxpatch-btn-dl-patch-bank")?.addEventListener("click", () => downloadPatchAsBankSyx());
  document.getElementById("dxpatch-btn-export-bank")?.addEventListener("click", () => downloadFullBankSyx());
  document.getElementById("dxpatch-dl-bank")?.addEventListener("click", () => downloadFullBankSyx());

  // SysEx file upload / drop
  const fileInput = document.getElementById("dxpatch-file-input");
  fileInput?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) {
      loadSysexFile(e.target.files[0]);
      e.target.value = "";
    }
  });

  const dropArea = document.getElementById("dxpatch-drop-area");
  if (dropArea) {
    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("dragover");
    });
    dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));
    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");
      if (e.dataTransfer.files?.[0]) loadSysexFile(e.dataTransfer.files[0]);
    });
  }

  // Bank generators
  document.getElementById("dxpatch-btn-fill-bank")?.addEventListener("click", () => generateBank(false));
  document.getElementById("dxpatch-btn-fill-mixed-bank")?.addEventListener("click", () => generateBank(true));

  // Patch Name input
  document.getElementById("dxpatch-name-input")?.addEventListener("input", (e) => {
    if (!currentPatch) return;
    currentPatch.name = DX7Patch.sanitizeName(e.target.value);
    bank.setPatch(currentSlot, currentPatch);
    renderBankList();
  });

  // Global voice parameter bindings
  const bindVoiceParam = (id, applyFn, label) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      if (!currentPatch) return;
      applyFn(Number(e.target.value));
      onPatchEdited(label);
    });
  };

  bindVoiceParam("dxpatch-alg-input", (v) => (currentPatch.algorithm = clamp(v, 1, 32)), "Updated Algorithm");

  const stepAlgorithm = (delta) => {
    if (!currentPatch) return;
    let nextAlg = currentPatch.algorithm + delta;
    if (nextAlg > 32) nextAlg = 1;
    if (nextAlg < 1) nextAlg = 32;
    currentPatch.algorithm = nextAlg;
    onPatchEdited("Updated Algorithm");
  };

  document.getElementById("dxpatch-alg-prev")?.addEventListener("click", () => stepAlgorithm(-1));
  document.getElementById("dxpatch-alg-next")?.addEventListener("click", () => stepAlgorithm(1));

  const algInputEl = document.getElementById("dxpatch-alg-input");
  algInputEl?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepAlgorithm(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  // Feedback Stepper
  bindVoiceParam("dxpatch-fb-input", (v) => (currentPatch.feedback = clamp(v, 0, 7)), "Updated Feedback");
  const stepFeedback = (delta) => {
    if (!currentPatch) return;
    const nextVal = clamp(currentPatch.feedback + delta, 0, 7);
    if (nextVal !== currentPatch.feedback) {
      currentPatch.feedback = nextVal;
      onPatchEdited("Updated Feedback");
    }
  };
  document.getElementById("dxpatch-fb-prev")?.addEventListener("click", () => stepFeedback(-1));
  document.getElementById("dxpatch-fb-next")?.addEventListener("click", () => stepFeedback(1));
  document.getElementById("dxpatch-fb-input")?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepFeedback(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // Transpose Stepper
  bindVoiceParam("dxpatch-transpose-input", (v) => (currentPatch.transpose = clamp(v, 0, 48)), "Updated Transpose");
  const stepTranspose = (delta) => {
    if (!currentPatch) return;
    const nextVal = clamp(currentPatch.transpose + delta, 0, 48);
    if (nextVal !== currentPatch.transpose) {
      currentPatch.transpose = nextVal;
      onPatchEdited("Updated Transpose");
    }
  };
  document.getElementById("dxpatch-transpose-prev")?.addEventListener("click", () => stepTranspose(-1));
  document.getElementById("dxpatch-transpose-next")?.addEventListener("click", () => stepTranspose(1));
  document.getElementById("dxpatch-transpose-input")?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepTranspose(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // LFO Wave Stepper
  const stepLfoWave = (delta) => {
    if (!currentPatch) return;
    let nextVal = currentPatch.lfo.waveform + delta;
    if (nextVal > 5) nextVal = 0;
    if (nextVal < 0) nextVal = 5;
    currentPatch.lfo.waveform = nextVal;
    onPatchEdited("Updated LFO Waveform");
  };
  document.getElementById("dxpatch-lfo-wave-prev")?.addEventListener("click", () => stepLfoWave(-1));
  document.getElementById("dxpatch-lfo-wave-next")?.addEventListener("click", () => stepLfoWave(1));
  document.getElementById("dxpatch-lfo-wave")?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepLfoWave(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // LFO Speed Stepper
  bindVoiceParam("dxpatch-lfo-speed", (v) => (currentPatch.lfo.speed = clamp(v, 0, 99)), "Updated LFO Speed");
  const stepLfoSpeed = (delta) => {
    if (!currentPatch) return;
    const nextVal = clamp(currentPatch.lfo.speed + delta, 0, 99);
    if (nextVal !== currentPatch.lfo.speed) {
      currentPatch.lfo.speed = nextVal;
      onPatchEdited("Updated LFO Speed");
    }
  };
  document.getElementById("dxpatch-lfo-spd-prev")?.addEventListener("click", () => stepLfoSpeed(-1));
  document.getElementById("dxpatch-lfo-spd-next")?.addEventListener("click", () => stepLfoSpeed(1));
  document.getElementById("dxpatch-lfo-speed")?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepLfoSpeed(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // LFO Pitch Mod Depth Stepper
  bindVoiceParam(
    "dxpatch-lfo-pmd",
    (v) => {
      currentPatch.lfo.pitch_mod_depth = clamp(v, 0, 99);
      if (currentPatch.lfo.pitch_mod_depth > 0 && currentPatch.lfo.pitch_mod_sens === 0) {
        currentPatch.lfo.pitch_mod_sens = 2;
      }
    },
    "Updated LFO Pitch Mod Depth"
  );
  const stepLfoPmd = (delta) => {
    if (!currentPatch) return;
    const nextVal = clamp(currentPatch.lfo.pitch_mod_depth + delta, 0, 99);
    if (nextVal !== currentPatch.lfo.pitch_mod_depth) {
      currentPatch.lfo.pitch_mod_depth = nextVal;
      if (currentPatch.lfo.pitch_mod_depth > 0 && currentPatch.lfo.pitch_mod_sens === 0) {
        currentPatch.lfo.pitch_mod_sens = 2;
      }
      onPatchEdited("Updated LFO Pitch Mod Depth");
    }
  };
  document.getElementById("dxpatch-lfo-pmd-prev")?.addEventListener("click", () => stepLfoPmd(-1));
  document.getElementById("dxpatch-lfo-pmd-next")?.addEventListener("click", () => stepLfoPmd(1));
  document.getElementById("dxpatch-lfo-pmd")?.addEventListener("wheel", (e) => {
    e.preventDefault();
    stepLfoPmd(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // Hardware SysEx actions
  document.getElementById("dxpatch-chk-auto-send")?.addEventListener("change", (e) => {
    autoSendOnGenerate = e.target.checked;
  });

  document.getElementById("dxpatch-midi-channel-select")?.addEventListener("change", (e) => {
    midiChannel = Number(e.target.value) & 0x0f;
  });

  document.getElementById("dxpatch-audition-mode-select")?.addEventListener("change", (e) => {
    auditionMode = e.target.value;
  });

  document.getElementById("dxpatch-btn-send-patch")?.addEventListener("click", () => sendCurrentPatchToHardware());
  document.getElementById("dxpatch-btn-send-bank")?.addEventListener("click", () => sendFullBankToHardware());

  // Audition keyboard
  buildPianoKeyboard();

  // Keyboard shortcut listener
  window.addEventListener("keydown", handleKeyDown);

  // Operator Envelope & Algorithm canvas interactions
  initEnvSelectors();
  initEnvelopeCanvasInteraction();
  initAlgCanvasInteraction();

  // Seed bank and generate initial patch
  populateInitialBank();
  generatePatch();
}

export function activateDxPatch() {
  active = true;
  initDxPatch();
  refreshPatchUI();
  renderBankList();
}

export function deactivateDxPatch() {
  active = false;
  try {
    if (audioPlayer) {
      if (typeof audioPlayer.stop === "function") audioPlayer.stop();
      else if (typeof audioPlayer.stopAllNotes === "function") audioPlayer.stopAllNotes();
    }
  } catch (e) {
    console.warn("Error stopping audio in deactivateDxPatch:", e);
  }
}

function handleKeyDown(e) {
  if (!active) return;
  const tag = e.target?.tagName || "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  const key = e.key.toUpperCase();
  if (PIANO_KEY_MAP[key] !== undefined && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const midiNote = PIANO_KEY_MAP[key];
    playSingleNote(midiNote);
    const keyEl = document.querySelector(`#dxpatch-piano-keyboard [data-midi="${midiNote}"]`);
    if (keyEl) {
      keyEl.classList.add("active");
      setTimeout(() => keyEl.classList.remove("active"), 220);
    }
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    generatePatch();
  } else if (key === "M") {
    e.preventDefault();
    mutateCurrentPatch();
  } else if (key === "B") {
    e.preventDefault();
    addCurrentToBank();
  }
}

function getGenerationOptions() {
  const forceAlgVal = document.getElementById("dxpatch-force-alg-select")?.value;
  const algorithm = forceAlgVal ? Number(forceAlgVal) : null;
  const category = document.getElementById("dxpatch-category-select")?.value || "keys";
  const profileVal = document.getElementById("dxpatch-profile-select")?.value || "none";
  const profile = profileVal === "none" ? null : profileVal;

  return new GenerationOptions({
    algorithm,
    category,
    profile,
    brightness: Number(document.getElementById("dxpatch-slider-brightness")?.value || 0.6),
    dissonance: Number(document.getElementById("dxpatch-slider-dissonance")?.value || 0.0),
    envelope_speed: Number(document.getElementById("dxpatch-slider-env-speed")?.value || 0.5),
    detune_amount: Number(document.getElementById("dxpatch-slider-detune")?.value || 0.3),
  });
}

function populateInitialBank() {
  const rng = new SeededRNG(1983);
  const patches = Array.from({ length: 32 }, (_, i) => {
    const cat = BANK_CATEGORIES[i % BANK_CATEGORIES.length];
    return getGenerator(cat).generate(
      new GenerationOptions({ seed: rng.randint(1, 999999), category: cat })
    );
  });
  bank = new DX7Bank(patches);
  renderBankList();
}

async function autoSyncHardware(baseMessage) {
  if (autoSendOnGenerate && currentPatch && midi.findFm1()) {
    try {
      const res = await midi.sendVoicePatch(currentPatch, midiChannel);
      setStatus(`${baseMessage} → Sent 163B VCED to ${res.portName}`);
      return;
    } catch (err) {
      setStatus(`${baseMessage} (SysEx send notice: ${err.message})`);
      return;
    }
  }
  setStatus(baseMessage);
}

export async function generatePatch() {
  const opts = getGenerationOptions();
  currentPatch = getGenerator(opts.category).generate(opts);
  refreshPatchUI();
  const profTag = opts.profile ? ` [${opts.profile.toUpperCase()}]` : "";
  await autoSyncHardware(
    `Generated ${opts.category.toUpperCase()}${profTag}: '${currentPatch.name.trim()}' (Alg ${currentPatch.algorithm}, FB ${currentPatch.feedback})`
  );
}

export async function mutateCurrentPatch() {
  if (!currentPatch) return;
  const rate = Number(document.getElementById("dxpatch-slider-mutation")?.value || 0.2);
  currentPatch = PatchMutator.mutate(currentPatch, { mutationRate: rate });
  refreshPatchUI();
  await autoSyncHardware(`Mutated voice (${Math.round(rate * 100)}%): '${currentPatch.name.trim()}'`);
}

function onPatchEdited(reason = "Edited parameter") {
  if (!currentPatch) return;
  currentPatch.clampAll();
  refreshPatchUI();
  autoSyncHardware(`${reason} on '${currentPatch.name.trim()}'`);
}

function playSingleNote(midiNote = 60) {
  if (!currentPatch) return;
  const fm1 = midi.findFm1();
  const useHardware = fm1 && (auditionMode === "auto" || auditionMode === "hardware" || auditionMode === "both");
  const useBrowser = auditionMode === "browser" || auditionMode === "both" || (auditionMode === "auto" && !fm1);

  if (useHardware) {
    midi.playHardwareNote(midiNote, 100, 500, midiChannel + 1);
  }
  if (useBrowser && audioPlayer) {
    audioPlayer.playPatchNote(currentPatch, midiNote, 100, 1.1);
  }
}

function addCurrentToBank() {
  if (!currentPatch) return;
  const savedSlot = currentSlot;
  bank.setPatch(savedSlot, currentPatch);
  currentSlot = (savedSlot % 32) + 1;
  renderBankList();
  setStatus(`Saved '${currentPatch.name.trim()}' to Bank Slot ${String(savedSlot).padStart(2, "0")}`);
}

function generateBank(mixed = false) {
  const baseOpts = getGenerationOptions();
  const rng = new SeededRNG(baseOpts.seed);
  const patches = Array.from({ length: 32 }, () => {
    const cat = mixed ? rng.choice(BANK_CATEGORIES) : baseOpts.category;
    return getGenerator(cat).generate(
      new GenerationOptions({ ...baseOpts, category: cat, seed: rng.randint(1, 1000000) })
    );
  });

  bank = new DX7Bank(patches);
  currentSlot = 1;
  currentPatch = bank.getPatch(1).copy();
  refreshPatchUI();
  renderBankList();
  setStatus(
    `Generated 32-voice ${mixed ? "MIXED" : baseOpts.category.toUpperCase()} bank. Loaded Slot 01: '${currentPatch.name.trim()}'`
  );
}

function refreshPatchUI() {
  const patch = currentPatch;
  if (!patch) return;

  const nameEl = document.getElementById("dxpatch-name-input");
  if (nameEl) nameEl.value = patch.name.trim();

  const algEl = document.getElementById("dxpatch-alg-input");
  if (algEl) algEl.value = String(patch.algorithm);

  const fbEl = document.getElementById("dxpatch-fb-input");
  if (fbEl) fbEl.value = String(patch.feedback);

  const transEl = document.getElementById("dxpatch-transpose-input");
  if (transEl) transEl.value = String(patch.transpose);

  const lfoWave = document.getElementById("dxpatch-lfo-wave");
  if (lfoWave) lfoWave.textContent = LFO_WAVE_NAMES[patch.lfo.waveform] ?? "Triangle";

  const lfoSpd = document.getElementById("dxpatch-lfo-speed");
  if (lfoSpd) lfoSpd.value = String(patch.lfo.speed);

  const lfoPmd = document.getElementById("dxpatch-lfo-pmd");
  if (lfoPmd) lfoPmd.value = String(patch.lfo.pitch_mod_depth);

  const algInfo = getAlgorithm(patch.algorithm);
  currentAlgInfo = algInfo;

  updateEnvSelectorButtons(algInfo);
  drawAlgorithmCanvas(algInfo);
  renderOperatorsTable(patch, algInfo);
  drawEnvelopeCanvas(patch, algInfo);
}

function drawAlgorithmCanvas(algInfo) {
  const canvas = document.getElementById("dxpatch-alg-canvas");
  if (!canvas) return;
  const carrierStr = algInfo.carriers.map((c) => `OP${c}`).join(", ");
  const modStr = algInfo.modulators.length > 0 ? algInfo.modulators.map((m) => `OP${m}`).join(", ") : "None";
  canvas.title = `Algorithm ${algInfo.id}: ${algInfo.description} (Carriers: ${carrierStr} · Modulators: ${modStr}) — Click an operator to select`;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Depth computation
  const depth = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (let pass = 0; pass < 6; pass++) {
    for (const [modStr, targets] of Object.entries(algInfo.connections)) {
      const mod = Number(modStr);
      for (const t of targets) {
        depth[mod] = Math.max(depth[mod], depth[t] + 1);
      }
    }
  }

  const maxDepth = Math.max(...Object.values(depth));
  const rows = Array.from({ length: maxDepth + 1 }, () => []);
  for (let op = 6; op >= 1; op--) {
    rows[depth[op]].push(op);
  }

  // Adaptive box sizing and vertical padding based on tree depth
  const boxW = 26;
  const boxH = maxDepth >= 4 ? 14 : 18;
  const halfW = boxW / 2;
  const halfH = boxH / 2;
  const padY = maxDepth >= 4 ? 14 : 20;
  const usableH = h - padY * 2;

  const pos = {};
  for (let d = 0; d <= maxDepth; d++) {
    const rowOps = rows[d];
    const y = maxDepth === 0 ? h / 2 : h - padY - (d / maxDepth) * usableH;
    rowOps.forEach((op, idx) => {
      const x = ((idx + 1) / (rowOps.length + 1)) * w;
      pos[op] = { x, y };
    });
  }
  algNodePositions = pos;

  // Draw modulation connection lines using right-angled connectors
  ctx.strokeStyle = "rgba(156, 163, 175, 0.65)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [modStr, targets] of Object.entries(algInfo.connections)) {
    const fromOp = Number(modStr);
    const from = pos[fromOp];
    if (!from || !targets || !targets.length) continue;

    const fromBottom = from.y + halfH;

    for (const t of targets) {
      const to = pos[t];
      if (!to) continue;
      const toTop = to.y - halfH;

      ctx.beginPath();
      if (Math.abs(from.x - to.x) < 2) {
        // Direct vertical connector
        ctx.moveTo(from.x, fromBottom);
        ctx.lineTo(to.x, toTop);
      } else {
        // Right-angled orthogonal connector: drop to midpoint, traverse horizontally, drop to target top
        const midY = fromBottom + (toTop - fromBottom) * 0.5;
        ctx.moveTo(from.x, fromBottom);
        ctx.lineTo(from.x, midY);
        ctx.lineTo(to.x, midY);
        ctx.lineTo(to.x, toTop);
      }
      ctx.stroke();

      // Downward arrowhead at target entry
      const arrowH = 3.5;
      const arrowW = 2.5;
      ctx.beginPath();
      ctx.moveTo(to.x - arrowW, toTop - arrowH);
      ctx.lineTo(to.x, toTop);
      ctx.lineTo(to.x + arrowW, toTop - arrowH);
      ctx.stroke();
    }
  }

  // Draw feedback loop using right-angled rectangular loop
  const fbPos = pos[algInfo.feedback_op];
  if (fbPos) {
    ctx.strokeStyle = "rgba(168, 85, 247, 0.95)";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const xR = fbPos.x + halfW;
    const yT = fbPos.y - halfH;
    const loopRight = Math.min(w - 6, xR + 7);
    const loopTop = Math.max(4, yT - 7);

    ctx.beginPath();
    ctx.moveTo(xR, fbPos.y);
    ctx.lineTo(loopRight, fbPos.y);
    ctx.lineTo(loopRight, loopTop);
    ctx.lineTo(fbPos.x, loopTop);
    ctx.lineTo(fbPos.x, yT);
    ctx.stroke();

    // Downward arrowhead at feedback entry
    ctx.beginPath();
    ctx.moveTo(fbPos.x - 2.5, yT - 3.5);
    ctx.lineTo(fbPos.x, yT);
    ctx.lineTo(fbPos.x + 2.5, yT - 3.5);
    ctx.stroke();
  }

  // Draw operator nodes
  const carrierSet = new Set(algInfo.carriers);
  for (let op = 1; op <= 6; op++) {
    const { x, y } = pos[op];
    const isCarr = carrierSet.has(op);
    const isSelected = selectedEnvOp === op;

    ctx.fillStyle = isCarr ? "rgba(34, 197, 94, 0.22)" : "rgba(245, 158, 11, 0.22)";
    ctx.strokeStyle = isSelected ? (isCarr ? "#86efac" : "#fde68a") : (isCarr ? "#22c55e" : "#f59e0b");
    ctx.lineWidth = isSelected ? 2.4 : 1.8;

    ctx.beginPath();
    ctx.roundRect(x - halfW, y - halfH, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();

    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - halfW - 2, y - halfH - 2, boxW + 4, boxH + 4);
      ctx.restore();
    }

    ctx.fillStyle = isCarr ? "#86efac" : "#fde68a";
    ctx.font = `bold ${boxH < 16 ? 9 : 10}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`OP${op}`, x, y);
  }
}

function renderOperatorsTable(patch, algInfo) {
  const tbody = document.getElementById("dxpatch-ops-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const carrierSet = new Set(algInfo.carriers);

  for (let opNum = 6; opNum >= 1; opNum--) {
    const op = patch.op(opNum);
    const isCarr = carrierSet.has(opNum);
    const isSelected = selectedEnvOp === opNum;
    const tr = document.createElement("tr");
    tr.dataset.op = String(opNum);
    if (!op.enabled) tr.classList.add("op-disabled");
    if (isSelected) {
      tr.classList.add("op-selected");
      tr.classList.add(isCarr ? "role-carrier" : "role-mod");
    }

    const ratioStr =
      op.osc_mode === 0
        ? `${op.frequency_ratio.toFixed(2)}x`
        : `${Math.round(op.frequency_ratio)}Hz`;

    const numInputsHtml = OP_NUM_COLUMNS.map(([field, min, max], idx) => {
      const cell = `<td><input type="number" class="op-num-input" data-op="${opNum}" data-field="${field}" min="${min}" max="${max}" value="${op[field]}" /></td>`;
      return idx === 1 ? `${cell}<td class="ratio-readout">${ratioStr}</td>` : cell;
    }).join("");

    tr.innerHTML = `
      <td>
        <label class="op-cell-label">
          <input type="checkbox" data-op="${opNum}" data-field="enabled" ${op.enabled ? "checked" : ""} />
          <span>OP${opNum}</span>
        </label>
      </td>
      <td><span class="dxpatch-badge ${isCarr ? "badge-carrier" : "badge-mod"}" title="${isCarr ? "Carrier (Audible Output)" : "Modulator"}">${isCarr ? "C" : "M"}</span></td>
      <td><input type="number" class="op-num-input" data-op="${opNum}" data-field="output_level" min="0" max="99" value="${op.output_level}" /></td>
      <td>
        <select class="op-mode-select" data-op="${opNum}" data-field="osc_mode" title="Oscillator Mode: Ratio (RAT) or Fixed Hz (FIX)">
          <option value="0" ${op.osc_mode === 0 ? "selected" : ""}>RAT</option>
          <option value="1" ${op.osc_mode === 1 ? "selected" : ""}>FIX</option>
        </select>
      </td>
      ${numInputsHtml}
    `;

    tr.addEventListener("click", (e) => {
      if (e.target.dataset.field === "enabled") return;
      if (selectedEnvOp !== opNum) {
        setEnvSelectedOp(opNum);
      }
    });

    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", (e) => {
      const opNum = Number(e.target.dataset.op);
      const field = e.target.dataset.field;
      const op = currentPatch.op(opNum);
      op[field] = field === "enabled" ? e.target.checked : Number(e.target.value);
      onPatchEdited(`OP${opNum} ${field}`);
    });
  });
}

function drawEnvelopeCanvas(patch, algInfo) {
  const canvas = document.getElementById("dxpatch-env-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Keep internal bitmap matched with container width for maximum sharpness
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0 && Math.abs(canvas.width - rect.width) > 1) {
    canvas.width = Math.round(rect.width);
  }
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padX = 16;
  const padY = 14;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  // Background grid lines (25%, 50%, 75% level lines)
  ctx.strokeStyle = "rgba(156, 163, 175, 0.1)";
  ctx.lineWidth = 1;
  for (let l = 1; l <= 3; l++) {
    const y = h - padY - (l / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }

  // Bottom baseline (Level 0)
  ctx.strokeStyle = "rgba(156, 163, 175, 0.24)";
  ctx.beginPath();
  ctx.moveTo(padX, h - padY);
  ctx.lineTo(w - padX, h - padY);
  ctx.stroke();

  const carrierSet = new Set(algInfo.carriers);
  const minSeg = 10;
  const maxSeg = plotW * 0.24;
  const segW = (rate) => minSeg + (1 - clamp(rate, 0, 99) / 99) * (maxSeg - minSeg);
  const yVal = (lvl) => h - padY - (clamp(lvl, 0, 99) / 99.0) * plotH;

  envelopeCurves = {};
  lastDrawnPoints = {};

  // Compute curve points for all operators
  for (let opNum = 1; opNum <= 6; opNum++) {
    const op = patch.op(opNum);
    const x0 = padX;
    const y0 = yVal(0);
    const x1 = x0 + segW(op.eg_rate_1);
    const y1 = yVal(op.eg_level_1);
    const x2 = x1 + segW(op.eg_rate_2);
    const y2 = yVal(op.eg_level_2);
    const x3 = x2 + segW(op.eg_rate_3);
    const y3 = yVal(op.eg_level_3);
    const x4 = Math.min(w - padX, x3 + segW(op.eg_rate_4));
    const y4 = yVal(op.eg_level_4);

    envelopeCurves[opNum] = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      { x: x2, y: y2 },
      { x: x3, y: y3 },
      { x: x4, y: y4 },
    ];
  }

  if (selectedEnvOp === "all") {
    // Mode ALL: render all enabled envelopes equally
    for (let opNum = 6; opNum >= 1; opNum--) {
      const op = patch.op(opNum);
      if (!op.enabled) continue;
      const pts = envelopeCurves[opNum];
      const isCarr = carrierSet.has(opNum);

      ctx.strokeStyle = isCarr ? "#22c55e" : "#f59e0b";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      ctx.fillStyle = isCarr ? "#86efac" : "#fde68a";
      ctx.font = "9px monospace";
      ctx.fillText(`OP${opNum}`, pts[1].x + 2, pts[1].y - 3);
    }

    drawCanvasHud(ctx, w, padY, "ALL ENVELOPES • Click an OP button or curve to select & edit");
  } else {
    // Mode Single OP selected
    const activeOpNum = Number(selectedEnvOp);
    const activeOp = patch.op(activeOpNum);
    const activeIsCarr = carrierSet.has(activeOpNum);

    // 1. Darken / dim other envelopes in the background
    for (let opNum = 6; opNum >= 1; opNum--) {
      if (opNum === activeOpNum) continue;
      const op = patch.op(opNum);
      if (!op.enabled) continue;
      const pts = envelopeCurves[opNum];
      const isCarr = carrierSet.has(opNum);

      ctx.strokeStyle = isCarr ? "rgba(34, 197, 94, 0.18)" : "rgba(245, 158, 11, 0.18)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      ctx.fillStyle = isCarr ? "rgba(134, 239, 172, 0.28)" : "rgba(253, 230, 138, 0.28)";
      ctx.font = "8.5px monospace";
      ctx.fillText(`OP${opNum}`, pts[1].x + 2, pts[1].y - 2);
    }

    // 2. Highlight selected envelope on top
    const pts = envelopeCurves[activeOpNum];
    lastDrawnPoints = pts;

    const strokeColor = activeIsCarr ? "#22c55e" : "#f59e0b";
    const fillColor = activeIsCarr ? "rgba(34, 197, 94, 0.08)" : "rgba(245, 158, 11, 0.08)";

    // Flat semi-transparent fill under curve
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[4].x, h - padY);
    ctx.lineTo(pts[0].x, h - padY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Bold envelope stroke
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Start anchor dot (P0)
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Breakpoint handles (P1..P4)
    const activePtIdx =
      isDraggingBreakpoint && draggedBreakpoint
        ? draggedBreakpoint.index
        : hoveredBreakpoint?.index ?? null;

    for (let i = 1; i <= 4; i++) {
      const pt = pts[i];
      const isPointActive = activePtIdx === i;

      // Vertical guide line when active
      if (isPointActive) {
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x, h - padY);
        ctx.stroke();
        ctx.restore();

        // Outer glow halo
        ctx.fillStyle = activeIsCarr ? "rgba(34, 197, 94, 0.28)" : "rgba(245, 158, 11, 0.28)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Handle circle
      const r = isPointActive ? 6.5 : 5.0;
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner dot
      ctx.fillStyle = isPointActive ? "#ffffff" : strokeColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      ctx.fill();

      // Breakpoint label: P1..P4
      ctx.fillStyle = isPointActive ? "#ffffff" : activeIsCarr ? "#86efac" : "#fde68a";
      ctx.font = `bold ${isPointActive ? 9.5 : 8.5}px monospace`;
      const labelY = pt.y > h / 2 ? pt.y - 9 : pt.y + 14;
      ctx.fillText(`P${i}`, pt.x - 5, labelY);
    }

    // Top-right status HUD
    let hudText = "";
    if (activePtIdx) {
      const rVal = activeOp[`eg_rate_${activePtIdx}`];
      const lVal = activeOp[`eg_level_${activePtIdx}`];
      hudText = `OP${activeOpNum} • P${activePtIdx}: Rate R${activePtIdx}=${rVal}  Level L${activePtIdx}=${lVal}`;
    } else {
      hudText = `OP${activeOpNum} [${activeIsCarr ? "CARRIER" : "MOD"}] • R: ${activeOp.eg_rate_1}, ${activeOp.eg_rate_2}, ${activeOp.eg_rate_3}, ${activeOp.eg_rate_4} • Drag points`;
    }
    drawCanvasHud(ctx, w, padY, hudText, strokeColor);
  }
}

function drawCanvasHud(ctx, w, padY, text, accentColor = null) {
  ctx.save();
  ctx.font = "9px var(--font-mono, monospace)";
  const metrics = ctx.measureText(text);
  const badgeW = metrics.width + 14;
  const badgeH = 18;
  const badgeX = w - badgeW - 12;
  const badgeY = 6;

  ctx.fillStyle = "rgba(17, 24, 39, 0.88)";
  ctx.strokeStyle = accentColor ? colorMixRgba(accentColor, 0.5) : "rgba(156, 163, 175, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor || "#f1f5f9";
  ctx.textBaseline = "middle";
  ctx.fillText(text, badgeX + 7, badgeY + badgeH / 2);
  ctx.restore();
}

export function setEnvSelectedOp(op) {
  selectedEnvOp = op === "all" ? "all" : Number(op);

  const buttons = document.querySelectorAll("#dxpatch-env-op-selectors .dxpatch-op-sel-btn");
  buttons.forEach((b) => {
    const isTarget = String(b.dataset.op) === String(selectedEnvOp);
    b.classList.toggle("active", isTarget);
    b.setAttribute("aria-pressed", isTarget ? "true" : "false");
  });

  document.querySelectorAll("#dxpatch-ops-tbody tr").forEach((tr) => {
    tr.classList.toggle("op-selected", String(tr.dataset.op) === String(selectedEnvOp));
  });

  if (currentPatch && currentAlgInfo) {
    drawAlgorithmCanvas(currentAlgInfo);
    drawEnvelopeCanvas(currentPatch, currentAlgInfo);
  }
}

function updateEnvSelectorButtons(algInfo) {
  const carrierSet = new Set(algInfo.carriers);
  const patch = currentPatch;
  for (let opNum = 1; opNum <= 6; opNum++) {
    const btn = document.querySelector(`#dxpatch-env-op-selectors [data-op="${opNum}"]`);
    if (!btn) continue;
    const isCarr = carrierSet.has(opNum);
    btn.classList.toggle("btn-carrier", isCarr);
    btn.classList.toggle("btn-mod", !isCarr);
    if (patch) {
      const op = patch.op(opNum);
      btn.classList.toggle("btn-disabled", !op.enabled);
    }
    const isTarget = String(opNum) === String(selectedEnvOp);
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-pressed", isTarget ? "true" : "false");
  }
  const allBtn = document.querySelector('#dxpatch-env-op-selectors [data-op="all"]');
  if (allBtn) {
    const isTarget = selectedEnvOp === "all";
    allBtn.classList.toggle("active", isTarget);
    allBtn.setAttribute("aria-pressed", isTarget ? "true" : "false");
  }
}

function initEnvSelectors() {
  const group = document.getElementById("dxpatch-env-op-selectors");
  if (!group) return;
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".dxpatch-op-sel-btn");
    if (!btn) return;
    const opVal = btn.dataset.op;
    if (opVal === "all") {
      setEnvSelectedOp("all");
    } else {
      const opNum = Number(opVal);
      if (selectedEnvOp === opNum) {
        setEnvSelectedOp("all");
      } else {
        setEnvSelectedOp(opNum);
      }
    }
  });
}

function initAlgCanvasInteraction() {
  const algCanvas = document.getElementById("dxpatch-alg-canvas");
  if (!algCanvas) return;
  algCanvas.style.cursor = "pointer";
  algCanvas.addEventListener("click", (e) => {
    const rect = algCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (algCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (algCanvas.height / rect.height);
    for (let op = 1; op <= 6; op++) {
      const p = algNodePositions[op];
      if (p && Math.abs(mx - p.x) <= 16 && Math.abs(my - p.y) <= 12) {
        setEnvSelectedOp(op);
        break;
      }
    }
  });
}

function initEnvelopeCanvasInteraction() {
  const canvas = document.getElementById("dxpatch-env-canvas");
  if (!canvas) return;

  const getCanvasPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!currentPatch || !currentAlgInfo) return;
    const pos = getCanvasPos(e);

    // 1. If single OP is selected, check if user clicked on one of its 4 breakpoints
    if (selectedEnvOp !== "all" && lastDrawnPoints) {
      for (let i = 1; i <= 4; i++) {
        const pt = lastDrawnPoints[i];
        if (pt && Math.hypot(pos.x - pt.x, pos.y - pt.y) <= 14) {
          isDraggingBreakpoint = true;
          draggedBreakpoint = { opNum: Number(selectedEnvOp), index: i };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          drawEnvelopeCanvas(currentPatch, currentAlgInfo);
          return;
        }
      }
    }

    // 2. Check if user clicked near any operator curve to select that operator
    if (envelopeCurves) {
      let closestOp = null;
      let closestDist = Infinity;
      for (const [opStr, pts] of Object.entries(envelopeCurves)) {
        const opNum = Number(opStr);
        for (let s = 0; s < pts.length - 1; s++) {
          const d = distToSegment(pos.x, pos.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y);
          if (d < closestDist) {
            closestDist = d;
            closestOp = opNum;
          }
        }
      }
      if (closestDist <= 12 && closestOp !== null) {
        setEnvSelectedOp(closestOp);
        e.preventDefault();
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!currentPatch || !currentAlgInfo) return;
    const pos = getCanvasPos(e);
    const w = canvas.width;
    const h = canvas.height;
    const padX = 16;
    const padY = 14;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;
    const minSeg = 10;
    const maxSeg = plotW * 0.24;

    if (isDraggingBreakpoint && draggedBreakpoint) {
      const { opNum, index: i } = draggedBreakpoint;
      const op = currentPatch.op(opNum);

      // Level calculation (vertical)
      const lvl = clamp(Math.round(((h - padY - pos.y) / plotH) * 99), 0, 99);
      op[`eg_level_${i}`] = lvl;

      // Rate calculation (horizontal)
      const prevX = i === 1 ? padX : lastDrawnPoints[i - 1].x;
      const dx = pos.x - prevX;
      const clampedDx = clamp(dx, minSeg, maxSeg);
      const t = (clampedDx - minSeg) / (maxSeg - minSeg);
      const rate = clamp(Math.round(99 * (1 - t)), 0, 99);
      op[`eg_rate_${i}`] = rate;

      // Live sync to table inputs
      const rInput = document.querySelector(`.op-num-input[data-op="${opNum}"][data-field="eg_rate_${i}"]`);
      const lInput = document.querySelector(`.op-num-input[data-op="${opNum}"][data-field="eg_level_${i}"]`);
      if (rInput) {
        rInput.value = String(rate);
        rInput.classList.add("cell-editing");
      }
      if (lInput) {
        lInput.value = String(lvl);
        lInput.classList.add("cell-editing");
      }

      drawEnvelopeCanvas(currentPatch, currentAlgInfo);
      return;
    }

    // Hover detection
    let hovered = null;
    if (selectedEnvOp !== "all" && lastDrawnPoints) {
      for (let i = 1; i <= 4; i++) {
        const pt = lastDrawnPoints[i];
        if (pt && Math.hypot(pos.x - pt.x, pos.y - pt.y) <= 14) {
          hovered = { opNum: Number(selectedEnvOp), index: i };
          break;
        }
      }
    }

    if (hovered) {
      canvas.style.cursor = "grab";
    } else {
      let nearCurve = false;
      if (envelopeCurves) {
        for (const pts of Object.values(envelopeCurves)) {
          for (let s = 0; s < pts.length - 1; s++) {
            if (distToSegment(pos.x, pos.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y) <= 8) {
              nearCurve = true;
              break;
            }
          }
          if (nearCurve) break;
        }
      }
      canvas.style.cursor = nearCurve ? "pointer" : "default";
    }

    if (hoveredBreakpoint?.index !== hovered?.index) {
      hoveredBreakpoint = hovered;
      drawEnvelopeCanvas(currentPatch, currentAlgInfo);
    }
  });

  const finishDrag = (e) => {
    if (isDraggingBreakpoint) {
      isDraggingBreakpoint = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      document.querySelectorAll(".op-num-input.cell-editing").forEach((el) => {
        el.classList.remove("cell-editing");
      });
      const opNum = draggedBreakpoint ? draggedBreakpoint.opNum : selectedEnvOp;
      draggedBreakpoint = null;
      onPatchEdited(`OP${opNum} Envelope Drag`);
      drawEnvelopeCanvas(currentPatch, currentAlgInfo);
    }
  };

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function colorMixRgba(hexOrColor, alpha) {
  if (hexOrColor.startsWith("#")) {
    let hex = hexOrColor.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hexOrColor;
}

function buildPianoKeyboard() {
  const container = document.getElementById("dxpatch-piano-keyboard");
  if (!container) return;
  container.innerHTML = "";
  const whiteCount = PIANO_NOTES.filter((n) => !n.black).length;
  let whiteSeen = 0;

  for (const n of PIANO_NOTES) {
    const el = document.createElement("div");
    el.dataset.midi = String(n.midi);
    if (!n.black) {
      el.className = "piano-key-white";
      el.textContent = n.key ? `${n.label} [${n.key}]` : n.label;
      whiteSeen++;
    } else {
      el.className = "piano-key-black";
      el.textContent = n.key;
      el.style.left = `calc(${(whiteSeen / whiteCount) * 100}% - 11px)`;
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      el.classList.add("active");
      playSingleNote(n.midi);
    });
    el.addEventListener("mouseup", () => el.classList.remove("active"));
    el.addEventListener("mouseleave", () => el.classList.remove("active"));
    container.appendChild(el);
  }
}

function renderBankList() {
  const listEl = document.getElementById("dxpatch-bank-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const slotInd = document.getElementById("dxpatch-bank-slot-indicator");
  if (slotInd) slotInd.textContent = `Slot ${String(currentSlot).padStart(2, "0")}`;

  for (let slot = 1; slot <= 32; slot++) {
    const p = bank.getPatch(slot);
    const item = document.createElement("div");
    item.className = `bank-slot ${slot === currentSlot ? "active" : ""}`;
    item.dataset.slot = String(slot);

    item.innerHTML = `
      <span class="slot-idx">${String(slot).padStart(2, "0")}</span>
      <span class="slot-name">${p.name.trim()}</span>
      <span class="slot-meta">A${p.algorithm} F${p.feedback}</span>
    `;

    item.addEventListener("click", () => {
      currentSlot = slot;
      currentPatch = bank.getPatch(slot).copy();
      refreshPatchUI();
      renderBankList();
      playSingleNote(60);
      setStatus(`Loaded Slot ${String(slot).padStart(2, "0")}: '${currentPatch.name.trim()}'`);
    });
    listEl.appendChild(item);
  }
}

function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getSafeFilename(name, suffix = "") {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "dx7_patch";
  return `${clean}${suffix}.syx`;
}

function downloadSingleVoiceSyx() {
  if (!currentPatch) return;
  const filename = getSafeFilename(currentPatch.name, "_voice");
  triggerDownload(encodeSingleVoiceSysex(currentPatch, midiChannel), filename);
  setStatus(`Downloaded single-voice SysEx '${filename}' (163 bytes VCED)`);
}

function downloadPatchAsBankSyx() {
  if (!currentPatch) return;
  const filename = getSafeFilename(currentPatch.name, "_cart");
  triggerDownload(new DX7Bank([currentPatch]).toSysex(midiChannel), filename);
  setStatus(`Downloaded cartridge bank SysEx '${filename}' (4,104 bytes VMEM, Slot 1)`);
}

function downloadFullBankSyx() {
  triggerDownload(bank.toSysex(midiChannel), "dx7_bank_32.syx");
  setStatus("Downloaded 32-voice bank 'dx7_bank_32.syx' (4,104 bytes VMEM)");
}

async function loadSysexFile(file) {
  try {
    const parsed = parseSysexBytes(new Uint8Array(await file.arrayBuffer()));
    if (parsed.type === "voice") {
      currentPatch = parsed.patch;
      refreshPatchUI();
      setStatus(`Loaded single voice '${parsed.patch.name.trim()}' from ${file.name}`);
    } else if (parsed.type === "bank") {
      bank = new DX7Bank(parsed.patches);
      currentSlot = 1;
      currentPatch = bank.getPatch(1).copy();
      refreshPatchUI();
      renderBankList();
      setStatus(`Loaded 32-voice bank from ${file.name} (Slot 01: '${currentPatch.name.trim()}')`);
    }
  } catch (err) {
    setStatus(`Error loading .syx file: ${err.message}`);
  }
}

async function sendCurrentPatchToHardware() {
  if (!currentPatch) return;
  try {
    const res = await midi.sendVoicePatch(currentPatch, midiChannel);
    setStatus(`Transmitted '${currentPatch.name.trim()}' (${res.byteLength}B VCED SysEx) to ${res.portName}`);
  } catch (err) {
    setStatus(`Hardware Send Error: ${err.message}`);
  }
}

async function sendFullBankToHardware() {
  try {
    setStatus("Transmitting 32-voice bank (4,104 bytes) to hardware...");
    const res = await midi.sendBankPatch(bank.patches, midiChannel, (pct) => {
      setStatus(`Transmitting 32-voice bank... ${Math.round(pct * 100)}%`);
    });
    setStatus(`Transmitted 32-voice bank (${res.byteLength}B VMEM SysEx) to ${res.portName}`);
  } catch (err) {
    setStatus(`Hardware Bank Transfer Error: ${err.message}`);
  }
}

function setStatus(msg) {
  const el = document.getElementById("dxpatch-status-message");
  if (el) el.textContent = msg;
}

export function loadExternalDxPatch(patch, bankPatches = null, slot1to32 = 1) {
  initDxPatch();
  if (Array.isArray(bankPatches) && bankPatches.length === 32) {
    bank = new DX7Bank(bankPatches);
  }
  currentSlot = clamp(slot1to32, 1, 32);
  if (patch) {
    currentPatch = patch.copy();
    bank.setPatch(currentSlot, currentPatch);
  } else {
    currentPatch = bank.getPatch(currentSlot).copy();
  }
  refreshPatchUI();
  renderBankList();
  setStatus(`Opened '${currentPatch.name.trim()}' from Librarian (Slot ${String(currentSlot).padStart(2, "0")})`);
}

