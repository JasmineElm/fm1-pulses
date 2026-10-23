// device.js — FM-1 hardware connection status and tempo sync (real-time control only).
import { state, refs, getSelected, status } from "./state.js";
import * as midi from "./midi.js";

const GSET_ADDR = 0x01C0E840 + 5816;
const GSET_LEN = 137;

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
