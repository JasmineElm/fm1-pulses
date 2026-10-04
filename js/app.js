// app.js — FM-1 Pulses: generate a 16-slot bank (evolving), freeze to the FM-1.
import { generate, generateBank, SCALES, LFO_WAVES, midiName } from "./generator.js";
import { encodeWrite, emptyPattern } from "./pattern.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
const SLOTS = 16;

// rate index -> duration in quarter notes (1/32 = a quarter/8, etc.)
const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];

// Triplet swing: 50% = straight, 75% = the offbeat lands 1/3 of a step late (2:1).
// The pair keeps its length; the first step stretches and the second shortens.
function swingFrac() {
  const s = Math.min(75, Math.max(50, state.swing ?? 50));
  return ((s - 50) / 25) / 3;
}

// Pitch mapping (must match generator.js): Offset is the centre of the range and
// Amplitude is its half-width, so notes swing +/- SPAN/2 semitones around Offset.
const SPAN = 36;
const ampSemi = (a) => (a / 100) * (SPAN / 2);   // amplitude % -> +/- semitones
const offSemi = (o) => (o / 100) * (SPAN / 2);   // offset % -> centre shift (semitones)
const centreNote = () => state.root + offSemi(state.lfoOffset);
// "Magnets": values where the LFO lands on a simple interval from the root.
const MAG_INTERVALS = [0, 3, 5, 7, 12, 18];      // root, m3, 4th, 5th, octave, 12th
const toPct = (semis) => Math.round((semis / (SPAN / 2)) * 100);
const AMP_MAGNETS = MAG_INTERVALS.map(toPct);
const OFF_MAGNETS = [...new Set([0, ...MAG_INTERVALS.slice(1).flatMap((s) => [-s, s])].map(toPct))].sort((a, b) => a - b);

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, humanize: 0,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoAmp: 50, lfoOffset: 0, lfoRate: 16, octave: 0,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0,
};
const state = { ...DEFAULT };
let bank = [];          // 16 patterns
let selected = 0;       // 0..15
let busy = false;

