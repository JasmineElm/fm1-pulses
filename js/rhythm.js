import {
  state, refs, R, setState, scheduleRegen, getBank, status, onRegen, RATE_NAMES,
  getPrevGateBlend, setPrevGateBlend, DEFAULT, refreshLoopInfo
} from "./state.js";
import {
  euclid, classicName, quantize, midiName
} from "./generator.js";
import { renderBuffer, onBufferRender, selectStep, getEditStep } from "./grid.js?v=251";
import { onStep } from "./player.js";

// Classic Euclidean Rhythm Presets (N hits over M steps with optional rotation)
export const EUCLID_PRESETS = [
  { id: "custom", name: "Euclidean Presets…" },
  { id: "3,8", name: "Tresillo — E(3,8)", n: 3, m: 8, rot: 0 },
  { id: "5,8", name: "Cinquillo — E(5,8)", n: 5, m: 8, rot: 0 },
  { id: "5,16", name: "Son Clave — E(5,16)", n: 5, m: 16, rot: 0 },
  { id: "5,16,3", name: "Rumba Clave — E(5,16 rot 3)", n: 5, m: 16, rot: 3 },
  { id: "5,16,1", name: "Bossa Nova — E(5,16 rot 1)", n: 5, m: 16, rot: 1 },
  { id: "7,16", name: "Soukous — E(7,16)", n: 7, m: 16, rot: 0 },
  { id: "7,16,2", name: "Samba — E(7,16 rot 2)", n: 7, m: 16, rot: 2 },
  { id: "4,16", name: "Gahu — E(4,16)", n: 4, m: 16, rot: 0 },
  { id: "9,16", name: "Aksak — E(9,16)", n: 9, m: 16, rot: 0 },
  { id: "7,12", name: "Bembé — E(7,12)", n: 7, m: 12, rot: 0 },
  { id: "11,16", name: "11/16 Balkan — E(11,16)", n: 11, m: 16, rot: 0 },
];

// Quick Genre & Metric Rhythm Templates
export const GENRE_PRESETS = [
  { id: "", name: "Rhythm Preset…" },
  { id: "four-floor", name: "Four on the Floor (1/4)", fn: (i) => i % 4 === 0 },
  { id: "eighths", name: "Straight Eighths (1/8)", fn: (i) => i % 2 === 0 },
  { id: "offbeats", name: "Offbeats / Upbeats", fn: (i) => i % 4 === 2 },
  { id: "dotted", name: "Dotted 3/16 Pulse", fn: (i) => i % 3 === 0 },
  { id: "charleston", name: "Charleston Groove", fn: (i) => (i % 8 === 0 || i % 8 === 3) },
  { id: "half-time", name: "Half-Time Accent", fn: (i) => i % 8 === 0 },
  { id: "syncopated", name: "Syncopated Clave", fn: (i) => [0, 3, 6, 10, 12].includes(i % 16) }
];

let stepButtons = []; // Cached array of 64 button DOM elements
let rotOffset = 0;
let lastPlayheadStep = null;
let badgeEl = null;
let rotDisplayEl = null;
let euclidHitsInput = null;
let euclidDivSelect = null;

/**
 * Creates a default note for an activated step if none exists.
 */
function getDefaultNoteForStep(stepIndex) {
  const root = state.root ?? 48;
  const scale = state.scale ?? "pentatonicMinor";
  const offset = state.lfoOffset ?? 0;
  return quantize(Math.max(0, Math.min(127, root + offset)), scale, root);
}

/**
 * Synchronizes the 16x4 step button grid with the current pattern in bank[0].
 */
