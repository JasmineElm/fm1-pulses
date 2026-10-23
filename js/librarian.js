/**
 * js/librarian.js — FM-1 Preset & Pattern Librarian Workbench.
 *
 * Exports presets (SysEx 0x10 -> .syx v4 / DX7 VCED / VMEM / .json) and patterns
 * (SysEx 0x11 RAM read -> .syx / .mid / .json) from the M-VAVE FM-1, and uploads
 * new or edited patterns (from .syx, .json, .mid, sequencer bank, or interactive editor)
 * to the FM-1 via SysEx 0x20.
 */

import {
  MAX_STEPS,
  MAX_NOTES,
  RATE_NAMES,
  ysum,
  encodeWrite,
  emptyPattern,
  clonePattern,
  decodePatternSysex,
  encodePatternMidi,
  decodePatternMidi,
} from "./pattern.js";
import {
  clamp,
  DX7Patch,
  DX7Bank,
  packVoice128,
  unpackVoice128,
  packVoice155,
  unpackVoice155,
  encodeSingleVoiceSysex,
  encodeBankSysex,
  parseSysexBytes,
} from "./dx7.js";
import {
  VAPatch,
  MARK_VA,
  MARK_FM,
  MARK_8BIT,
  SUBID,
  V4_LEN,
  RESET_RECORD,
  pack87,
  unpack87,
  unpackVoice as unpackFm1Voice,
  packVoice as packFm1Voice,
  FX_DEFS,
  VA_WAVES,
  VA_FILTER_TYPES,
  cutoffText,
  VAAudioPlayer,
} from "./va.js";
import { WebAudioPlayer } from "./dxaudio.js";
import { midiName } from "./generator.js";
import { getBank, getSelected, setSelected, locks, state } from "./state.js";
import { renderBuffer, refreshLockCount } from "./grid.js?v=1";
import { syncRhythmGrid } from "./rhythm.js?v=1";
import { showModel } from "./modes.js";
import { loadExternalDxPatch } from "./dxpatch.js?v=2";
import * as midi from "./midi.js";

let initialized = false;
let active = false;

// 128 Hardware Preset Slots (0..127)
let presets = [];
let selectedPresetSlot = 0; // 0..127
let presetBankFilter = "all"; // "all" | "A" | "B" | "C" | "D" | "VA"

// 16 Hardware Pattern Slots (0..15)
let patterns = [];
let selectedPatternSlot = 0; // 0..15

// Audition & Playback State
let fmAudio = null;
let vaAudio = null;
let auditionMode = "auto";
let midiChannel = 0; // 0..15
let playingPattern = false;
let playStepIdx = 0;
let playTimer = null;

// Transfer Progress / Cancellation State
let transferBusy = false;
let cancelRequested = false;

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (k) => s.getPropertyValue(k).trim();
  return {
    bg: v("--bg") || "#111215",
    panel: v("--panel") || "#18191f",
    panel2: v("--panel2") || "#22252e",
    line: v("--line") || "#333846",
    lineFocus: v("--line-focus") || "#4b5264",
    fg: v("--fg") || "#f3f4f6",
    dim: v("--dim") || "#9ca3af",
    accent: v("--accent") || "#3b82f6",
    accent2: v("--accent2") || "#60a5fa",
    ok: v("--ok") || "#22c55e",
    err: v("--err") || "#ef4444",
  };
}

function slotBankLabel(slot0to127) {
  const bankIdx = Math.floor(slot0to127 / 32);
  const bankChar = ["A", "B", "C", "D"][bankIdx] || "A";
  const num = (slot0to127 % 32) + 1;
  return `${bankChar}${String(num).padStart(2, "0")}`;
}

function engineFromRecord(record, slot = 0) {
  if (!record || record.length < 19) return slot >= 112 ? "VA" : "FM";
  const m = record[18];
  if (m === MARK_VA) return "VA";
  if (m === MARK_8BIT) return "8B";
  return "FM";
}

function voiceNameFromBytes(voice128) {
  if (!voice128 || voice128.length < 128) return "INIT VOICE";
  let s = "";
  for (let i = 118; i < 128; i++) {
    const c = voice128[i] & 0x7F;
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
  }
  return s;
}

function encodeExactPreset(entry, slotOverride = null) {
  const slot = (slotOverride !== null ? slotOverride : entry.slot) & 0x7F;
  const edit = unpackFm1Voice(entry.voice);
  const record = entry.record ? Uint8Array.from(entry.record) : Uint8Array.from(RESET_RECORD);
  const payload = [...edit, ...pack87(record)];
  return Uint8Array.from([0xF0, 0x43, 0x00, SUBID, 0x04, slot, ...payload, ysum(payload), 0xF7]);
}

function decodeExactPreset(msg) {
  if (
    msg.length !== V4_LEN ||
    msg[0] !== 0xF0 ||
    msg[1] !== 0x43 ||
    msg[3] !== SUBID ||
    msg[4] !== 0x04 ||
    msg[V4_LEN - 1] !== 0xF7
  ) {
    return null;
  }
  const payload = msg.subarray(6, V4_LEN - 2);
  if (ysum(payload) !== msg[V4_LEN - 2]) {
    throw new Error("Checksum mismatch in v4 preset SysEx message");
  }
  const slot = msg[5] & 0x7F;
  const edit = payload.subarray(0, 155);
  const voice = packFm1Voice(edit);
  const record = unpack87(payload.subarray(155), 59);
  return {
    slot,
    name: voiceNameFromBytes(voice),
    engine: engineFromRecord(record, slot),
    voice,
    record,
    hasRecord: true,
    loaded: true,
  };
}

function createDefaultPresets() {
  presets = Array.from({ length: 128 }, (_, slot) => {
    const isVa = slot >= 112;
    if (isVa) {
      const vp = new VAPatch({ name: `VA ${slot - 111}`, slot });
      const fw = vp.toFirmwareBytes();
      return {
        slot,
        name: vp.name,
        engine: "VA",
        voice: fw.voice,
        record: fw.record,
        hasRecord: true,
        loaded: false,
      };
    }
    const dp = new DX7Patch({ name: `PRESET ${String(slot + 1).padStart(3, "0")}` });
    const voice = packVoice128(dp);
    const record = Uint8Array.from(RESET_RECORD);
    record[18] = MARK_FM;
    return {
      slot,
      name: dp.name,
      engine: "FM",
      voice,
      record,
      hasRecord: false,
      loaded: false,
    };
  });
}

function createDefaultPatterns() {
  const seqBank = getBank();
  patterns = Array.from({ length: 16 }, (_, i) => {
    if (seqBank && seqBank[i]) {
      return clonePattern(seqBank[i]);
    }
    return emptyPattern(16, 6, state.tempo || 120, state.gate || 50, state.swing || 50);
  });
}

