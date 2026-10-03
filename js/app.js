// app.js — FM-1 Pulses: generate a 16-slot bank (evolving), freeze to the FM-1.
import { generate, generateBank, SCALES, LFO_WAVES, midiName } from "./generator.js";
import { encodeWrite } from "./pattern.js";
import * as midi from "./midi.js";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
const SLOTS = 16;

// rate index -> duration in quarter notes (1/32 = a quarter/8, etc.)
const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
const LFO_RATE_STEPS = [1, 2, 4, 8, 16, 32, 64];

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoAmp: 50, lfoOffset: 0, lfoRate: 4,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0,
};
const state = { ...DEFAULT };
let bank = [];          // 16 patterns
let selected = 0;       // 0..15
let busy = false;

// The LFO rate means "one cycle every N steps". Spell that out musically - the
// cycle length in bars and how many cycles the sequence runs - so it reads as a
// duration instead of a cryptic "/16".
function lfoRateLabel(n) {
  const q = RATE_QUARTERS[state.rate] ?? RATE_QUARTERS[6];
  const stepsPerBar = 4 / q;                 // steps in one 4/4 bar at this note value
  const bars = n / stepsPerBar;
  const cycles = (state.length || 64) / n;
  const bar = bars >= 1
    ? `${+bars.toFixed(2)} bar${bars === 1 ? "" : "s"}`
    : (() => { const inv = 1 / bars; return Math.abs(inv - Math.round(inv)) < 0.05 ? `1/${Math.round(inv)} bar` : `${+bars.toFixed(3)} bar`; })();
  const cyc = cycles % 1 === 0 ? cycles : +cycles.toFixed(1);
  return `/${n} · ${n} step${n === 1 ? "" : "s"} · ${bar} · ${cyc} cycle${cyc === 1 ? "" : "s"}`;
}

function refreshLfoRate() {
  const inp = refs.lfoRate?.inp;
  if (!inp) return;
  const cur = inp.value;
  inp.innerHTML = "";
  for (const o of LFO_RATE_STEPS) {
    const op = document.createElement("option");
    op.value = String(o); op.textContent = lfoRateLabel(o);
    inp.appendChild(op);
  }
  inp.value = cur;
}

// --------------------------------------------------------------------------- //
// Controls
// --------------------------------------------------------------------------- //
const CONTROLS = [
  { sec: "Bank", items: [
    { k: "drift", t: "range", label: "Drift", min: 0, max: 100, suffix: "%" },
    { k: "seed", t: "num", label: "Seed" },
  ] },
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
          op.value = String(o);
          op.textContent = it.k === "lfoRate" ? lfoRateLabel(o) : it.fmt ? it.fmt(o) : String(o);
          inp.appendChild(op);
        }
      } else if (it.t === "num") {
        inp = document.createElement("input"); inp.type = "number"; inp.min = 0; inp.step = 1;
      } else {
        inp = document.createElement("input");
        inp.type = "range"; inp.min = it.min; inp.max = it.max; inp.step = it.step || 1;
      }
      const out = it.t === "select" ? null : document.createElement("b");
      const read = () => (it.t === "range" || it.t === "num" || numSel) ? Number(inp.value) : inp.value;
      const sync = () => {
        const v = read();
        state[it.k] = v;
        if (out) out.textContent = (it.fmt ? it.fmt(v) : v) + (it.suffix || "");
        if (it.k === "rate" || it.k === "length") refreshLfoRate();
      };
      inp.addEventListener("input", () => { sync(); scheduleRegen(); });
      inp.value = String(state[it.k]); sync();
      if (it.t === "select") { inp.classList.add("span2"); row.append(name, inp); }
      else row.append(name, inp, out);
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
// Bank strip (16 slots) + the selected slot's step grid
// --------------------------------------------------------------------------- //
function noteCount(p) {
  return p ? p.steps.slice(0, p.length).reduce((a, s) => a + s.notes.length, 0) : 0;
}

