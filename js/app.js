// app.js — FM-1 Pulses: generate a phrase, freeze it into the FM-1's sequencer.
import { generate, SCALES, LFO_WAVES, midiName } from "./generator.js";
import { encodeWrite } from "./pattern.js";
import * as midi from "./midi.js";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  length: 64, rate: 8, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoAmp: 50, lfoOffset: 0, lfoRate: 4,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0,
};
const state = { ...DEFAULT };
let pattern = null;
let prevSteps = null;
let busy = false;

// --------------------------------------------------------------------------- //
// Controls
// --------------------------------------------------------------------------- //
const CONTROLS = [
  { sec: "Pitch", items: [
    { k: "scale", t: "select", label: "Scale", opts: Object.keys(SCALES) },
    { k: "root", t: "range", label: "Root", min: 24, max: 84, fmt: midiName },
    { k: "lfoWave", t: "select", label: "LFO wave", opts: LFO_WAVES },
    { k: "lfoAmp", t: "range", label: "Amplitude", min: 0, max: 100, suffix: "%" },
    { k: "lfoOffset", t: "range", label: "Offset", min: -100, max: 100 },
    { k: "lfoRate", t: "select", label: "LFO rate", opts: [1, 2, 4, 8, 16, 32, 64], fmt: (v) => "/" + v },
  ] },
  { sec: "Density", items: [
    { k: "gateProb", t: "range", label: "Gate", min: 0, max: 100, suffix: "%" },
    { k: "velocity", t: "range", label: "Velocity", min: 1, max: 127 },
  ] },
  { sec: "Character", items: [
    { k: "spread", t: "select", label: "Spread", opts: ["constant", "bell", "uniform", "extremes"] },
    { k: "bias", t: "range", label: "Bias", min: -100, max: 100 },
    { k: "quantSteps", t: "range", label: "Quantize", min: 0, max: 100, suffix: "%" },
  ] },
  { sec: "Memory", items: [
    { k: "dejaVu", t: "range", label: "Deja Vu", min: 0, max: 100, suffix: "%" },
  ] },
  { sec: "Pattern", items: [
    { k: "rate", t: "select", label: "Note value", opts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], fmt: (v) => RATE_NAMES[v] },
    { k: "tempo", t: "range", label: "Tempo", min: 30, max: 300, suffix: " BPM" },
    { k: "gate", t: "range", label: "Gate length", min: 5, max: 100, suffix: "%" },
    { k: "swing", t: "range", label: "Swing", min: 50, max: 75, suffix: "%" },
    { k: "length", t: "range", label: "Length", min: 1, max: 64, suffix: " steps" },
  ] },
];

const refs = {};
function buildControls() {
  const el = document.getElementById("controls");
  for (const sec of CONTROLS) {
    const h = document.createElement("h2"); h.textContent = sec.sec; el.appendChild(h);
    const grid = document.createElement("div"); grid.className = "grid";
    for (const it of sec.items) {
      const row = document.createElement("label"); row.className = "ctl";
      const name = document.createElement("span"); name.textContent = it.label;
      const numSel = it.t === "select" && it.opts.every((o) => typeof o === "number");
      let inp;
      if (it.t === "select") {
        inp = document.createElement("select");
        for (const o of it.opts) {
          const op = document.createElement("option");
          op.value = String(o); op.textContent = it.fmt ? it.fmt(o) : String(o);
          inp.appendChild(op);
        }
      } else {
        inp = document.createElement("input");
        inp.type = "range"; inp.min = it.min; inp.max = it.max; inp.step = it.step || 1;
      }
      const out = document.createElement("b");
      const read = () => (it.t === "range" || numSel) ? Number(inp.value) : inp.value;
      const sync = () => {
        const v = read();
        state[it.k] = v;
        out.textContent = (it.fmt ? it.fmt(v) : v) + (it.suffix || "");
      };
      inp.addEventListener("input", sync);
      inp.value = String(state[it.k]); sync();
      row.append(name, inp, out);
      grid.appendChild(row);
      refs[it.k] = { inp, sync };
    }
    el.appendChild(grid);
  }
}
function refreshControls() {
  for (const [k, r] of Object.entries(refs)) { r.inp.value = String(state[k]); r.sync(); }
}

