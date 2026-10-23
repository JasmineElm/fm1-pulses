// pattern.js — FM-1 sequencer pattern encoder (SysEx command 0x20).
//
// Port of fm1pat.py's encode_write, byte-verified against the Virtual-FM-1
// codec (sync/Fm1Seq.cpp). Produces the exact messages that write a pattern
// into the FM-1+VA firmware's sequencer RAM, 8 steps per message.
//
// A pattern is:
//   { length: 1..64, rate: 0..9 (1/1..1/32T), tempo: 30..300,
//     gate: 5..100, swing: 50..75,
//     steps: Array(64) of { rate, notes: [{note, vel}] } }
//
// Notes <= 9 per step. rate index -> note value:
//   0:1/1 1:1/2 2:1/4 3:1/4T 4:1/8 5:1/8T 6:1/16 7:1/16T 8:1/32 9:1/32T

export const MAX_STEPS = 64;
export const MAX_NOTES = 9;
export const RATE_NAMES = ["1/1","1/2","1/4","1/4T","1/8","1/8T","1/16","1/16T","1/32","1/32T"];

const SUBSYS_ID = 0x7D;
const CMD = 0x20;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Firmware checksum: sum of (b ^ 0xFF), low 7 bits.
export function ysum(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + (b ^ 0xFF)) & 0xFF;
  return s & 0x7F;
}

// One message = 8 steps of a pattern (177 bytes).
export function encodeWritePart(pattern, pat, part, save) {
  const body = [
    CMD,
    clamp(pat, 0, 15),
    clamp(part, 0, 7),
    save ? 1 : 0,
    clamp(pattern.length, 1, MAX_STEPS),
    clamp(pattern.rate, 0, 9),
    clamp(pattern.tempo, 30, 300) & 0x7F,
    (clamp(pattern.tempo, 30, 300) >> 7) & 0x7F,
    clamp(pattern.gate, 5, 100),
    clamp(pattern.swing, 50, 75),
    0, // per-pattern voice: not stored since FM-1_060
  ];
  for (let i = 0; i < 8; i++) {
    const step = pattern.steps[part * 8 + i] || { rate: pattern.rate, notes: [] };
    const notes = step.notes.slice(0, MAX_NOTES);
    body.push(clamp(step.rate, 0, 9), notes.length);
    for (let j = 0; j < MAX_NOTES; j++) body.push(j < notes.length ? clamp(notes[j].note, 0, 127) : 0);
    for (let j = 0; j < MAX_NOTES; j++) body.push(j < notes.length ? clamp(notes[j].vel, 1, 127) : 0);
  }
  return [0xF0, 0x43, 0x00, SUBSYS_ID, ...body, ysum(body), 0xF7];
}

// All messages for a pattern (parts = max(2, ceil(length/8)); last carries save).
export function encodeWrite(pattern, pat, save) {
  const parts = Math.max(2, Math.ceil(pattern.length / 8));
  const out = [];
  for (let k = 0; k < parts; k++) out.push(encodeWritePart(pattern, pat, k, save && k === parts - 1));
  return out;
}

// An empty 64-step pattern at the given rate.
export function emptyPattern(length = 64, rate = 8, tempo = 120, gate = 50, swing = 50) {
  return {
    length, rate, tempo, gate, swing,
    steps: Array.from({ length: MAX_STEPS }, () => ({ rate, notes: [] })),
  };
}

export function clonePattern(p) {
  if (!p) return emptyPattern(16, 6, 120, 50, 50);
  return {
    length: clamp(p.length ?? 16, 1, MAX_STEPS),
    rate: clamp(p.rate ?? 6, 0, 9),
    tempo: clamp(p.tempo ?? 120, 30, 300),
    gate: clamp(p.gate ?? 50, 5, 100),
    swing: clamp(p.swing ?? 50, 50, 75),
    sound: p.sound ?? 0,
    steps: Array.from({ length: MAX_STEPS }, (_, i) => {
      const st = p.steps?.[i];
      return {
        rate: clamp(st?.rate ?? p.rate ?? 6, 0, 9),
        notes: Array.isArray(st?.notes)
          ? st.notes.slice(0, MAX_NOTES).map((n) => ({
              note: clamp(n.note ?? 60, 0, 127),
              vel: clamp(n.vel ?? 100, 1, 127),
            }))
          : [],
      };
    }),
  };
}

