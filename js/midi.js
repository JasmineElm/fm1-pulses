// midi.js — Web MIDI: find the FM-1, send SysEx (pattern freeze) or notes.
//
// The pattern write (SysEx 0x20) is refused with status 3 while the FM-1's
// sequencer is playing, so we read the reply after each message and surface it.

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

const NAME_RE = /fm-?1|mvave|m-vave|4c4a/i;

export function findFm1() {
  if (!access) return null;
  for (const o of access.outputs.values()) if (NAME_RE.test(o.name)) return o;
  return null;
}

// The FM-1's MIDI input (what the device sends back to us).
export function findFm1Input() {
  if (!access) return null;
  for (const i of access.inputs.values()) if (NAME_RE.test(i.name)) return i;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 7-bit LSB-first bitstream -> bytes (the firmware's reply packing).
function unpack7(bytes) {
  const out = [];
  let acc = 0, nb = 0;
  for (const b of bytes) {
    acc |= b << nb; nb += 7;
    while (nb >= 8) { out.push(acc & 0xFF); acc >>= 8; nb -= 8; }
  }
  return out;
}

// F0 7D <packed> F7 -> { kind, status, arg }
export function decodeReply(sx) {
  if (sx.length < 4 || sx[0] !== 0xF0 || sx[1] !== 0x7D) return null;
  const buf = unpack7(sx.slice(1, -1));
  if (buf[0] !== 0x7D) return null;
  return {
    kind: buf[1],
    status: buf[2],
    arg: (buf[3] | (buf[4] << 8) | (buf[5] << 16) | (buf[6] << 24)) >>> 0,
  };
}

const STATUS_TEXT = {
  0: "done",
  1: "a value out of range",
  2: "damaged in transit",
  3: "the FM-1's sequencer is playing — stop it (SEQ off) and freeze again",
};

// Wait for one SysEx reply on the FM-1's input port.
function waitReply(input, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { input.onmidimessage = null; resolve(null); }, timeoutMs);
    input.onmidimessage = (e) => {
      const d = e.data;
      if (d && d[0] === 0xF0 && d[1] === 0x7D) {
        clearTimeout(timer);
        input.onmidimessage = null;
        resolve(Array.from(d));
      }
    };
  });
}

// Send the 0x20 pattern messages, confirming each. Throws with a readable
// message if the FM-1 refuses (e.g. status 3 = sequencer playing).
export async function sendPattern(msgs, gapMs = 90) {
  const out = findFm1();
  if (!out) throw new Error("FM-1 not found — connect it and allow the MIDI prompt");
  const input = findFm1Input();

  for (let i = 0; i < msgs.length; i++) {
    out.send(new Uint8Array(msgs[i]));
    if (input) {
      const rep = await waitReply(input, 1500);
      const d = rep ? decodeReply(rep) : null;
      if (d && d.status !== 0) {
        throw new Error(`FM-1 refused (status ${d.status}): ${STATUS_TEXT[d.status] || "unknown"}`);
      }
      if (!d) await sleep(gapMs); // no reply (old fw / input unavailable): pace blindly
    } else if (i < msgs.length - 1) {
      await sleep(gapMs);
    }
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
