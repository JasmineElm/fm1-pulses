/**
 * js/vapatch.js — BaudGirl FM-1+VA Virtual Analog Preset Workbench for FM-1 Pulses.
 * Subtractive Synthesis, 16-Preset VA Pack Manager & Web MIDI CC / SysEx Codec.
 */

import { clamp } from "./dx7.js";
import { SeededRNG } from "./dxgenerator.js";
import * as midi from "./midi.js";
import {
  VAPatch,
  VA_WAVES,
  VA_FILTER_TYPES,
  FX_DEFS,
  VA_RECIPES,
  cutoffText,
  generateVAPatch,
  mutateVAPatch,
  encodeVAPresetSysex,
  encodeVABankSysex,
  parseVASysexBytes,
  VAAudioPlayer,
} from "./va.js";

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

const SCRUB_PARAMS = [
  { field: "super", key: "SUP", title: "Supersaw Unison Voices (0-100, CC 25)", min: 0, max: 100, color: "cyan" },
  { field: "detune", key: "DET", title: "Unison Detune Spread (0-100, CC 26)", min: 0, max: 100, color: "cyan" },
  { field: "drift", key: "DRF", title: "Analog Pitch Drift (0-100, CC 27)", min: 0, max: 100, color: "cyan" },
  { field: "sub", key: "SUB", title: "Sub Oscillator -1 Oct (0-100, CC 28)", min: 0, max: 100, color: "cyan" },
  { field: "noise", key: "NOI", title: "White Noise Mix (0-100, CC 29)", min: 0, max: 100, color: "cyan" },
  { field: "pwm", key: "PWM", title: "Pulse Width Modulation (0-100, CC 30)", min: 0, max: 100, color: "cyan" },
  { field: "cutoff", key: "CUT", title: "Filter Cutoff (0-100 / 20Hz-20kHz, CC 74)", min: 0, max: 100, color: "amber", fmt: (v) => cutoffText(v) },
  { field: "resonance", key: "RES", title: "Filter Resonance (0-100, CC 71)", min: 0, max: 100, color: "amber" },
  { field: "filterEnv", key: "F.ENV", title: "Filter Envelope Depth (0-100, CC 52)", min: 0, max: 100, color: "amber" },
  { field: "filterDecay", key: "F.DEC", title: "Filter Envelope Decay (0-100, CC 53)", min: 0, max: 100, color: "amber" },
  { field: "shape", key: "SHP", title: "Filter Envelope Shape (0-100, CC 54)", min: 0, max: 100, color: "amber" },
  { field: "lfoCutoff", key: "LFO>C", title: "LFO to Filter Cutoff (0-100, CC 57)", min: 0, max: 100, color: "purple" },
  { field: "attack", key: "ATK", title: "Amp Attack (0-100, CC 73)", min: 0, max: 100, color: "cyan" },
  { field: "decay", key: "DEC", title: "Amp Decay (0-100, CC 75)", min: 0, max: 100, color: "cyan" },
  { field: "sustain", key: "SUS", title: "Amp Sustain (0-100, CC 70)", min: 0, max: 100, color: "cyan" },
  { field: "release", key: "REL", title: "Amp Release (0-100, CC 72)", min: 0, max: 100, color: "cyan" },
  { field: "lfoSpeed", key: "L.SPD", title: "LFO Speed (0-99, CC 76)", min: 0, max: 99, color: "purple" },
  { field: "lfoPmd", key: "L.PMD", title: "LFO Pitch Mod Depth (0-99, CC 77)", min: 0, max: 99, color: "purple" },
  { field: "level", key: "LVL", title: "Preset Output Level (0-99)", min: 0, max: 99, color: "cyan" },
  { field: "velocityToLevel", key: "VEL", title: "Velocity to Level (0-7)", min: 0, max: 7, color: "cyan" },
];

const VA_CATEGORIES = Object.keys(VA_RECIPES);

let active = false;
let initialized = false;
let pack = []; // 16 VA presets (Slots 113-128, indices 0..15)
let currentPackIdx = 0;
let currentPatch = null;
let audioPlayer = null;
let autoSendCC = true;
let midiChannel = 0; // 0-indexed (Ch 1)
let fxChannel = 1;   // 0-indexed (Ch 2)
let auditionMode = "auto";

function getThemeTokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return {
    bgCanvas: v("--bg") || (isLight ? "#f3f4f6" : "#111215"),
    border: v("--line") || (isLight ? "#d1d5db" : "#333846"),
    borderHighlight: v("--line-focus") || (isLight ? "#9ca3af" : "#4b5264"),
    textMain: v("--fg") || (isLight ? "#111827" : "#f3f4f6"),
    textMuted: v("--dim") || (isLight ? "#4b5563" : "#9ca3af"),
    cyan: v("--accent") || "#3b82f6",
    cyanDim: isLight ? "rgba(37, 99, 235, 0.14)" : "rgba(59, 130, 246, 0.18)",
    amber: "#f59e0b",
    amberDim: "rgba(245, 158, 11, 0.16)",
    purple: "#a855f7",
    purpleDim: "rgba(168, 85, 247, 0.18)",
    green: v("--ok") || "#16a34a",
    red: v("--err") || "#dc2626",
  };
}

export function initVaPatch() {
  if (initialized) return;
  initialized = true;

  audioPlayer = new VAAudioPlayer();

  // Macro sliders
  const sliders = [
    ["va-slider-cutoff", "va-val-cutoff"],
    ["va-slider-unison", "va-val-unison"],
    ["va-slider-speed", "va-val-speed"],
    ["va-slider-fx", "va-val-fx"],
    ["va-slider-mutation", "va-val-mutation"],
  ];
  for (const [sId, vId] of sliders) {
    const s = document.getElementById(sId);
    const v = document.getElementById(vId);
    if (s && v) {
      s.addEventListener("input", () => {
        v.textContent = Number(s.value).toFixed(2);
      });
    }
  }

  // Top action buttons
  document.getElementById("va-btn-generate")?.addEventListener("click", () => generatePatch());
  document.getElementById("va-btn-mutate")?.addEventListener("click", () => mutateCurrentPatch());
  document.getElementById("va-btn-add-bank")?.addEventListener("click", () => storeToPackSlot());

  // Top navigation downloads / loads
  document.getElementById("va-top-dl-preset")?.addEventListener("click", () => downloadSinglePresetSyx());
  document.getElementById("va-top-dl-pack")?.addEventListener("click", () => downloadPackSyx());
  document.getElementById("va-btn-dl-preset")?.addEventListener("click", () => downloadSinglePresetSyx());
  document.getElementById("va-btn-dl-pack")?.addEventListener("click", () => downloadPackSyx());
  document.getElementById("va-btn-export-pack")?.addEventListener("click", () => downloadPackSyx());

  const fileInput = document.getElementById("va-top-file-input");
  const panelFileInput = document.getElementById("va-panel-file-input");
  const dropArea = document.getElementById("va-drop-area");

  const onFile = (file) => {
    if (file) loadSysexFile(file);
  };
  fileInput?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) { onFile(e.target.files[0]); e.target.value = ""; }
  });
  panelFileInput?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) { onFile(e.target.files[0]); e.target.value = ""; }
  });

  if (dropArea) {
    dropArea.addEventListener("click", () => panelFileInput?.click());
    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("dragover");
    });
    dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));
    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");
      if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  // Pack generation
  document.getElementById("va-btn-fill-pack")?.addEventListener("click", () => generatePack(false));
  document.getElementById("va-btn-fill-mixed")?.addEventListener("click", () => generatePack(true));

  // Name input
  document.getElementById("va-name-input")?.addEventListener("input", (e) => {
    if (!currentPatch) return;
    currentPatch.name = VAPatch.sanitizeName(e.target.value);
    pack[currentPackIdx] = currentPatch.copy();
    renderPackList();
  });

  // Transpose steppers
  document.getElementById("va-transpose-prev")?.addEventListener("click", () => stepTranspose(-1));
  document.getElementById("va-transpose-next")?.addEventListener("click", () => stepTranspose(1));
  document.getElementById("va-transpose-input")?.addEventListener("change", (e) => {
    if (!currentPatch) return;
    currentPatch.transpose = clamp(Number(e.target.value), 0, 48);
    onPatchEdited("Transpose");
  });

  // Slot stepper
  document.getElementById("va-slot-prev")?.addEventListener("click", () => stepTargetSlot(-1));
  document.getElementById("va-slot-next")?.addEventListener("click", () => stepTargetSlot(1));

  // Segmented Pill Button Groups
  bindSegGroup("va-wave-group", "wave", "Waveform");
  bindSegGroup("va-filter-group", "filterType", "Filter Type");
  bindSegGroup("va-keytrk-group", "keyTracking", "Key Tracking");
  bindSegGroup("va-mono-group", "mono", "Voice Mode");

  // Interactive Canvases
  initOscCanvasInteractions();
  initFilterCanvasInteractions();
  initEnvCanvasInteractions();

  // MIDI CC & SysEx
  document.getElementById("va-btn-send-cc")?.addEventListener("click", () => beamLiveCCs());
  document.getElementById("va-btn-send-v4")?.addEventListener("click", () => sendV4PresetToMidi());
  document.getElementById("va-chk-auto-cc")?.addEventListener("change", (e) => {
    autoSendCC = e.target.checked;
  });
  document.getElementById("va-midi-channel-select")?.addEventListener("change", (e) => {
    midiChannel = Number(e.target.value) & 0x0f;
  });
  document.getElementById("va-audition-mode-select")?.addEventListener("change", (e) => {
    auditionMode = e.target.value;
  });

  buildPianoKeyboard();
  window.addEventListener("keydown", handleKeyDown);

  populateInitialPack();
  generatePatch();
}