// --------------------------------------------------------------------------- //
// FM-1 Hardware RAM Pattern Read Decoder (SysEx 0x11)
// --------------------------------------------------------------------------- //

export const STEPS_RAM = 0x01C14CD0;      // steps 0..15, 512 B per pattern (16 x 32B)
export const EXT_RAM   = 0x01C79D30;      // steps 16..63, 1536 B per pattern (48 x 32B)
export const GSET_RAM  = 0x01C0E840 + 5816;
export const GSET_LEN  = 137;

// Firmware tick table at 192 PPQN (step durations at 96 PPQN are half of these)
export const VALUE_TICKS_192 = [768, 384, 192, 128, 96, 64, 48, 32, 24, 16];

/**
 * Decodes a 64-step pattern from the FM-1's raw RAM step bytes (512 or 2048 bytes)
 * and the 137-byte global settings block (gset).
 */
export function decodePatternFromRam(stepsBytes, gset, pat = 0) {
  const pIdx = clamp(pat, 0, 15);
  const length = gset && gset.length > 98 + pIdx ? clamp(gset[98 + pIdx] || 16, 1, MAX_STEPS) : 16;
  const rate = gset && gset.length > 50 + pIdx && gset[50 + pIdx] <= 9 ? gset[50 + pIdx] : 6;
  const rawTempo = gset && gset.length > 67 + 2 * pIdx
    ? (gset[66 + 2 * pIdx] | (gset[67 + 2 * pIdx] << 8))
    : 120;
  const tempo = clamp(rawTempo >= 30 && rawTempo <= 300 ? rawTempo : 120, 30, 300);
  const gate = gset && gset.length > 18 + pIdx ? clamp(gset[18 + pIdx] || 50, 5, 100) : 50;
  const swing = gset && gset.length > 34 + pIdx ? clamp(gset[34 + pIdx] || 50, 50, 75) : 50;
  const sound = gset && gset.length > 118 + pIdx ? gset[118 + pIdx] : 0;

  const steps = Array.from({ length: MAX_STEPS }, () => ({ rate, notes: [] }));
  const availSteps = Math.min(MAX_STEPS, Math.floor((stepsBytes?.length || 0) / 32));

  for (let k = 0; k < availSteps; k++) {
    const base = k * 32;
    const sRate = stepsBytes[base + 10] <= 9 ? stepsBytes[base + 10] : rate;
    const rawCount = stepsBytes[base + 30];
    const nNotes = rawCount === 0xFF ? 0 : Math.min(rawCount, MAX_NOTES);
    const notes = [];
    for (let j = 0; j < nNotes; j++) {
      const n = stepsBytes[base + j];
      if (n < 128) {
        const v = stepsBytes[base + 20 + j];
        notes.push({
          note: clamp(n, 0, 127),
          vel: clamp(v === 0xFF || v === 0 ? 100 : v, 1, 127),
        });
      }
    }
    const st = { rate: sRate, notes };
    const flags = stepsBytes[base + 29];
    if ((flags & 0xC0) === 0x40) {
      st.accent = (flags & 1) !== 0;
      st.ratchet = ((flags >> 2) & 3) + 1;
    }
    steps[k] = st;
  }

  return { length, rate, tempo, gate, swing, sound, steps };
}

// --------------------------------------------------------------------------- //
// SysEx 0x20 Pattern File Decoder (.syx)
// --------------------------------------------------------------------------- //

/**
 * Parses one or more 177-byte SysEx 0x20 pattern write messages from a .syx buffer.
 * Returns an array of { slot, pattern } objects.
 */
