// cellular.js — 1D Elementary Cellular Automata (Wolfram) Sequencer Model.
//
// Evolves 64-step musical phrases using Wolfram 1D cellular automata rules
// (e.g., Rule 30, 90, 110, 150). Maps generations of cell states into
// quantized polyphonic chords, melodic contours, or split bass/lead lines.

import { SCALES, NOTE_NAMES, midiName, mulberry32 } from "./generator.js?v=100";
import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js?v=103";
import { knob, fader, dropdown, actionBtn } from "./controls.js?v=103";
import { onStep, isLive } from "./player.js?v=103";

export const WOLFRAM_PRESETS = [
  { rule: 30, name: "Rule 30", desc: "Chaos / Aperiodic" },
  { rule: 90, name: "Rule 90", desc: "Sierpinski Fractal" },
  { rule: 110, name: "Rule 110", desc: "Turing / Gliders" },
  { rule: 150, name: "Rule 150", desc: "Bilateral Fractal" },
  { rule: 184, name: "Rule 184", desc: "Traffic / Flow" },
  { rule: 54, name: "Rule 54", desc: "Glider Cycles" },
  { rule: 22, name: "Rule 22", desc: "Branching Trees" },
  { rule: 126, name: "Rule 126", desc: "Percolation" }
];

export const CA_WIDTH = 16;
let caCustomRow = new Uint8Array(CA_WIDTH);
let activeHoverCell = null;
let activeCanvasPlayhead = null;

// Convert 8-bit rule number (0..255) to array of 8 bits [b7..b0]
export function ruleToBits(rule) {
  const r = Math.max(0, Math.min(255, Math.round(Number(rule) || 0)));
  const bits = [];
  for (let i = 7; i >= 0; i--) {
    bits.push((r >> i) & 1);
  }
  return bits;
}

// Convert 8 bits [b7..b0] to rule number
export function bitsToRule(bits) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    r |= (bits[i] ? 1 : 0) << (7 - i);
  }
  return r;
}

// Single generation evolution of 1D CA
export function evolveRow(row, rule, boundary = "wrap") {
  const W = row.length;
  const next = new Uint8Array(W);
  for (let i = 0; i < W; i++) {
    let left, right;
    if (boundary === "wrap") {
      left = row[(i - 1 + W) % W];
      right = row[(i + 1) % W];
    } else if (boundary === "mirror") {
      left = i === 0 ? row[1] : row[i - 1];
      right = i === W - 1 ? row[W - 2] : row[i + 1];
    } else { // "zero"
      left = i === 0 ? 0 : row[i - 1];
      right = i === W - 1 ? 0 : row[i + 1];
    }
    const center = row[i];
    const pattern = (left << 2) | (center << 1) | right;
    next[i] = (rule >> pattern) & 1;
  }
  return next;
}

// Generate the initial row (generation 0)
export function makeInitialRow(width, genesis, seed, initDensity, custom = null) {
  const row = new Uint8Array(width);
  if (genesis === "custom" && custom) {
    for (let i = 0; i < width; i++) row[i] = custom[i] ? 1 : 0;
    return row;
  }
  if (genesis === "random") {
    const rng = mulberry32(seed ^ 0x5a5a5a5a);
    const prob = (initDensity ?? 35) / 100;
    for (let i = 0; i < width; i++) {
      row[i] = rng() < prob ? 1 : 0;
    }
    // Guarantee at least one cell alive
    if (!row.some((c) => c === 1)) row[Math.floor(width / 2)] = 1;
  } else if (genesis === "sparse") {
    const rng = mulberry32(seed ^ 0x12345678);
    const pos1 = Math.floor(rng() * width);
    const pos2 = (pos1 + Math.floor(width / 2) + Math.floor(rng() * 3 - 1)) % width;
    row[pos1] = 1;
    row[pos2] = 1;
  } else if (genesis === "edges") {
    row[0] = 1;
    row[width - 1] = 1;
  } else {
    // "center" default
    row[Math.floor(width / 2)] = 1;
  }
  return row;
}