function renderBank() {
  const el = document.getElementById("bank");
  el.innerHTML = "";
  for (let s = 0; s < SLOTS; s++) {
    const p = bank[s];
    const cell = document.createElement("button");
    cell.className = "bankcell" + (s === selected ? " sel" : "");
    const num = document.createElement("span"); num.className = "bn"; num.textContent = s + 1;
    const mini = document.createElement("div"); mini.className = "mini";
    for (let i = 0; i < 64; i++) {
      const d = document.createElement("i");
      if (p && i < p.length && p.steps[i] && p.steps[i].notes.length) d.className = "on";
      mini.appendChild(d);
    }
    const cnt = document.createElement("span"); cnt.className = "bc"; cnt.textContent = noteCount(p);
    cell.append(num, mini, cnt);
    cell.title = `slot ${s + 1}: ${noteCount(p)} notes`;
    cell.addEventListener("click", () => { selected = s; renderBank(); renderBuffer(); });
    el.appendChild(cell);
  }
  const tot = bank.reduce((a, p) => a + noteCount(p), 0);
  const el2 = document.getElementById("bankinfo");
  if (el2) el2.textContent = bank.length ? `16 slots · ${tot} notes · drift ${state.drift}%` : "";
}

function renderBuffer() {
  const el = document.getElementById("steps");
  el.innerHTML = "";
  const p = bank[selected];
  if (!p) return;
  for (let i = 0; i < 64; i++) {
    const st = p.steps[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    const on = i < p.length && st && st.notes.length;
    if (on) {
      cell.textContent = midiName(st.notes[0].note);
      cell.classList.add("on");
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else if (i >= p.length) {
      cell.classList.add("off");
    }
    el.appendChild(cell);
  }
  document.getElementById("selnum").textContent = String(selected + 1);
  document.getElementById("bufinfo").textContent =
    `${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount(p)} notes`;
}

function status(msg, cls = "") {
  const el = document.getElementById("status");
  el.textContent = msg; el.className = "status " + cls;
}

// Header fields (tempo/rate/gate/swing/length) come from the live controls and
// don't affect the generated notes, so they apply to every slot without regen.
function syncHeader() {
  for (const p of bank) {
    if (!p) continue;
    p.tempo = state.tempo; p.rate = state.rate; p.gate = state.gate; p.swing = state.swing;
    p.length = Math.max(1, Math.min(64, state.length));
    for (const st of p.steps) st.rate = state.rate;
  }
}

// --------------------------------------------------------------------------- //
// Actions
// --------------------------------------------------------------------------- //
function doGenerate(newSeed = false) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  refs.seed.inp.value = String(state.seed); refs.seed.sync();
  bank = generateBank(state, state.drift);
  selected = 0;
  renderBank(); renderBuffer();
  status(`generated 16 slots (seed ${state.seed}, drift ${state.drift}%)`);
}

async function doFreeze(slotIndex) {
  if (!bank[slotIndex]) return;
  syncHeader();
  const msgs = encodeWrite(bank[slotIndex], slotIndex, true);
  try {
    status(`freezing slot ${slotIndex + 1}…`);
    const name = await midi.sendPattern(msgs);
    status(`slot ${slotIndex + 1} frozen ✓ (${name})`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  }
}

async function doSendAll() {
  if (busy || !bank.length) return;
  busy = true;
  try {
    syncHeader();
    for (let i = 0; i < SLOTS; i++) {
      status(`freezing ${i + 1}/${SLOTS}…`);
      await midi.sendPattern(encodeWrite(bank[i], i, true));
    }
    status(`all ${SLOTS} slots frozen ✓`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live regeneration: any control change re-derives the bank from the same seed,
// so the step view (and a running loop) follows the sliders in real time.
let regenTimer = null;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    bank = generateBank(state, state.drift);
    renderBank(); renderBuffer();
  }, 40);
}

// Looping audition: plays the selected slot continuously, re-reading the live
// pattern every step so slider changes are heard as they happen.
let live = false, liveToken = 0, nowCell = null, liveStep = -1;

function clearPlayhead() {
  if (nowCell) nowCell.classList.remove("now");
  nowCell = null; liveStep = -1;
}

function markStep(i) {
  liveStep = i;
  const el = document.getElementById("steps");
  if (nowCell) nowCell.classList.remove("now");
  nowCell = el.children[i] || null;
  if (nowCell) nowCell.classList.add("now");
}

function stopLive() {
  live = false; liveToken++;
  clearPlayhead();
  const btn = document.getElementById("audition");
  if (btn) { btn.textContent = "▶ Play"; btn.classList.remove("playing"); }
  status("stopped");
}

function toggleLive() {
  if (live) { stopLive(); return; }
  live = true; liveToken++;
  const btn = document.getElementById("audition");
  btn.textContent = "■ Stop"; btn.classList.add("playing");
  status("playing (loop) — tweak the sliders live");
  liveLoop(liveToken);
}

async function liveLoop(token) {
  let i = 0;
  while (live && token === liveToken) {
    try {
      const p = bank[selected];
      if (!p || !p.length) { await sleep(100); continue; }
      if (i >= p.length) i = 0;
      markStep(i);
      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
      if (st.notes.length) {
        for (const n of st.notes) midi.sendNoteOn(n.note, n.vel);
        await sleep(Math.max(12, stepMs * gate));
        for (const n of st.notes) midi.sendNoteOff(n.note);
        await sleep(Math.max(3, stepMs * (1 - gate)));
      } else {
        await sleep(stepMs);
      }
      i++;
    } catch (e) {
      status("play error: " + (e.message || e), "err");
      await sleep(200);
    }
  }
  clearPlayhead();
}

// --------------------------------------------------------------------------- //
// Themes (the FM-1's seven, decoded from its firmware)
// --------------------------------------------------------------------------- //
const THEMES = [
  { id: "purple", name: "Purple", accent: "#ff5da4" },
  { id: "black", name: "Black", accent: "#f6f2f6" },
  { id: "grey", name: "Grey", accent: "#f6e6d5" },
  { id: "orange", name: "Orange", accent: "#ff7939" },
  { id: "green", name: "Green", accent: "#6ae2cd" },
  { id: "blue", name: "Blue", accent: "#8bb2e6" },
  { id: "brown", name: "Brown", accent: "#e69962" },
];

function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  localStorage.setItem("fm1p.theme", id);
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.id === id));
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

