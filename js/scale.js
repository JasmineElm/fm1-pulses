// scale.js — Unified Musical Scale & Root Note/Octave management for FM-1 Pulses.
import { SCALES, NOTE_NAMES, midiName } from "./generator.js";
import { state, refs, R, status } from "./state.js";
import { dropdown } from "./controls.js";

export const SCALE_LABELS = {
  pentMinor: "Pentatonic Minor",
  pentMajor: "Pentatonic Major",
  minor: "Natural Minor (Aeolian)",
  major: "Major (Ionian)",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
  blues: "Blues",
  harmonicMinor: "Harmonic Minor",
  melodicMinor: "Melodic Minor",
  phrygian: "Phrygian",
  lydian: "Lydian",
  locrian: "Locrian",
  wholeTone: "Whole Tone",
  dimHalfWhole: "Diminished (Half-Whole)",
  dimWholeHalf: "Diminished (Whole-Half)",
  augmented: "Augmented",
  inSen: "In Sen (Japanese)",
  hijaz: "Hijaz (Arabic)",
  chromatic: "Chromatic",
  custom: "Custom (User Defined)"
};

export const ROOT_NOTE_OPTIONS = NOTE_NAMES.map((name, idx) => ({
  v: String(idx),
  t: name
}));

export const ROOT_OCTAVE_OPTIONS = [
  { v: "1", t: "Octave 1" },
  { v: "2", t: "Octave 2" },
  { v: "3", t: "Octave 3" },
  { v: "4", t: "Octave 4" },
  { v: "5", t: "Octave 5" }
];

export function findPredefinedScale(intervals) {
  const target = intervals.join(",");
  for (const [key, ivs] of Object.entries(SCALES)) {
    if (key === "custom") continue;
    if (ivs.length === intervals.length && [...ivs].sort((a, b) => a - b).join(",") === target) {
      return key;
    }
  }
  return null;
}

/**
 * Creates a complete Scale & Root Note/Octave management component.
 * Produces:
 * - rootNoteCtrl: Dropdown for Root Note (C through B)
 * - rootOctCtrl: Dropdown for Root Octave (Octave 1 through 5)
 * - scaleCtrl: Dropdown for Scale Quantize
 * - scaleBox: 12-button horizontal interactive scale note selector (<div class="scale">)
 * - sync(): Synchronizes UI buttons and indicators to current state
 */