export function initLibrarian() {
  if (initialized) return;
  initialized = true;

  fmAudio = new WebAudioPlayer();
  vaAudio = new VAAudioPlayer();
  createDefaultPresets();
  createDefaultPatterns();

  bindEvents();
  refreshAll();
}

export function activateLibrarian() {
  active = true;
  initLibrarian();
  // If patterns are all empty and sequencer has patterns, sync unedited slots
  const seqBank = getBank();
  const anyNotes = patterns.some((p) => p.steps.some((s) => s.notes.length > 0));
  if (!anyNotes && seqBank && seqBank.length) {
    for (let i = 0; i < Math.min(16, seqBank.length); i++) {
      if (seqBank[i]) patterns[i] = clonePattern(seqBank[i]);
    }
  }
  refreshAll();
}

export function deactivateLibrarian() {
  active = false;
  stopPatternAudition();
  try {
    if (fmAudio && typeof fmAudio.stopAll === "function") fmAudio.stopAll();
  } catch {}
}

function setStatus(msg) {
  const el = document.getElementById("lib-status-message");
  if (el) el.textContent = msg;
}

function showProgress(label, pct) {
  const wrap = document.getElementById("lib-progress-wrap");
  const lbl = document.getElementById("lib-progress-label");
  const fill = document.getElementById("lib-progress-fill");
  if (wrap) wrap.classList.add("active");
  if (lbl) lbl.textContent = label;
  if (fill) fill.style.width = `${Math.round(clamp(pct * 100, 0, 100))}%`;
}

function hideProgress() {
  const wrap = document.getElementById("lib-progress-wrap");
  if (wrap) wrap.classList.remove("active");
}