// --------------------------------------------------------------------------- //
// Controls
// --------------------------------------------------------------------------- //
const CONTROLS = [
  { sec: "Bank", items: [
    { k: "drift", t: "range", label: "Drift", min: 0, max: 100, suffix: "%",
      help: "How far the parameters evolve across the bank, slot 1 → slot 16. 0% = all 16 share the parameters; higher = they drift apart (density, amplitude, bias, LFO speed…)." },
    { k: "seed", t: "num", label: "Seed",
      help: "The one seed every slot is derived from. Same seed + same settings = the same bank." },
  ] },
  { sec: "Pitch", items: [
    { k: "scale", t: "select", label: "Scale", opts: Object.keys(SCALES),
      help: "Notes are quantised to this scale." },
    { k: "root", t: "range", label: "Root", min: 24, max: 84, fmt: midiName,
      help: "The scale's root note (MIDI number) that notes quantise to. The Offset control sets where the pitch range sits; at Amplitude 0 every note lands on the Offset note, not here." },
    { k: "lfoWave", t: "select", label: "LFO wave", opts: LFO_WAVES,
      help: "The pitch source. sine/triangle/saw/square are deterministic contours; random draws a fresh value from the Spread distribution every (length ÷ cycles) steps — this is where Spread and Bias really bite; randomWalk/smoothRandom/sampleHold are the older random shapes." },
    { k: "lfoAmp", t: "range", label: "Amplitude", min: 0, max: 100, suffix: "%",
      magnets: AMP_MAGNETS,
      readout: (v) => { const c = centreNote(), s = ampSemi(v); return `${midiName(c - s)}–${midiName(c + s)}`; },
      help: "Pitch spread, shown as the note range it produces, centred on Offset. 0% = every note is the Offset note; 100% = ±18 semitones. Snaps to root/3rd/5th/octave." },
    { k: "lfoOffset", t: "range", label: "Offset", min: -100, max: 100,
      magnets: OFF_MAGNETS,
      readout: (v) => midiName(state.root + offSemi(v)),
      help: "The centre (median) of the pitch range. Amplitude spreads notes evenly above and below this note. Snaps to intervals from the root." },
    { k: "lfoRate", t: "range", label: "LFO cycles", min: 1, max: 24, step: 0.5,
      help: "How many LFO cycles fit across the pattern (higher = faster). Whole numbers land exactly on the phrase and repeat; fractional values drift, so every pass differs. Random wave: a new value every (pattern length ÷ cycles) steps." },
    { k: "octave", t: "range", label: "Octave up", min: 0, max: 100, suffix: "%",
      help: "Chance a note jumps up one octave. Since the jump is 12 semitones it keeps the same scale degree, so it never breaks the key. 0% = never. The jump is in the note, so the FM-1 plays it too." },
  ] },
  { sec: "Density", items: [
    { k: "gateProb", t: "range", label: "Gate", min: 0, max: 100, suffix: "%",
      help: "Probability each step plays a note. 0% = silence, 100% = every step. This is the rhythmic density." },
    { k: "velocity", t: "range", label: "Velocity", min: 1, max: 127,
      help: "Base note velocity. Only the browser/live-MIDI audition uses it — the FM-1 plays its own velocity on pattern playback." },
    { k: "humanize", t: "range", label: "Humanize", min: 0, max: 100, suffix: "%",
      help: "Random velocity deviation per note: ±40 at 100%, none at 0%. Same caveat as Velocity — the FM-1's sequencer does not play stored velocities, so this shows up in the audition / live MIDI." },
  ] },
  { sec: "Character", items: [
    { k: "spread", t: "select", label: "Spread", opts: ["constant", "bell", "uniform", "extremes"],
      help: "Shapes how the LFO value maps to notes: constant (no movement), bell (centre-weighted), uniform (flat), extremes (only the low/high ends)." },
    { k: "bias", t: "range", label: "Bias", min: -100, max: 100,
      help: "Skews the note distribution toward low (−) or high (+). Not a pitch shift — it changes how likely each register is." },
    { k: "quantSteps", t: "range", label: "Quantize", min: 0, max: 100, suffix: "%",
      help: "Snap strength to the scale. 100% = always in scale, lower lets chromatic passing notes through." },
  ] },
  { sec: "Memory", items: [
    { k: "dejaVu", t: "range", label: "Deja Vu", min: 0, max: 100, suffix: "%",
      help: "How much each slot reuses the previous slot's notes. 0% = fully fresh, 100% = a locked loop. Applied across the bank." },
  ] },
  { sec: "Pattern", items: [
    { k: "rate", t: "select", label: "Note value", opts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], fmt: (v) => RATE_NAMES[v],
      help: "The note value of one step, which sets the bar length. At 1/32 a 64-step phrase is 2 bars; at 1/16 it is 4 bars. Written to the FM-1." },
    { k: "tempo", t: "range", label: "Tempo", min: 30, max: 300, suffix: " BPM",
      help: "Playback tempo. Written into the pattern header and used by the live audition." },
    { k: "gate", t: "range", label: "Gate length", min: 5, max: 100, suffix: "%",
      help: "How much of each step a note holds. Low = staccato, high = legato. Written into the pattern header." },
    { k: "swing", t: "range", label: "Swing", min: 50, max: 75, suffix: "%",
      help: "Delays every other step for a shuffle feel. 50% = straight, 75% = triplet (2:1). Applied in the browser audition and written into the pattern for the FM-1." },
    { k: "length", t: "range", label: "Length", min: 1, max: 64, suffix: " steps",
      help: "How many of the 64 steps the pattern plays. Written into the pattern header." },
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
      if (it.help) row.title = it.help;
      const name = document.createElement("span"); name.textContent = it.label;
      if (it.help) name.title = it.help;
      const numSel = it.t === "select" && it.opts.every((o) => typeof o === "number");
      let inp, box = null;
      if (it.t === "select") {
        inp = document.createElement("select");
        for (const o of it.opts) {
          const op = document.createElement("option");
          op.value = String(o);
          op.textContent = it.fmt ? it.fmt(o) : String(o);
          inp.appendChild(op);
        }
      } else {
        inp = document.createElement("input");
        if (it.t === "num") {
          inp.type = "number"; if (it.min != null) inp.min = it.min; if (it.max != null) inp.max = it.max; inp.step = 1;
        } else {
          inp.type = "range"; inp.min = it.min; inp.max = it.max; inp.step = it.step || 1;
          // typeable box for exact values
          box = document.createElement("input");
          box.type = "number"; box.className = "box";
          box.min = it.min; box.max = it.max; box.step = it.step || 1;
          box.title = "Type an exact value";
        }
      }
      const out = it.t === "range" ? document.createElement("b") : null;
      const read = () => (it.t === "range" || it.t === "num" || numSel) ? Number(inp.value) : inp.value;
      // magnet tick marks on the slider (datalist renders as ticks in Chrome)
      if (it.magnets && it.t === "range") {
        const dl = document.createElement("datalist"); dl.id = "mag-" + it.k;
        for (const m of it.magnets) {
          if (m >= it.min && m <= it.max) { const op = document.createElement("option"); op.value = String(m); dl.appendChild(op); }
        }
        row.appendChild(dl);
        inp.setAttribute("list", dl.id);
      }
      const label = (v) => it.readout ? it.readout(v)
        : (it.suffix || (it.fmt && it.fmt(v) !== String(v) ? it.fmt(v) : ""));
      const sync = () => {
        const v = read();
        state[it.k] = v;
        if (box) box.value = String(v);
        if (out) out.textContent = label(v);
        if (it.k === "root") { refs.lfoAmp?.sync(); refs.lfoOffset?.sync(); }
        if (it.k === "lfoOffset") refs.lfoAmp?.sync();
      };
      inp.addEventListener("input", () => { sync(); scheduleRegen(); });
      // soft magnet: on release, snap to a nearby interval mark
      if (it.magnets && it.t === "range") {
        inp.addEventListener("change", () => {
          const v = Number(inp.value);
          let best = v, bd = 99;
          for (const m of it.magnets) { const d = Math.abs(v - m); if (d < bd) { bd = d; best = m; } }
          if (bd <= 2 && best !== v) { inp.value = String(best); sync(); scheduleRegen(); }
        });
      }
      if (box) {
        box.value = String(state[it.k]);
        box.addEventListener("input", () => {
          let v = Number(box.value);
          if (!Number.isFinite(v)) return;
          v = Math.min(it.max, Math.max(it.min, Math.round(v)));
          inp.value = String(v);
          sync(); scheduleRegen();
        });
      }
      inp.value = String(state[it.k]); sync();
      if (it.t === "select" || it.t === "num") { inp.classList.add("span2"); row.append(name, inp); }
      else row.append(name, inp, box, out);
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
    cell.addEventListener("click", () => { selected = s; renderBank(); renderBuffer(); if (!live) playOnce(); });
    el.appendChild(cell);
  }
  const tot = bank.reduce((a, p) => a + noteCount(p), 0);
  const el2 = document.getElementById("bankinfo");
  if (el2) el2.textContent = bank.length ? `16 slots · ${tot} notes · drift ${state.drift}%` : "";
}