// Run CA for N steps, returning array of rows
export function runAutomata(stepsCount, width, rule, genesis, boundary, seed, initDensity, custom) {
  const grid = [];
  let current = makeInitialRow(width, genesis, seed, initDensity, custom);
  grid.push(current);
  for (let s = 1; s < stepsCount; s++) {
    current = evolveRow(current, rule, boundary);
    grid.push(current);
  }
  return grid;
}

// Build array of scale MIDI note numbers for the W columns
export function buildScalePitches(root, scaleName, count) {
  const scale = SCALES[scaleName] || SCALES.pentMinor;
  const pitches = [];
  const startRoot = Math.max(24, Math.min(84, Math.round(Number(root) || 48)));
  let deg = 0;
  while (pitches.length < count) {
    const oct = Math.floor(deg / scale.length);
    const note = startRoot + oct * 12 + scale[deg % scale.length];
    if (note <= 127) pitches.push(note);
    else break;
    deg++;
  }
  while (pitches.length < count) {
    pitches.push(pitches[pitches.length - 1] || 60);
  }
  return pitches;
}

// Map a 64-step CA grid to an FM-1 pattern
export function caGridToPattern(grid, pitches, params, seed) {
  const len = Math.max(1, Math.min(64, Math.round(params.length || 64)));
  const steps = [];
  const contour = [];
  const gates = [];
  const mapping = params.caMapping || "matrix";
  const gateProb = (params.caDensity ?? 85) / 100;
  const baseVel = Math.max(1, Math.min(127, Math.round(params.caVelocity ?? 100)));
  const rng = mulberry32(seed ^ 0xca11a110);

  for (let i = 0; i < 64; i++) {
    if (i >= len) {
      steps.push({ rate: params.rate, notes: [] });
      contour.push(pitches[0] || 60);
      gates.push(0);
      continue;
    }

    const row = grid[i] || new Uint8Array(CA_WIDTH);
    const activeCols = [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 1) activeCols.push(c);
    }

    const hasNotes = activeCols.length > 0 && rng() <= gateProb;
    gates.push(hasNotes ? 1 : 0);

    const stepNotes = [];
    if (hasNotes) {
      if (mapping === "matrix") {
        // Polyphonic: up to 6 simultaneous notes
        const maxNotes = Math.min(6, activeCols.length);
        const stride = Math.max(1, Math.floor(activeCols.length / maxNotes));
        for (let k = 0; k < activeCols.length && stepNotes.length < maxNotes; k += stride) {
          const col = activeCols[k];
          const note = pitches[col] ?? 60;
          // Dynamics influenced by density
          const vel = Math.max(20, Math.min(127, Math.round(baseVel * (0.8 + (activeCols.length / CA_WIDTH) * 0.4))));
          stepNotes.push({ note, vel });
        }
      } else if (mapping === "contour") {
        // Melodic lead contour: weighted center of mass
        let sum = 0;
        for (const col of activeCols) sum += col;
        const avgCol = Math.round(sum / activeCols.length);
        const note = pitches[avgCol] ?? pitches[0] ?? 60;
        stepNotes.push({ note, vel: baseVel });
      } else if (mapping === "bassMelody") {
        // Bass (col < 8) and Lead (col >= 8)
        const bassCols = activeCols.filter((c) => c < 8);
        const leadCols = activeCols.filter((c) => c >= 8);
        if (bassCols.length) {
          stepNotes.push({ note: pitches[bassCols[0]], vel: Math.min(127, baseVel + 10) });
        }
        if (leadCols.length) {
          stepNotes.push({ note: pitches[leadCols[leadCols.length - 1]], vel: baseVel });
        }
      }
    }

    steps.push({ rate: params.rate, notes: stepNotes });
    const primaryNote = stepNotes.length ? stepNotes[0].note : (pitches[Math.floor(CA_WIDTH / 2)] || 60);
    contour.push(primaryNote);
  }

  return {
    length: len,
    rate: params.rate,
    tempo: params.tempo,
    gate: params.gate,
    swing: params.swing,
    steps,
    caGrid: grid,
    pitches,
    contour,
    gates
  };
}