function triggerDownload(bytes, filename, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function getFilteredPresetSlots() {
  if (presetBankFilter === "A") return Array.from({ length: 32 }, (_, i) => i);
  if (presetBankFilter === "B") return Array.from({ length: 32 }, (_, i) => 32 + i);
  if (presetBankFilter === "C") return Array.from({ length: 32 }, (_, i) => 64 + i);
  if (presetBankFilter === "D") return Array.from({ length: 32 }, (_, i) => 96 + i);
  if (presetBankFilter === "VA") return Array.from({ length: 16 }, (_, i) => 112 + i);
  return Array.from({ length: 128 }, (_, i) => i);
}

// --------------------------------------------------------------------------- //
// Hardware Preset Operations (Pull 0x10, Write 0x04, Export .syx / .json)
// --------------------------------------------------------------------------- //

async function pullSinglePresetFromHardware(slot = selectedPresetSlot) {
  if (transferBusy) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    setStatus(`Reading Preset ${String(slot + 1).padStart(3, "0")} (${slotBankLabel(slot)}) from FM-1...`);
    const res = await midi.readPreset(slot, 3);
    const record = res.record || Uint8Array.from(RESET_RECORD);
    const engine = engineFromRecord(record, slot);
    const name = voiceNameFromBytes(res.voice);
    presets[slot] = {
      slot,
      name,
      engine,
      voice: res.voice,
      record,
      hasRecord: res.hasRecord,
      loaded: true,
    };
    selectedPresetSlot = slot;
    refreshPresetInspector();
    renderPresetList();
    setStatus(`Pulled Preset ${String(slot + 1).padStart(3, "0")} (${slotBankLabel(slot)}): '${name.trim()}' [${engine}]`);
  } catch (err) {
    setStatus(`Preset Read Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
  }
}

async function pullPresetRangeFromHardware(slots, label = "Presets") {
  if (transferBusy) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    showProgress(`Reading ${label} (0/${slots.length})...`, 0);
    setStatus(`Reading ${slots.length} ${label} from FM-1 via SysEx 0x10...`);
    const results = await midi.readPresetsRange(
      slots,
      (done, total, res) => {
        const record = res.record || Uint8Array.from(RESET_RECORD);
        const engine = engineFromRecord(record, res.slot);
        const name = voiceNameFromBytes(res.voice);
        presets[res.slot] = {
          slot: res.slot,
          name,
          engine,
          voice: res.voice,
          record,
          hasRecord: res.hasRecord,
          loaded: true,
        };
        showProgress(`Reading ${res.slot + 1}: ${name.trim()} (${done}/${total})`, done / total);
      },
      () => cancelRequested
    );
    refreshPresetInspector();
    renderPresetList();
    if (cancelRequested) {
      setStatus(`Cancelled preset pull (${results.length}/${slots.length} read).`);
    } else {
      setStatus(`Pulled ${results.length} presets from FM-1 ✓`);
    }
  } catch (err) {
    setStatus(`Preset Pull Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
    hideProgress();
  }
}

async function writeSinglePresetToHardware() {
  const entry = presets[selectedPresetSlot];
  if (!entry || transferBusy) return;
  transferBusy = true;
  try {
    const sysex = encodeExactPreset(entry, selectedPresetSlot);
    setStatus(`Writing Preset ${selectedPresetSlot + 1} ('${entry.name.trim()}') to FM-1 (231B v4)...`);
    const res = await midi.sendExactPresetSysex(sysex);
    setStatus(`Wrote Preset ${selectedPresetSlot + 1} ('${entry.name.trim()}') to ${res.portName} ✓`);
  } catch (err) {
    setStatus(`Preset Write Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
  }
}

function exportSinglePresetV4Syx() {
  const entry = presets[selectedPresetSlot];
  if (!entry) return;
  const sysex = encodeExactPreset(entry, selectedPresetSlot);
  const safe = entry.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "preset";
  const fname = `fm1_preset_${String(selectedPresetSlot + 1).padStart(3, "0")}_${safe}_v4.syx`;
  triggerDownload(sysex, fname);
  setStatus(`Exported '${fname}' (231B BaudGirl v4 Exact SysEx)`);
}

function exportSinglePresetDx7Syx() {
  const entry = presets[selectedPresetSlot];
  if (!entry) return;
  const patch = unpackVoice128(entry.voice);
  const sysex = encodeSingleVoiceSysex(patch, midiChannel);
  const safe = entry.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "voice";
  const fname = `fm1_voice_${String(selectedPresetSlot + 1).padStart(3, "0")}_${safe}_dx7.syx`;
  triggerDownload(sysex, fname);
  setStatus(`Exported '${fname}' (163B DX7 VCED SysEx)`);
}

function exportFilteredPresetsV4Syx() {
  const slots = getFilteredPresetSlots();
  const chunks = slots.map((s) => encodeExactPreset(presets[s], s));
  const out = new Uint8Array(chunks.length * V4_LEN);
  chunks.forEach((c, i) => out.set(c, i * V4_LEN));
  const tag = presetBankFilter.toLowerCase();
  const fname = `fm1_presets_${tag}_${slots.length}_v4.syx`;
  triggerDownload(out, fname);
  setStatus(`Exported ${slots.length} presets to '${fname}' (${out.length} bytes v4 SysEx)`);
}

function exportActive32BankDx7Syx() {
  const bankIdx = Math.floor(selectedPresetSlot / 32);
  const bankLetter = ["A", "B", "C", "D"][bankIdx] || "A";
  const start = bankIdx * 32;
  const dxPatches = Array.from({ length: 32 }, (_, i) => unpackVoice128(presets[start + i].voice));
  const sysex = encodeBankSysex(dxPatches, midiChannel);
  const fname = `fm1_bank_${bankLetter}_dx7_32v.syx`;
  triggerDownload(sysex, fname);
  setStatus(`Exported Bank ${bankLetter} (Slots ${start + 1}–${start + 32}) to '${fname}' (4,104B DX7 VMEM)`);
}

function openSelectedPresetInTool() {
  const entry = presets[selectedPresetSlot];
  if (!entry) return;
  if (entry.engine === "VA") {
    setStatus(`Preset ${selectedPresetSlot + 1} is a Virtual Analog (VA) preset. VA editing is handled directly on hardware.`);
  } else {
    const dp = unpackVoice128(entry.voice);
    const bankIdx = Math.floor(selectedPresetSlot / 32);
    const start = bankIdx * 32;
    const bankPatches = Array.from({ length: 32 }, (_, i) => unpackVoice128(presets[start + i].voice));
    const slot1to32 = (selectedPresetSlot % 32) + 1;
    loadExternalDxPatch(dp, bankPatches, slot1to32);
    showModel("dxpatch");
  }
}

// --------------------------------------------------------------------------- //
// Hardware Pattern Operations (Pull 0x11, Upload 0x20, Export .syx/.mid/.json)
// --------------------------------------------------------------------------- //

async function pullSinglePatternFromHardware(patIdx = selectedPatternSlot) {
  if (transferBusy) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    showProgress(`Reading Pattern P${String(patIdx + 1).padStart(2, "0")} from FM-1 RAM...`, 0.35);
    setStatus(`Reading Pattern P${String(patIdx + 1).padStart(2, "0")} from FM-1 RAM (SysEx 0x11)...`);
    const { pattern } = await midi.readDevicePattern(patIdx);
    patterns[patIdx] = clonePattern(pattern);
    selectedPatternSlot = patIdx;
    refreshPatternUI();
    renderPatternBankGrid();
    const noteCount = patterns[patIdx].steps.reduce((acc, s) => acc + s.notes.length, 0);
    setStatus(
      `Pulled Pattern P${String(patIdx + 1).padStart(2, "0")} from FM-1 ✓ (${pattern.length} steps, ${RATE_NAMES[pattern.rate]}, ${noteCount} notes, ${pattern.tempo} BPM)`
    );
  } catch (err) {
    setStatus(`Pattern Read Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
    hideProgress();
  }
}

async function pullAll16PatternsFromHardware() {
  if (transferBusy) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    const indices = Array.from({ length: 16 }, (_, i) => i);
    showProgress("Reading All 16 Patterns (0/16)...", 0);
    setStatus("Reading all 16 patterns from FM-1 RAM (SysEx 0x11)...");
    const { patterns: list } = await midi.readDevicePatterns(
      indices,
      (done, total, patIdx) => {
        showProgress(`Reading Pattern P${String(patIdx + 1).padStart(2, "0")} (${done}/${total})`, done / total);
      },
      () => cancelRequested
    );
    for (const item of list) {
      patterns[item.slot] = clonePattern(item.pattern);
    }
    refreshPatternUI();
    renderPatternBankGrid();
    if (cancelRequested) {
      setStatus(`Cancelled pattern pull (${list.length}/16 read).`);
    } else {
      setStatus(`Pulled all ${list.length} patterns from FM-1 ✓`);
    }
  } catch (err) {
    setStatus(`Pattern Bank Pull Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
    hideProgress();
  }
}

async function uploadSinglePatternToHardware(patIdx = selectedPatternSlot) {
  if (transferBusy) return;
  const pat = patterns[patIdx];
  if (!pat) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    const msgs = encodeWrite(pat, patIdx, true);
    showProgress(`Uploading Pattern P${String(patIdx + 1).padStart(2, "0")} (${msgs.length} parts)...`, 0.5);
    setStatus(`Uploading Pattern P${String(patIdx + 1).padStart(2, "0")} to FM-1 (SysEx 0x20, ${msgs.length * 177} bytes)...`);
    const portName = await midi.sendPattern(msgs, `P${String(patIdx + 1).padStart(2, "0")}`);
    setStatus(
      `Uploaded Pattern P${String(patIdx + 1).padStart(2, "0")} (${pat.length} steps, ${RATE_NAMES[pat.rate]}) to ${portName} ✓`
    );
  } catch (err) {
    setStatus(`Pattern Upload Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
    hideProgress();
  }
}

async function uploadAll16PatternsToHardware() {
  if (transferBusy) return;
  transferBusy = true;
  cancelRequested = false;
  try {
    showProgress("Uploading 16 Patterns to FM-1 (0/16)...", 0);
    setStatus("Uploading all 16 patterns to FM-1 via SysEx 0x20...");
    let uploaded = 0;
    for (let i = 0; i < 16; i++) {
      if (cancelRequested) break;
      const p = patterns[i];
      showProgress(`Uploading Pattern P${String(i + 1).padStart(2, "0")} (${i + 1}/16)...`, (i + 1) / 16);
      await midi.sendPattern(encodeWrite(p, i, true), `P${String(i + 1).padStart(2, "0")}`);
      uploaded++;
    }
    if (cancelRequested) {
      setStatus(`Cancelled pattern upload (${uploaded}/16 uploaded).`);
    } else {
      setStatus(`Uploaded all 16 patterns to FM-1 ✓`);
    }
  } catch (err) {
    setStatus(`Bulk Pattern Upload Error: ${err.message || err}`);
  } finally {
    transferBusy = false;
    hideProgress();
  }
}

function exportSinglePatternSyx() {
  const pat = patterns[selectedPatternSlot];
  if (!pat) return;
  const msgs = encodeWrite(pat, selectedPatternSlot, true);
  const bytes = [];
  for (const m of msgs) bytes.push(...m);
  const fname = `fm1_pattern_p${String(selectedPatternSlot + 1).padStart(2, "0")}.syx`;
  triggerDownload(new Uint8Array(bytes), fname);
  setStatus(`Exported Pattern P${String(selectedPatternSlot + 1).padStart(2, "0")} to '${fname}' (${bytes.length} bytes)`);
}

function exportAll16PatternsSyx() {
  const bytes = [];
  for (let i = 0; i < 16; i++) {
    for (const m of encodeWrite(patterns[i], i, true)) bytes.push(...m);
  }
  const fname = "fm1_patterns_all16.syx";
  triggerDownload(new Uint8Array(bytes), fname);
  setStatus(`Exported all 16 patterns to '${fname}' (${bytes.length} bytes)`);
}

function exportSinglePatternMidi() {
  const pat = patterns[selectedPatternSlot];
  if (!pat) return;
  const midBytes = encodePatternMidi(pat);
  const fname = `fm1_pattern_p${String(selectedPatternSlot + 1).padStart(2, "0")}.mid`;
  triggerDownload(midBytes, fname, "audio/midi");
  setStatus(`Exported Pattern P${String(selectedPatternSlot + 1).padStart(2, "0")} as Standard MIDI File '${fname}' (${midBytes.length}B)`);
}

function pullFromSequencerWorkspace() {
  const seqBank = getBank();
  if (!seqBank || !seqBank.length) {
    setStatus("Sequencer bank is empty.");
    return;
  }
  for (let i = 0; i < Math.min(16, seqBank.length); i++) {
    if (seqBank[i]) patterns[i] = clonePattern(seqBank[i]);
  }
  selectedPatternSlot = clamp(getSelected() || 0, 0, 15);
  refreshPatternUI();
  renderPatternBankGrid();
  setStatus(`Pulled 16 patterns from Pulses Sequencer workspace (Active: P${String(selectedPatternSlot + 1).padStart(2, "0")})`);
}

function sendPatternToSequencerWorkspace() {
  const pat = patterns[selectedPatternSlot];
  if (!pat) return;
  const seqBank = getBank();
  const targetSlot = selectedPatternSlot;
  if (seqBank) {
    seqBank[targetSlot] = clonePattern(pat);
  }
  state.length = pat.length;
  state.rate = pat.rate;
  state.tempo = pat.tempo;
  state.gate = pat.gate;
  state.swing = pat.swing;
  setSelected(targetSlot);

  // Lock active steps in the sequencer so regeneration preserves them
  locks.clear();
  for (let i = 0; i < pat.length; i++) {
    const st = pat.steps[i];
    if (st && st.notes.length > 0) {
      locks.set(`${targetSlot}:${i}`, st.notes.map((n) => ({ note: n.note, vel: n.vel })));
    }
  }
  try {
    renderBuffer();
    refreshLockCount();
    syncRhythmGrid();
  } catch {}
  setStatus(`Sent Pattern P${String(targetSlot + 1).padStart(2, "0")} into Pulses Sequencer Slot ${targetSlot + 1} (steps locked)`);
}

// --------------------------------------------------------------------------- //
// JSON Bundle & Universal File Import (.syx / .json / .mid)
// --------------------------------------------------------------------------- //

const hexEncode = (arr) => Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
const hexDecode = (str) => {
  const clean = String(str || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

function exportJsonBundle(mode = "all") {
  const bundle = {
    format: "virtual-fm1",
    app: "fm1-pulses-librarian",
    version: 1,
  };

  if (mode === "all" || mode === "presets") {
    const slots = mode === "presets" ? getFilteredPresetSlots() : Array.from({ length: 128 }, (_, i) => i);
    bundle.presets = slots.map((s) => {
      const e = presets[s];
      return {
        slot: s + 1,
        name: e.name.trim(),
        engine: e.engine === "8B" ? "8-Bit" : e.engine,
        raw: {
          voice: hexEncode(e.voice),
          record: hexEncode(e.record || RESET_RECORD),
        },
      };
    });
  }

  if (mode === "all" || mode === "patterns") {
    bundle.patterns = patterns.map((p, idx) => ({
      slot: idx + 1,
      length: p.length,
      rate: p.rate,
      noteValue: RATE_NAMES[p.rate] || "1/16",
      tempo: p.tempo,
      gate: p.gate,
      swing: p.swing,
      steps: p.steps.slice(0, MAX_STEPS).map((st) => ({
        rate: st.rate,
        notes: st.notes.map((n) => ({ note: n.note, vel: n.vel })),
      })),
    }));
  }

  const fname = mode === "presets"
    ? "fm1_presets.json"
    : mode === "patterns"
      ? "fm1_patterns.json"
      : "fm1_backup_bundle.json";
  triggerDownload(JSON.stringify(bundle, null, 2), fname, "application/json");
  setStatus(`Exported ${fname} ✓`);
}

async function handleIncomingFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".json")) {
      const text = await file.text();
      const data = JSON.parse(text);
      importJsonData(data, file.name);
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name.endsWith(".mid") || name.endsWith(".midi") || (bytes[0] === 0x4D && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64)) {
      const pat = decodePatternMidi(bytes, patterns[selectedPatternSlot]?.rate ?? 6);
      patterns[selectedPatternSlot] = pat;
      refreshPatternUI();
      renderPatternBankGrid();
      const noteCount = pat.steps.reduce((acc, s) => acc + s.notes.length, 0);
      setStatus(`Imported MIDI file '${file.name}' into Pattern P${String(selectedPatternSlot + 1).padStart(2, "0")} (${pat.length} steps, ${noteCount} notes)`);
      return;
    }

    importSysexBytes(bytes, file.name);
  } catch (err) {
    setStatus(`File Import Error (${file.name}): ${err.message || err}`);
  }
}

