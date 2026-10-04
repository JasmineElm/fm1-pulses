// midi.js — Web MIDI: find the FM-1, send SysEx (pattern freeze) or notes.
//
// The pattern write (SysEx 0x20) is refused with status 3 while the FM-1's
// sequencer is playing, so we read the reply after each message and surface it.
// We can also READ the device's memory (SysEx 0x11) to check what it stored.
import { ysum } from "./pattern.js?v=67";

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
  const len = (buf[7] | (buf[8] << 8)) >>> 0;
  return {
    kind: buf[1],
    status: buf[2],
    arg: (buf[3] | (buf[4] << 8) | (buf[5] << 16) | (buf[6] << 24)) >>> 0,
    len,
    data: buf.slice(9, 9 + len),
  };
}

// Read a block of the FM-1's memory (SysEx 0x11). Used to check what the device
// actually stored, instead of assuming the write landed.
//   F0 43 00 7D 11 <addr:5 x 7LE> <len:2 x 7LE> <sum> F7
export async function readMemory(addr, len) {
  const out = findFm1();
  if (!out) throw new Error("FM-1 not found");
  const input = findFm1Input();
  if (!input) throw new Error("the FM-1's MIDI input is unavailable, so it cannot be read back");
  const body = [0x11];
  for (let i = 0; i < 5; i++) body.push((addr >> (7 * i)) & 0x7F);
  body.push(len & 0x7F, (len >> 7) & 0x7F);
  out.send(new Uint8Array([0xF0, 0x43, 0x00, 0x7D, ...body, ysum(body), 0xF7]));
  const rep = await waitReply(input, 1500);
  if (!rep) throw new Error("no reply to the read request");
  const d = decodeReply(rep);
  if (!d) throw new Error("could not decode the read reply");
  if (d.status !== 0) throw new Error(`read refused (status ${d.status})`);
  return d.data;
}

const STATUS_TEXT = {
  0: "done",
  1: "a value out of range",
  2: "damaged in transit",
  3: "the FM-1's sequencer is playing — stop it (SEQ off, not just STOP) and send again",
};

const hex = (a) => a.map((b) => b.toString(16).padStart(2, "0")).join(" ");

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
// message if the FM-1 refuses (status 3 = sequencer playing/busy). A status 3 is
// retried once after a pause, since the device can still be busy finishing the
// previous write; the error carries the raw reply so a wrong decode is visible.
export async function sendPattern(msgs, label = "") {
  const out = findFm1();
  if (!out) throw new Error("FM-1 not found — connect it and allow the MIDI prompt");
  const input = findFm1Input();

  const sendOne = async (bytes) => {
    out.send(new Uint8Array(bytes));
    if (!input) return;
    const rep = await waitReply(input, 1500);
    if (!rep) return;
    const d = decodeReply(rep);
    if (d && d.status !== 0) {
      const err = new Error(
        `FM-1 refused (status ${d.status}): ${STATUS_TEXT[d.status] || "unknown"}` +
        `${label ? " [" + label + "]" : ""} [reply ${hex(rep)}]`);
      err.status = d.status; err.reply = rep;
      throw err;
    }
  };

  for (let i = 0; i < msgs.length; i++) {
    try {
      await sendOne(msgs[i]);
    } catch (e) {
      if (e.status === 3) {
        await sleep(400);          // give the device a moment, then try once more
        await sendOne(msgs[i]);
      } else throw e;
    }
    await sleep(60);              // pace like the verified fm1tool (60ms/message)
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