export function activateVaPatch() {
  active = true;
  initVaPatch();
  refreshUI();
  renderPackList();
}

export function deactivateVaPatch() {
  active = false;
  try {
    if (audioPlayer && typeof audioPlayer.stopAllNotes === "function") {
      audioPlayer.stopAllNotes();
    }
  } catch (e) {
    console.warn("Error stopping audio in deactivateVaPatch:", e);
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
    const keyEl = document.querySelector(`#va-piano-keyboard [data-midi="${midiNote}"]`);
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
    storeToPackSlot();
  } else if (key === "E") {
    e.preventDefault();
    downloadPackSyx();
  }
}

function bindSegGroup(groupId, prop, label) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".va-seg-btn");
    if (!btn || !currentPatch) return;
    const val = Number(Object.values(btn.dataset)[0]);
    currentPatch[prop] = val;
    onPatchEdited(label);
  });
}

function stepTranspose(delta) {
  if (!currentPatch) return;
  currentPatch.transpose = clamp(currentPatch.transpose + delta, 0, 48);
  onPatchEdited("Transpose");
}

function stepTargetSlot(delta) {
  const input = document.getElementById("va-target-slot");
  if (!input) return;
  const next = clamp((Number(input.value) || 113) + delta, 1, 128);
  input.value = next;
  if (currentPatch) currentPatch.slot = next - 1;
}

function getGenOptions() {
  const targetSlot = clamp(Number(document.getElementById("va-target-slot")?.value) || 113, 1, 128) - 1;
  return {
    category: document.getElementById("va-category-select")?.value || "supersaw",
    profile: document.getElementById("va-profile-select")?.value || "none",
    cutoffBias: Number(document.getElementById("va-slider-cutoff")?.value || 0.6),
    unisonSpread: Number(document.getElementById("va-slider-unison")?.value || 0.5),
    envSpeed: Number(document.getElementById("va-slider-speed")?.value || 0.5),
    fxDensity: Number(document.getElementById("va-slider-fx")?.value || 0.5),
    slot: targetSlot,
  };
}

function populateInitialPack() {
  const rng = new SeededRNG(2026);
  pack = Array.from({ length: 16 }, (_, i) => {
    const cat = VA_CATEGORIES[i % VA_CATEGORIES.length];
    return generateVAPatch({ category: cat, seed: rng.randint(1, 999999), slot: 112 + i });
  });
  renderPackList();
}

async function autoSyncHardware(baseMsg) {
  const fm1 = midi.findFm1();
  if (fm1 && autoSendCC && currentPatch) {
    try {
      const res = await midi.sendVALiveCCs(currentPatch, midiChannel, fxChannel);
      setStatus(`${baseMsg} → Beamed ${res.ccCount} CCs to ${res.portName}`);
      return;
    } catch (err) {
      setStatus(`${baseMsg} (MIDI CC error: ${err.message})`);
      return;
    }
  }
  setStatus(baseMsg);
}

