// rack.js — the single-module knob UI. Same engine as app.js (generator, pattern,
// midi, audio); only the controls differ: one portrait case, knobs on top and the
// pattern display inside the case below. app.js and the MVP are untouched.
import { generate, generateBank, SCALES, LFO_WAVES, midiName } from "./generator.js?v=54";
import { encodeWrite, emptyPattern } from "./pattern.js?v=54";
import * as midi from "./midi.js?v=54";
import * as audio from "./audio.js?v=54";
import { knob, sw, toggle } from "./knob.js?v=54";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
const SLOTS = 16;

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, humanize: 0, gateQuant: 0, snapGrid: 4,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoAmp: 50, lfoOffset: 0, lfoRate: 4, octave: 0, gravity: 0, unipolar: false,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0, loop: 8, loopFrom: 1,
};
const state = { ...DEFAULT };
let bank = [];
let selected = 0;
let busy = false;
let editStep = -1;
const locks = new Map();   // "slot:step" -> [{ note, vel }]
const refs = {};           // state key -> control element (has setValue)

function status(msg, cls = "") {
  const el = document.getElementById("status");
  if (el) { el.textContent = msg; el.className = "status " + cls; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- //
// Sequencer (ported from app.js, unchanged behaviour)
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
    cell.addEventListener("click", () => { selected = s; renderBank(); renderBuffer(); if (!live) playOnce(); });
    el.appendChild(cell);
  }
  const el2 = document.getElementById("bufinfo");
  if (el2) el2.textContent = bank.length ? `drift ${state.drift}%` : "";
}

function applyLocks() {
  for (const [key, notes] of locks) {
    const [s, i] = key.split(":").map(Number);
    const p = bank[s];
    if (p && p.steps[i]) p.steps[i].notes = notes.map((n) => ({ ...n }));
  }
}

function refreshLockCount() {
  const el = document.getElementById("lockcount");
  if (el) el.textContent = locks.size ? `${locks.size} locked` : "";
}

function renderEditor() {
  const p = bank[selected];
  const has = editStep >= 0 && p && p.steps[editStep];
  document.getElementById("estep").textContent = editStep >= 0 ? String(editStep + 1) : "—";
  const noteEl = document.getElementById("enote");
  const lockBtn = document.getElementById("elock");
  if (!has) {
    noteEl.textContent = "—";
    lockBtn.textContent = "🔓"; lockBtn.classList.remove("on");
    return;
  }
  const notes = p.steps[editStep].notes;
  noteEl.textContent = notes.length ? notes.map((n) => midiName(n.note)).join(" ") : "(empty)";
  const isL = locks.has(`${selected}:${editStep}`);
  lockBtn.textContent = isL ? "🔒" : "🔓";
  lockBtn.classList.toggle("on", isL);
}

function selectStep(i) { editStep = i; renderBuffer(); }

function setStepNote(i, note) {
  const p = bank[selected];
  if (!p || !p.steps[i]) return;
  if (note == null) p.steps[i].notes = [];
  else {
    const v = p.steps[i].notes[0]?.vel ?? state.velocity ?? 100;
    p.steps[i].notes = [{ note: Math.max(0, Math.min(127, note)), vel: Math.max(1, Math.min(127, v)) }];
  }
  locks.set(`${selected}:${i}`, p.steps[i].notes.map((n) => ({ ...n })));
  renderBank(); renderBuffer(); refreshLockCount();
}

function clearLocks() { locks.clear(); renderBank(); renderBuffer(); refreshLockCount(); status("locks cleared"); }