export function syncRhythmGrid() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  let activeHits = 0;

  for (let i = 0; i < 64; i++) {
    const btn = stepButtons[i];
    if (!btn) continue;

    const st = p.steps[i];
    const isWithinLen = i < seqLen;
    const hasNotes = isWithinLen && st && st.notes && st.notes.length > 0;

    if (hasNotes) activeHits++;

    btn.classList.toggle("is-active", !!hasNotes);
    btn.classList.toggle("is-off-length", !isWithinLen);
    btn.classList.toggle("is-edit", i === getEditStep());

    const noteEl = btn.querySelector(".r-step-note");
    const velBarEl = btn.querySelector(".r-step-vel-bar");

    if (hasNotes) {
      const n0 = st.notes[0];
      const vel = Math.max(1, Math.min(127, n0.vel ?? 100));
      // Opacity scales continuously from 0.25 (vel 1) to 1.0 (vel 127), exactly matching traditional grid
      const alpha = 0.25 + 0.75 * (vel / 127);
      const velPct = Math.round((vel / 127) * 100);

      btn.style.setProperty("--vel-alpha", alpha.toFixed(3));

      if (noteEl) {
        noteEl.textContent = midiName(n0.note);
      }
      if (velBarEl) {
        velBarEl.style.width = `${velPct}%`;
      }
      btn.title = `Step ${i + 1}: ${st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ")}`;
    } else {
      btn.style.removeProperty("--vel-alpha");

      if (noteEl) {
        noteEl.textContent = "";
      }
      if (velBarEl) {
        velBarEl.style.width = "0%";
      }
      btn.title = `Step ${i + 1}`;
    }
  }

  if (badgeEl) {
    const pct = Math.round((activeHits / seqLen) * 100);
    badgeEl.textContent = `${activeHits} / ${seqLen} hits (${pct}%)`;
  }

  if (rotDisplayEl) {
    rotDisplayEl.textContent = rotOffset > 0 ? `+${rotOffset}` : `${rotOffset}`;
  }
}

/**
 * Toggles a single step gate on or off.
 */
export function toggleStepGate(stepIndex) {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps[stepIndex]) return;

  const st = p.steps[stepIndex];
  const hasNotes = st.notes && st.notes.length > 0;

  if (hasNotes) {
    st._savedNote = { ...st.notes[0] };
    st.notes = [];
    status(`Step ${stepIndex + 1} trigger off`);
  } else {
    let noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(stepIndex);
    const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
    st.notes = [{ note: Math.max(0, Math.min(127, noteVal)), vel: Math.max(1, Math.min(127, vel)) }];
    delete st.echo;
    status(`Step ${stepIndex + 1} trigger on (${midiName(noteVal)} v${vel})`);
  }

  syncRhythmGrid();
  renderBuffer();
}

/**
 * Applies a Euclidean pattern across all steps up to pattern length.
 */
export function applyEuclidPattern(hits, div, rot = 0) {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const N = Math.max(0, Math.min(div, hits));
  const M = Math.max(2, Math.min(64, div));
  let mask = euclid(N, M);

  const effRot = ((rot % M) + M) % M;
  if (effRot > 0) {
    mask = [...mask.slice(effRot), ...mask.slice(0, effRot)];
  }

  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  for (let i = 0; i < seqLen; i++) {
    const isHit = mask[i % M] === 1;
    const st = p.steps[i];
    if (isHit) {
      if (!st.notes || st.notes.length === 0) {
        const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
        const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
        st.notes = [{ note: noteVal, vel }];
      }
    } else {
      if (st.notes && st.notes.length > 0) {
        st._savedNote = { ...st.notes[0] };
        st.notes = [];
      }
    }
    delete st.echo;
  }

  syncRhythmGrid();
  renderBuffer();
  const classic = classicName(N, M);
  status(`Applied Euclid E(${N},${M})${classic ? ` [${classic}]` : ""}${effRot ? ` rot ${effRot}` : ""}`, "ok");
}

/**
 * Applies the currently active Euclidean mode ("hits" or "div") across sequence steps.
 * In "hits" mode: activates a step every n steps.
 * In "div" mode: activates a step every (sequence length)/div.
 * Mutually exclusive: changing or selecting one does not affect the other.
 */