function importSysexBytes(bytes, filename = "file.syx") {
  // 1. Check for SysEx 0x20 Pattern Write messages (177B each)
  const decodedPatterns = decodePatternSysex(bytes);
  if (decodedPatterns.length > 0) {
    if (decodedPatterns.length === 1) {
      // Single pattern: load into currently selected pattern slot
      patterns[selectedPatternSlot] = clonePattern(decodedPatterns[0].pattern);
    } else {
      for (const { slot, pattern } of decodedPatterns) {
        patterns[clamp(slot, 0, 15)] = clonePattern(pattern);
      }
      selectedPatternSlot = clamp(decodedPatterns[0].slot, 0, 15);
    }
    refreshPatternUI();
    renderPatternBankGrid();
    setStatus(
      `Loaded ${decodedPatterns.length} pattern${decodedPatterns.length > 1 ? "s" : ""} from '${filename}' (ready to inspect or upload to FM-1)`
    );
    return;
  }

  // 2. Check for BaudGirl v4 231-byte Exact Preset messages (0x04)
  const messages = [];
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0xF0) start = i;
    else if (bytes[i] === 0xF7 && start >= 0) {
      messages.push(bytes.subarray(start, i + 1));
      start = -1;
    }
  }
  const v4Presets = [];
  for (const m of messages) {
    const p = decodeExactPreset(m);
    if (p) v4Presets.push(p);
  }
  if (v4Presets.length > 0) {
    if (v4Presets.length === 1) {
      const p = v4Presets[0];
      p.slot = selectedPresetSlot;
      presets[selectedPresetSlot] = p;
    } else {
      for (const p of v4Presets) {
        presets[clamp(p.slot, 0, 127)] = p;
      }
      selectedPresetSlot = clamp(v4Presets[0].slot, 0, 127);
    }
    refreshPresetInspector();
    renderPresetList();
    setStatus(`Loaded ${v4Presets.length} FM-1 v4 preset${v4Presets.length > 1 ? "s" : ""} from '${filename}'`);
    return;
  }

  // 3. Check for standard DX7 Voice (163B) or 32-Voice Bank (4104B)
  const parsed = parseSysexBytes(bytes);
  if (parsed.type === "voice") {
    const voice = packVoice128(parsed.patch);
    const record = Uint8Array.from(RESET_RECORD);
    record[18] = MARK_FM;
    presets[selectedPresetSlot] = {
      slot: selectedPresetSlot,
      name: parsed.patch.name,
      engine: "FM",
      voice,
      record,
      hasRecord: false,
      loaded: true,
    };
    refreshPresetInspector();
    renderPresetList();
    setStatus(`Loaded DX7 Voice '${parsed.patch.name.trim()}' into Slot ${selectedPresetSlot + 1}`);
  } else if (parsed.type === "bank") {
    const bankIdx = Math.floor(selectedPresetSlot / 32);
    const baseSlot = bankIdx * 32;
    parsed.patches.forEach((p, idx) => {
      const slot = baseSlot + idx;
      const voice = packVoice128(p);
      const record = Uint8Array.from(RESET_RECORD);
      record[18] = MARK_FM;
      presets[slot] = {
        slot,
        name: p.name,
        engine: "FM",
        voice,
        record,
        hasRecord: false,
        loaded: true,
      };
    });
    refreshPresetInspector();
    renderPresetList();
    setStatus(`Loaded 32-voice DX7 bank from '${filename}' into Slots ${baseSlot + 1}–${baseSlot + 32}`);
  }
}