function renderBuffer() {
  const el = document.getElementById("steps");
  el.innerHTML = "";
  const p = bank[selected];
  if (!p) return;
  for (let i = 0; i < 64; i++) {
    const st = p.steps[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    const dot = document.createElement("span");
    dot.className = "dot";
    cell.appendChild(dot);
    const on = i < p.length && st && st.notes.length;
    if (on) {
      dot.textContent = midiName(st.notes[0].note);
      cell.classList.add("on");
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else if (i >= p.length) cell.classList.add("off");
    if (locks.has(`${selected}:${i}`)) cell.classList.add("locked");
    if (i === editStep) cell.classList.add("edit");
    cell.addEventListener("click", () => selectStep(i));
    el.appendChild(cell);
  }
  document.getElementById("selnum").textContent = String(selected + 1);
  document.getElementById("bufinfo").textContent = `${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount(p)} notes`;
  renderEditor();
}

// Header fields apply to every slot without a regen.
function syncHeader() {
  for (const p of bank) {
    if (!p) continue;
    p.tempo = state.tempo; p.rate = state.rate; p.gate = state.gate; p.swing = state.swing;
    p.length = Math.max(1, Math.min(64, state.length));
    for (const st of p.steps) st.rate = state.rate;
  }
}

// --------------------------------------------------------------------------- //
// Generation
// --------------------------------------------------------------------------- //
function doGenerate(newSeed = false) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  refs.seed?.setValue(state.seed, false);
  bank = generateBank(state, state.drift);
  applyLocks();
  renderBank(); renderBuffer();
  status(`16 slots · seed ${state.seed}`);
}

let regenTimer = null;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    bank = generateBank(state, state.drift);
    applyLocks();
    renderBank(); renderBuffer();
  }, 40);
}

// --------------------------------------------------------------------------- //
// Freeze / clear
// --------------------------------------------------------------------------- //
async function doFreeze(slotIndex) {
  if (!bank[slotIndex]) return;
  syncHeader();
  try {
    status(`freezing slot ${slotIndex + 1}…`);
    const name = await midi.sendPattern(encodeWrite(bank[slotIndex], slotIndex, true), `slot ${slotIndex + 1}`);
    status(`slot ${slotIndex + 1} frozen ✓ (${name})`, "ok");
  } catch (e) { status(String(e.message || e), "err"); }
}

async function doSendAll() {
  if (busy || !bank.length) return;
  busy = true;
  try {
    syncHeader();
    for (let i = 0; i < SLOTS; i++) {
      status(`freezing ${i + 1}/${SLOTS}…`);
      await midi.sendPattern(encodeWrite(bank[i], i, true), `slot ${i + 1}`);
    }
    status(`all ${SLOTS} slots frozen ✓`, "ok");
  } catch (e) { status(String(e.message || e), "err"); }
  finally { busy = false; }
}

async function doClearAll() {
  if (busy || !bank.length) return;
  if (!confirm(`Erase all ${SLOTS} patterns on the FM-1?\n\nThis overwrites them with empty patterns. The browser bank is not affected.`)) return;
  busy = true;
  try {
    const blank = emptyPattern(64, state.rate, state.tempo, state.gate, state.swing);
    for (let i = 0; i < SLOTS; i++) {
      status(`clearing ${i + 1}/${SLOTS}…`);
      await midi.sendPattern(encodeWrite(blank, i, true), `slot ${i + 1}`);
    }
    status(`all ${SLOTS} patterns cleared ✓`, "ok");
  } catch (e) { status(String(e.message || e), "err"); }
  finally { busy = false; }
}

// --------------------------------------------------------------------------- //
// Audition (browser synth + live MIDI)
// --------------------------------------------------------------------------- //
let live = false, liveToken = 0, nowCell = null, onceToken = 0;

function swingFrac() {
  const s = Math.min(75, Math.max(50, state.swing ?? 50));
  return ((s - 50) / 25) / 3;
}