// Generate the 16-slot bank using CA
export function generateCaBank(baseParams, driftPct = 50) {
  const drift = Math.max(0, Math.min(100, driftPct)) / 100;
  const baseSeed = (baseParams.seed >>> 0);
  const rule = Math.max(0, Math.min(255, Math.round(baseParams.caRule ?? 30)));
  const genesis = baseParams.caGenesis || "center";
  const boundary = baseParams.caBoundary || "wrap";
  const initDensity = baseParams.caInitDensity ?? 35;
  const pitches = buildScalePitches(baseParams.caRoot ?? 48, baseParams.caScale || "pentMinor", CA_WIDTH);

  const bank = [];
  for (let slot = 0; slot < 16; slot++) {
    const slotSeed = (baseSeed + slot * 0x9e3779b1) >>> 0;
    const t = (slot / 15) * drift;

    // Bank evolution: evolve rule mutation or initial row offset with drift
    let slotRule = rule;
    if (t > 0.4 && slot > 0) {
      // Occasional gentle bit flip in rule for evolutionary drift
      const rng = mulberry32(slotSeed ^ 0xfeed);
      if (rng() < t * 0.7) {
        const bitToFlip = (rng() * 8) | 0;
        slotRule = rule ^ (1 << bitToFlip);
      }
    }

    // Offset starting generation or density with drift
    const startOffset = Math.round(t * 12);
    const totalGenNeeded = 64 + startOffset;
    const rawGrid = runAutomata(
      totalGenNeeded,
      CA_WIDTH,
      slotRule,
      genesis,
      boundary,
      slotSeed,
      initDensity,
      genesis === "custom" ? caCustomRow : null
    );

    const slotGrid = rawGrid.slice(startOffset, startOffset + 64);
    const pat = caGridToPattern(slotGrid, pitches, baseParams, slotSeed);
    bank.push(pat);
  }
  return bank;
}

// Randomize Cellular Automata parameters
export function randomizeCa() {
  state.seed = (Math.random() * 1e9) | 0;
  const randomPreset = WOLFRAM_PRESETS[(Math.random() * WOLFRAM_PRESETS.length) | 0];
  state.caRule = randomPreset ? randomPreset.rule : (Math.random() * 256) | 0;
  state.caGenesis = ["center", "random", "sparse", "edges"][(Math.random() * 4) | 0];
  state.caBoundary = ["wrap", "zero", "mirror"][(Math.random() * 3) | 0];
  state.caMapping = ["matrix", "contour", "bassMelody"][(Math.random() * 3) | 0];
  state.caScale = Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0];
  state.caRoot = [36, 48, 60][(Math.random() * 3) | 0];
  state.caDensity = 60 + ((Math.random() * 35) | 0);
  state.caInitDensity = 25 + ((Math.random() * 40) | 0);

  syncCaControls();
  doGenerate(true);
}