function importJsonData(data, filename = "file.json") {
  let patCount = 0;
  let preCount = 0;

  // Virtual-FM-1 or Librarian bundle format
  if (Array.isArray(data.presets)) {
    data.presets.forEach((pr, idx) => {
      const slot = clamp((pr.slot ? pr.slot - 1 : idx), 0, 127);
      if (pr.raw?.voice) {
        const voice = hexDecode(pr.raw.voice);
        const record = pr.raw.record ? hexDecode(pr.raw.record) : Uint8Array.from(RESET_RECORD);
        if (voice.length === 128) {
          presets[slot] = {
            slot,
            name: voiceNameFromBytes(voice),
            engine: engineFromRecord(record, slot),
            voice,
            record,
            hasRecord: Boolean(pr.raw.record),
            loaded: true,
          };
          preCount++;
        }
      }
    });
  }

  const incomingPatterns = Array.isArray(data.patterns)
    ? data.patterns
    : Array.isArray(data.steps)
      ? [data]
      : null;

  if (incomingPatterns) {
    incomingPatterns.forEach((rawPat, idx) => {
      const slot = incomingPatterns.length === 1
        ? selectedPatternSlot
        : clamp((rawPat.slot ? rawPat.slot - 1 : idx), 0, 15);
      const rateIdx = typeof rawPat.rate === "number"
        ? clamp(rawPat.rate, 0, 9)
        : Math.max(0, RATE_NAMES.indexOf(rawPat.noteValue || "1/16"));
      const p = emptyPattern(
        clamp(rawPat.length ?? 16, 1, MAX_STEPS),
        rateIdx >= 0 ? rateIdx : 6,
        clamp(rawPat.tempo ?? 120, 30, 300),
        clamp(rawPat.gate ?? 50, 5, 100),
        clamp(rawPat.swing ?? 50, 50, 75)
      );
      if (Array.isArray(rawPat.steps)) {
        rawPat.steps.slice(0, MAX_STEPS).forEach((st, sIdx) => {
          const stRate = typeof st?.rate === "number" ? clamp(st.rate, 0, 9) : p.rate;
          const notes = Array.isArray(st?.notes)
            ? st.notes.slice(0, MAX_NOTES).map((n) => ({
                note: clamp(n.note ?? n.pitch ?? 60, 0, 127),
                vel: clamp(n.vel ?? n.velocity ?? 100, 1, 127),
              }))
            : [];
          p.steps[sIdx] = { rate: stRate, notes };
        });
      }
      patterns[slot] = p;
      patCount++;
    });
  }

  refreshAll();
  if (patCount > 0 || preCount > 0) {
    setStatus(`Imported ${preCount} preset(s) and ${patCount} pattern(s) from '${filename}'`);
  } else {
    throw new Error("No valid FM-1 presets or patterns found in JSON file");
  }
}

// --------------------------------------------------------------------------- //
// Auditioning (Single Note + Pattern Sequencer Loop)
// --------------------------------------------------------------------------- //

function playPresetNote(midiNote = 60, vel = 100, durationMs = 280) {
  const entry = presets[selectedPresetSlot];
  const fm1 = midi.findFm1();
  const useHw = fm1 && (auditionMode === "auto" || auditionMode === "hardware" || auditionMode === "both");
  const useBrowser = auditionMode === "browser" || auditionMode === "both" || (auditionMode === "auto" && !fm1);

  if (useHw) {
    midi.playHardwareNote(midiNote, vel, durationMs, midiChannel + 1);
  }
  if (useBrowser && entry) {
    const durSec = Math.max(0.08, durationMs / 1000);
    if (entry.engine === "VA") {
      const vp = VAPatch.fromFirmwareBytes(unpackFm1Voice(entry.voice), entry.record, selectedPresetSlot);
      vaAudio?.playPatchNote(vp, midiNote, vel, durSec);
    } else {
      const dp = unpackVoice128(entry.voice);
      fmAudio?.playPatchNote(dp, midiNote, vel, durSec);
    }
  }
}

function togglePatternAudition() {
  if (playingPattern) {
    stopPatternAudition();
  } else {
    startPatternAudition();
  }
}

function startPatternAudition() {
  if (playingPattern) return;
  playingPattern = true;
  playStepIdx = 0;
  const btn = document.getElementById("lib-btn-play-pattern");
  if (btn) {
    btn.textContent = "■ Stop";
    btn.classList.add("playing");
  }
  scheduleNextAuditionStep();
}

function stopPatternAudition() {
  playingPattern = false;
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  const btn = document.getElementById("lib-btn-play-pattern");
  if (btn) {
    btn.textContent = "▶ Play";
    btn.classList.remove("playing");
  }
  drawPatternCanvas();
}