async function playOnce() {
  const p = bank[selected];
  if (!p || live) return;
  const token = ++onceToken;
  audio.unlock();
  const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
  const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
  for (let i = 0; i < p.length; i++) {
    if (token !== onceToken || live) return;
    const st = p.steps[i];
    const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
    const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
    const sDur = stepMs - late;
    if (late) await sleep(late);
    if (st.notes.length) {
      for (const n of st.notes) { midi.sendNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
      await sleep(Math.max(12, sDur * gate));
      for (const n of st.notes) { midi.sendNoteOff(n.note); audio.noteOff(n.note); }
      await sleep(Math.max(3, sDur * (1 - gate)));
    } else await sleep(sDur);
  }
}

function clearPlayhead() {
  if (nowCell) nowCell.classList.remove("now");
  nowCell = null;
}

function markStep(i) {
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
  onceToken++;
  live = true; liveToken++;
  audio.unlock();
  const btn = document.getElementById("audition");
  btn.textContent = "■ Stop"; btn.classList.add("playing");
  status("playing (loop)");
  liveLoop(liveToken);
}

async function liveLoop(token) {
  let i = 0;
  while (live && token === liveToken) {
    try {
      const p = bank[selected];
      if (!p || !p.length) { await sleep(100); continue; }
      if (i >= p.length) i = 0;
      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
      const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
      const sDur = stepMs - late;
      if (late) await sleep(late);
      markStep(i);
      if (st.notes.length) {
        for (const n of st.notes) { midi.sendNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
        await sleep(Math.max(12, sDur * gate));
        for (const n of st.notes) { midi.sendNoteOff(n.note); audio.noteOff(n.note); }
        await sleep(Math.max(3, sDur * (1 - gate)));
      } else await sleep(sDur);
      i++;
    } catch (e) { status("play error: " + (e.message || e), "err"); await sleep(200); }
  }
  clearPlayhead();
}

// --------------------------------------------------------------------------- //
// Themes (the FM-1's own seven)
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
  const menu = document.getElementById("themes");
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
// The rack
// --------------------------------------------------------------------------- //
// A section occupies `span` rails of the panel grid. Its controls are laid out on
// the SAME rail width, so every control in the panel lines up on one column
// regardless of which section it is in. A section with fewer controls than rails
// centres its sub-grid, which keeps the rail width identical.
function sect(title, span, kids) {
  const s = document.createElement("section");
  s.className = "sect";
  s.style.gridColumn = `span ${span}`;
  const h = document.createElement("h3");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "sgrid";
  const cols = Math.min(span, kids.length);
  g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  if (cols < span) { g.style.width = `${(cols / span) * 100}%`; g.style.margin = "0 auto"; }
  g.append(...kids);
  s.append(h, g);
  return s;
}

function buildRack() {
  const panel = document.getElementById("panel");

  panel.append(
    sect("Rhythm", 2, [
      R("tempo", knob({ label: "Tempo", min: 30, max: 300, value: state.tempo, def: DEFAULT.tempo, size: "lg",
        format: (v) => `${Math.round(v)}`, onInput: setState("tempo") })),
      R("swing", knob({ label: "Swing", min: 50, max: 75, value: state.swing, def: DEFAULT.swing, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("swing") })),
      R("gateProb", knob({ label: "Gate", min: 0, max: 100, value: state.gateProb, def: DEFAULT.gateProb, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gateProb") })),
      R("gateQuant", knob({ label: "Grid snap", min: 0, max: 100, value: state.gateQuant, def: DEFAULT.gateQuant, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gateQuant") })),
      R("snapGrid", knob({ label: "Snap grid", min: 2, max: 8, step: 1, value: state.snapGrid, def: DEFAULT.snapGrid, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: setState("snapGrid") })),
      R("gate", knob({ label: "Gate len", min: 5, max: 100, value: state.gate, def: DEFAULT.gate, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gate") })),
    ]),

    sect("Global", 2, [
      R("drift", knob({ label: "Drift", min: 0, max: 100, value: state.drift, def: DEFAULT.drift, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("drift") })),
      R("seed", num("Seed", state.seed, (v) => { state.seed = v | 0; scheduleRegen(); })),
      R("rate", sel("Note", RATE_NAMES.map((t, v) => ({ v, t })), state.rate, setState("rate", Number))),
      R("length", knob({ label: "Length", min: 1, max: 64, value: state.length, def: DEFAULT.length, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.length = v; refreshLoopRanges(); scheduleRegen(); } })),
      R("quantSteps", knob({ label: "Quantize", min: 0, max: 100, value: state.quantSteps, def: DEFAULT.quantSteps, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("quantSteps") })),
      R("unipolar", toggle({ label: "Unipolar", value: state.unipolar, onInput: setState("unipolar") })),
    ]),

    sect("Pitch", 2, [
      R("lfoWave", sel("Wave", LFO_WAVES.map((w) => ({ v: w, t: WAVE_SHORT[w] ?? w, title: w })), state.lfoWave, setState("lfoWave"))),
      R("lfoRate", knob({ label: "Cycles", min: 1, max: 16, step: 0.5, value: state.lfoRate, def: DEFAULT.lfoRate, size: "md",
        format: (v) => `${v}`, onInput: setState("lfoRate") })),
      R("lfoAmp", knob({ label: "Amp", min: 0, max: 100, value: state.lfoAmp, def: DEFAULT.lfoAmp, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("lfoAmp") })),
      R("lfoOffset", knob({ label: "Offset", min: -100, max: 100, value: state.lfoOffset, def: DEFAULT.lfoOffset, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: setState("lfoOffset") })),
      R("scale", sel("Scale", Object.keys(SCALES).map((s) => ({ v: s, t: s })), state.scale, setState("scale"))),
      R("root", knob({ label: "Root", min: 24, max: 84, value: state.root, def: DEFAULT.root, size: "md",
        format: (v) => midiName(v), onInput: setState("root") })),
    ]),

    sect("Shape", 6, [
      R("spread", sel("Spread", ["constant", "bell", "uniform", "extremes"].map((s) => ({ v: s, t: s })), state.spread, setState("spread"))),
      R("bias", knob({ label: "Bias", min: -100, max: 100, value: state.bias, def: DEFAULT.bias, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: setState("bias") })),
      R("humanize", knob({ label: "Humanize", min: 0, max: 100, value: state.humanize, def: DEFAULT.humanize, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("humanize") })),
      R("velocity", knob({ label: "Velocity", min: 1, max: 127, value: state.velocity, def: DEFAULT.velocity, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: setState("velocity") })),
      R("octave", knob({ label: "Octave up", min: 0, max: 100, value: state.octave, def: DEFAULT.octave, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("octave") })),
      R("gravity", knob({ label: "Root grav", min: 0, max: 100, value: state.gravity, def: DEFAULT.gravity, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gravity") })),
    ]),

    sect("Memory", 6, [
      R("loopFrom", knob({ label: "Loop from", min: 1, max: Math.max(1, state.length - 2), step: 1, value: state.loopFrom, def: DEFAULT.loopFrom, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.loopFrom = Math.round(v); refreshLoopRanges(); scheduleRegen(); } })),
      R("loop", knob({ label: "Loop len", min: 2, max: Math.max(2, state.length - 1), step: 1, value: state.loop, def: DEFAULT.loop, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.loop = Math.round(v); refreshLoopInfo(); scheduleRegen(); } })),
      R("dejaVu", knob({ label: "Deja Vu", min: 0, max: 100, value: state.dejaVu, def: DEFAULT.dejaVu, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("dejaVu") })),
    ]),
  );
}

// Short panel legends for the LFO waves: a real panel would not print
// "smoothRandom" on a 6mm switch. The full name stays in the tooltip.
const WAVE_SHORT = {
  sine: "sine", triangle: "tri", saw: "saw", square: "sqr",
  random: "random", randomWalk: "walk", smoothRandom: "smooth", sampleHold: "hold",
};

// panel switch (encoder-style) instead of a native <select>
function sel(label, opts, value, onInput) { return sw({ label, options: opts, value, onInput }); }

function num(label, value, onInput) {
  const wrap = document.createElement("label"); wrap.className = "sel";
  const inp = document.createElement("input");
  inp.type = "number"; inp.className = "seedbox"; inp.value = String(value);
  inp.addEventListener("input", () => { const v = Number(inp.value); if (Number.isFinite(v)) onInput(v); });
  const l = document.createElement("span"); l.textContent = label;
  wrap.append(inp, l);
  wrap.setValue = (v) => { inp.value = String(v); };
  return wrap;
}

// register a control under its state key; set(..., false) keeps it silent on sync
function R(key, el) { refs[key] = el; return el; }
const setState = (key, fn) => (v) => { state[key] = fn ? fn(v) : v; scheduleRegen(); };

// The loop region is [Loop from, Loop from + Loop len - 1]; neither knob may push the
// region past Length, so their ranges follow each other. The guard stops the clamp in
// setRange from re-entering through onInput.
let adjustingLoop = false;
function refreshLoopRanges() {
  if (adjustingLoop) return;
  const from = refs.loopFrom, len = refs.loop;
  if (!from || !len) return;
  adjustingLoop = true;
  try {
    const L = Math.max(3, Math.round(state.length || 64));
    from.setRange(1, Math.max(1, L - 2));
    const a = Math.round(from.value);
    len.setRange(2, Math.max(2, L - a + 1));
  } finally { adjustingLoop = false; }
  refreshLoopInfo();
}

function refreshLoopInfo() {
  const el = document.getElementById("loopinfo");
  if (!el) return;
  const L = Math.max(3, Math.round(state.length || 64));
  const a = Math.round(refs.loopFrom?.value ?? 1);
  const n = Math.round(refs.loop?.value ?? 8);
  const reps = (L - a + 1) / n;
  el.textContent = n >= 2 && a + n - 1 <= L ? `loop ${a}–${a + n - 1} ×${reps.toFixed(1)}` : "loop off";
}

// push state back into every control (used after Randomize)
function syncRack() {
  for (const [k, el] of Object.entries(refs)) if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  refreshLoopRanges();
}

// --------------------------------------------------------------------------- //
// Transport + init
// --------------------------------------------------------------------------- //
function randomize() {
  state.seed = (Math.random() * 1e9) | 0;
  Object.assign(state, {
    scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
    lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
    lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
    gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
    spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
    quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    gateQuant: (Math.random() * 100) | 0, humanize: (Math.random() * 100) | 0,
  });
  syncRack();
  doGenerate(true);
}

function buildTransport() {
  document.getElementById("gen").addEventListener("click", () => doGenerate(true));
  document.getElementById("rand").addEventListener("click", randomize);
  document.getElementById("audition").addEventListener("click", toggleLive);
  const muteBtn = document.getElementById("mute");
  muteBtn.addEventListener("click", () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
  });
  document.getElementById("freeze").addEventListener("click", () => doFreeze(selected));
  document.getElementById("fill").addEventListener("click", doSendAll);
  document.getElementById("clearall").addEventListener("click", doClearAll);
}

function buildEditor() {
  const p0 = () => bank[selected];
  document.getElementById("edown").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const cur = p0().steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur - 1);
  });
  document.getElementById("eup").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const cur = p0().steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur + 1);
  });
  document.getElementById("eclear").addEventListener("click", () => { if (editStep >= 0) setStepNote(editStep, null); });
  document.getElementById("elock").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const key = `${selected}:${editStep}`;
    if (locks.has(key)) locks.delete(key);
    else locks.set(key, p0().steps[editStep].notes.map((n) => ({ ...n })));
    renderBuffer(); refreshLockCount();
  });
  document.getElementById("eclearlocks").addEventListener("click", clearLocks);
  refreshLockCount();
}

async function initMidi() {
  const selEl = document.getElementById("device");
  const fill = () => {
    selEl.innerHTML = "";
    const outs = midi.listOutputs();
    const fm1 = midi.findFm1();
    for (const o of outs) {
      const op = document.createElement("option");
      op.value = o.id; op.textContent = o.name;
      if (fm1 && o.id === fm1.id) op.selected = true;
      selEl.appendChild(op);
    }
    if (!outs.length) selEl.innerHTML = "<option>— no MIDI —</option>";
    const led = document.getElementById("led");
    if (led) led.className = "led" + (fm1 ? " ok" : "");
    status(fm1 ? `FM-1: ${fm1.name}` : "FM-1 not found", fm1 ? "ok" : "");
  };
  try {
    await midi.initMidi(); fill(); midi.onStateChange(fill);
    selEl.addEventListener("change", fill);
  } catch (e) {
    status(String(e.message || e), "err");
    selEl.innerHTML = "<option>— Web MIDI blocked —</option>";
  }
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); toggleLive(); }
  if (e.key === "f") doFreeze(selected);
  if (e.key === "g") doGenerate(true);
  if (e.key === "ArrowRight") { selected = (selected + 1) % SLOTS; renderBank(); renderBuffer(); }
  if (e.key === "ArrowLeft") { selected = (selected + SLOTS - 1) % SLOTS; renderBank(); renderBuffer(); }
});

buildTheme();
buildRack();
refreshLoopRanges();
buildTransport();
buildEditor();
doGenerate(true);
initMidi();