// Render the Space-Time Cellular Automata matrix canvas
export function renderCaCanvas(canvas, pattern, activeStep = null, hover = null) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width || 560);
  const h = Math.round(rect.height || 480);

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  const bgColor = styles.getPropertyValue("--panel").trim() || "#181a20";
  const panel2 = styles.getPropertyValue("--panel2").trim() || "#22252e";
  const fgColor = styles.getPropertyValue("--fg").trim() || "#f3f4f6";
  const dimColor = styles.getPropertyValue("--dim").trim() || "#9ca3af";
  const lineColor = styles.getPropertyValue("--line").trim() || "#333846";
  const accent = styles.getPropertyValue("--accent").trim() || "#3b82f6";

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const pitches = pattern?.pitches || buildScalePitches(state.caRoot ?? 48, state.caScale || "pentMinor", CA_WIDTH);
  const grid = pattern?.caGrid || [];
  const stepsCount = Math.max(1, Math.min(64, pattern?.length || state.length || 64));

  const padLeft = 24;
  const padTop = 22;
  const padRight = 6;
  const padBottom = 8;
  const gridW = w - padLeft - padRight;
  const gridH = h - padTop - padBottom;
  const colW = gridW / CA_WIDTH;
  const rowH = gridH / stepsCount;

  // 1. Column Pitch Headers
  ctx.font = "8px 'Barlow Semi Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < CA_WIDTH; c++) {
    const cx = padLeft + c * colW + colW / 2;
    const noteName = midiName(pitches[c] ?? 60);
    ctx.fillStyle = (hover && hover.col === c) ? fgColor : dimColor;
    ctx.fillText(noteName, cx, 11);
  }

  // 2. Draw Grid Cells
  for (let r = 0; r < stepsCount; r++) {
    const row = grid[r] || new Uint8Array(CA_WIDTH);
    const ry = padTop + r * rowH;
    const isPlayhead = activeStep === r;

    // Step number on the left (every 4 or 8 steps)
    if (r === 0 || (r + 1) % 8 === 0 || isPlayhead) {
      ctx.textAlign = "right";
      ctx.fillStyle = isPlayhead ? fgColor : dimColor;
      ctx.font = isPlayhead ? "bold 8.5px 'Barlow Semi Condensed', sans-serif" : "7.5px 'Barlow Semi Condensed', sans-serif";
      ctx.fillText(String(r + 1), padLeft - 4, ry + rowH / 2);
    }

    // Playhead row background glow
    if (isPlayhead) {
      ctx.fillStyle = styles.getPropertyValue("--panel2") || panel2;
      ctx.fillRect(padLeft, ry - 0.5, gridW, rowH + 1);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(padLeft - 1, ry - 0.5, gridW + 2, rowH + 1);
    }

    for (let c = 0; c < CA_WIDTH; c++) {
      const rx = padLeft + c * colW;
      const isAlive = row[c] === 1;
      const cellPad = rowH > 8 ? 1.5 : 0.8;
      const cellW = Math.max(1, colW - cellPad * 2);
      const cellH = Math.max(1, rowH - cellPad * 2);

      if (isAlive) {
        ctx.fillStyle = isPlayhead ? "#ffffff" : accent;
        if (cellW > 6 && cellH > 6) {
          ctx.beginPath();
          ctx.roundRect(rx + cellPad, ry + cellPad, cellW, cellH, 2);
          ctx.fill();
        } else {
          ctx.fillRect(rx + cellPad, ry + cellPad, cellW, cellH);
        }
      } else {
        ctx.fillStyle = panel2;
        ctx.fillRect(rx + cellPad, ry + cellPad, cellW, cellH);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(rx + cellPad, ry + cellPad, cellW, cellH);
      }

      // Hover cell highlight
      if (hover && hover.row === r && hover.col === c) {
        ctx.strokeStyle = fgColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, colW, rowH);
      }
    }
  }

  // Row 0 custom genesis hint
  ctx.strokeStyle = colorMix(accent, 40);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop + rowH);
  ctx.lineTo(padLeft + gridW, padTop + rowH);
  ctx.stroke();
  ctx.setLineDash([]);
}

function colorMix(col, pct) {
  return `color-mix(in srgb, ${col} ${pct}%, transparent)`;
}

// Synchronize UI inputs to state
export function syncCaControls() {
  for (const [k, el] of Object.entries(refs)) {
    if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  }
  updateRuleBitsDisplay(state.caRule ?? 30);
  updateCaHeaderInfo();
  updateCaSlotsDisplay();
}

