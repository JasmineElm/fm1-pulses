// rack.js — the single-module knob UI. Same engine as app.js (generator, pattern,
// midi, audio); only the controls differ: one portrait case, knobs on top and the
// pattern display inside the case below. app.js and the MVP are untouched.
import { generate, generateBank, SCALES, LFO_WAVES, midiName, classicName } from "./generator.js?v=65";
import { encodeWrite, emptyPattern } from "./pattern.js?v=65";
import * as midi from "./midi.js?v=65";
import * as audio from "./audio.js?v=65";
import { knob, sw } from "./knob.js?v=66";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
const SLOTS = 16;

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, humanize: 0, gateQuant: 0, snapGrid: 4,
  gateBlend: 0, euclidRot: 0,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoShape: 0, lfoAmp: 50, lfoOffset: 0, lfoRate: 4, octave: 0, gravity: 0, unipolar: false,
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
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // loop region, 0-based
  const ln = Math.round(state.loop ?? 0);
  for (let s = 0; s < SLOTS; s++) {
    const p = bank[s];
    const cell = document.createElement("button");
    cell.className = "bankcell" + (s === selected ? " sel" : "");
    const num = document.createElement("span"); num.className = "bn"; num.textContent = s + 1;
    const mini = document.createElement("div"); mini.className = "mini";
    const loopOn = p && ln >= 2 && ls + ln <= p.length;
    for (let i = 0; i < 64; i++) {
      const d = document.createElement("i");
      const cls = [];
      if (p && i < p.length && p.steps[i] && p.steps[i].notes.length) cls.push("on");
      if (loopOn && i >= ls && i < ls + ln) {
        cls.push("loop");
        if (i === ls) cls.push("loopstart");
      }
      d.className = cls.join(" ");
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
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // loop region, 0-based
  const ln = Math.round(state.loop ?? 0);
  const loopOn = ln >= 2 && ls + ln <= p.length;
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
    if (loopOn && i >= ls && i < ls + ln) {
      cell.classList.add("loop");
      if (i === ls) cell.classList.add("loopstart");
    }
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
  scheduleTempoProbe();
}

// Trailing device-tempo probe: every control tweak schedules ONE read that fires
// 1.2s after the user stops interacting. Dragging resets the timer, so there is
// no traffic while turning a knob — just one read after the hand leaves it. The
// busy flag keeps a slow reply from overlapping the next probe.
let tempoProbeTimer = null;
let tempoProbeBusy = false;
function scheduleTempoProbe() {
  if (!midi.hasAccess()) return;
  clearTimeout(tempoProbeTimer);
  tempoProbeTimer = setTimeout(() => {
    if (tempoProbeBusy || !midi.findFm1()) return;
    tempoProbeBusy = true;
    const before = state.tempo;
    syncDeviceTempo().catch(() => null).finally(() => { tempoProbeBusy = false; })
      .then((held) => {
        if (held && held !== before) status(`device BPM: ${held} — Tempo synced`, "ok");
      });
  }, 1200);
}

// --------------------------------------------------------------------------- //
// Freeze / clear
// --------------------------------------------------------------------------- //
// The FM-1 keeps each pattern's tempo in its global settings block, as a
// little-endian halfword at gset[66 + 2*pattern]. Read it back so a freeze can
// report what the DEVICE is holding, not just what we sent.
const GSET_ADDR = 0x01C0E840 + 5816;
const GSET_LEN = 137;
async function readBack(pat) {
  const data = await midi.readMemory(GSET_ADDR, GSET_LEN);
  if (data.length < 68 + 2 * pat) throw new Error(`short read (${data.length} bytes)`);
  return { tempo: data[66 + 2 * pat] | (data[67 + 2 * pat] << 7), data };
}
const hex = (a) => Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(" ");

// Diagnostic: dump the whole settings block. Change ONE thing on the FM-1 itself
// (e.g. its tempo), read again, and the bytes that moved are that setting — which
// pins the true offset for this firmware instead of trusting another version's map.
async function dumpGset() {
  try {
    status("reading the device's settings block…");
    const data = await midi.readMemory(GSET_ADDR, GSET_LEN);
    await syncDeviceTempo(data);
    const rows = [];
    for (let i = 0; i < data.length; i += 16) {
      rows.push(String(i).padStart(3, "0") + ": " +
        Array.from(data.slice(i, i + 16)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    }
    alert(`FM-1 global settings, ${data.length} bytes\n\n${rows.join("\n")}`);
    status(`read ${data.length} bytes · Tempo synced to the device's BPM`, "ok");
  } catch (e) { status("read failed: " + (e.message || e), "err"); }
}

// The FM-1's tempo is unit-global (mirrored across all 16 slots) and the 0x20
// header tempo is acked but ignored by the firmware, so the DEVICE is the source
// of truth: read it and snap the Tempo knob to it — what you see is what plays.
// `data` skips the read when a caller already has the settings block.
async function syncDeviceTempo(data = null, retries = 2) {
  try {
    if (!data) data = await midi.readMemory(GSET_ADDR, GSET_LEN);
    const held = data[66 + 2 * selected] | (data[67 + 2 * selected] << 7);
    if (held >= 30 && held <= 300) {
      state.tempo = held;
      refs.tempo?.setValue(held, false);
      return held;
    }
    return null;
  } catch (e) {
    if (retries > 0) return syncDeviceTempo(null, retries - 1);
    return null;
  }
}

async function doFreeze(slotIndex) {
  if (!bank[slotIndex]) return;
  syncHeader();
  try {
    status(`freezing slot ${slotIndex + 1} · ${Math.round(state.tempo)} bpm · ${RATE_NAMES[state.rate]}…`);
    const name = await midi.sendPattern(encodeWrite(bank[slotIndex], slotIndex, true), `slot ${slotIndex + 1}`);
    // read it back: did the DEVICE store the tempo we just sent? (Spoiler on
    // Baud Girl 093: never. The tempo bytes are acked and discarded, so we
    // re-sync the knob to the device's real BPM instead of pretending.)
    try {
      const { tempo: held, data } = await readBack(slotIndex);
      const want = Math.round(state.tempo);
      const off = 66 + 2 * slotIndex;
      if (held !== want) {
        await syncDeviceTempo(data);
        status(`slot ${slotIndex + 1} frozen ✓ · FM-1 holds ${held} bpm (sent ${want}) — tempo is device-global on this firmware, so Tempo now shows the device's BPM`,
          "err");
      } else {
        status(`slot ${slotIndex + 1} frozen ✓ · sent ${want} bpm, device holds ${held} bpm`, "ok");
      }
    } catch (e) {
      await syncDeviceTempo();
      status(`slot ${slotIndex + 1} frozen ✓ (read-back: ${e.message || e})`, "ok");
    }
  } catch (e) { status(String(e.message || e), "err"); }
}

async function doSendAll() {
  if (busy || !bank.length) return;
  busy = true;
  try {
    syncHeader();
    for (let i = 0; i < SLOTS; i++) {
      status(`freezing ${i + 1}/${SLOTS} · ${Math.round(state.tempo)} bpm · ${RATE_NAMES[state.rate]}…`);
      await midi.sendPattern(encodeWrite(bank[i], i, true), `slot ${i + 1}`);
    }
    const held = await syncDeviceTempo();
    status(`all ${SLOTS} slots frozen ✓${held ? ` · device holds ${held} bpm` : ""}`, "ok");
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
    const held = await syncDeviceTempo();
    status(`all ${SLOTS} patterns cleared ✓${held ? ` · device holds ${held} bpm` : ""}`, "ok");
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
  // WYSIWYG: re-read the device's BPM on Play so the loop matches the unit
  // even if its tempo knob moved since the last sync.
  syncDeviceTempo().then((held) => {
    if (held) status(`playing · device holds ${held} BPM — Tempo synced`, "ok");
  });
  liveLoop(liveToken);
}

// Scheduled against an ABSOLUTE clock, not by accumulating relative sleeps.
// The gate floors below (max 12ms note, max 3ms release) otherwise ADD to each
// step instead of eating into it, which measured up to 16% slow at low gate on
// short steps. Every step now waits until its own target time, so overhead and
// the floors cannot accumulate.
async function liveLoop(token) {
  const t0 = performance.now();
  let elapsed = 0;      // ms into the phrase, on the absolute clock
  let i = 0;
  while (live && token === liveToken) {
    try {
      const p = bank[selected];
      if (!p || !p.length) { await sleep(100); t0 += 100; continue; }
      if (i >= p.length) i = 0;
      // if we fell a long way behind (throttled tab), re-anchor instead of bursting
      if (performance.now() - (t0 + elapsed) > 250) t0 = performance.now() - elapsed;

      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
      const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
      const sDur = stepMs - late;

      const startAt = t0 + elapsed + late;
      let w = startAt - performance.now();
      if (w > 0) await sleep(w);
      markStep(i);
      if (st.notes.length) {
        for (const n of st.notes) { midi.sendNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
        const offAt = startAt + Math.max(12, sDur * gate);
        w = offAt - performance.now(); if (w > 0) await sleep(w);
        for (const n of st.notes) { midi.sendNoteOff(n.note); audio.noteOff(n.note); }
      }
      w = (t0 + elapsed + stepMs) - performance.now();
      if (w > 0) await sleep(w);
      elapsed += stepMs;
      i++;
    } catch (e) { status("play error: " + (e.message || e), "err"); await sleep(200); t0 += 200; }
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
// the SAME rail width, so every control in the panel lines up on one column.
// A section with fewer controls than rails places them on WHOLE columns (an
// integer offset), never by centring on width — centring lands on half-rails and
// breaks the alignment.
function sect(title, span, kids) {
  const s = document.createElement("section");
  s.className = "sect";
  s.style.gridColumn = `span ${span}`;
  const h = document.createElement("h3");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "sgrid";
  g.style.gridTemplateColumns = `repeat(${span}, minmax(0, 1fr))`;
  const off = Math.floor((span - Math.min(span, kids.length)) / 2);
  kids.forEach((k, i) => {
    if (off) k.style.gridColumn = `${off + i + 1}`;
  });
  g.append(...kids);
  s.append(h, g);
  return s;
}

function buildRack() {
  const panel = document.getElementById("panel");

  panel.append(
    sect("Rhythm", 2, [
      R("tempo", knob({ label: "Tempo", min: 30, max: 300, value: state.tempo, def: DEFAULT.tempo, size: "lg",
        format: (v) => `${Math.round(v)}`, onInput: setState("tempo"),
        onDblClick: () => {
          syncDeviceTempo().then((held) => {
            status(held ? `device holds ${held} BPM — Tempo synced` : "could not read the device tempo", held ? "ok" : "err");
          });
        },
        tip: "BPM is device-global on the FM-1 — freezing cannot change it; the unit's own BPM governs playback. The app re-syncs to the device after a freeze; double-click re-reads now." })),
      R("swing", knob({ label: "Swing", min: 50, max: 75, value: state.swing, def: DEFAULT.swing, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("swing") })),
      R("gateProb", knob({ label: "Gate", min: 0, max: 100, value: state.gateProb, def: DEFAULT.gateProb, size: "lg",
        format: (v) => `${Math.round(v)}%`,
        onInput: (v) => { state.gateProb = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "random mode: chance each step fires. euclid mode: the DENSITY — Gate % becomes N hits evenly spaced over the cycle (see the loop info line)." })),
      R("gateBlend", knob({ label: "Euclid", min: 0, max: 100, value: state.gateBlend, def: DEFAULT.gateBlend, size: "md",
        format: (v) => v <= 0 ? "random" : v >= 100 ? "euclid" : `${Math.round(v)}%`,
        onInput: (v) => { state.gateBlend = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "Gradient between random placement (0%) and even Euclidean spacing (100%). In between, each step rolls which law it follows — Gate % is the density either way." })),
      R("euclidRot", knob({ label: "Rotate", min: 0, max: 15, step: 1, value: state.euclidRot, def: DEFAULT.euclidRot, size: "sm",
        format: (v) => `${Math.round(v)}`,
        onInput: (v) => { state.euclidRot = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "Rotates the Euclidean hit pattern within its cycle (wraps). Only affects the euclid side of the gradient." })),
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
      R("seed", num("Seed", state.seed, (v) => { state.seed = v | 0; scheduleRegen(); }, { size: "sm" })),
      R("rate", rotary("Note", RATE_NAMES.map((t, v) => ({ v, t })), state.rate, (v) => { state.rate = Number(v); refreshLoopRanges(); scheduleRegen(); }, "sm")),
      R("length", knob({ label: "Length", min: 1, max: 64, value: state.length, def: DEFAULT.length, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.length = v; refreshLoopRanges(); scheduleRegen(); } })),
      R("quantSteps", knob({ label: "Quantize", min: 0, max: 100, value: state.quantSteps, def: DEFAULT.quantSteps, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("quantSteps") })),
      R("unipolar", rotary("Unipolar", [{ v: false, t: "off" }, { v: true, t: "on" }], state.unipolar, (v) => { state.unipolar = !!v; scheduleRegen(); }, "sm")),
    ]),

    sect("Pitch", 2, [
      R("lfoWave", rotary("Wave", LFO_WAVES.map((w) => ({ v: w, t: WAVE_SHORT[w] ?? w })), state.lfoWave, (v) => { state.lfoWave = v; scheduleRegen(); }, "sm")),
      R("lfoShape", knob({ label: "Shape", min: 0, max: 100, value: state.lfoShape, def: DEFAULT.lfoShape, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("lfoShape"),
        tip: "wave morph — sine: fold amount; triangle/saw: curve bend; square: pulse width 50→5%; perlin: octave shimmer; randomWalk: step size; smoothRandom: slew." })),
      R("lfoRate", knob({ label: "Cycles", min: 1, max: 16, step: 0.5, value: state.lfoRate, def: DEFAULT.lfoRate, size: "md",
        format: (v) => `${v}`, onInput: setState("lfoRate") })),
      R("lfoAmp", knob({ label: "Amp", min: 0, max: 100, value: state.lfoAmp, def: DEFAULT.lfoAmp, size: "lg",
        format: (v) => `${Math.round(v)}%`, onInput: setState("lfoAmp") })),
      R("lfoOffset", knob({ label: "Offset", min: -100, max: 100, value: state.lfoOffset, def: DEFAULT.lfoOffset, size: "lg",
        format: (v) => `${Math.round(v)}`, onInput: setState("lfoOffset") })),
      R("scale", rotary("Scale", Object.keys(SCALES).map((s) => ({ v: s, t: s })), state.scale, (v) => { state.scale = v; scheduleRegen(); }, "sm")),
      R("root", knob({ label: "Root", min: 24, max: 84, value: state.root, def: DEFAULT.root, size: "md",
        format: (v) => midiName(v), onInput: setState("root") })),
    ]),

    sect("Shape", 6, [
      R("spread", rotary("Spread", ["constant", "bell", "uniform", "extremes"].map((s) => ({ v: s, t: s })), state.spread, (v) => { state.spread = v; scheduleRegen(); }, "sm")),
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
  sine: "sine", triangle: "tri", saw: "saw", square: "sqr", perlin: "perlin",
  random: "random", randomWalk: "walk", smoothRandom: "smooth", sampleHold: "hold",
};

// A ROTARY SWITCH: a knob over a list of options, one detent per position, with
// the chosen name printed underneath. This is what hardware does with a discrete
// setting — no text box anywhere on the panel.
function rotary(label, opts, value, onInput, size = "md") {
  const el = knob({
    label, min: 0, max: opts.length - 1, step: 1,
    value: Math.max(0, opts.findIndex((o) => String(o.v) === String(value))),
    def: 0, size, ticks: Math.max(1, opts.length - 1), majorEvery: 0, smallVal: true,
    format: (v) => opts[Math.min(opts.length - 1, Math.max(0, Math.round(v)))]?.t ?? "",
    onInput: (v) => { const o = opts[Math.round(v)]; if (o) onInput(o.v); },
  });
  const setIdx = el.setValue;
  el.setValue = (v) => {
    const i = opts.findIndex((o) => String(o.v) === String(v));
    if (i >= 0) setIdx(i, false);
  };
  return el;
}

function num(label, value, onInput, extra = {}) {
  const el = knob({
    label, min: 0, max: 999999999, step: 1, value: Math.max(0, Math.round(value) % 1000000000),
    def: 0, size: "sm", onInput: (v) => onInput(v | 0),
    format: (v) => String(Math.round(v)),
    ...extra,
  });
  return el;
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
  const loopTxt = n >= 2 && a + n - 1 <= L ? `loop ${a}–${a + n - 1} ×${reps.toFixed(1)}` : "loop off";
  if (state.gateBlend > 0) {
    const blend = Math.min(100, Math.max(0, state.gateBlend ?? 0)) / 100;
    const M = Math.max(2, n >= 2 ? n : 16);
    const N = Math.max(0, Math.min(M, Math.round((state.gateProb ?? 70) / 100 * M)));
    const rot = ((state.euclidRot ?? 0) % M + M) % M;
    el.textContent = `${loopTxt} · E(${N},${M})${rot ? " rot " + rot : ""}${blend < 1 ? " @" + Math.round(blend * 100) + "%" : ""}`;
  } else el.textContent = loopTxt;
}

// push state back into every control (used after Randomize)
function syncRack() {
  for (const [k, el] of Object.entries(refs)) if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  refreshLoopRanges();
}

// --------------------------------------------------------------------------- //
// Export / import — the bank is fully reproducible from state + locks, so a
// JSON file IS the song. The .syx download is the same bank in the FM-1's own
// SysEx format, for anyone who pushes patterns with another tool.
// --------------------------------------------------------------------------- //
const STATE_VERSION = 1;

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportState() {
  const data = {
    app: "fm1-pulses",
    version: STATE_VERSION,
    seed: state.seed >>> 0,
    params: { ...state },
    locks: Object.fromEntries(locks),
    selected,
  };
  download(`fm1p-${state.seed >>> 0}.json`, JSON.stringify(data, null, 2), "application/json");
  status(`exported seed ${state.seed >>> 0} ✓`);
}

async function importState(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== "fm1-pulses") throw new Error("not an FM-1 Pulses file");
    if (d.params) Object.assign(state, d.params);
    else if (d.seed != null) Object.assign(state, d);   // tolerate files saved as raw state
    for (const k of Object.keys(state)) if (!(k in DEFAULT)) delete state[k];
    state.seed = (d.seed ?? state.seed) >>> 0;
    locks.clear();
    for (const [k, v] of Object.entries(d.locks ?? {})) locks.set(k, v.map((n) => ({ ...n })));
    selected = Math.max(0, Math.min(SLOTS - 1, Number(d.selected) || 0));
    syncRack(); refreshLoopInfo();
    doGenerate(false);
    refreshLockCount();
    status(`imported seed ${state.seed >>> 0} ✓`);
  } catch (e) {
    status("import failed: " + (e.message || e), "err");
  }
}

function exportSysex() {
  syncHeader();
  const bytes = [];
  for (let i = 0; i < SLOTS; i++) for (const m of encodeWrite(bank[i], i, true)) bytes.push(...m);
  download(`fm1p-${state.seed >>> 0}.syx`, new Uint8Array(bytes), "application/octet-stream");
  status(`bank .syx downloaded ✓ (${bytes.length} bytes, 16 slots)`);
}

// --------------------------------------------------------------------------- //
// Transport + init
// --------------------------------------------------------------------------- //
function randomize() {
  state.seed = (Math.random() * 1e9) | 0;
  Object.assign(state, {
    scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
    lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
    lfoShape: (Math.random() * 100) | 0,
    lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
    gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
    spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
    quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    gateQuant: (Math.random() * 100) | 0, humanize: (Math.random() * 100) | 0,
    gateBlend: (Math.random() * 100) | 0, euclidRot: (Math.random() * 16) | 0,
  });
  syncRack();
  doGenerate(true);
}

function buildTransport() {
  document.getElementById("gen").addEventListener("click", () => doGenerate(true));
  document.getElementById("rand").addEventListener("click", randomize);
  document.getElementById("audition").addEventListener("click", toggleLive);
  // preview timbre: a UI preference, not part of the generative state
  const muteBtn = document.getElementById("mute");
  const soundEl = sw({
    label: "sound",
    options: audio.SOUNDS.map((s) => ({ v: s.id, t: s.name })),
    value: localStorage.getItem("fm1p.sound") || audio.getSound(),
    onInput: (id) => {
      audio.setSound(id);
      localStorage.setItem("fm1p.sound", id);
      status(`preview: ${audio.SOUNDS.find((s) => s.id === id)?.name ?? id}`);
    },
  });
  muteBtn.insertAdjacentElement("beforebegin", soundEl);
  document.getElementById("export")?.addEventListener("click", exportState);
  const finp = document.getElementById("importfile");
  document.getElementById("import")?.addEventListener("click", () => finp.click());
  finp.addEventListener("change", () => {
    const f = finp.files[0];
    if (f) importState(f);
    finp.value = "";
  });
  document.getElementById("syx")?.addEventListener("click", exportSysex);
  muteBtn.addEventListener("click", () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
  });
  document.getElementById("freeze").addEventListener("click", () => doFreeze(selected));
  document.getElementById("fill").addEventListener("click", doSendAll);
  document.getElementById("clearall").addEventListener("click", doClearAll);
  document.getElementById("diag")?.addEventListener("click", dumpGset);
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
  const nameEl = () => document.getElementById("devname");
  const fill = () => {
    const fm1 = midi.findFm1();
    const outs = midi.listOutputs();
    const n = nameEl();
    if (n) n.textContent = fm1 ? fm1.name : (outs.length ? `${outs[0].name} (no FM-1)` : "no MIDI");
    const led = document.getElementById("led");
    if (led) led.className = "led" + (fm1 ? " ok" : "");
    status(fm1 ? `FM-1: ${fm1.name}` : "FM-1 not found", fm1 ? "ok" : "");
  };
  try {
    await midi.initMidi();
    fill();
    // Re-sync whenever the device (re)connects or drops: the FM-1's tempo is
    // device-global and the device is the source of truth.
    midi.onStateChange(() => {
      fill();
      if (midi.findFm1()) {
        syncDeviceTempo().then((held) => {
          if (held) status(`FM-1 connected · device holds ${held} BPM — Tempo synced`, "ok");
        });
      }
    });
    // WYSIWYG tempo: snap the knob to the device's real (unit-global) BPM.
    const held = await syncDeviceTempo();
    if (held) status(`FM-1: ${midi.findFm1()?.name ?? ""} · device holds ${held} BPM — Tempo synced`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
    const n = nameEl();
    if (n) n.textContent = "no Web MIDI";
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

// Coming back to the tab re-syncs the Tempo knob to the device's real BPM —
// the user may have turned the tempo knob on the unit while we were away.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && midi.hasAccess() && midi.findFm1()) syncDeviceTempo();
});

buildTheme();
buildRack();
refreshLoopRanges();
buildTransport();
buildEditor();
doGenerate(true);
initMidi();