// ---- step editing + locks --------------------------------------------------
// A locked step keeps its notes when the bank regenerates. Locks are per
// (slot, step), so you can pin notes in any of the 16 slots.
const locks = new Map();      // "slot:step" -> [{ note, vel }]
let editStep = -1;

const locked = (slot, i) => locks.has(`${slot}:${i}`);

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
    noteEl.textContent = "click a step to edit it";
    lockBtn.textContent = "🔓 unlocked"; lockBtn.classList.remove("on");
    return;
  }
  const notes = p.steps[editStep].notes;
  noteEl.textContent = notes.length ? notes.map((n) => midiName(n.note)).join(" ") : "(empty)";
  const isL = locked(selected, editStep);
  lockBtn.textContent = isL ? "🔒 locked" : "🔓 unlocked";
  lockBtn.classList.toggle("on", isL);
}

function selectStep(i) { editStep = i; renderBuffer(); }

// set a step's note (null = empty) and lock it so it survives regeneration
function setStepNote(i, note) {
  const p = bank[selected];
  if (!p || !p.steps[i]) return;
  if (note == null) {
    p.steps[i].notes = [];
  } else {
    const v = p.steps[i].notes[0]?.vel ?? (typeof state.velocity === "number" ? state.velocity : 100);
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
    const on = i < p.length && st && st.notes.length;
    if (on) {
      cell.textContent = midiName(st.notes[0].note);
      cell.classList.add("on");
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else if (i >= p.length) {
      cell.classList.add("off");
    }
    if (locked(selected, i)) cell.classList.add("locked");
    if (i === editStep) cell.classList.add("edit");
    cell.addEventListener("click", () => selectStep(i));
    el.appendChild(cell);
  }
  document.getElementById("selnum").textContent = String(selected + 1);
  document.getElementById("bufinfo").textContent =
    `${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount(p)} notes`;
  renderEditor();
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
  applyLocks();
  renderBank(); renderBuffer();
  status(`generated 16 slots (seed ${state.seed}, drift ${state.drift}%)`);
}

async function doFreeze(slotIndex) {
  if (!bank[slotIndex]) return;
  syncHeader();
  const msgs = encodeWrite(bank[slotIndex], slotIndex, true);
  try {
    status(`freezing slot ${slotIndex + 1}…`);
    const name = await midi.sendPattern(msgs, `slot ${slotIndex + 1}`);
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
      await midi.sendPattern(encodeWrite(bank[i], i, true), `slot ${i + 1}`);
    }
    status(`all ${SLOTS} slots frozen ✓`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

// Erase all 16 sequencer patterns on the FM-1 by writing empty ones. This is
// destructive on the device, so it asks first; the browser bank is untouched.
async function doClearAll() {
  if (busy || !bank.length) return;
  if (!confirm(`Erase all ${SLOTS} patterns on the FM-1?\n\nThis overwrites them with empty patterns. The browser bank is not affected.`)) return;
  busy = true;
  try {
    // Always clear a full 64 steps: a shorter length would leave the tail of the
    // FM-1's pattern intact, and only 8 messages erase all 64.
    const blank = emptyPattern(64, state.rate, state.tempo, state.gate, state.swing);
    for (let i = 0; i < SLOTS; i++) {
      status(`clearing ${i + 1}/${SLOTS}…`);
      await midi.sendPattern(encodeWrite(blank, i, true), `slot ${i + 1}`);
    }
    status(`all ${SLOTS} patterns cleared ✓`, "ok");
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
    applyLocks();
    renderBank(); renderBuffer();
  }, 40);
}

// Looping audition: plays the selected slot continuously, re-reading the live
// pattern every step so slider changes are heard as they happen.
let live = false, liveToken = 0, nowCell = null, liveStep = -1, onceToken = 0;

// one-shot preview of the selected slot (browser synth + FM-1 if attached)
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
    const late = i % 2 === 1 ? stepMs * swingFrac() : 0;   // swing the offbeat
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
  onceToken++;                 // cancel any one-shot preview
  live = true; liveToken++;
  audio.unlock();
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
      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
      const late = i % 2 === 1 ? stepMs * swingFrac() : 0;   // swing the offbeat
      const sDur = stepMs - late;
      if (late) await sleep(late);
      markStep(i);
      if (st.notes.length) {
        for (const n of st.notes) { midi.sendNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
        await sleep(Math.max(12, sDur * gate));
        for (const n of st.notes) { midi.sendNoteOff(n.note); audio.noteOff(n.note); }
        await sleep(Math.max(3, sDur * (1 - gate)));
      } else {
        await sleep(sDur);
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
  const muteBtn = document.getElementById("mute");
  if (muteBtn) muteBtn.addEventListener("click", () => { const m = !audio.isMuted(); audio.setMuted(m); muteBtn.textContent = m ? "🔇" : "🔊"; status(m ? "browser audio muted" : "browser audio on"); });
  document.getElementById("freeze").addEventListener("click", () => doFreeze(selected));
  document.getElementById("fill").addEventListener("click", doSendAll);
  document.getElementById("clearall").addEventListener("click", doClearAll);
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
buildEditor();
buildFooter();
doGenerate(true);
initMidi();