function updateRuleBitsDisplay(rule) {
  const bits = ruleToBits(rule);
  const container = document.getElementById("ca-rule-bits");
  if (!container) return;
  const btns = container.querySelectorAll(".ca-bit-btn");
  btns.forEach((btn, idx) => {
    const bitVal = bits[idx];
    btn.dataset.bitVal = String(bitVal);
    btn.classList.toggle("active", bitVal === 1);
    btn.textContent = `${btn.dataset.pattern}: ${bitVal}`;
    btn.setAttribute("aria-pressed", String(bitVal === 1));
  });
  const ruleNumEl = document.getElementById("ca-rule-num-display");
  if (ruleNumEl) ruleNumEl.textContent = `Rule ${rule}`;
}

function updateCaHeaderInfo() {
  const bank = getBank();
  const pat = bank[getSelected()];
  const infoEl = document.getElementById("ca-seq-info");
  if (!infoEl || !pat) return;
  const activeNotes = pat.steps.reduce((acc, st) => acc + (st.notes?.length || 0), 0);
  const scaleName = state.caScale || "pentMinor";
  const rootName = midiName(state.caRoot || 48);
  infoEl.innerHTML = `Slot <b>${getSelected() + 1}</b> · Rule <b>${state.caRule ?? 30}</b> · ${state.length} steps · ${activeNotes} notes · ${rootName} ${scaleName}`;
}

export function updateCaSlotsDisplay() {
  const container = document.getElementById("ca-bank-slots");
  if (!container) return;
  const bank = getBank();
  const currentSlot = getSelected();
  container.querySelectorAll(".ca-slot-btn").forEach((btn, idx) => {
    const isSel = idx === currentSlot;
    btn.classList.toggle("selected", isSel);
    btn.setAttribute("aria-selected", String(isSel));
    const pat = bank[idx];
    const notesCount = pat ? pat.steps.reduce((acc, st) => acc + (st.notes?.length || 0), 0) : 0;
    btn.querySelector(".ca-slot-notes").textContent = `${notesCount}n`;
  });
}