async function generatePatch() {
  const opts = getGenOptions();
  currentPatch = generateVAPatch(opts);
  refreshUI();
  await autoSyncHardware(
    `Generated VA ${opts.category.toUpperCase()}: '${currentPatch.name.trim()}' (${VA_WAVES[currentPatch.wave]}, ${VA_FILTER_TYPES[currentPatch.filterType]} ${cutoffText(currentPatch.cutoff)})`
  );
}

async function mutateCurrentPatch() {
  if (!currentPatch) return;
  const rate = Number(document.getElementById("va-slider-mutation")?.value) || 0.2;
  currentPatch = mutateVAPatch(currentPatch, rate);
  refreshUI();
  await autoSyncHardware(`Mutated VA voice '${currentPatch.name.trim()}' (Rate: ${rate.toFixed(2)})`);
}

function storeToPackSlot() {
  if (!currentPatch) return;
  pack[currentPackIdx] = currentPatch.copy();
  renderPackList();
  setStatus(`Stored '${currentPatch.name.trim()}' into Pack Slot ${113 + currentPackIdx}`);
}

function generatePack(mixed = false) {
  const cat = document.getElementById("va-category-select")?.value || "supersaw";
  const rng = new SeededRNG(Date.now() & 0xffffff);

  pack = Array.from({ length: 16 }, (_, i) => {
    const chosenCat = mixed ? VA_CATEGORIES[i % VA_CATEGORIES.length] : cat;
    return generateVAPatch({ category: chosenCat, seed: rng.randint(1, 999999), slot: 112 + i });
  });

  currentPackIdx = 0;
  currentPatch = pack[0].copy();
  refreshUI();
  renderPackList();
  setStatus(`Generated 16 ${mixed ? "mixed" : cat} VA presets for slots 113–128`);
}

function onPatchEdited(reason = "edit") {
  if (!currentPatch) return;
  refreshUI();
  autoSyncHardware(`Edited ${reason}: '${currentPatch.name.trim()}'`);
}

async function beamLiveCCs() {
  if (!currentPatch) return;
  try {
    const res = await midi.sendVALiveCCs(currentPatch, midiChannel, fxChannel);
    setStatus(`Beamed ${res.ccCount} VA CCs to ${res.portName} (Ch ${midiChannel + 1}, FX Ch ${fxChannel + 1})`);
  } catch (err) {
    setStatus(`Beam CC Error: ${err.message}`);
  }
}

async function sendV4PresetToMidi() {
  if (!currentPatch) return;
  const slotVal = clamp(Number(document.getElementById("va-target-slot")?.value) || 113, 1, 128);
  try {
    const res = await midi.sendVAPresetPatch(currentPatch, slotVal - 1);
    setStatus(`Written 231B v4 SysEx to FM-1 Slot ${res.slot} on ${res.portName}`);
  } catch (err) {
    setStatus(`Write 231B Error: ${err.message}`);
  }
}

function downloadSinglePresetSyx() {
  if (!currentPatch) return;
  const slotVal = clamp(Number(document.getElementById("va-target-slot")?.value) || 113, 1, 128);
  const syx = encodeVAPresetSysex(currentPatch, slotVal - 1);
  const cleanName = currentPatch.name.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "patch";
  const blob = new Blob([syx], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VA_S${String(slotVal).padStart(3, "0")}_${cleanName}.syx`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded single 231-byte preset for Slot ${slotVal}`);
}

function downloadPackSyx() {
  if (pack.length === 0) return;
  const syx = encodeVABankSysex(pack, 112);
  const blob = new Blob([syx], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FM1VA_Pack_113-128.syx`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded 16-preset pack (Slots 113-128) as .syx (${syx.length} bytes)`);
}

