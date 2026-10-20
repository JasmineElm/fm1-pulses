// scale.js — Unified Musical Scale & Root Note/Octave management for FM-1 Pulses.
import { SCALES, NOTE_NAMES, midiName, quantize } from "./generator.js";
import { state, refs, R, status } from "./state.js";
import { dropdown, fader } from "./controls.js";

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

export const PITCH_SPAN_OPTIONS = [
  { v: "1", t: "1 Octave" },
  { v: "2", t: "2 Octaves" },
  { v: "3", t: "3 Octaves" },
  { v: "4", t: "4 Octaves" }
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
 * Resolves the active scale interval array.
 */
export function getActiveScaleIntervals(scaleName = state.scale, customScale = state.customScale) {
  if (scaleName === "custom" && Array.isArray(customScale) && customScale.length > 0) {
    return customScale;
  }
  return SCALES[scaleName] || SCALES.pentMinor;
}

/**
 * Returns the effective root MIDI note number (0..127).
 */
export function getRootMidi() {
  if (typeof state.root === "number") return state.root;
  const note = Number(state.rootNote ?? 0) || 0;
  const oct = typeof state.rootOctave === "number" ? state.rootOctave : 3;
  return (oct + 1) * 12 + note;
}

/**
 * Computes an octave shift (in semitones) given an octave chance and mode.
 * @param {number} octChance - 0..1 probability of octave shift
 * @param {string} mode - "up", "down", or "both"
 * @param {Function} rng - Random number generator returning [0, 1)
 * @returns {number} - 0, 12, or -12 semitones
 */
export function computeOctaveShift(octChance = 0, mode = "up", rng = Math.random) {
  if (octChance <= 0 || rng() >= octChance) return 0;
  const m = (mode || "up").toLowerCase();
  if (m === "down") return -12;
  if (m === "both") return rng() < 0.5 ? 12 : -12;
  return 12; // "up"
}

/**
 * Unified note mapper from normalized continuous pitch [0..1] to a scale-quantized MIDI note.
 */
export function mapNormalizedToNote({
  norm = 0,
  root = getRootMidi(),
  scale = getActiveScaleIntervals(),
  octaveSpread = Number(state.pitchSpan || 2),
  spreadDirection = state.octaveMode || "up",
  octChance = ((state.octave ?? 0) / 100),
  quantStrength = ((state.quantSteps ?? 100) / 100),
  rng = Math.random
} = {}) {
  const clampedNorm = Math.max(0, Math.min(1, Number(norm) || 0));
  const spanSemitones = Math.max(1, octaveSpread) * 12;
  const intervals = Array.isArray(scale) && scale.length > 0 ? scale : getActiveScaleIntervals(scale);

  // Calculate raw pitch base according to Spread Direction
  let rawPitch;
  const dir = (spreadDirection || "up").toLowerCase();
  if (dir === "down") {
    rawPitch = root - (clampedNorm * spanSemitones);
  } else if (dir === "both") {
    rawPitch = root + ((clampedNorm - 0.5) * spanSemitones);
  } else {
    // "up" (default)
    rawPitch = root + (clampedNorm * spanSemitones);
  }

  // Apply scale quantization
  let note = quantize(rawPitch, intervals, root, quantStrength, rng);

  // Apply octave jump if configured
  const shift = computeOctaveShift(octChance, dir, rng);
  if (shift !== 0 && note + shift >= 0 && note + shift <= 127) {
    note += shift;
  }

  return Math.max(0, Math.min(127, Math.round(note)));
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

    if (refs[rootNoteKey]?.setValue && state[rootNoteKey] !== undefined) {
      refs[rootNoteKey].setValue(String(state[rootNoteKey]), false);
    }
    if (refs[rootOctaveKey]?.setValue && state[rootOctaveKey] !== undefined) {
      refs[rootOctaveKey].setValue(String(state[rootOctaveKey]), false);
    }
    if (refs[scaleKey]?.setValue && state[scaleKey] !== undefined) {
      refs[scaleKey].setValue(state[scaleKey], false);
    }

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

/**
 * Creates the complete, unified 'Notes' div component for any sequencer model.
 * Contains:
 * + Root Note
 * + Root Octave
 * + Scale DropDown
 * + Note Selection
 * + Quantize
 * + Octave spread (Fader + Mode Dropdown)
 */
export function createNotesSection({
  container = null,
  title = "Notes",
  scaleKey = "scale",
  customScaleKey = "customScale",
  rootKey = "root",
  rootNoteKey = "rootNote",
  rootOctaveKey = "rootOctave",
  pitchSpanKey = "pitchSpan",
  quantKey = "quantSteps",
  octaveKey = "octave",
  octaveModeKey = "octaveMode",
  defaultOctave = 4,
  defaultPitchSpan = 3,
  scaleLabel = "Scale",
  isFullWidth = false,
  badgeText = "Key & Scale",
  onChange = () => {}
} = {}) {
  const picker = createScalePicker({
    scaleKey,
    customScaleKey,
    rootKey,
    rootNoteKey,
    rootOctaveKey,
    defaultOctave,
    scaleLabel,
    onChange
  });

  // Octave Spread Dropdown (formerly Pitch Span)
  const pitchSpanCtrl = R(pitchSpanKey, dropdown({
    label: "Octave Spread",
    options: PITCH_SPAN_OPTIONS,
    value: String(state[pitchSpanKey] ?? defaultPitchSpan),
    onInput: (v) => {
      state[pitchSpanKey] = Number(v);
      onChange();
      status(`Octave Spread: ${v} Octaves`);
    },
    tip: "Total octave width spanned by the note generator or grid (1 to 4 octaves)."
  }));

  // Quantize Fader
  const quantCtrl = R(quantKey, fader({
    label: "Quantize",
    min: 0,
    max: 100,
    value: state[quantKey] ?? 100,
    def: 100,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state[quantKey] = v;
      onChange();
      status(`Quantize: ${Math.round(v)}%`);
    },
    tip: "Scale snap strength: probability notes lock to the chosen scale. 100% = strictly in-key; lower allows raw, out-of-scale chromatic pitches."
  }));

  // Octave Spread Fader
  const octaveCtrl = R(octaveKey, fader({
    label: isFullWidth ? "Octave" : "Octave Spread",
    min: 0,
    max: 100,
    value: state[octaveKey] ?? 0,
    def: 0,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state[octaveKey] = v;
      onChange();
      status(`Octave Spread: ${Math.round(v)}%`);
    },
    tip: "Chance of shifting a note by one octave (Up, Down, or Both)."
  }));

  // Spread Direction Dropdown (formerly Direction)
  const octaveModeCtrl = R(octaveModeKey, dropdown({
    label: "Spread Direction",
    options: [
      { v: "up", t: "Up" },
      { v: "down", t: "Down" },
      { v: "both", t: "Both" }
    ],
    value: state[octaveModeKey] || "up",
    onInput: (v) => {
      state[octaveModeKey] = v;
      onChange();
      status(`Spread Direction: ${v.toUpperCase()}`);
    },
    tip: "Octave spread direction: Up (+12 st), Down (-12 st), or Both (±12 st)."
  }));

  // Container Div titled 'Notes'
  const sectEl = container || document.createElement("div");
  if (!container) sectEl.className = "sect notes-sect";
  sectEl.innerHTML = "";

  const headEl = document.createElement("div");
  headEl.className = "humanise-head notes-head";
  const h = document.createElement("h3");
  h.textContent = title;
  const badge = document.createElement("span");
  badge.textContent = badgeText;
  headEl.append(h, badge);

  const grid = document.createElement("div");
  grid.className = isFullWidth ? "sgrid notes-grid notes-grid-fullwidth" : "sgrid notes-grid";
  if (!isFullWidth) {
    grid.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))";
    sectEl.style.gridColumn = "span 6";
  }

  picker.rootNoteCtrl.classList.add("ctrl-root-note");
  picker.rootOctCtrl.classList.add("ctrl-root-oct");
  pitchSpanCtrl.classList.add("ctrl-pitch-span");
  octaveModeCtrl.classList.add("ctrl-oct-mode");
  picker.scaleCtrl.classList.add("ctrl-scale");
  picker.scaleBox.classList.add("ctrl-scale-box");
  quantCtrl.classList.add("ctrl-quant");
  octaveCtrl.classList.add("ctrl-oct-spread");

  if (!isFullWidth) {
    // Row 1: Root Note (2), Root Octave (2), Octave Spread (2)
    picker.rootNoteCtrl.style.gridColumn = "span 2";
    picker.rootOctCtrl.style.gridColumn = "span 2";
    pitchSpanCtrl.style.gridColumn = "span 2";

    // Row 2: Spread Direction (2), Scale Dropdown (4)
    octaveModeCtrl.style.gridColumn = "span 2";
    picker.scaleCtrl.style.gridColumn = "span 4";

    // Row 3: Note Selection (12 buttons) (6)
    picker.scaleBox.style.gridColumn = "span 6";

    // Row 4: Quantize (3), Octave Spread % (3)
    quantCtrl.style.gridColumn = "span 3";
    octaveCtrl.style.gridColumn = "span 3";

    grid.append(
      picker.rootNoteCtrl,
      picker.rootOctCtrl,
      pitchSpanCtrl,
      octaveModeCtrl,
      picker.scaleCtrl,
      picker.scaleBox,
      quantCtrl,
      octaveCtrl
    );
  } else {
    grid.append(
      picker.rootNoteCtrl,
      picker.rootOctCtrl,
      pitchSpanCtrl,
      octaveModeCtrl,
      picker.scaleCtrl,
      quantCtrl,
      octaveCtrl,
      picker.scaleBox
    );
  }

  sectEl.append(headEl, grid);

  function sync() {
    picker.sync();
    if (refs[pitchSpanKey]?.setValue) refs[pitchSpanKey].setValue(String(state[pitchSpanKey] ?? defaultPitchSpan), false);
    if (refs[quantKey]?.setValue) refs[quantKey].setValue(state[quantKey] ?? 100, false);
    if (refs[octaveKey]?.setValue) refs[octaveKey].setValue(state[octaveKey] ?? 0, false);
    if (refs[octaveModeKey]?.setValue) refs[octaveModeKey].setValue(state[octaveModeKey] || "up", false);
  }

  return {
    sectEl,
    rootNoteCtrl: picker.rootNoteCtrl,
    rootOctCtrl: picker.rootOctCtrl,
    pitchSpanCtrl,
    scaleCtrl: picker.scaleCtrl,
    scaleBox: picker.scaleBox,
    quantCtrl,
    octaveCtrl,
    octaveModeCtrl,
    sync
  };
}
