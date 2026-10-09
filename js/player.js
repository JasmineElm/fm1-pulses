// player.js — Transport audition, playback loop, and live MIDI streaming.
import { state, getBank, getSelected, RATE_QUARTERS, status, sleep } from "./state.js?v=100";
import * as midi from "./midi.js?v=100";
import * as audio from "./audio.js?v=100";
import { setScopeNow, renderScope } from "./scope.js?v=100";
import { knob, sw } from "./knob.js?v=100";

let live = false;
let liveToken = 0;
let nowCell = null;
let onceToken = 0;
const previewHeld = new Set();   // pitches still sounding from a slot preview

let onPlayStartSyncCallback = null;
export function onPlayStartSync(fn) { onPlayStartSyncCallback = fn; }

export function isLive() { return live; }

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

export function clearPlayhead() {
  if (nowCell) nowCell.classList.remove("now");
  nowCell = null;
  setScopeNow(null);
  renderScope();
}

export function markStep(i) {
  const el = document.getElementById("steps");
  if (!el) return;
  if (nowCell) nowCell.classList.remove("now");
  nowCell = el.children[i] || null;
  if (nowCell) nowCell.classList.add("now");
  setScopeNow(i);
  renderScope();
}

export function stopLive() {
  live = false;
  liveToken++;
  clearPlayhead();
  const btn = document.getElementById("audition");
  if (btn) { btn.textContent = "▶ Play"; btn.classList.remove("playing"); }
  status("stopped");
}

export function toggleLive() {
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
  liveLoop(liveToken);
}

export async function liveLoop(token) {
  const t0 = performance.now();
  let elapsed = 0;
  let i = 0;
  while (live && token === liveToken) {
    try {
      const bank = getBank();
      const p = bank[getSelected()];
      if (!p || !p.length) { await sleep(100); t0 += 100; continue; }
      if (i >= p.length) i = 0;
      if (performance.now() - (t0 + elapsed) > 250) t0 = performance.now() - elapsed;

      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
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