async function loadSysexFile(file) {
  try {
    const parsed = parseVASysexBytes(new Uint8Array(await file.arrayBuffer()));
    if (parsed.type === "va-voice") {
      currentPatch = parsed.patch;
      refreshUI();
      setStatus(`Loaded VA Preset '${parsed.patch.name.trim()}' (Slot ${parsed.slot + 1}) from ${file.name}`);
    } else if (parsed.type === "va-bank") {
      pack = parsed.patches;
      currentPackIdx = 0;
      currentPatch = pack[0].copy();
      refreshUI();
      renderPackList();
      setStatus(`Loaded ${parsed.patches.length}-preset VA Pack from ${file.name}`);
    } else {
      setStatus(`File does not appear to be BaudGirl FM-1+VA SysEx (wrong header/length)`);
    }
  } catch (err) {
    setStatus(`Error loading .syx file: ${err.message}`);
  }
}

function playSingleNote(midiNote) {
  const shouldPlayBrowser = auditionMode === "browser" || auditionMode === "both" || (auditionMode === "auto" && !midi.findFm1());
  const shouldPlayHW = auditionMode === "hardware" || auditionMode === "both" || (auditionMode === "auto" && midi.findFm1());

  if (shouldPlayBrowser && audioPlayer && currentPatch) {
    audioPlayer.playNote(currentPatch, midiNote, 100, 0.6);
  }
  if (shouldPlayHW && midi.findFm1()) {
    midi.playHardwareNote(midiNote, 100, 500, midiChannel + 1);
  }
}

function refreshUI() {
  if (!currentPatch) return;
  const p = currentPatch;

  // Name
  const nameEl = document.getElementById("va-name-input");
  if (nameEl && document.activeElement !== nameEl) nameEl.value = p.name;

  // Transpose
  const trnEl = document.getElementById("va-transpose-input");
  if (trnEl && document.activeElement !== trnEl) trnEl.value = p.transpose;

  // Segmented Pill Buttons
  updateSegGroup("va-wave-group", p.wave);
  updateSegGroup("va-filter-group", p.filterType);
  updateSegGroup("va-keytrk-group", p.keyTracking);
  updateSegGroup("va-mono-group", p.mono);

  // Canvases
  drawOscCanvas(p);
  drawFilterCanvas(p);
  drawEnvCanvas(p);

  // Scrub Grid & FX Grid
  renderScrubGrid(p);
  renderFxGrid(p);
}

function updateSegGroup(groupId, activeVal) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll(".va-seg-btn").forEach((btn) => {
    const val = Number(Object.values(btn.dataset)[0]);
    btn.classList.toggle("active", val === activeVal);
  });
}

function initOscCanvasInteractions() {
  const canvas = document.getElementById("va-osc-canvas");
  if (!canvas) return;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging || !currentPatch) return;
    const dx = e.clientX - startX;
    const dy = startY - e.clientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      moved = true;
      startX = e.clientX;
      startY = e.clientY;
      if (currentPatch.wave === 3) {
        currentPatch.pwm = clamp(currentPatch.pwm + Math.round(dx * 0.5), 0, 100);
      } else {
        currentPatch.detune = clamp(currentPatch.detune + Math.round(dx * 0.5), 0, 100);
      }
      currentPatch.super = clamp(currentPatch.super + Math.round(dy * 0.6), 0, 100);
      refreshUI();
    }
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    if (!moved && currentPatch) {
      currentPatch.wave = (currentPatch.wave + 1) % 4;
      onPatchEdited(`Wave ${VA_WAVES[currentPatch.wave]}`);
    } else if (moved) {
      onPatchEdited("Oscillator Unison/PWM");
    }
  });
}

function initFilterCanvasInteractions() {
  const canvas = document.getElementById("va-filter-canvas");
  if (!canvas) return;
  let dragging = false;

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    updateFromMouse(e);
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    updateFromMouse(e);
  });
  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      onPatchEdited("Filter Cutoff/Res");
    }
  });
  canvas.addEventListener("wheel", (e) => {
    if (!currentPatch) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 3 : -3;
    currentPatch.filterEnv = clamp(currentPatch.filterEnv + delta, 0, 100);
    onPatchEdited("Filter Envelope Depth");
  });

  function updateFromMouse(e) {
    if (!currentPatch) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left - 12) / (rect.width - 24), 0, 1);
    const ny = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    currentPatch.cutoff = Math.round(nx * 100);
    currentPatch.resonance = Math.round(ny * 100);
    refreshUI();
  }
}