export function applyActiveEuclidRhythm() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  const mode = state.euclidMode || "hits";
  const rot = ((state.euclidRot ?? 0) % seqLen + seqLen) % seqLen;

  let mask = new Array(seqLen).fill(0);

  if (mode === "hits") {
    // Hits mode: activates a step every n steps
    const n = Math.max(1, Math.min(64, Math.round(Number(state.euclidHits) || 4)));
    for (let i = 0; i < seqLen; i++) {
      if (((i - rot) % n + n) % n === 0) {
        mask[i] = 1;
      }
    }
    const hitCount = mask.filter((x) => x === 1).length;
    status(`Hits mode: step every ${n} steps (${hitCount}/${seqLen} active)${rot ? ` rot ${rot}` : ""}`);
  } else {
    // Div mode: activates a step every (sequence length)/div
    const div = Math.max(1, Math.min(64, Math.round(Number(state.euclidDiv) || 16)));
    const baseMask = euclid(div, seqLen);
    for (let i = 0; i < seqLen; i++) {
      mask[i] = baseMask[(i - rot + seqLen * 100) % seqLen];
    }
    const hitCount = mask.filter((x) => x === 1).length;
    status(`Div mode: ${div} divisions across ${seqLen} steps (${hitCount} active)${rot ? ` rot ${rot}` : ""}`);
  }

  for (let i = 0; i < seqLen; i++) {
    const isHit = mask[i] === 1;
    const st = p.steps[i];
    if (isHit) {
      if (!st.notes || st.notes.length === 0) {
        const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
        const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
        st.notes = [{ note: noteVal, vel }];
      }
    } else {
      if (st.notes && st.notes.length > 0) {
        st._savedNote = { ...st.notes[0] };
        st.notes = [];
      }
    }
    delete st.echo;
  }

  syncRhythmGrid();
  renderBuffer();
  refreshLoopInfo();
}

/**
 * Applies a metric / genre rhythm preset.
 */
export function applyGenrePreset(presetId) {
  const preset = GENRE_PRESETS.find((p) => p.id === presetId);
  if (!preset || !preset.fn) return;

  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  for (let i = 0; i < seqLen; i++) {
    const isHit = preset.fn(i);
    const st = p.steps[i];
    if (isHit) {
      if (!st.notes || st.notes.length === 0) {
        const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
        const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
        st.notes = [{ note: noteVal, vel }];
      }
    } else {
      if (st.notes && st.notes.length > 0) {
        st._savedNote = { ...st.notes[0] };
        st.notes = [];
      }
    }
    delete st.echo;
  }

  syncRhythmGrid();
  renderBuffer();
  status(`Applied rhythm preset: ${preset.name}`, "ok");
}

/**
 * Rotates the rhythm pattern steps left (-1) or right (+1) cyclically.
 */
export function rotatePattern(direction) {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const L = Math.max(1, Math.min(64, state.length || 64));
  if (L <= 1) return;

  if (direction > 0) {
    // Rotate Right (shift forward)
    const lastNotes = p.steps[L - 1].notes;
    const lastSaved = p.steps[L - 1]._savedNote;
    for (let i = L - 1; i > 0; i--) {
      p.steps[i].notes = p.steps[i - 1].notes;
      p.steps[i]._savedNote = p.steps[i - 1]._savedNote;
    }
    p.steps[0].notes = lastNotes;
    p.steps[0]._savedNote = lastSaved;
    rotOffset = (rotOffset + 1) % L;
  } else {
    // Rotate Left (shift backward)
    const firstNotes = p.steps[0].notes;
    const firstSaved = p.steps[0]._savedNote;
    for (let i = 0; i < L - 1; i++) {
      p.steps[i].notes = p.steps[i + 1].notes;
      p.steps[i]._savedNote = p.steps[i + 1]._savedNote;
    }
    p.steps[L - 1].notes = firstNotes;
    p.steps[L - 1]._savedNote = firstSaved;
    rotOffset = (rotOffset - 1 + L) % L;
  }

  syncRhythmGrid();
  renderBuffer();
  state.euclidRot = ((rotOffset % 16) + 16) % 16;
  if (rotDisplayEl) {
    rotDisplayEl.textContent = rotOffset > 0 ? `+${rotOffset}` : `${rotOffset}`;
  }
  refreshLoopInfo();
  status(`Rotated rhythm ${direction > 0 ? "right (+1)" : "left (-1)"} · shift ${rotOffset}`);
}

/**
 * Sets all steps within pattern length to ON.
 */
export function setAllGatesOn() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const L = Math.max(1, Math.min(64, state.length || 64));
  for (let i = 0; i < L; i++) {
    const st = p.steps[i];
    if (!st.notes || st.notes.length === 0) {
      const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
      const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
      st.notes = [{ note: noteVal, vel }];
    }
  }

  syncRhythmGrid();
  renderBuffer();
  status(`All ${L} steps set to ON`);
}

/**
 * Sets all steps to OFF (clears all gates).
 */
