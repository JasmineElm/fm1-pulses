// player.js — Transport audition, playback loop, and live MIDI streaming.
import { state, getBank, getSelected, RATE_NAMES, RATE_QUARTERS, status, sleep } from "./state.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";
import { setScopeNow, renderScope } from "./scope.js";
import { knob, sw } from "./knob.js";

let live = false;
let liveToken = 0;
let nowCell = null;
let onceToken = 0;
const previewHeld = new Set();   // pitches still sounding from a slot preview

let onPlayStartSyncCallback = null;
export function onPlayStartSync(fn) { onPlayStartSyncCallback = fn; }

let modelTransportHandler = null;

/**
 * Sets or clears custom transport start/stop/toggle handlers for autonomous
 * models that manage their own continuous event time (e.g. flocking swarm).
 *
 * @param {{ toggle: Function, stop?: Function, start?: Function, isRunning?: Function }|null} handler
 */
export function setModelTransportHandler(handler) {
  modelTransportHandler = handler && typeof handler.toggle === "function" ? handler : null;
}

export function isLive() {
  if (modelTransportHandler?.isRunning) {
    return !!modelTransportHandler.isRunning();
  }
  return live;
}

export function swingFrac() {
  const s = Math.min(75, Math.max(50, state.swing ?? 50));
  return ((s - 50) / 25) / 3;
}

// Live note out — routes to BLE when it is connected (play-only), USB otherwise.
export function liveNoteOn(note, vel) {
  if (midi.bleConnected()) { midi.bleSendNoteOn(note, vel); return; }
  midi.sendNoteOn(note, vel);
}

export function liveNoteOff(note) {
  if (midi.bleConnected()) { midi.bleSendNoteOff(note); return; }
  midi.sendNoteOff(note);
}

export function panicPreview() {
  for (const n of previewHeld) {
    try { liveNoteOff(n); } catch (_) {}
    try { audio.noteOff(n); } catch (_) {}
  }
  previewHeld.clear();
}