export function decodePatternSysex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const messages = [];
  let start = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0xF0) start = i;
    else if (data[i] === 0xF7 && start >= 0) {
      messages.push(data.subarray(start, i + 1));
      start = -1;
    }
  }

  const bySlot = new Map();
  for (const msg of messages) {
    if (msg.length !== 177 || msg[0] !== 0xF0 || msg[1] !== 0x43 || msg[3] !== SUBSYS_ID || msg[4] !== CMD) {
      continue;
    }
    const body = msg.subarray(4, 175);
    if (ysum(body) !== msg[175]) {
      throw new Error("Checksum mismatch in FM-1 pattern SysEx (0x20) message");
    }
    const pat = clamp(body[1], 0, 15);
    const part = clamp(body[2], 0, 7);
    const length = clamp(body[4], 1, MAX_STEPS);
    const rate = clamp(body[5], 0, 9);
    const tempo = clamp(body[6] | (body[7] << 7), 30, 300);
    const gate = clamp(body[8], 5, 100);
    const swing = clamp(body[9], 50, 75);
    const sound = body[10];

    let entry = bySlot.get(pat);
    if (!entry) {
      entry = emptyPattern(length, rate, tempo, gate, swing);
      entry.sound = sound;
      bySlot.set(pat, entry);
    } else {
      entry.length = length;
      entry.rate = rate;
      entry.tempo = tempo;
      entry.gate = gate;
      entry.swing = swing;
      entry.sound = sound;
    }

    for (let i = 0; i < 8; i++) {
      const stepIdx = part * 8 + i;
      if (stepIdx >= MAX_STEPS) break;
      const off = 11 + i * 20;
      const stRate = clamp(body[off], 0, 9);
      const count = clamp(body[off + 1], 0, MAX_NOTES);
      const notes = [];
      for (let j = 0; j < count; j++) {
        const note = clamp(body[off + 2 + j], 0, 127);
        const vel = clamp(body[off + 11 + j] || 100, 1, 127);
        notes.push({ note, vel });
      }
      entry.steps[stepIdx] = { rate: stRate, notes };
    }
  }

  return Array.from(bySlot.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([slot, pattern]) => ({ slot, pattern }));
}

// --------------------------------------------------------------------------- //
// Standard MIDI File (.mid) Export & Import for Patterns
// --------------------------------------------------------------------------- //

function writeVarLen(val) {
  let v = val >>> 0;
  const bytes = [v & 0x7F];
  while ((v >>= 7) > 0) {
    bytes.unshift((v & 0x7F) | 0x80);
  }
  return bytes;
}

/**
 * Encodes a pattern into a Standard MIDI File (Format 0, 96 PPQN).
 */
export function encodePatternMidi(pattern) {
  const p = clonePattern(pattern);
  const ppqn = 96;
  const events = []; // { tick, bytes }

  const mpqn = Math.round(60000000 / clamp(p.tempo, 30, 300));
  events.push({
    tick: 0,
    order: 0,
    bytes: [0xFF, 0x51, 0x03, (mpqn >> 16) & 0xFF, (mpqn >> 8) & 0xFF, mpqn & 0xFF],
  });

  let cursorTick = 0;
  for (let i = 0; i < p.length; i++) {
    const st = p.steps[i] || { rate: p.rate, notes: [] };
    const pairTicks = VALUE_TICKS_192[clamp(p.rate ?? st.rate ?? 6, 0, 9)] || 48; // 2 steps at 96 PPQN
    const firstStepTicks = Math.max(1, Math.floor((pairTicks * clamp(p.swing, 50, 75)) / 100));
    const stepTicks = (i % 2 === 0) ? firstStepTicks : Math.max(1, pairTicks - firstStepTicks);
    const gateTicks = Math.max(1, Math.round((stepTicks * clamp(p.gate, 5, 100)) / 100));

    for (const n of st.notes) {
      events.push({
        tick: cursorTick,
        order: 2,
        bytes: [0x90, clamp(n.note, 0, 127), clamp(n.vel, 1, 127)],
      });
      events.push({
        tick: cursorTick + gateTicks,
        order: 1,
        bytes: [0x80, clamp(n.note, 0, 127), 0],
      });
    }
    cursorTick += stepTicks;
  }

  events.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  events.push({ tick: cursorTick, order: 3, bytes: [0xFF, 0x2F, 0x00] });

  const trackBytes = [];
  let lastTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - lastTick);
    lastTick = ev.tick;
    trackBytes.push(...writeVarLen(delta), ...ev.bytes);
  }

  const tLen = trackBytes.length;
  return Uint8Array.from([
    0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01, (ppqn >> 8) & 0xFF, ppqn & 0xFF,
    0x4D, 0x54, 0x72, 0x6B,
    (tLen >>> 24) & 0xFF, (tLen >>> 16) & 0xFF, (tLen >>> 8) & 0xFF, tLen & 0xFF,
    ...trackBytes,
  ]);
}

