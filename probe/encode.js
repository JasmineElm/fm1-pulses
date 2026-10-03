// probe/encode.js — pure byte-level FM-1 encoding + BLE-MIDI framing.
//
// No DOM, no Bluetooth: importable by the probe page AND by node, so the
// encoders can be byte-diffed against the verified Python/tooling output.
//
// BLE-MIDI packet shape (Apple BLE-MIDI spec):
//   [header = 0x80 | ts>>7]  [ (0x80 | ts&0x7F) <message bytes> ] ...
// A SysEx spans packets: each packet repeats header+timestamp and resumes the
// payload. Every payload byte is < 0x80, so a byte >= 0x80 seen mid-SysEx is
// framing (the only exception being the terminating 0xF7).

export const SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const IO_CHAR_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';

// MIDI bytes per BLE packet. Android default MTU 23 -> 20-byte ATT payload;
// the BLE-MIDI header + timestamp byte consume 2 of those.
export const CHUNK = 18;

export function packetize(midiBytes) {
  const out = [];
  for (let i = 0; i < midiBytes.length; i += CHUNK) {
    const body = midiBytes.slice(i, i + CHUNK);
    const p = new Uint8Array(body.length + 2);
    p[0] = 0x80;                        // header, timestamp high bits
    p[1] = 0x80;                        // timestamp low 7 bits
    p.set(body, 2);
    out.push(p);
  }
  return out;
}

// Firmware checksum: sum of (b ^ 0xFF), low 7 bits.
export function ysum(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + (b ^ 0xFF)) & 0xFF;
  return s & 0x7F;
}

// F0 43 00 7D <body> <sum> F7
export function sysex7d(body) {
  return Uint8Array.from([0xF0, 0x43, 0x00, 0x7D, ...body, ysum(body), 0xF7]);
}

// 0x11 memory read — addr as 5x7-bit LE, then len as 2x7-bit LE.
// Mirrors mvp/fm1tool.c cmd "read".
export function readMsg(addr, len) {
  const body = [0x11];
  for (let i = 0; i < 5; i++) body.push((addr >>> (7 * i)) & 0x7F);
  body.push(len & 0x7F, (len >>> 7) & 0x7F);
  return sysex7d(body);
}

// 0x20 pattern write, 8 steps per message, 177 bytes each. Port of js/pattern.js.
export function encodePart(pat, part, save, p) {
  const body = [0x20, pat, part, save ? 1 : 0, p.length, p.rate,
                p.tempo & 0x7F, (p.tempo >>> 7) & 0x7F, p.gate, p.swing, 0];
  for (let i = 0; i < 8; i++) {
    const st = p.steps[part * 8 + i] || { rate: p.rate, notes: [] };
    const notes = st.notes.slice(0, 9);
    body.push(st.rate, notes.length);
    for (let j = 0; j < 9; j++) body.push(j < notes.length ? notes[j].note : 0);
    for (let j = 0; j < 9; j++) body.push(j < notes.length ? notes[j].vel : 0);
  }
  return sysex7d(body);
}

export function encodeWrite(p, pat, save) {
  const parts = Math.max(2, Math.ceil(p.length / 8));
  const out = [];
  for (let k = 0; k < parts; k++) out.push(encodePart(pat, k, save && k === parts - 1, p));
  return out;
}

// The probe's built-in test pattern: 16 steps of 1/16, C-E-G melody on evens.
export function testPattern(save) {
  const steps = Array.from({ length: 64 }, () => ({ rate: 6, notes: [] }));
  const mel = [48, 52, 55, 52, 48, 55, 60, 55];
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((i, k) => {
    steps[i] = { rate: 6, notes: [{ note: mel[k], vel: 100 }] };
  });
  return encodeWrite({ length: 16, rate: 6, tempo: 120, gate: 50, swing: 50, steps }, 15, save);
}

/* ------------------------- inbound direction (replies) ------------------- */

// 7-bit LSB-first bitstream -> bytes (the firmware's reply packing).
export function unpack7(bytes) {
  const out = []; let acc = 0, nb = 0;
  for (const b of bytes) {
    acc |= b << nb; nb += 7;
    while (nb >= 8) { out.push(acc & 0xFF); acc >>= 8; nb -= 8; }
  }
  return out;
}

// F0 7D <packed> F7 -> { kind, status, arg, len }  (same shape as js/midi.js).
export function decodeReply(sx) {
  if (sx.length < 4 || sx[0] !== 0xF0 || sx[1] !== 0x7D) return null;
  const buf = unpack7(sx.slice(1, -1));
  if (buf.length < 9 || buf[0] !== 0x7D) return null;
  // NOTE: len is 2x 7-bit groups -> shift 7, NOT 8. js/midi.js and mvp/fm1tool.c
  // both use `buf[8] << 8`, which cannot represent any length >= 128 (180 would
  // need a 0xB4 group, illegal in a 7-bit field). Harmless there -- neither
  // actually uses the value -- but wrong. Everything else here is 7-bit groups.
  return {
    kind: buf[1], status: buf[2], len: buf[7] | (buf[8] << 7),
    arg: (buf[3] | (buf[4] << 8) | (buf[5] << 16) | (buf[6] << 24)) >>> 0,
  };
}

// Reassemble SysEx that BLE-MIDI splits across packets. Feed it every
// notification payload; it calls onSysex(fullMessageBytes) on each complete
// F0..F7. Stateful — one instance per connection.
export function createSysexReassembler(onSysex) {
  let buf = null;
  return function feed(packet) {
    let i = 1;                          // byte 0 is the packet header
    while (i < packet.length) {
      const b = packet[i];
      if (buf) {
        if (b < 0x80) { buf.push(b); i++; continue; }
        if (b === 0xF7) { buf.push(b); const s = buf; buf = null; onSysex(s); i++; continue; }
        i++;                            // timestamp byte mid-SysEx -> framing
        continue;
      }
      if (b === 0xF0) { buf = [0xF0]; i++; continue; }
      i++;                              // ignore non-SysEx traffic
    }
  };
}