function scheduleNextAuditionStep() {
  if (!playingPattern) return;
  const pat = patterns[selectedPatternSlot];
  if (!pat) {
    stopPatternAudition();
    return;
  }

  const len = clamp(pat.length, 1, MAX_STEPS);
  const idx = playStepIdx % len;
  const st = pat.steps[idx] || { rate: pat.rate, notes: [] };

  // Highlight playhead
  drawPatternCanvas(idx);

  // Calculate step duration in ms from tempo, rate, and swing
  const bpm = clamp(pat.tempo || 120, 30, 300);
  const quarterMs = 60000 / bpm;
  const rateMult = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12][clamp(st.rate ?? pat.rate, 0, 9)] || 0.25;
  const baseStepMs = quarterMs * rateMult;
  const swingPct = clamp(pat.swing || 50, 50, 75) / 50; // 1.0 .. 1.5
  const stepMs = (idx % 2 === 0) ? baseStepMs * swingPct : baseStepMs * (2 - swingPct);
  const gateMs = Math.max(25, stepMs * (clamp(pat.gate || 50, 5, 100) / 100));

  for (const n of st.notes) {
    playPresetNote(n.note, n.vel, gateMs);
  }

  playStepIdx = (idx + 1) % len;
  playTimer = setTimeout(scheduleNextAuditionStep, Math.max(25, stepMs));
}

// --------------------------------------------------------------------------- //
// Interactive Pattern Editing & Canvas Visualization
// --------------------------------------------------------------------------- //

const CANVAS_MIN_NOTE = 36; // C2
const CANVAS_MAX_NOTE = 84; // C6
const CANVAS_NUM_NOTES = CANVAS_MAX_NOTE - CANVAS_MIN_NOTE + 1; // 49 semitones

function getCanvasMetrics(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const padL = 32;
  const padR = 8;
  const padT = 10;
  const padB = 18;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const stepW = plotW / MAX_STEPS;
  const rowH = plotH / CANVAS_NUM_NOTES;
  return { w, h, padL, padR, padT, padB, plotW, plotH, stepW, rowH };
}

function noteToCanvasY(note, m) {
  const cl = clamp(note, CANVAS_MIN_NOTE, CANVAS_MAX_NOTE);
  const row = CANVAS_MAX_NOTE - cl;
  return m.padT + (row + 0.5) * m.rowH;
}

function drawPatternCanvas(activePlayStep = -1) {
  const canvas = document.getElementById("lib-pattern-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const m = getCanvasMetrics(canvas);
  const { w, h, padL, padR, padT, padB, plotW, plotH, stepW, rowH } = m;
  const c = getThemeColors();
  const pat = patterns[selectedPatternSlot];
  if (!pat) return;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle alternating 4-step beat columns
  for (let b = 0; b < 16; b++) {
    if (b % 2 === 1) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
      ctx.fillRect(padL + b * 4 * stepW, padT, 4 * stepW, plotH);
    }
  }

  // Horizontal octave guides (C2, C3, C4, C5, C6)
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.fillStyle = c.dim;
  ctx.font = "9px ui-monospace, monospace";
  for (let octNote = CANVAS_MIN_NOTE; octNote <= CANVAS_MAX_NOTE; octNote += 12) {
    const y = Math.round(noteToCanvasY(octNote, m)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(midiName(octNote), 4, y + 3);
  }

  // Step grid lines every 4 steps & Bar lines every 16 steps
  for (let s = 0; s <= MAX_STEPS; s += 4) {
    const x = Math.round(padL + s * stepW) + 0.5;
    ctx.strokeStyle = (s % 16 === 0) ? c.lineFocus : c.line;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
    if (s < MAX_STEPS && (s % 8 === 0)) {
      ctx.fillStyle = c.dim;
      ctx.fillText(String(s + 1), x + 2, h - 5);
    }
  }

  // Shade region beyond pattern.length
  if (pat.length < MAX_STEPS) {
    const endX = padL + pat.length * stepW;
    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.fillRect(endX, padT, (w - padR) - endX, plotH);
    ctx.strokeStyle = c.accent2;
    ctx.beginPath();
    ctx.moveTo(endX, padT);
    ctx.lineTo(endX, h - padB);
    ctx.stroke();
  }

  // Playhead column
  if (activePlayStep >= 0 && activePlayStep < MAX_STEPS) {
    const px = padL + activePlayStep * stepW;
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, padT + 0.5, Math.max(2, stepW - 1), plotH - 1);
    ctx.lineWidth = 1;
  }

  // Draw step notes
  const barH = Math.max(5, Math.ceil(rowH * 1.4));
  for (let i = 0; i < MAX_STEPS; i++) {
    const st = pat.steps[i];
    if (!st || !st.notes.length) continue;
    const x = padL + i * stepW;
    const isPast = i >= pat.length;
    for (const n of st.notes) {
      const y = noteToCanvasY(n.note, m);
      ctx.fillStyle = isPast ? c.dim : c.accent;
      ctx.globalAlpha = isPast ? 0.35 : Math.max(0.4, n.vel / 127);
      ctx.fillRect(x + 1, y - barH / 2, Math.max(2, stepW - 2), barH);
    }
  }
  ctx.globalAlpha = 1.0;
}

function refreshPatternUI() {
  const pat = patterns[selectedPatternSlot];
  if (!pat) return;

  const slotVal = document.getElementById("lib-pat-slot-val");
  if (slotVal) slotVal.textContent = `P${String(selectedPatternSlot + 1).padStart(2, "0")}`;

  const lenVal = document.getElementById("lib-pat-len-val");
  if (lenVal) lenVal.textContent = `${pat.length} st`;

  const rateVal = document.getElementById("lib-pat-rate");
  if (rateVal) rateVal.textContent = RATE_NAMES[pat.rate] || "1/16";

  const tempoVal = document.getElementById("lib-pat-tempo-val");
  if (tempoVal) tempoVal.textContent = String(pat.tempo);

  const gateVal = document.getElementById("lib-pat-gate-val");
  if (gateVal) gateVal.textContent = `${pat.gate}%`;

  const swingVal = document.getElementById("lib-pat-swing-val");
  if (swingVal) swingVal.textContent = `${pat.swing}%`;

  const notesVal = document.getElementById("lib-pat-notes-val");
  if (notesVal) {
    const totalNotes = pat.steps.slice(0, pat.length).reduce((acc, s) => acc + (s.notes?.length || 0), 0);
    notesVal.textContent = String(totalNotes);
  }

  drawPatternCanvas(playingPattern ? playStepIdx : -1);
}