function buildTheme() {
  const menu = document.getElementById("theme-menu");
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.className = "swatch"; b.dataset.id = t.id;
    b.title = t.name; b.setAttribute("aria-label", t.name);
    b.style.background = t.accent;
    b.addEventListener("click", () => applyTheme(t.id));
    menu.appendChild(b);
  }
  const saved = localStorage.getItem("fm1p.theme");
  applyTheme(THEMES.some((t) => t.id === saved) ? saved : "purple");
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
    await midi.initMidi(); fill(); midi.onStateChange(fill);
    sel.addEventListener("change", fill);
  } catch (e) {
    status(String(e.message || e), "err");
    sel.innerHTML = "<option>— Web MIDI blocked —</option>";
  }
}

function buildFooter() {
  document.getElementById("gen").addEventListener("click", () => doGenerate(true));
  document.getElementById("rand").addEventListener("click", () => {
    state.seed = (Math.random() * 1e9) | 0;
    Object.assign(state, {
      scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
      lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
      lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
      gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
      spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
      quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    });
    refreshControls(); doGenerate(true);
  });
  document.getElementById("audition").addEventListener("click", toggleLive);
  document.getElementById("freeze").addEventListener("click", () => doFreeze(selected));
  document.getElementById("fill").addEventListener("click", doSendAll);
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); toggleLive(); }
    if (e.key === "f") doFreeze(selected);
    if (e.key === "g") doGenerate(true);
    if (e.key === "ArrowRight") { selected = (selected + 1) % SLOTS; renderBank(); renderBuffer(); }
    if (e.key === "ArrowLeft") { selected = (selected + SLOTS - 1) % SLOTS; renderBank(); renderBuffer(); }
  });
}

buildTheme();
buildControls();
refreshLfoRate();
buildFooter();
doGenerate(true);
initMidi();