/**
 * Decodes a Standard MIDI File (.mid) into a 64-step FM-1 pattern.
 */
export function decodePatternMidi(bytes, rate = 6) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 14 || data[0] !== 0x4D || data[1] !== 0x54 || data[2] !== 0x68 || data[3] !== 0x64) {
    throw new Error("Not a valid Standard MIDI (.mid) file");
  }
  const division = (data[12] << 8) | data[13];
  const ppqn = (division & 0x8000) ? 96 : (division || 96);

  let tempo = 120;
  const noteOns = []; // { tick, note, vel }
  let pos = 8 + ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]);

  while (pos + 8 <= data.length) {
    const isMTrk = data[pos] === 0x4D && data[pos + 1] === 0x54 && data[pos + 2] === 0x72 && data[pos + 3] === 0x6B;
    const chunkLen = ((data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7]) >>> 0;
    pos += 8;
    const end = Math.min(data.length, pos + chunkLen);
    if (!isMTrk) {
      pos = end;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    let p = pos;
    while (p < end) {
      let delta = 0;
      while (p < end) {
        const b = data[p++];
        delta = (delta << 7) | (b & 0x7F);
        if ((b & 0x80) === 0) break;
      }
      tick += delta;
      if (p >= end) break;

      let status = data[p];
      if (status < 0x80) {
        status = runningStatus;
      } else {
        p++;
        if (status < 0xF0) runningStatus = status;
      }

      const hi = status & 0xF0;
      if (hi === 0x90) {
        const note = data[p++] & 0x7F;
        const vel = data[p++] & 0x7F;
        if (vel > 0) noteOns.push({ tick, note, vel });
      } else if (hi === 0x80 || hi === 0xA0 || hi === 0xB0 || hi === 0xE0) {
        p += 2;
      } else if (hi === 0xC0 || hi === 0xD0) {
        p += 1;
      } else if (status === 0xFF) {
        const metaType = data[p++];
        let mLen = 0;
        while (p < end) {
          const b = data[p++];
          mLen = (mLen << 7) | (b & 0x7F);
          if ((b & 0x80) === 0) break;
        }
        if (metaType === 0x51 && mLen === 3 && p + 3 <= end) {
          const mpqn = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
          if (mpqn > 0) tempo = clamp(Math.round(60000000 / mpqn), 30, 300);
        }
        p += mLen;
      } else if (status === 0xF0 || status === 0xF7) {
        let sLen = 0;
        while (p < end) {
          const b = data[p++];
          sLen = (sLen << 7) | (b & 0x7F);
          if ((b & 0x80) === 0) break;
        }
        p += sLen;
      } else {
        break;
      }
    }
    pos = end;
  }

  const stepRate = clamp(rate, 0, 9);
  const stepTicks = Math.max(1, Math.round(((VALUE_TICKS_192[stepRate] || 48) / 2) * (ppqn / 96)));
  const pat = emptyPattern(16, stepRate, tempo, 50, 50);

  let maxStep = 0;
  for (const ev of noteOns) {
    const stepIdx = Math.round(ev.tick / stepTicks);
    if (stepIdx >= 0 && stepIdx < MAX_STEPS) {
      maxStep = Math.max(maxStep, stepIdx);
      const st = pat.steps[stepIdx];
      if (st.notes.length < MAX_NOTES && !st.notes.some((n) => n.note === ev.note)) {
        st.notes.push({ note: ev.note, vel: ev.vel });
      }
    }
  }
  pat.length = clamp(Math.max(16, Math.ceil((maxStep + 1) / 4) * 4), 1, MAX_STEPS);
  return pat;
}