function renderPatternBankGrid() {
  const container = document.getElementById("lib-pattern-list");
  if (!container) return;
  container.innerHTML = "";

  const badge = document.getElementById("lib-active-pat-badge");
  if (badge) badge.textContent = `P${String(selectedPatternSlot + 1).padStart(2, "0")}`;

  patterns.forEach((p, idx) => {
    const el = document.createElement("div");
    el.className = `lib-pat-slot ${idx === selectedPatternSlot ? "active" : ""}`;
    const noteCount = p.steps.slice(0, p.length).reduce((acc, s) => acc + s.notes.length, 0);
    const bars = Array.from({ length: 8 }, (_, b) => {
      const has = p.steps.slice(b * 8, (b + 1) * 8).some((s) => s.notes.length > 0);
      return `<i class="${has ? "on" : ""}"></i>`;
    }).join("");

    el.title = `Pattern P${String(idx + 1).padStart(2, "0")}: ${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount} notes — Click to select, double-click to play`;
    el.innerHTML = `
      <span class="lib-pat-slot-id">P${String(idx + 1).padStart(2, "0")}</span>
      <div class="lib-pat-mini-bar">${bars}</div>
      <span class="lib-pat-slot-meta">${p.length}st · ${noteCount}n</span>
    `;
    el.addEventListener("click", () => {
      selectedPatternSlot = idx;
      refreshPatternUI();
      renderPatternBankGrid();
    });
    el.addEventListener("dblclick", () => {
      selectedPatternSlot = idx;
      refreshPatternUI();
      renderPatternBankGrid();
      if (!playingPattern) startPatternAudition();
    });
    container.appendChild(el);
  });
}

// --------------------------------------------------------------------------- //
// Preset Inspector & 128-Preset Bank Browser
// --------------------------------------------------------------------------- //

function refreshPresetInspector() {
  const entry = presets[selectedPresetSlot];
  if (!entry) return;

  const slotLabel = document.getElementById("lib-preset-slot-label");
  if (slotLabel) {
    slotLabel.textContent = `${String(selectedPresetSlot + 1).padStart(3, "0")} (${slotBankLabel(selectedPresetSlot)})`;
  }

  const nameInput = document.getElementById("lib-preset-name-input");
  if (nameInput) nameInput.value = entry.name.trim();

  const engBadge = document.getElementById("lib-preset-engine-badge");
  if (engBadge) {
    engBadge.textContent = entry.engine;
    engBadge.className = `lib-badge ${entry.engine.toLowerCase()}`;
  }

  const summaryEl = document.getElementById("lib-preset-summary");
  if (!summaryEl) return;

  const record = entry.record || RESET_RECORD;
  const activeFx = [0, 1, 2, 3, 4, 5]
    .filter((t) => Boolean(record[28 + 3 * t]))
    .map((t) => FX_DEFS[t].name);
  if ((record[5] & 0x80) && (record[5] & 8)) activeFx.push("CRUSH");
  const fxText = activeFx.length ? activeFx.join(" · ") : "BYPASS";

  if (entry.engine === "VA") {
    const vp = VAPatch.fromFirmwareBytes(unpackFm1Voice(entry.voice), record, selectedPresetSlot);
    summaryEl.innerHTML = `
      <div class="lib-meta-box" title="Oscillator Waveform & Unison">
        <span class="lib-micro-label">OSC / SUP</span>
        <span class="lib-meta-val">${VA_WAVES[vp.wave]} · ${vp.super}%</span>
      </div>
      <div class="lib-meta-box" title="VA Filter Type & Cutoff">
        <span class="lib-micro-label">FILTER</span>
        <span class="lib-meta-val">${VA_FILTER_TYPES[vp.filterType]} ${cutoffText(vp.cutoff)}</span>
      </div>
      <div class="lib-meta-box" title="Amp Envelope ADSR">
        <span class="lib-micro-label">ADSR</span>
        <span class="lib-meta-val">${vp.attack}/${vp.decay}/${vp.sustain}/${vp.release}</span>
      </div>
      <div class="lib-meta-box" title="Active Effects">
        <span class="lib-micro-label">FX CHAIN</span>
        <span class="lib-meta-val">${fxText}</span>
      </div>
    `;
  } else {
    const dp = unpackVoice128(entry.voice);
    const ratios = [1, 2, 3, 4, 5, 6].map((i) => dp.op(i).frequency_ratio.toFixed(1)).join(" : ");
    summaryEl.innerHTML = `
      <div class="lib-meta-box" title="FM Algorithm & Feedback">
        <span class="lib-micro-label">ALG / FB</span>
        <span class="lib-meta-val">ALG ${dp.algorithm} · FB ${dp.feedback}</span>
      </div>
      <div class="lib-meta-box" title="LFO Waveform & Speed">
        <span class="lib-micro-label">LFO</span>
        <span class="lib-meta-val">${dp.lfo.waveform_name.slice(0, 6)} · ${dp.lfo.speed}</span>
      </div>
      <div class="lib-meta-box" title="Operator Frequency Ratios (OP1..OP6)">
        <span class="lib-micro-label">OP RATIOS</span>
        <span class="lib-meta-val">${ratios}</span>
      </div>
      <div class="lib-meta-box" title="Active Effects">
        <span class="lib-micro-label">FX CHAIN</span>
        <span class="lib-meta-val">${fxText}</span>
      </div>
    `;
  }
}