export function setAllGatesOff() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const L = Math.max(1, Math.min(64, state.length || 64));
  for (let i = 0; i < L; i++) {
    const st = p.steps[i];
    if (st.notes && st.notes.length > 0) {
      st._savedNote = { ...st.notes[0] };
      st.notes = [];
    }
  }

  syncRhythmGrid();
  renderBuffer();
  status("All step gates turned OFF");
}

/**
 * Inverts all step gates (ON -> OFF, OFF -> ON).
 */
export function invertGates() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const L = Math.max(1, Math.min(64, state.length || 64));
  for (let i = 0; i < L; i++) {
    const st = p.steps[i];
    if (st.notes && st.notes.length > 0) {
      st._savedNote = { ...st.notes[0] };
      st.notes = [];
    } else {
      const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
      const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
      st.notes = [{ note: noteVal, vel }];
    }
  }

  syncRhythmGrid();
  renderBuffer();
  status("Inverted all step gates");
}

/**
 * Duplicates Bar 1 (steps 1–16) across Bars 2, 3, and 4 (steps 17–64).
 */
export function copyBar1ToAll() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  for (let i = 16; i < 64; i++) {
    const src = p.steps[i % 16];
    p.steps[i].notes = src.notes.map((n) => ({ ...n }));
    if (src._savedNote) p.steps[i]._savedNote = { ...src._savedNote };
  }

  syncRhythmGrid();
  renderBuffer();
  status("Bar 1 (steps 1–16) duplicated across all bars", "ok");
}

/**
 * Stochastically randomizes gates using current density.
 */
export function randomizeGates() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  const L = Math.max(1, Math.min(64, state.length || 64));
  const prob = (state.gateProb ?? 70) / 100;

  for (let i = 0; i < L; i++) {
    const st = p.steps[i];
    const isHit = Math.random() < prob;
    if (isHit) {
      if (!st.notes || st.notes.length === 0) {
        const noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(i);
        const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
        st.notes = [{ note: noteVal, vel }];
      }
    } else {
      if (st.notes && st.notes.length > 0) {
        st._savedNote = { ...st.notes[0] };
        st.notes = [];
      }
    }
  }

  syncRhythmGrid();
  renderBuffer();
  status(`Randomized gates (density ${Math.round(prob * 100)}%)`);
}

/**
 * Fully randomises the rhythm pattern (density, Euclidean parameters or presets, and gates).
 */
export function randomizeRhythm() {
  const bank = getBank();
  const p = bank[0];
  if (!p || !p.steps) return;

  // 1. Pick a random musical density between 35% and 75%
  const density = Math.floor(Math.random() * 41) + 35;
  state.gateProb = density;
  if (refs.gateProb?.setValue) refs.gateProb.setValue(density);

  // 2. Decide style: 65% Euclidean rhythm preset/division, 35% stochastic/density pattern
  const useEuclid = Math.random() < 0.65;

  if (useEuclid) {
    const validPresets = EUCLID_PRESETS.slice(1);
    const chosen = validPresets[Math.floor(Math.random() * validPresets.length)];
    const rot = Math.floor(Math.random() * chosen.m);
    rotOffset = rot;
    state.euclidRot = rot;
    state.euclidDiv = String(chosen.m);
    state.gateBlend = 100;
    if (refs.euclidRot?.setValue) refs.euclidRot.setValue(rot);
    if (refs.euclidDiv?.setValue) refs.euclidDiv.setValue(chosen.m);
    if (refs.gateBlend?.setValue) refs.gateBlend.setValue(100);
    if (rotDisplayEl) rotDisplayEl.textContent = rot > 0 ? `+${rot}` : `${rot}`;
    if (euclidHitsInput) euclidHitsInput.value = String(chosen.n);
    if (euclidDivSelect) euclidDivSelect.value = String(chosen.m);
    applyEuclidPattern(chosen.n, chosen.m, rot);
  } else {
    rotOffset = 0;
    state.euclidRot = 0;
    state.gateBlend = 0;
    if (refs.gateBlend?.setValue) refs.gateBlend.setValue(0);
    if (refs.euclidRot?.setValue) refs.euclidRot.setValue(0);
    if (rotDisplayEl) rotDisplayEl.textContent = "0";
    randomizeGates();
    // 50% chance to repeat Bar 1 across all 4 bars for coherent rhythmic phrasing
    if (Math.random() < 0.5) {
      copyBar1ToAll();
    }
  }

  syncRhythmGrid();
  renderBuffer();
}