function initEnvCanvasInteractions() {
  const canvas = document.getElementById("va-env-canvas");
  if (!canvas) return;
  let dragMode = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (!currentPatch) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const norm = x / w;

    if (norm < 0.28) dragMode = "attack";
    else if (norm < 0.65) dragMode = "decaySustain";
    else dragMode = "release";

    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragMode || !currentPatch) return;
    const dx = Math.round((e.clientX - lastX) * 0.6);
    const dy = Math.round((lastY - e.clientY) * 0.6);
    lastX = e.clientX;
    lastY = e.clientY;

    if (dragMode === "attack") {
      currentPatch.attack = clamp(currentPatch.attack + dx, 0, 100);
    } else if (dragMode === "decaySustain") {
      currentPatch.decay = clamp(currentPatch.decay + dx, 0, 100);
      currentPatch.sustain = clamp(currentPatch.sustain + dy, 0, 100);
    } else {
      currentPatch.release = clamp(currentPatch.release + dx, 0, 100);
    }
    currentPatch.syncOp6FromAdsr();
    refreshUI();
  });

  window.addEventListener("mouseup", () => {
    if (dragMode) {
      dragMode = null;
      onPatchEdited("ADSR Envelope");
    }
  });
}

function drawOscCanvas(p) {
  const canvas = document.getElementById("va-osc-canvas");
  if (!canvas) return;
  const t = getThemeTokens();
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Center zero line
  ctx.strokeStyle = t.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const waveSample = (phase, type, pwm = 0.5) => {
    const ph = ((phase % 1) + 1) % 1;
    if (type === 0) return Math.sin(ph * Math.PI * 2);
    if (type === 1) return 2 * ph - 1;
    if (type === 2) return 1 - 4 * Math.abs(Math.round(ph - 0.25) - (ph - 0.25));
    return ph < pwm ? 1 : -1;
  };

  const voices = p.super > 8 ? 5 : 1;
  const duty = 0.5 - (p.pwm / 100) * 0.38;

  for (let v = 0; v < voices; v++) {
    const isCenter = v === Math.floor(voices / 2);
    const phaseOffset = (v - Math.floor(voices / 2)) * ((p.detune / 100) * 0.14);
    ctx.strokeStyle = isCenter ? t.cyan : t.purple;
    ctx.lineWidth = isCenter ? 2.0 : 1.0;
    ctx.beginPath();
    for (let x = 8; x < w - 8; x++) {
      const normX = (x - 8) / (w - 16);
      const yVal = waveSample(normX * 2 + phaseOffset, p.wave, duty);
      const subVal = p.sub > 0 ? Math.sin(normX * Math.PI * 2) * (p.sub / 100) * 0.35 : 0;
      const py = h / 2 - clamp((yVal * 0.75 + subVal) * (h * 0.38), -h * 0.44, h * 0.44);
      if (x === 8) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
  }
}

function drawFilterCanvas(p) {
  const canvas = document.getElementById("va-filter-canvas");
  if (!canvas) return;
  const t = getThemeTokens();
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = t.border;
  ctx.lineWidth = 1;
  for (let y = 25; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const cutX = 14 + (p.cutoff / 100) * (w - 28);
  const resPeak = (p.resonance / 100) * 36;
  const baseY = h * 0.6;

  // Filter Envelope span indicator
  if (p.filterEnv > 0) {
    const envEndX = Math.min(w - 10, cutX + (p.filterEnv / 100) * (w * 0.45));
    ctx.fillStyle = t.amberDim;
    ctx.fillRect(cutX, 8, envEndX - cutX, h - 16);
    ctx.strokeStyle = t.amber;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(envEndX, 8);
    ctx.lineTo(envEndX, h - 8);
    ctx.stroke();
  }

  // Filter Transfer Curve
  ctx.strokeStyle = t.cyan;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let x = 8; x < w - 8; x++) {
    const dx = (x - cutX) / 26;
    let resp = 0;
    if (p.filterType === 0) resp = dx <= 0 ? 1 : Math.exp(-dx * 1.1); // LP12
    else if (p.filterType === 1) resp = dx <= 0 ? 1 : Math.exp(-dx * 2.0); // LP24
    else if (p.filterType === 2) resp = Math.exp(-dx * dx * 1.4); // BP
    else resp = dx >= 0 ? 1 : Math.exp(dx * 1.6); // HP
    const resBump = Math.exp(-dx * dx * 5.5) * (resPeak / 50);
    const y = clamp(baseY - (resp - 0.5) * 44 - resBump * 38, 8, h - 8);
    if (x === 8) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Cutoff handle dot
  ctx.fillStyle = t.cyan;
  ctx.beginPath();
  ctx.arc(cutX, clamp(baseY - 20 - resPeak * 0.8, 10, h - 10), 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnvCanvas(p) {
  const canvas = document.getElementById("va-env-canvas");
  if (!canvas) return;
  const t = getThemeTokens();
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = t.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, h - 12);
  ctx.lineTo(w - 8, h - 12);
  ctx.stroke();

  const x0 = 10;
  const x1 = x0 + 4 + (p.attack / 100) * 52;
  const x2 = x1 + 4 + (p.decay / 100) * 52;
  const x3 = Math.max(x2 + 20, w - 64);
  const x4 = x3 + 4 + (p.release / 100) * 50;

  const yBot = h - 12;
  const yTop = 14;
  const ySus = yBot - (p.sustain / 100) * (yBot - yTop);

  ctx.fillStyle = t.cyanDim;
  ctx.beginPath();
  ctx.moveTo(x0, yBot);
  ctx.lineTo(x1, yTop);
  ctx.lineTo(x2, ySus);
  ctx.lineTo(x3, ySus);
  ctx.lineTo(x4, yBot);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = t.cyan;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(x0, yBot);
  ctx.lineTo(x1, yTop);
  ctx.lineTo(x2, ySus);
  ctx.lineTo(x3, ySus);
  ctx.lineTo(x4, yBot);
  ctx.stroke();

  for (const [nx, ny] of [[x1, yTop], [x2, ySus], [x4, yBot]]) {
    ctx.fillStyle = t.cyan;
    ctx.beginPath();
    ctx.arc(nx, ny, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderScrubGrid(p) {
  const grid = document.getElementById("va-scrub-grid");
  if (!grid) return;
  grid.innerHTML = "";

  for (const item of SCRUB_PARAMS) {
    const val = p[item.field];
    const pct = ((val - item.min) / (item.max - item.min)) * 100;
    const cell = document.createElement("div");
    cell.className = "va-scrub-cell";
    cell.title = item.title;
    const fillClass = item.color === "amber" ? "amber" : item.color === "purple" ? "purple" : "";
    cell.innerHTML = `
      <div class="va-scrub-cell-top">
        <span class="va-scrub-key">${item.key}</span>
        <span class="va-scrub-val">${item.fmt ? item.fmt(val) : val}</span>
      </div>
      <div class="va-scrub-bar">
        <div class="va-scrub-fill ${fillClass}" style="width: ${pct.toFixed(1)}%"></div>
      </div>
    `;

    attachScrubHandler(
      cell,
      item.min,
      item.max,
      () => currentPatch[item.field],
      (nextVal) => {
        currentPatch[item.field] = nextVal;
        if (item.field.startsWith("attack") || item.field.startsWith("decay") || item.field.startsWith("sustain") || item.field.startsWith("release")) {
          currentPatch.syncOp6FromAdsr();
        }
      },
      item.key
    );

    grid.appendChild(cell);
  }
}

function attachScrubHandler(element, min, max, getVal, setVal, label) {
  let startY = 0;
  let startVal = 0;
  let dragging = false;

  element.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startVal = getVal();
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const range = max - min;
    const step = range > 20 ? 1 : 0.1;
    const nextVal = clamp(Math.round((startVal + dy * (range / 120)) / step) * step, min, max);
    setVal(nextVal);
    refreshUI();
  });

  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      onPatchEdited(label);
    }
  });

  element.addEventListener("wheel", (e) => {
    e.preventDefault();
    const cur = getVal();
    const delta = e.deltaY < 0 ? 1 : -1;
    setVal(clamp(cur + delta, min, max));
    onPatchEdited(label);
  });
}

function renderFxGrid(p) {
  const grid = document.getElementById("va-fx-grid");
  if (!grid) return;
  grid.innerHTML = "";

  FX_DEFS.forEach((def, idx) => {
    const state = p.fx[idx];
    const unit = document.createElement("div");
    unit.className = `va-fx-unit ${state.on ? "fx-active" : ""}`;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "va-fx-toggle-btn";
    toggleBtn.title = `Toggle ${def.name} ${state.on ? "OFF" : "ON"}`;
    toggleBtn.innerHTML = `<span>${def.name}</span><span>${state.on ? "ON" : "OFF"}</span>`;
    toggleBtn.addEventListener("click", () => {
      state.on = !state.on;
      onPatchEdited(`${def.name} ${state.on ? "ON" : "OFF"}`);
    });
    unit.appendChild(toggleBtn);

    if (def.types) {
      const typeBtn = document.createElement("button");
      typeBtn.type = "button";
      typeBtn.className = "va-fx-type-btn";
      typeBtn.title = "Click to cycle type";
      typeBtn.textContent = def.types[state.type] || def.types[0];
      typeBtn.addEventListener("click", () => {
        state.type = (state.type + 1) % def.types.length;
        onPatchEdited(`${def.name} ${def.types[state.type]}`);
      });
      unit.appendChild(typeBtn);
    }

    def.params.forEach(([pName, min, max], pIdx) => {
      const val = state.p[pIdx];
      const pct = ((val - min) / (max - min)) * 100;
      const cell = document.createElement("div");
      cell.className = "va-scrub-cell";
      cell.title = `${def.name} ${pName} (${min}-${max})`;
      cell.innerHTML = `
        <div class="va-scrub-cell-top">
          <span class="va-scrub-key">${pName}</span>
          <span class="va-scrub-val">${val}</span>
        </div>
        <div class="va-scrub-bar">
          <div class="va-scrub-fill" style="width: ${pct.toFixed(1)}%"></div>
        </div>
      `;
      attachScrubHandler(
        cell,
        min,
        max,
        () => state.p[pIdx],
        (nextVal) => { state.p[pIdx] = nextVal; },
        `${def.name} ${pName}`
      );
      unit.appendChild(cell);
    });

    grid.appendChild(unit);
  });
}

function buildPianoKeyboard() {
  const container = document.getElementById("va-piano-keyboard");
  if (!container) return;
  container.innerHTML = "";
  const whiteCount = PIANO_NOTES.filter((n) => !n.black).length;
  let whiteSeen = 0;

  for (const n of PIANO_NOTES) {
    const el = document.createElement("div");
    el.dataset.midi = String(n.midi);
    if (!n.black) {
      el.className = "va-piano-key-white";
      el.textContent = n.key ? `${n.label} [${n.key}]` : n.label;
      whiteSeen++;
    } else {
      el.className = "va-piano-key-black";
      el.textContent = n.key;
      el.style.left = `${((whiteSeen - 0.35) / whiteCount) * 100}%`;
    }
    el.addEventListener("mousedown", () => {
      el.classList.add("active");
      playSingleNote(n.midi);
    });
    el.addEventListener("mouseup", () => el.classList.remove("active"));
    el.addEventListener("mouseleave", () => el.classList.remove("active"));
    container.appendChild(el);
  }
}

function renderPackList() {
  const container = document.getElementById("va-bank-list");
  if (!container) return;
  container.innerHTML = "";

  const indicator = document.getElementById("va-bank-slot-indicator");
  if (indicator) indicator.textContent = `Slot ${113 + currentPackIdx}`;

  pack.forEach((p, idx) => {
    const cell = document.createElement("div");
    cell.className = `va-bank-cell ${idx === currentPackIdx ? "active" : ""}`;
    cell.dataset.slotIdx = String(idx);
    cell.innerHTML = `
      <span class="va-bank-cell-num">${113 + idx}</span>
      <span class="va-bank-cell-name">${p.name.trim() || "INIT"}</span>
      <span class="va-bank-cell-tag">${VA_WAVES[p.wave].slice(0, 3).toUpperCase()}</span>
    `;
    cell.addEventListener("click", () => {
      currentPackIdx = idx;
      currentPatch = pack[idx].copy();
      refreshUI();
      renderPackList();
      setStatus(`Loaded VA Pack Slot ${113 + idx}: '${currentPatch.name.trim()}'`);
    });
    container.appendChild(cell);
  });
}

function setStatus(msg) {
  const el = document.getElementById("va-status-message");
  if (el) el.textContent = msg;
}
