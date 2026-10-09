// device.js — FM-1 hardware device communication, SysEx writes, and tempo sync.
import { state, refs, getBank, getSelected, RATE_NAMES, SLOTS, status } from "./state.js?v=100";
import * as midi from "./midi.js?v=100";
import { encodeWrite, emptyPattern } from "./pattern.js?v=100";

const GSET_ADDR = 0x01C0E840 + 5816;
const GSET_LEN = 137;
let busy = false;

let tempoProbeTimer = null;
let tempoProbeBusy = false;

export function scheduleTempoProbe() {
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

export async function readBack(pat) {
  const data = await midi.readMemory(GSET_ADDR, GSET_LEN);
  if (data.length < 68 + 2 * pat) throw new Error(`short read (${data.length} bytes)`);
  return { tempo: data[66 + 2 * pat] | (data[67 + 2 * pat] << 7), data };
}

export async function dumpGset() {
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

export async function syncDeviceTempo(data = null, retries = 2) {
  try {
    if (!data) data = await midi.readMemory(GSET_ADDR, GSET_LEN);
    const selected = getSelected();
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

export function syncHeader() {
  const bank = getBank();
  for (const p of bank) {
    if (!p) continue;
    p.tempo = state.tempo; p.rate = state.rate; p.gate = state.gate; p.swing = state.swing;
    p.length = Math.max(1, Math.min(64, state.length));
    for (const st of p.steps) st.rate = state.rate;
  }
}

export async function doFreeze(slotIndex) {
  const bank = getBank();
  if (!bank[slotIndex]) return;
  syncHeader();
  try {
    status(`freezing slot ${slotIndex + 1} · ${Math.round(state.tempo)} bpm · ${RATE_NAMES[state.rate]}…`);
    await midi.sendPattern(encodeWrite(bank[slotIndex], slotIndex, true), `slot ${slotIndex + 1}`);
    try {
      const { tempo: held, data } = await readBack(slotIndex);
      const want = Math.round(state.tempo);
      if (held !== want) {
        await syncDeviceTempo(data);
        status(`slot ${slotIndex + 1} frozen ✓ · FM-1 holds ${held} bpm (sent ${want}) — tempo is device-global on this firmware, so Tempo now shows the device's BPM`, "err");
      } else {
        status(`slot ${slotIndex + 1} frozen ✓ · sent ${want} bpm, device holds ${held} bpm`, "ok");
      }
    } catch (e) {
      await syncDeviceTempo();
      status(`slot ${slotIndex + 1} frozen ✓ (read-back: ${e.message || e})`, "ok");
    }
  } catch (e) { status(String(e.message || e), "err"); }
}

export async function doSendAll() {
  const bank = getBank();
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

export async function doClearAll() {
  const bank = getBank();
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

export async function initMidi() {
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
    midi.onStateChange(() => {
      fill();
      if (midi.findFm1()) {
        syncDeviceTempo().then((held) => {
          if (held) status(`FM-1 connected · device holds ${held} BPM — Tempo synced`, "ok");
        });
      }
    });
    const held = await syncDeviceTempo();
    if (held) status(`FM-1: ${midi.findFm1()?.name ?? ""} · device holds ${held} BPM — Tempo synced`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
    const n = nameEl();
    if (n) n.textContent = "no Web MIDI";
  }
}
