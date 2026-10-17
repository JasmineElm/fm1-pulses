// rhythm.js — Full-width Rhythm Controls & 16x4 64-Step Grid Sequencer for FM-1 Pulses.
import {
  state, refs, getBank, status, onRegen, RATE_NAMES
} from "./state.js";
import {
  euclid, classicName, quantize, midiName, SCALES
} from "./generator.js";
import { renderBuffer, onBufferRender } from "./grid.js?v=213";
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

    const noteEl = btn.querySelector(".r-step-note");
    if (noteEl) {
      if (hasNotes) {
        noteEl.textContent = midiName(st.notes[0].note);
      } else {
        noteEl.textContent = "";
      }
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
    status(`Step ${stepIndex + 1} off`);
  } else {
    let noteVal = st._savedNote ? st._savedNote.note : getDefaultNoteForStep(stepIndex);
    const vel = st._savedNote ? st._savedNote.vel : (state.velocity ?? 100);
    st.notes = [{ note: Math.max(0, Math.min(127, noteVal)), vel: Math.max(1, Math.min(127, vel)) }];
    delete st.echo;
    status(`Step ${stepIndex + 1} on (${midiName(noteVal)})`);
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
export function initRhythm(containerEl) {
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
  const euclidGroup = document.createElement("div");
  euclidGroup.className = "rhythm-tool-group";

  const euclidLabel = document.createElement("span");
  euclidLabel.className = "rhythm-tool-label";
  euclidLabel.textContent = "Euclid";

  const euclidSelect = document.createElement("select");
  euclidSelect.className = "rhythm-select";
  euclidSelect.title = "Select classic Euclidean rhythm preset";
  for (const ep of EUCLID_PRESETS) {
    const opt = document.createElement("option");
    opt.value = ep.id;
    opt.textContent = ep.name;
    euclidSelect.appendChild(opt);
  }

  const euclidInputsWrap = document.createElement("div");
  euclidInputsWrap.className = "rhythm-euclid-inputs";

  const hitsLabel = document.createElement("label");
  hitsLabel.title = "Euclidean hits (N)";
  hitsLabel.textContent = "Hits ";
  euclidHitsInput = document.createElement("input");
  euclidHitsInput.type = "number";
  euclidHitsInput.className = "rhythm-num-input";
  euclidHitsInput.min = "0";
  euclidHitsInput.max = "64";
  euclidHitsInput.value = "5";
  hitsLabel.appendChild(euclidHitsInput);

  const divLabel = document.createElement("label");
  divLabel.title = "Cycle length in steps (M)";
  divLabel.textContent = "Div ";
  euclidDivSelect = document.createElement("select");
  euclidDivSelect.className = "rhythm-select-sm";
  for (const d of [16, 12, 8, 7, 6, 5, 4, 32, 64]) {
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = String(d);
    if (d === 16) opt.selected = true;
    euclidDivSelect.appendChild(opt);
  }
  divLabel.appendChild(euclidDivSelect);

  const applyEuclidBtn = document.createElement("button");
  applyEuclidBtn.className = "rhythm-btn primary";
  applyEuclidBtn.title = "Apply Euclidean rhythm pattern";
  applyEuclidBtn.textContent = "Apply";
  applyEuclidBtn.addEventListener("click", () => {
    const h = parseInt(euclidHitsInput.value, 10) || 0;
    const d = parseInt(euclidDivSelect.value, 10) || 16;
    applyEuclidPattern(h, d, 0);
  });

  euclidSelect.addEventListener("change", () => {
    const val = euclidSelect.value;
    if (val === "custom") return;
    const preset = EUCLID_PRESETS.find((p) => p.id === val);
    if (preset && preset.n !== undefined) {
      euclidHitsInput.value = String(preset.n);
      euclidDivSelect.value = String(preset.m);
      applyEuclidPattern(preset.n, preset.m, preset.rot || 0);
    }
  });

  euclidInputsWrap.append(hitsLabel, divLabel, applyEuclidBtn);
  euclidGroup.append(euclidLabel, euclidSelect, euclidInputsWrap);

  // --- Genre Presets ---
  const genreGroup = document.createElement("div");
  genreGroup.className = "rhythm-tool-group";
  const genreLabel = document.createElement("span");
  genreLabel.className = "rhythm-tool-label";
  genreLabel.textContent = "Pattern";

  const genreSelect = document.createElement("select");
  genreSelect.className = "rhythm-select";
  genreSelect.title = "Standard metric and groove patterns";
  for (const gp of GENRE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = gp.id;
    opt.textContent = gp.name;
    genreSelect.appendChild(opt);
  }
  genreSelect.addEventListener("change", () => {
    if (genreSelect.value) {
      applyGenrePreset(genreSelect.value);
    }
  });
  genreGroup.append(genreLabel, genreSelect);

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

  toolbar.append(euclidGroup, genreGroup, rotGroup, batchGroup);
  header.append(titleWrap, toolbar);

  // 2. 16x4 Step Buttons Grid
  const gridContainer = document.createElement("div");
  gridContainer.className = "rhythm-grid-container";
  gridContainer.id = "rhythm-grid-container";

  for (let bar = 0; bar < 4; bar++) {
    const row = document.createElement("div");
    row.className = "rhythm-row";

    // Row Label
    const barLabel = document.createElement("div");
    barLabel.className = "rhythm-bar-label";
    const barTag = document.createElement("span");
    barTag.className = "rhythm-bar-tag";
    barTag.textContent = `Bar ${bar + 1}`;
    const barRange = document.createElement("span");
    barRange.className = "rhythm-bar-range";
    barRange.textContent = `${bar * 16 + 1}–${(bar + 1) * 16}`;
    barLabel.append(barTag, barRange);

    // Row Steps (16 buttons)
    const stepsWrap = document.createElement("div");
    stepsWrap.className = "rhythm-row-steps";

    for (let s = 0; s < 16; s++) {
      const stepIdx = bar * 16 + s;
      const isDownbeat = s % 4 === 0;

      const btn = document.createElement("button");
      btn.className = "rhythm-step-btn" + (isDownbeat ? " is-downbeat" : "");
      btn.dataset.step = String(stepIdx);
      btn.title = `Step ${stepIdx + 1} (Bar ${bar + 1}, Beat ${Math.floor(s / 4) + 1}.${(s % 4) + 1})`;

      const btnHeader = document.createElement("div");
      btnHeader.className = "r-step-header";

      const numSpan = document.createElement("span");
      numSpan.className = "r-step-num";
      numSpan.textContent = String(stepIdx + 1);

      const ledSpan = document.createElement("span");
      ledSpan.className = "r-step-led";

      btnHeader.append(numSpan, ledSpan);

      const noteSpan = document.createElement("span");
      noteSpan.className = "r-step-note";

      btn.append(btnHeader, noteSpan);

      btn.addEventListener("click", () => {
        toggleStepGate(stepIdx);
      });

      stepButtons.push(btn);
      stepsWrap.appendChild(btn);
    }

    row.append(barLabel, stepsWrap);
    gridContainer.appendChild(row);
  }

  containerEl.append(header, gridContainer);

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