export function createScalePicker({
  scaleKey = "scale",
  customScaleKey = "customScale",
  rootKey = "root",
  rootNoteKey = "rootNote",
  rootOctaveKey = "rootOctave",
  defaultOctave = 3,
  scaleLabel = "Scale",
  onChange = () => {}
} = {}) {
  let scaleButtons = [];
  let scaleInfoEl = null;
  let activeNotePcs = new Set();

  function getRootMidi() {
    if (typeof state[rootKey] === "number") return state[rootKey];
    const oct = typeof state[rootOctaveKey] === "number" ? state[rootOctaveKey] : defaultOctave;
    const note = typeof state[rootNoteKey] === "number" ? state[rootNoteKey] : 0;
    return (oct + 1) * 12 + note;
  }

  function sync() {
    const rootMidi = getRootMidi();
    const rootPc = ((rootMidi % 12) + 12) % 12;
    const scaleName = state[scaleKey] || "pentMinor";
    const intervals = (scaleName === "custom" && state[customScaleKey])
      ? state[customScaleKey]
      : (SCALES[scaleName] || SCALES.pentMinor);

    activeNotePcs = new Set(intervals.map((iv) => (rootPc + iv) % 12));

    scaleButtons.forEach((btn, idx) => {
      const isActive = activeNotePcs.has(idx);
      const isRoot = idx === rootPc;
      btn.classList.toggle("active", isActive);
      btn.classList.toggle("is-root", isRoot);
      btn.setAttribute("aria-checked", isActive ? "true" : "false");
      const noteName = NOTE_NAMES[idx];
      btn.title = `${noteName}${isRoot ? " (Root)" : ""}: ${isActive ? "Active in scale (click to exclude)" : "Excluded (click to include)"}`;
    });

    if (scaleInfoEl) {
      const activeSorted = Array.from(activeNotePcs).sort((a, b) => a - b);
      scaleInfoEl.textContent = `${activeNotePcs.size} active: ${activeSorted.map((pc) => NOTE_NAMES[pc]).join(" ")}`;
    }
  }

  function onNoteButtonClick(noteIdx) {
    const rootMidi = getRootMidi();
    const rootPc = ((rootMidi % 12) + 12) % 12;
    if (activeNotePcs.has(noteIdx)) {
      if (activeNotePcs.size <= 1) {
        status("Scale must have at least one note", "err");
        return;
      }
      activeNotePcs.delete(noteIdx);
    } else {
      activeNotePcs.add(noteIdx);
    }

    const intervals = Array.from(activeNotePcs)
      .map((pc) => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b);

    const matched = findPredefinedScale(intervals);
    if (matched) {
      state[scaleKey] = matched;
      if (refs[scaleKey]) refs[scaleKey].setValue(matched);
      status(`Scale: ${SCALE_LABELS[matched] || matched}`);
    } else {
      state[scaleKey] = "custom";
      state[customScaleKey] = intervals;
      SCALES.custom = intervals;
      if (refs[scaleKey]) refs[scaleKey].setValue("custom");
      const activeNames = Array.from(activeNotePcs).sort((a, b) => a - b).map((pc) => NOTE_NAMES[pc]).join(" ");
      status(`Custom Scale: ${activeNames}`);
    }

    sync();
    onChange();
  }

  // Ensure initial state keys are populated
  const curRoot = typeof state[rootKey] === "number" ? state[rootKey] : (defaultOctave + 1) * 12;
  if (state[rootNoteKey] === undefined) state[rootNoteKey] = ((curRoot % 12) + 12) % 12;
  if (state[rootOctaveKey] === undefined) state[rootOctaveKey] = Math.floor(curRoot / 12) - 1;
  state[rootKey] = (state[rootOctaveKey] + 1) * 12 + state[rootNoteKey];

  // 1. Root Note dropdown
  const rootNoteCtrl = R(rootNoteKey, dropdown({
    label: "Root Note",
    options: ROOT_NOTE_OPTIONS,
    value: String(state[rootNoteKey]),
    onInput: (v) => {
      state[rootNoteKey] = Number(v);
      const oct = typeof state[rootOctaveKey] === "number" ? state[rootOctaveKey] : defaultOctave;
      state[rootKey] = (oct + 1) * 12 + state[rootNoteKey];
      sync();
      onChange();
      status(`Root Note: ${midiName(state[rootKey])} (${state[rootKey]})`);
    },
    tip: "Pitch class of the root note (C through B)."
  }));

  // 2. Root Octave dropdown
  const rootOctCtrl = R(rootOctaveKey, dropdown({
    label: "Root Octave",
    options: ROOT_OCTAVE_OPTIONS,
    value: String(state[rootOctaveKey]),
    onInput: (v) => {
      state[rootOctaveKey] = Number(v);
      const noteIdx = typeof state[rootNoteKey] === "number" ? state[rootNoteKey] : 0;
      state[rootKey] = (state[rootOctaveKey] + 1) * 12 + noteIdx;
      onChange();
      status(`Root Octave: Octave ${state[rootOctaveKey]} (${midiName(state[rootKey])})`);
    },
    tip: "Base octave for the root note."
  }));

  // 3. Scale Quantize dropdown
  const scaleCtrl = R(scaleKey, dropdown({
    label: scaleLabel,
    options: Object.keys(SCALES).map((s) => ({
      v: s,
      t: SCALE_LABELS[s] || s
    })),
    value: state[scaleKey] || "pentMinor",
    onInput: (v) => {
      state[scaleKey] = v;
      sync();
      onChange();
      status(`Scale: ${SCALE_LABELS[v] || v}`);
    },
    tip: "Scale for musical pitch quantization."
  }));

  // 4. Scale Notes Programmer (<div class="scale">)
  const scaleBox = document.createElement("div");
  scaleBox.className = "ca-scale-box";

  const scaleHeader = document.createElement("div");
  scaleHeader.className = "ca-scale-header";
  scaleHeader.innerHTML = `
    <span class="ca-scale-title">Scale</span>
    <span class="ca-scale-info"></span>
  `;
  scaleInfoEl = scaleHeader.querySelector(".ca-scale-info");

  const scaleDiv = document.createElement("div");
  scaleDiv.className = "scale";
  scaleDiv.setAttribute("role", "group");
  scaleDiv.setAttribute("aria-label", "Scale Note Quantizer (12 Chromatic Notes)");

  scaleButtons = [];
  NOTE_NAMES.forEach((name, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ca-scale-btn";
    btn.dataset.note = String(idx);
    btn.setAttribute("role", "checkbox");
    btn.innerHTML = `<span class="ca-scale-note">${name}</span>`;
    btn.addEventListener("click", () => onNoteButtonClick(idx));
    scaleDiv.appendChild(btn);
    scaleButtons.push(btn);
  });

  scaleBox.append(scaleHeader, scaleDiv);

  // Initialize button states
  sync();

  return {
    rootNoteCtrl,
    rootOctCtrl,
    scaleCtrl,
    scaleBox,
    scaleDiv,
    sync
  };
}