// Build the complete Cellular Automata UI Panel
export function buildCellularPanel(container) {
  if (!container) return;
  container.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "ca-layout";

  // LEFT MODULE: Controls
  const module = document.createElement("div");
  module.className = "ca-module";

  // SECTION 1: RULE
  const ruleSect = document.createElement("section");
  ruleSect.className = "sect ca-sect";
  ruleSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Wolfram 1D Rule</h3>
      <span class="ca-rule-badge" id="ca-rule-num-display">Rule ${state.caRule ?? 30}</span>
    </div>
  `;

  // Rule Number Slider + Stepper
  const ruleSliderWrap = document.createElement("div");
  ruleSliderWrap.className = "ca-rule-slider-wrap";
  ruleSliderWrap.append(
    R("caRule", fader({
      label: "Rule Number", min: 0, max: 255, step: 1, value: state.caRule ?? 30, def: 30,
      format: (v) => `${Math.round(v)}`,
      onInput: (v) => {
        state.caRule = Math.round(v);
        updateRuleBitsDisplay(state.caRule);
        scheduleRegen();
      },
      tip: "Wolfram elementary cellular automata rule number (0–255)."
    }))
  );

  // Quick Preset Rule Buttons
  const presetRulesWrap = document.createElement("div");
  presetRulesWrap.className = "ca-preset-rules";
  for (const pr of WOLFRAM_PRESETS) {
    const b = document.createElement("button");
    b.className = "ca-preset-btn";
    b.textContent = `${pr.rule}`;
    b.title = `${pr.name}: ${pr.desc}`;
    b.addEventListener("click", () => {
      state.caRule = pr.rule;
      if (refs.caRule) refs.caRule.setValue(pr.rule);
      updateRuleBitsDisplay(pr.rule);
      scheduleRegen();
      status(`${pr.name} (${pr.desc}) selected`, "ok");
    });
    presetRulesWrap.appendChild(b);
  }

  // 8-Bit Wolfram Switchboard
  const bitsContainer = document.createElement("div");
  bitsContainer.className = "ca-rule-bits";
  bitsContainer.id = "ca-rule-bits";
  const patterns = ["111", "110", "101", "100", "011", "010", "001", "000"];
  const currentBits = ruleToBits(state.caRule ?? 30);

  patterns.forEach((pat, idx) => {
    const bitBtn = document.createElement("button");
    bitBtn.className = `ca-bit-btn ${currentBits[idx] ? "active" : ""}`;
    bitBtn.dataset.pattern = pat;
    bitBtn.dataset.bitIndex = String(idx);
    bitBtn.dataset.bitVal = String(currentBits[idx]);
    bitBtn.textContent = `${pat}: ${currentBits[idx]}`;
    bitBtn.title = `Neighborhood ${pat} → click to toggle bit ${7 - idx}`;
    bitBtn.addEventListener("click", () => {
      const bits = ruleToBits(state.caRule ?? 30);
      bits[idx] = bits[idx] ? 0 : 1;
      const newRule = bitsToRule(bits);
      state.caRule = newRule;
      if (refs.caRule) refs.caRule.setValue(newRule);
      updateRuleBitsDisplay(newRule);
      scheduleRegen();
      status(`Rule ${newRule} (bit ${7 - idx} toggled)`, "ok");
    });
    bitsContainer.appendChild(bitBtn);
  });

  ruleSect.append(ruleSliderWrap, presetRulesWrap, bitsContainer);

  // SECTION 2: GENESIS (Initial Row)
  const genesisSect = document.createElement("section");
  genesisSect.className = "sect ca-sect";
  genesisSect.innerHTML = `<h3>Genesis · Initial State</h3>`;

  const genesisGrid = document.createElement("div");
  genesisGrid.className = "ca-grid-2col";
  genesisGrid.append(
    R("caGenesis", dropdown({
      label: "Genesis",
      options: [
        { v: "center", t: "Center 1" },
        { v: "random", t: "Random Seed" },
        { v: "sparse", t: "Sparse 2-Point" },
        { v: "edges", t: "Dual Edges" },
        { v: "custom", t: "Custom (Click Grid)" }
      ],
      value: state.caGenesis || "center",
      onInput: (v) => { state.caGenesis = v; scheduleRegen(); },
      tip: "Initial cell configuration for generation 1."
    })),
    R("caBoundary", dropdown({
      label: "Boundary",
      options: [
        { v: "wrap", t: "Wrap (Torus)" },
        { v: "zero", t: "Zero (Wall)" },
        { v: "mirror", t: "Mirror (Reflect)" }
      ],
      value: state.caBoundary || "wrap",
      onInput: (v) => { state.caBoundary = v; scheduleRegen(); },
      tip: "Edge conditions when calculating left/right neighbor."
    })),
    R("caInitDensity", fader({
      label: "Density", min: 10, max: 90, value: state.caInitDensity ?? 35, def: 35,
      format: (v) => `${Math.round(v)}%`,
      onInput: setState("caInitDensity"),
      tip: "Initial live cell density for Random genesis."
    })),
    actionBtn("Mutate 1-Bit", () => {
      // Invert a bit in custom genesis
      const idx = (Math.random() * CA_WIDTH) | 0;
      caCustomRow[idx] = caCustomRow[idx] ? 0 : 1;
      state.caGenesis = "custom";
      if (refs.caGenesis) refs.caGenesis.setValue("custom");
      scheduleRegen();
      status(`Mutated cell ${idx + 1} in Genesis row`);
    }, "Randomly flip a bit in initial row")
  );

  genesisSect.appendChild(genesisGrid);

  // SECTION 3: MUSICAL MAPPING
  const mappingSect = document.createElement("section");
  mappingSect.className = "sect ca-sect";
  mappingSect.innerHTML = `<h3>Musical Mapping</h3>`;

  const mappingGrid = document.createElement("div");
  mappingGrid.className = "ca-grid-2col";
  mappingGrid.append(
    R("caMapping", dropdown({
      label: "Mapping",
      options: [
        { v: "matrix", t: "Scale Matrix (Poly)" },
        { v: "contour", t: "Melodic Contour (Lead)" },
        { v: "bassMelody", t: "Bass + Lead (Split)" }
      ],
      value: state.caMapping || "matrix",
      onInput: (v) => { state.caMapping = v; scheduleRegen(); },
      tip: "How alive cells map into notes: polyphonic scale matrix, melodic contour line, or dual split."
    })),
    R("caScale", dropdown({
      label: "Scale",
      options: Object.keys(SCALES).map((s) => ({ v: s, t: s })),
      value: state.caScale || "pentMinor",
      onInput: (v) => { state.caScale = v; scheduleRegen(); },
      tip: "Musical scale constraining cell pitches."
    })),
    R("caRoot", fader({
      label: "Root", min: 36, max: 72, step: 1, value: state.caRoot ?? 48, def: 48,
      format: (v) => midiName(v),
      onInput: setState("caRoot"),
      tip: "Base root pitch for column 1."
    })),
    R("caDensity", fader({
      label: "Gate %", min: 10, max: 100, value: state.caDensity ?? 85, def: 85,
      format: (v) => `${Math.round(v)}%`,
      onInput: setState("caDensity"),
      tip: "Probability threshold that active cells produce notes (controls overall sequence density)."
    }))
  );

  mappingSect.appendChild(mappingGrid);

  // SECTION 4: BANK SLOTS (1 to 16)
  const slotsSect = document.createElement("section");
  slotsSect.className = "sect ca-sect ca-slots-sect";
  slotsSect.innerHTML = `<h3>Bank Slots (1–16)</h3>`;

  const slotsGrid = document.createElement("div");
  slotsGrid.className = "ca-bank-slots";
  slotsGrid.id = "ca-bank-slots";

  for (let i = 0; i < 16; i++) {
    const b = document.createElement("button");
    b.className = `ca-slot-btn ${i === getSelected() ? "selected" : ""}`;
    b.dataset.slot = String(i);
    b.innerHTML = `<span class="ca-slot-num">${i + 1}</span><span class="ca-slot-notes">—</span>`;
    b.title = `Switch to slot ${i + 1}`;
    b.addEventListener("click", () => {
      setSelected(i);
      updateCaSlotsDisplay();
      updateCaHeaderInfo();
      redrawCurrentCaCanvas();
      status(`Selected slot ${i + 1}`);
    });
    slotsGrid.appendChild(b);
  }

  slotsSect.appendChild(slotsGrid);

  module.append(ruleSect, genesisSect, mappingSect, slotsSect);

  // RIGHT DISPLAY: Cellular Automata State Display
  const display = document.createElement("div");
  display.className = "display ca-display";

  display.innerHTML = `
    <div class="ca-display-header">
      <h2>Cellular Automata Sequence</h2>
      <div class="ca-seq-info" id="ca-seq-info">Loading...</div>
    </div>
    <div class="ca-canvas-container">
      <canvas id="ca-canvas" class="ca-canvas"></canvas>
    </div>
    <div class="ca-display-footer">
      <span class="ca-hint">💡 Click or drag on top row to edit Genesis · Click steps to toggle notes · Space to Play</span>
      <span id="ca-step-hover" class="ca-step-hover">—</span>
    </div>
  `;

  layout.append(module, display);
  container.appendChild(layout);

  wireCanvasInteractions();
  redrawCurrentCaCanvas();
  updateCaSlotsDisplay();
}

function redrawCurrentCaCanvas() {
  const canvas = document.getElementById("ca-canvas");
  if (!canvas) return;
  const bank = getBank();
  const pat = bank[getSelected()];
  renderCaCanvas(canvas, pat, activeCanvasPlayhead, activeHoverCell);
  updateCaHeaderInfo();
}

function wireCanvasInteractions() {
  const canvas = document.getElementById("ca-canvas");
  if (!canvas) return;

  const getCellFromEvent = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const padLeft = 24;
    const padTop = 22;
    const padRight = 6;
    const padBottom = 8;
    const gridW = w - padLeft - padRight;
    const gridH = h - padTop - padBottom;
    const stepsCount = Math.max(1, Math.min(64, state.length || 64));

    if (x < padLeft || x > w - padRight || y < padTop || y > h - padBottom) return null;

    const col = Math.floor(((x - padLeft) / gridW) * CA_WIDTH);
    const row = Math.floor(((y - padTop) / gridH) * stepsCount);
    if (col >= 0 && col < CA_WIDTH && row >= 0 && row < stepsCount) {
      return { col, row };
    }
    return null;
  };

  canvas.addEventListener("mousemove", (e) => {
    const cell = getCellFromEvent(e);
    activeHoverCell = cell;
    const hoverEl = document.getElementById("ca-step-hover");
    if (cell) {
      const bank = getBank();
      const pat = bank[getSelected()];
      const noteName = pat?.pitches?.[cell.col] ? midiName(pat.pitches[cell.col]) : `Col ${cell.col + 1}`;
      const isAlive = pat?.caGrid?.[cell.row]?.[cell.col] === 1;
      if (hoverEl) {
        hoverEl.textContent = `Step ${cell.row + 1} · ${noteName} · ${isAlive ? "Active (1)" : "Rest (0)"}`;
      }
    } else {
      if (hoverEl) hoverEl.textContent = "—";
    }
    redrawCurrentCaCanvas();
  });

  canvas.addEventListener("mouseleave", () => {
    activeHoverCell = null;
    const hoverEl = document.getElementById("ca-step-hover");
    if (hoverEl) hoverEl.textContent = "—";
    redrawCurrentCaCanvas();
  });

  canvas.addEventListener("click", (e) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;
    const bank = getBank();
    const pat = bank[getSelected()];
    if (!pat || !pat.caGrid) return;

    if (cell.row === 0) {
      // Toggle custom Genesis cell
      caCustomRow[cell.col] = caCustomRow[cell.col] ? 0 : 1;
      state.caGenesis = "custom";
      if (refs.caGenesis) refs.caGenesis.setValue("custom");
      scheduleRegen();
      status(`Genesis cell ${cell.col + 1} toggled`);
    } else {
      // Toggle cell in this slot
      const curr = pat.caGrid[cell.row][cell.col];
      pat.caGrid[cell.row][cell.col] = curr ? 0 : 1;
      const pitches = pat.pitches || buildScalePitches(state.caRoot ?? 48, state.caScale || "pentMinor", CA_WIDTH);
      const updated = caGridToPattern(pat.caGrid, pitches, state, state.seed);
      bank[getSelected()] = updated;
      redrawCurrentCaCanvas();
      updateCaSlotsDisplay();
      status(`Step ${cell.row + 1}, cell ${cell.col + 1} toggled`);
    }
  });

  // Window resize re-renders canvas
  window.addEventListener("resize", () => {
    redrawCurrentCaCanvas();
  });
}

// Initialize the Cellular Automata Model
export function initCellular() {
  const container = document.getElementById("model-cellular");
  if (!container) return;
  buildCellularPanel(container);

  // Hook playhead step updates
  onStep((stepIndex) => {
    activeCanvasPlayhead = stepIndex;
    const canvas = document.getElementById("ca-canvas");
    if (canvas && container.style.display !== "none") {
      redrawCurrentCaCanvas();
    }
  });

  // Hook regeneration updates
  onRegen(() => {
    if (container.style.display !== "none") {
      redrawCurrentCaCanvas();
      updateCaSlotsDisplay();
      updateCaHeaderInfo();
    }
  });
}

// When activating the Cellular Automata Model
export function activateCellularModel() {
  setModelGenerator(generateCaBank);
  setModelRandomizer(randomizeCa);
  doGenerate(false);
  redrawCurrentCaCanvas();
  updateCaSlotsDisplay();
  updateCaHeaderInfo();
}

// When deactivating Cellular Automata Model
export function deactivateCellularModel() {
  activeCanvasPlayhead = null;
  setModelGenerator(null);
  setModelRandomizer(null);
}