/**
 * Highlights the running playhead on the 16x4 grid.
 */
export function highlightPlayhead(stepIndex) {
  if (lastPlayheadStep !== null && stepButtons[lastPlayheadStep]) {
    stepButtons[lastPlayheadStep].classList.remove("now");
  }

  if (stepIndex !== null && stepButtons[stepIndex]) {
    stepButtons[stepIndex].classList.add("now");
    lastPlayheadStep = stepIndex;
  } else {
    lastPlayheadStep = null;
  }
}

/**
 * Initializes and builds the full-width Rhythm section DOM.
 */
export function initRhythm(containerEl, sequenceContainerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  stepButtons = [];
  rotOffset = 0;

  // 1. Header & Toolbar
  const header = document.createElement("div");
  header.className = "rhythm-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "rhythm-title-wrap";
  const h3 = document.createElement("h3");
  h3.textContent = "Rhythm";
  badgeEl = document.createElement("span");
  badgeEl.className = "rhythm-badge";
  badgeEl.id = "rhythm-badge";
  badgeEl.textContent = "0 / 64 hits";
  titleWrap.append(h3, badgeEl);

  const toolbar = document.createElement("div");
  toolbar.className = "rhythm-toolbar";

  // --- Euclid Controls ---
  // --- Euclid Controls ---
  const euclidGroup = document.createElement("div");
  euclidGroup.className = "rhythm-tool-group";

  const euclidLabel = document.createElement("span");
  euclidLabel.className = "rhythm-tool-label";
  euclidLabel.textContent = "Euclid";

  const euclidSelect = document.createElement("select");
  euclidSelect.className = "rhythm-select rhythm-preset-select";
  euclidSelect.title = "Select rhythm preset (Euclidean rhythm or Groove pattern)";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "custom";
  defaultOpt.textContent = "Euclid Presets…";
  euclidSelect.appendChild(defaultOpt);

  const eucOptGroup = document.createElement("optgroup");
  eucOptGroup.label = "Euclidean";
  for (const ep of EUCLID_PRESETS) {
    if (ep.id === "custom") continue;
    const opt = document.createElement("option");
    opt.value = ep.id;
    opt.textContent = ep.name;
    eucOptGroup.appendChild(opt);
  }
  euclidSelect.appendChild(eucOptGroup);

  const patternOptGroup = document.createElement("optgroup");
  patternOptGroup.label = "Patterns";
  for (const gp of GENRE_PRESETS) {
    if (!gp.id) continue;
    const opt = document.createElement("option");
    opt.value = gp.id;
    opt.textContent = gp.name;
    patternOptGroup.appendChild(opt);
  }
  euclidSelect.appendChild(patternOptGroup);

  const euclidInputsWrap = document.createElement("div");
  euclidInputsWrap.className = "rhythm-euclid-inputs";

  // Mode Toggle: switch between "Hits" and "Div"
  // "Hits" activates a step every n steps.
  // "Div" activates a step every (sequence length)/div.
  // Mutually exclusive: changing or setting one does not affect the other.
  state.euclidMode = state.euclidMode || "hits";
  state.euclidHits = state.euclidHits || 4;
  state.euclidDiv = (state.euclidDiv && state.euclidDiv !== "auto") ? String(state.euclidDiv) : "16";

  const modeToggleWrap = document.createElement("div");
  modeToggleWrap.className = "rhythm-toggle-group";
  modeToggleWrap.setAttribute("role", "radiogroup");
  modeToggleWrap.setAttribute("aria-label", "Euclidean parameter toggle");

  const btnHits = document.createElement("button");
  btnHits.type = "button";
  btnHits.className = `rhythm-toggle-btn${state.euclidMode === "hits" ? " is-active" : ""}`;
  btnHits.textContent = "Hits";
  btnHits.title = "Hits mode: activate a step every n steps";
  btnHits.setAttribute("role", "radio");
  btnHits.setAttribute("aria-checked", state.euclidMode === "hits" ? "true" : "false");

  const btnDiv = document.createElement("button");
  btnDiv.type = "button";
  btnDiv.className = `rhythm-toggle-btn${state.euclidMode === "div" ? " is-active" : ""}`;
  btnDiv.textContent = "Div";
  btnDiv.title = "Div mode: activate a step every (sequence length)/div steps";
  btnDiv.setAttribute("role", "radio");
  btnDiv.setAttribute("aria-checked", state.euclidMode === "div" ? "true" : "false");

  modeToggleWrap.append(btnHits, btnDiv);

  euclidHitsInput = document.createElement("input");
  euclidHitsInput.type = "number";
  euclidHitsInput.className = "rhythm-num-input";
  euclidHitsInput.min = "1";
  euclidHitsInput.max = "64";
  euclidHitsInput.step = "1";
  euclidHitsInput.value = String(state.euclidHits);
  euclidHitsInput.title = "Step interval: activates a step every n steps";

  const hitsWrap = document.createElement("div");
  hitsWrap.className = "rhythm-mode-input-wrap";
  hitsWrap.style.display = state.euclidMode === "hits" ? "inline-flex" : "none";
  hitsWrap.appendChild(euclidHitsInput);

  euclidDivSelect = document.createElement("select");
  euclidDivSelect.className = "rhythm-select-sm";
  euclidDivSelect.title = "Sequence division: activates a step every (sequence length)/div steps";
  const divOptions = [
    { v: "2", t: "2" },
    { v: "3", t: "3" },
    { v: "4", t: "4" },
    { v: "5", t: "5" },
    { v: "6", t: "6" },
    { v: "7", t: "7" },
    { v: "8", t: "8" },
    { v: "12", t: "12" },
    { v: "16", t: "16" },
    { v: "24", t: "24" },
    { v: "32", t: "32" },
    { v: "64", t: "64" },
  ];
  for (const d of divOptions) {
    const opt = document.createElement("option");
    opt.value = d.v;
    opt.textContent = d.t;
    if (String(state.euclidDiv) === d.v) opt.selected = true;
    euclidDivSelect.appendChild(opt);
  }

  const divWrap = document.createElement("div");
  divWrap.className = "rhythm-mode-input-wrap";
  divWrap.style.display = state.euclidMode === "div" ? "inline-flex" : "none";
  divWrap.appendChild(euclidDivSelect);

  function setEuclidMode(mode, apply = true) {
    state.euclidMode = mode;
    const isHits = mode === "hits";
    btnHits.classList.toggle("is-active", isHits);
    btnHits.setAttribute("aria-checked", isHits ? "true" : "false");
    btnDiv.classList.toggle("is-active", !isHits);
    btnDiv.setAttribute("aria-checked", !isHits ? "true" : "false");
    hitsWrap.style.display = isHits ? "inline-flex" : "none";
    divWrap.style.display = !isHits ? "inline-flex" : "none";
    if (apply) {
      applyActiveEuclidRhythm();
    }
  }

  btnHits.addEventListener("click", () => setEuclidMode("hits", true));
  btnDiv.addEventListener("click", () => setEuclidMode("div", true));

  const blendLabel = document.createElement("label");
  blendLabel.title = "Euclidean blend: 0% = random placement, 100% = even Euclidean spacing";
  blendLabel.textContent = "Blend ";
  const blendInput = document.createElement("input");
  blendInput.type = "range";
  blendInput.min = "0";
  blendInput.max = "100";
  blendInput.value = String(state.gateBlend ?? 0);
  blendInput.className = "rhythm-slider";

  const blendVal = document.createElement("span");
  blendVal.className = "rhythm-val";
  blendVal.textContent = `${Math.round(state.gateBlend ?? 0)}%`;

  blendLabel.append(blendInput, blendVal);

  euclidHitsInput.addEventListener("input", (e) => {
    const n = Math.max(1, Math.min(64, parseInt(e.target.value, 10) || 1));
    state.euclidHits = n;
    // Mutually exclusive: does NOT affect state.euclidDiv or euclidDivSelect
    if (state.euclidMode === "hits") {
      applyActiveEuclidRhythm();
    }
  });

  euclidDivSelect.addEventListener("change", (e) => {
    state.euclidDiv = e.target.value;
    // Mutually exclusive: does NOT affect state.euclidHits or euclidHitsInput
    if (state.euclidMode === "div") {
      applyActiveEuclidRhythm();
    }
  });

  blendInput.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    state.gateBlend = v;
    if (v > 0) setPrevGateBlend(v);
    blendVal.textContent = `${Math.round(v)}%`;
    refreshLoopInfo();
    scheduleRegen();
  });

  euclidSelect.addEventListener("change", () => {
    const val = euclidSelect.value;
    if (val === "custom" || !val) return;

    const preset = EUCLID_PRESETS.find((p) => p.id === val);
    if (preset && preset.n !== undefined) {
      state.gateBlend = 100;
      blendInput.value = "100";
      blendVal.textContent = "100%";
      rotOffset = preset.rot || 0;
      state.euclidRot = rotOffset;
      if (rotDisplayEl) rotDisplayEl.textContent = rotOffset > 0 ? `+${rotOffset}` : `${rotOffset}`;
      applyEuclidPattern(preset.n, preset.m, preset.rot || 0);
      refreshLoopInfo();
      return;
    }

    const genre = GENRE_PRESETS.find((p) => p.id === val);
    if (genre && genre.fn) {
      applyGenrePreset(genre.id);
      refreshLoopInfo();
    }
  });

  euclidInputsWrap.append(modeToggleWrap, hitsWrap, divWrap, blendLabel);
  euclidGroup.append(euclidLabel, euclidSelect, euclidInputsWrap);

  // Register refs for synchronization
  R("euclidMode", {
    setValue: (v) => setEuclidMode(v, false),
    get value() { return state.euclidMode; }
  });

  R("euclidHits", {
    setValue: (v) => {
      state.euclidHits = Math.max(1, Math.min(64, parseInt(v, 10) || 4));
      if (euclidHitsInput) euclidHitsInput.value = String(state.euclidHits);
    },
    get value() { return state.euclidHits; }
  });

  R("euclidDiv", {
    setValue: (v) => {
      state.euclidDiv = String(v);
      if (euclidDivSelect) euclidDivSelect.value = String(v);
    },
    get value() { return state.euclidDiv; }
  });

  R("gateBlend", {
    setValue: (v) => {
      state.gateBlend = Number(v) || 0;
      blendInput.value = String(state.gateBlend);
      blendVal.textContent = `${Math.round(state.gateBlend)}%`;
    },
    setCheckbox: () => {},
    get value() { return state.gateBlend; }
  });

  R("euclidRot", {
    setValue: (v) => {
      rotOffset = Number(v) || 0;
      state.euclidRot = rotOffset;
      if (rotDisplayEl) rotDisplayEl.textContent = rotOffset > 0 ? `+${rotOffset}` : `${rotOffset}`;
    },
    get value() { return state.euclidRot; }
  });

  R("gateQuant", {
    setValue: (v) => {
      state.gateQuant = Number(v) || 0;
    },
    get value() { return state.gateQuant; }
  });

  R("snapGrid", {
    setValue: (v) => {
      state.snapGrid = Number(v) || 4;
    },
    get value() { return state.snapGrid; }
  });


  // --- Rotate Controls ---
  const rotGroup = document.createElement("div");
  rotGroup.className = "rhythm-tool-group";
  const rotLabel = document.createElement("span");
  rotLabel.className = "rhythm-tool-label";
  rotLabel.textContent = "Rotate";

  const rotBtnGroup = document.createElement("div");
  rotBtnGroup.className = "rhythm-btn-group";

  const rotLeftBtn = document.createElement("button");
  rotLeftBtn.className = "rhythm-btn";
  rotLeftBtn.title = "Rotate pattern 1 step left (earlier)";
  rotLeftBtn.textContent = "◀ Rot";
  rotLeftBtn.addEventListener("click", () => rotatePattern(-1));

  rotDisplayEl = document.createElement("span");
  rotDisplayEl.className = "rhythm-rot-display";
  rotDisplayEl.textContent = "0";

  const rotRightBtn = document.createElement("button");
  rotRightBtn.className = "rhythm-btn";
  rotRightBtn.title = "Rotate pattern 1 step right (later)";
  rotRightBtn.textContent = "Rot ▶";
  rotRightBtn.addEventListener("click", () => rotatePattern(1));

  rotBtnGroup.append(rotLeftBtn, rotDisplayEl, rotRightBtn);
  rotGroup.append(rotLabel, rotBtnGroup);

  // --- Batch Controls ---
  const batchGroup = document.createElement("div");
  batchGroup.className = "rhythm-tool-group";
  const batchLabel = document.createElement("span");
  batchLabel.className = "rhythm-tool-label";
  batchLabel.textContent = "Steps";

  const batchBtnGroup = document.createElement("div");
  batchBtnGroup.className = "rhythm-btn-group";

  const allOnBtn = document.createElement("button");
  allOnBtn.className = "rhythm-btn";
  allOnBtn.title = "Turn all step gates ON";
  allOnBtn.textContent = "All On";
  allOnBtn.addEventListener("click", setAllGatesOn);

  const allOffBtn = document.createElement("button");
  allOffBtn.className = "rhythm-btn";
  allOffBtn.title = "Turn all step gates OFF (clear pattern gates)";
  allOffBtn.textContent = "All Off";
  allOffBtn.addEventListener("click", setAllGatesOff);

  const invertBtn = document.createElement("button");
  invertBtn.className = "rhythm-btn";
  invertBtn.title = "Invert all step gates (flip on/off)";
  invertBtn.textContent = "Invert";
  invertBtn.addEventListener("click", invertGates);

  const copyBar1Btn = document.createElement("button");
  copyBar1Btn.className = "rhythm-btn";
  copyBar1Btn.title = "Duplicate Bar 1 (steps 1–16) across Bars 2, 3, and 4";
  copyBar1Btn.textContent = "Bar 1 → All";
  copyBar1Btn.addEventListener("click", copyBar1ToAll);

  const randomBtn = document.createElement("button");
  randomBtn.className = "rhythm-btn";
  randomBtn.title = "Randomize gates using density probability";
  randomBtn.textContent = "Random";
  randomBtn.addEventListener("click", randomizeGates);

  batchBtnGroup.append(allOnBtn, allOffBtn, invertBtn, copyBar1Btn, randomBtn);
  batchGroup.append(batchLabel, batchBtnGroup);

  toolbar.append(euclidGroup, rotGroup, batchGroup);
  header.append(titleWrap, toolbar);

  // 2. 16x4 Step Buttons Grid
  const gridContainer = document.createElement("div");
  gridContainer.className = "rhythm-grid-container";
  gridContainer.id = "rhythm-grid-container";

  for (let bar = 0; bar < 4; bar++) {
    const row = document.createElement("div");
    row.className = "rhythm-row";

    // Row Steps (16 buttons)
    const stepsWrap = document.createElement("div");
    stepsWrap.className = "rhythm-row-steps";

    for (let s = 0; s < 16; s++) {
      const stepIdx = bar * 16 + s;
      const isDownbeat = s % 4 === 0;

      const btn = document.createElement("button");
      btn.className = "rhythm-step-btn" + (isDownbeat ? " is-downbeat" : "");
      btn.dataset.step = String(stepIdx);
      btn.title = `Step ${stepIdx + 1}`;

      const btnHeader = document.createElement("div");
      btnHeader.className = "r-step-header";

      const numSpan = document.createElement("span");
      numSpan.className = "r-step-num";
      numSpan.textContent = String(stepIdx + 1);

      btnHeader.appendChild(numSpan);

      const noteSpan = document.createElement("span");
      noteSpan.className = "r-step-note";

      const velWrap = document.createElement("div");
      velWrap.className = "r-step-vel-wrap";
      velWrap.setAttribute("aria-hidden", "true");

      const velBar = document.createElement("span");
      velBar.className = "r-step-vel-bar";
      velWrap.appendChild(velBar);

      btn.append(btnHeader, noteSpan, velWrap);

      btn.addEventListener("click", () => {
        selectStep(stepIdx);
        toggleStepGate(stepIdx);
      });

      stepButtons.push(btn);
      stepsWrap.appendChild(btn);
    }

    row.appendChild(stepsWrap);
    gridContainer.appendChild(row);
  }

  const seqContainer = sequenceContainerEl || document.getElementById("sequence");
  if (seqContainer) {
    seqContainer.innerHTML = "";
    const seqHeader = document.createElement("h3");
    seqHeader.textContent = "Sequence";
    seqContainer.append(seqHeader, gridContainer);
    containerEl.append(header);
  } else {
    containerEl.append(header, gridContainer);
  }

  // Hook Step Clock for live playhead tracking
  onStep((stepIndex) => {
    highlightPlayhead(stepIndex);
  });

  // Hook regeneration to sync grid
  onRegen(() => {
    syncRhythmGrid();
  });

  // Hook buffer rendering from step editor to sync grid
  onBufferRender(() => {
    syncRhythmGrid();
  });

  // Initial sync
  syncRhythmGrid();
}