export async function playOnce(index) {
  if (modelTransportHandler) return;
  const slot = typeof index === "number" ? index : getSelected();
  const bank = getBank();
  const p = bank[slot];
  if (!p || live) return;
  const token = ++onceToken;
  panicPreview();
  audio.unlock();
  const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
  const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
  for (let i = 0; i < p.length; i++) {
    if (token !== onceToken || live) return;
    const st = p.steps[i];
    const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
    const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
    const humJitter = (state.humanize ? (Math.random() * 2 - 1) * (state.humanize / 100) * 0.15 * stepMs : 0);
    const sDur = Math.max(10, stepMs - late);
    const playDelay = Math.max(0, late + humJitter);
    if (playDelay) await sleep(playDelay);
    if (st.notes.length) {
      for (const n of st.notes) { previewHeld.add(n.note); liveNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
      await sleep(Math.max(12, sDur * gate));
      if (token !== onceToken || live) return;
      for (const n of st.notes) { previewHeld.delete(n.note); liveNoteOff(n.note); audio.noteOff(n.note); }
      await sleep(Math.max(3, sDur * (1 - gate)));
    } else await sleep(sDur);
  }
}

const stepListeners = new Set();
export function onStep(fn) {
  stepListeners.add(fn);
  return () => stepListeners.delete(fn);
}

let modelStepHandler = null;

/**
 * Sets or clears the active sequencer model's step tick handler.
 * Called when switching models so that only the currently active model
 * is notified during playback ticks.
 *
 * @param {Function|null} fn - Handler function receiving stepIndex (or null on stop)
 */
export function setModelStepHandler(fn) {
  modelStepHandler = typeof fn === "function" ? fn : null;
}

export function clearPlayhead() {
  if (nowCell) nowCell.classList.remove("now");
  nowCell = null;
  setScopeNow(null);
  try { renderScope(); } catch (_) {}
  for (const fn of stepListeners) {
    try { fn(null); } catch (_) {}
  }
  if (modelStepHandler) {
    try { modelStepHandler(null); } catch (_) {}
  }
}

export function markStep(i) {
  for (const fn of stepListeners) {
    try { fn(i); } catch (_) {}
  }
  if (modelStepHandler) {
    try { modelStepHandler(i); } catch (_) {}
  }
  const el = document.getElementById("steps");
  if (el && el.offsetParent !== null) {
    if (nowCell) nowCell.classList.remove("now");
    nowCell = el.children[i] || null;
    if (nowCell) nowCell.classList.add("now");
  }
  setScopeNow(i);
  try { renderScope(); } catch (_) {}
}

export function stopLive() {
  if (modelTransportHandler?.stop) {
    try { modelTransportHandler.stop(); } catch (_) {}
  }
  live = false;
  liveToken++;
  clearPlayhead();
  const btn = document.getElementById("audition");
  if (btn) { btn.textContent = "▶ Play"; btn.classList.remove("playing"); }
  status("stopped");
}

export function toggleLive() {
  if (modelTransportHandler?.toggle) {
    const running = modelTransportHandler.toggle();
    const btn = document.getElementById("audition");
    if (btn) {
      if (running) {
        btn.textContent = "■ Stop";
        btn.classList.add("playing");
      } else {
        btn.textContent = "▶ Play";
        btn.classList.remove("playing");
      }
    }
    return;
  }
  if (live) { stopLive(); return; }
  onceToken++;
  panicPreview();
  live = true;
  liveToken++;
  audio.unlock();
  const btn = document.getElementById("audition");
  if (btn) { btn.textContent = "■ Stop"; btn.classList.add("playing"); }
  status("playing (loop)");
  if (onPlayStartSyncCallback) onPlayStartSyncCallback();
  for (const fn of stepListeners) {
    try { fn(null); } catch (_) {}
  }
  if (modelStepHandler) {
    try { modelStepHandler(null); } catch (_) {}
  }
  liveLoop(liveToken);
}

export async function liveLoop(token) {
  let t0 = performance.now();
  let elapsed = 0;
  let i = 0;
  while (live && token === liveToken) {
    if (modelTransportHandler) break;
    try {
      const bank = getBank();
      const p = bank[getSelected()];
      if (!p || !p.length) { await sleep(100); t0 += 100; continue; }
      if (i >= p.length) i = 0;
      if (performance.now() - (t0 + elapsed) > 250) t0 = performance.now() - elapsed;

      const st = p.steps?.[i] || { notes: [], rate: p.rate ?? 6 };
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const rIdx = typeof st.rate === "number" ? st.rate : RATE_NAMES.indexOf(st.rate);
      const prIdx = typeof p.rate === "number" ? p.rate : RATE_NAMES.indexOf(p.rate);
      const qMult = RATE_QUARTERS[rIdx >= 0 ? rIdx : (prIdx >= 0 ? prIdx : 6)] ?? 0.25;
      const stepMs = qMs * qMult;
      const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
      const humFactor = (state.humanize ?? 0) / 100;
      const humJitter = humFactor > 0 ? (Math.random() * 2 - 1) * humFactor * 0.15 * stepMs : 0;
      const sDur = Math.max(10, stepMs - late);

      const startAt = t0 + elapsed + late + humJitter;
      let w = startAt - performance.now();
      if (w > 0) await sleep(w);
      markStep(i);
      if (st.notes.length) {
        for (const n of st.notes) { liveNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
        const offAt = startAt + Math.max(12, sDur * gate);
        w = offAt - performance.now(); if (w > 0) await sleep(w);
        for (const n of st.notes) { liveNoteOff(n.note); audio.noteOff(n.note); }
      }
      w = (t0 + elapsed + stepMs) - performance.now();
      if (w > 0) await sleep(w);
      elapsed += stepMs;
      i++;
    } catch (e) {
      status("play error: " + (e.message || e), "err");
      await sleep(200);
      t0 += 200;
    }
  }
  clearPlayhead();
}

export function buildAudioControls() {
  const muteBtn = document.getElementById("mute");
  if (!muteBtn) return;
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
  const volEl = knob({
    label: "Vol",
    min: 0,
    max: 100,
    step: 1,
    value: audio.getVolume(),
    def: 70,
    size: "sm",
    format: (v) => `${Math.round(v)}%`,
    tip: "Inbuilt synth preview volume (browser audio only).",
    onInput: (v) => {
      audio.setVolume(v);
      localStorage.setItem("fm1p.volume", String(v));
      status(`preview volume: ${Math.round(v)}%`);
    },
  });
  muteBtn.insertAdjacentElement("beforebegin", volEl);

  const toggleMute = () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
  };
  muteBtn.addEventListener("click", toggleMute);
}