function renderPresetList() {
  const listEl = document.getElementById("lib-preset-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const slots = getFilteredPresetSlots();
  const countBadge = document.getElementById("lib-preset-count-badge");
  if (countBadge) {
    const loadedCount = presets.filter((p) => p.loaded).length;
    countBadge.textContent = loadedCount > 0 ? `${loadedCount}/128 Read` : `${slots.length} Slots`;
  }

  for (const s of slots) {
    const entry = presets[s];
    const row = document.createElement("div");
    row.className = `lib-preset-row ${s === selectedPresetSlot ? "active" : ""} ${entry.loaded ? "" : "unread"}`;
    row.title = `Slot ${s + 1} (${slotBankLabel(s)}): ${entry.name.trim()} [${entry.engine}] — Click to select, double-click to pull from FM-1`;
    row.innerHTML = `
      <span class="lib-preset-num">${String(s + 1).padStart(3, "0")} ${slotBankLabel(s)}</span>
      <span class="lib-preset-name">${entry.name.trim() || "INIT"}</span>
      <span class="lib-badge ${entry.engine.toLowerCase()}">${entry.engine}</span>
    `;
    row.addEventListener("click", () => {
      selectedPresetSlot = s;
      refreshPresetInspector();
      renderPresetList();
      playPresetNote(60, 100, 240);
    });
    row.addEventListener("dblclick", () => {
      selectedPresetSlot = s;
      pullSinglePresetFromHardware(s);
    });
    listEl.appendChild(row);
  }
}



function refreshAll() {
  refreshPatternUI();
  renderPatternBankGrid();
  refreshPresetInspector();
  renderPresetList();
}

// --------------------------------------------------------------------------- //
// DOM Event Wiring
// --------------------------------------------------------------------------- //

function bindEvents() {
  // Top statusbar quick actions
  document.getElementById("lib-top-pull-presets")?.addEventListener("click", () => {
    pullPresetRangeFromHardware(Array.from({ length: 128 }, (_, i) => i), "All 128 Presets");
  });
  document.getElementById("lib-top-pull-patterns")?.addEventListener("click", () => {
    pullAll16PatternsFromHardware();
  });
  document.getElementById("lib-top-export-bundle")?.addEventListener("click", () => {
    exportJsonBundle("all");
  });

  // Cancel active transfer
  document.getElementById("lib-btn-cancel-transfer")?.addEventListener("click", () => {
    cancelRequested = true;
  });

  // Bank Filter Pills (ALL, A, B, C, D, VA)
  const bankFilterGroup = document.getElementById("lib-bank-filter-group");
  bankFilterGroup?.addEventListener("click", (e) => {
    const btn = e.target.closest(".lib-seg-btn");
    if (!btn) return;
    presetBankFilter = btn.dataset.bank || "all";
    bankFilterGroup.querySelectorAll(".lib-seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    const slots = getFilteredPresetSlots();
    if (!slots.includes(selectedPresetSlot)) {
      selectedPresetSlot = slots[0];
      refreshPresetInspector();
    }
    renderPresetList();
  });

  // Preset Hardware Pull / Write / Export buttons
  document.getElementById("lib-btn-pull-preset")?.addEventListener("click", () => {
    pullSinglePresetFromHardware(selectedPresetSlot);
  });
  document.getElementById("lib-btn-pull-bank")?.addEventListener("click", () => {
    const slots = getFilteredPresetSlots();
    const label = presetBankFilter === "all" ? "All 128 Presets" : `Bank ${presetBankFilter} (${slots.length})`;
    pullPresetRangeFromHardware(slots, label);
  });
  document.getElementById("lib-btn-write-preset")?.addEventListener("click", () => {
    writeSinglePresetToHardware();
  });
  document.getElementById("lib-btn-open-editor")?.addEventListener("click", () => {
    openSelectedPresetInTool();
  });
  document.getElementById("lib-btn-dl-preset-v4")?.addEventListener("click", () => {
    exportSinglePresetV4Syx();
  });
  document.getElementById("lib-btn-dl-preset-dx7")?.addEventListener("click", () => {
    exportSinglePresetDx7Syx();
  });
  document.getElementById("lib-btn-dl-bank-v4")?.addEventListener("click", () => {
    exportFilteredPresetsV4Syx();
  });
  document.getElementById("lib-btn-dl-bank-dx7")?.addEventListener("click", () => {
    exportActive32BankDx7Syx();
  });
  document.getElementById("lib-btn-dl-presets-json")?.addEventListener("click", () => {
    exportJsonBundle("presets");
  });

  // Preset Inspector Name & Slot Stepper
  document.getElementById("lib-preset-prev")?.addEventListener("click", () => {
    selectedPresetSlot = (selectedPresetSlot + 127) % 128;
    refreshPresetInspector();
    renderPresetList();
  });
  document.getElementById("lib-preset-next")?.addEventListener("click", () => {
    selectedPresetSlot = (selectedPresetSlot + 1) % 128;
    refreshPresetInspector();
    renderPresetList();
  });
  document.getElementById("lib-preset-name-input")?.addEventListener("input", (e) => {
    const entry = presets[selectedPresetSlot];
    if (!entry) return;
    const clean = DX7Patch.sanitizeName(e.target.value);
    entry.name = clean;
    for (let i = 0; i < 10; i++) entry.voice[118 + i] = clean.charCodeAt(i) & 0x7F;
    renderPresetList();
  });

  // Pattern Hardware Pull / Upload / Export / Sequencer Sync buttons
  document.getElementById("lib-btn-pull-pattern")?.addEventListener("click", () => {
    pullSinglePatternFromHardware(selectedPatternSlot);
  });
  document.getElementById("lib-btn-pull-all-patterns")?.addEventListener("click", () => {
    pullAll16PatternsFromHardware();
  });
  document.getElementById("lib-btn-upload-pattern")?.addEventListener("click", () => {
    uploadSinglePatternToHardware(selectedPatternSlot);
  });
  document.getElementById("lib-btn-upload-all-patterns")?.addEventListener("click", () => {
    uploadAll16PatternsToHardware();
  });
  document.getElementById("lib-btn-pull-seq")?.addEventListener("click", () => {
    pullFromSequencerWorkspace();
  });
  document.getElementById("lib-btn-send-seq")?.addEventListener("click", () => {
    sendPatternToSequencerWorkspace();
  });
  document.getElementById("lib-btn-dl-pat-syx")?.addEventListener("click", () => {
    exportSinglePatternSyx();
  });
  document.getElementById("lib-btn-dl-all-pat-syx")?.addEventListener("click", () => {
    exportAll16PatternsSyx();
  });
  document.getElementById("lib-btn-dl-pat-mid")?.addEventListener("click", () => {
    exportSinglePatternMidi();
  });
  document.getElementById("lib-btn-dl-pat-json")?.addEventListener("click", () => {
    exportJsonBundle("patterns");
  });

  // File Inputs & Drop Zone
  const topFileInput = document.getElementById("lib-top-file-input");
  const panelFileInput = document.getElementById("lib-panel-file-input");
  const dropArea = document.getElementById("lib-drop-area");

  topFileInput?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) {
      handleIncomingFile(e.target.files[0]);
      e.target.value = "";
    }
  });
  panelFileInput?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) {
      handleIncomingFile(e.target.files[0]);
      e.target.value = "";
    }
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
      if (e.dataTransfer.files?.[0]) handleIncomingFile(e.dataTransfer.files[0]);
    });
  }

  // Pattern Header Strip Controls (Play, Slot, Length, Rate, Tempo, Gate, Swing)
  document.getElementById("lib-btn-play-pattern")?.addEventListener("click", () => {
    togglePatternAudition();
  });

  document.getElementById("lib-pat-slot-prev")?.addEventListener("click", () => {
    selectedPatternSlot = (selectedPatternSlot + 15) % 16;
    refreshPatternUI();
    renderPatternBankGrid();
  });
  document.getElementById("lib-pat-slot-next")?.addEventListener("click", () => {
    selectedPatternSlot = (selectedPatternSlot + 1) % 16;
    refreshPatternUI();
    renderPatternBankGrid();
  });

  // Audition Mode & MIDI Channel
  document.getElementById("lib-audition-mode-select")?.addEventListener("change", (e) => {
    auditionMode = e.target.value;
  });
  document.getElementById("lib-midi-channel-select")?.addEventListener("change", (e) => {
    midiChannel = Number(e.target.value) || 0;
  });

  // Keyboard shortcuts when Librarian is active
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    const tag = e.target?.tagName || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    const key = e.key.toUpperCase();
    if (e.code === "Space") {
      e.preventDefault();
      e.stopImmediatePropagation();
      togglePatternAudition();
    } else if (key === "U") {
      e.preventDefault();
      uploadSinglePatternToHardware(selectedPatternSlot);
    }
  });
}
