// midi.js — Web MIDI: find the FM-1, send SysEx (pattern freeze) or notes.

let access = null;

export async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    throw new Error("Web MIDI unsupported — use Chrome/Edge over https or localhost");
  }
  access = await navigator.requestMIDIAccess({ sysex: true });
  return listOutputs();
}

export function listOutputs() {
  const out = [];
  if (!access) return out;
  for (const o of access.outputs.values()) out.push({ id: o.id, name: o.name });
  return out;
}

export function onStateChange(cb) {
  if (access) access.onstatechange = cb;
}

// Match by name; the FM-1 reports "FM-1" / "M-VAVE" / USB 4c4a.
export function findFm1() {
  if (!access) return null;
  for (const o of access.outputs.values()) {
    if (/fm-?1|mvave|m-vave|4c4a/i.test(o.name)) return o;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Send the 0x20 pattern messages, paced so the firmware keeps up (the last
// one carries the flash save, which takes longer).
export async function sendPattern(msgs, gapMs = 90) {
  const out = findFm1();
  if (!out) throw new Error("FM-1 not found — connect it and allow the MIDI prompt");
  for (let i = 0; i < msgs.length; i++) {
    out.send(new Uint8Array(msgs[i]));
    if (i < msgs.length - 1) await sleep(gapMs);
  }
  return out.name;
}

// Live note out (for the audition / sound-module mode).
export function sendNoteOn(note, vel, channel = 1) {
  const out = findFm1();
  if (out) out.send(new Uint8Array([0x90 | ((channel - 1) & 0x0F), note & 0x7F, vel & 0x7F]));
}

export function sendNoteOff(note, channel = 1) {
  const out = findFm1();
  if (out) out.send(new Uint8Array([0x80 | ((channel - 1) & 0x0F), note & 0x7F, 0]));
}

export function hasAccess() { return !!access; }