// --------------------------------------------------------------------------- //
// Buffer view
// --------------------------------------------------------------------------- //
function renderBuffer() {
  const el = document.getElementById("steps");
  el.innerHTML = "";
  if (!pattern) return;
  for (let i = 0; i < 64; i++) {
    const st = pattern.steps[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    const on = i < pattern.length && st && st.notes.length;
    if (on) {
      cell.textContent = midiName(st.notes[0].note);
      cell.classList.add("on");
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else {
      cell.textContent = "·";
      if (i >= pattern.length) cell.classList.add("off");
    }
    el.appendChild(cell);
  }
  const notes = pattern.steps.slice(0, pattern.length).reduce((a, s) => a + s.notes.length, 0);
  document.getElementById("bufinfo").textContent =
    `${pattern.length} steps · ${RATE_NAMES[pattern.rate]} · ${notes} notes`;
}

function status(msg, cls = "") {
  const el = document.getElementById("status");
  el.textContent = msg; el.className = "status " + cls;
}

// --------------------------------------------------------------------------- //
// Actions
// --------------------------------------------------------------------------- //
function doGenerate(keepPrev = true) {
  state.seed = (Math.random() * 1e9) | 0;
  const next = generate(state, keepPrev ? prevSteps : null);
  prevSteps = pattern ? pattern.steps : null;
  pattern = next;
  renderBuffer();
  status("generated");
}

async function doFreeze(slotIndex) {
  if (!pattern) doGenerate(false);
  const msgs = encodeWrite(pattern, slotIndex, true);
  try {
    status(`freezing ${msgs.length} messages → slot ${slotIndex + 1}…`);
    const name = await midi.sendPattern(msgs);
    status(`frozen to slot ${slotIndex + 1} ✓ (${name})`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  }
}

async function doFillAll() {
  if (busy) return;
  busy = true;
  try {
    for (let i = 0; i < 16; i++) {
      const p = generate({ ...state, seed: (Math.random() * 1e9) | 0 }, i === 0 ? prevSteps : null);
      const msgs = encodeWrite(p, i, true);
      status(`filling slot ${i + 1}/16…`);
      await midi.sendPattern(msgs);
    }
    status("all 16 slots filled ✓", "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

async function doAudition() {
  if (!pattern) return;
  const stepMs = 2000 / (pattern.length || 64);
  for (let i = 0; i < pattern.length; i++) {
    const st = pattern.steps[i];
    if (st.notes.length) {
      for (const n of st.notes) midi.sendNoteOn(n.note, n.vel);
      await new Promise((r) => setTimeout(r, Math.max(30, stepMs * pattern.gate / 100)));
      for (const n of st.notes) midi.sendNoteOff(n.note);
    }
    await new Promise((r) => setTimeout(r, Math.max(20, stepMs * (1 - pattern.gate / 100))));
  }
}

// --------------------------------------------------------------------------- //
// MIDI + wiring
// --------------------------------------------------------------------------- //
async function initMidi() {
  const sel = document.getElementById("device");
  const fill = () => {
    sel.innerHTML = "";
    const outs = midi.listOutputs();
    const fm1 = midi.findFm1();
    for (const o of outs) {
      const op = document.createElement("option");
      op.value = o.id; op.textContent = o.name;
      if (fm1 && o.id === fm1.id) op.selected = true;
      sel.appendChild(op);
    }
    if (!outs.length) sel.innerHTML = "<option>— no MIDI outputs —</option>";
    status(fm1 ? `FM-1: ${fm1.name}` : "FM-1 not found — connect it", fm1 ? "ok" : "");
  };
  try {
    await midi.initMidi();
    fill();
    midi.onStateChange(fill);
    sel.addEventListener("change", fill);
  } catch (e) {
    status(String(e.message || e), "err");
    sel.innerHTML = "<option>— Web MIDI blocked —</option>";
  }
}

function buildFooter() {
  const slot = document.getElementById("slot");
  for (let i = 1; i <= 16; i++) {
    const op = document.createElement("option"); op.value = String(i - 1); op.textContent = String(i);
    slot.appendChild(op);
  }
  document.getElementById("freeze").addEventListener("click", () => doFreeze(Number(slot.value)));
  document.getElementById("fill").addEventListener("click", doFillAll);
  document.getElementById("audition").addEventListener("click", doAudition);
  document.getElementById("gen").addEventListener("click", () => doGenerate(true));
  document.getElementById("rand").addEventListener("click", () => {
    Object.assign(state, {
      scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
      lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
      lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
      gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
      spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
      quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    });
    refreshControls(); doGenerate(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); doGenerate(true); }
    if (e.key === "f") doFreeze(Number(slot.value));
  });
}

buildControls();
buildFooter();
doGenerate(false);
initMidi();
