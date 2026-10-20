/**
 * BaudGirl FM-1+VA Virtual Analog Preset Engine, SysEx v4 Codec, MIDI CC Streamer,
 * Procedural Recipe Generator, Mutator, and Web Audio VA Synthesizer.
 *
 * Byte-accurate to BaudGirl's fm1preset.js, editmodel.js, and fm1seq.js (v102).
 */

import { clamp } from "./dx7.js";
import { SeededRNG } from "./dxgenerator.js";

export const VOICE_N = 128;
export const EDIT_N = 155;
export const REC_N = 59;
export const V4_LEN = 231;
export const MARK_VA = 0x5a;
export const MARK_FM = 0xa5;
export const MARK_8BIT = 0xc3;
export const SUBID = 0x7d;

export const VA_WAVES = ["Sine", "Saw", "Triangle", "Square"];
export const VA_FILTER_TYPES = ["LP12", "LP24", "BP", "HP"];
export const VA_KEY_TRACKS = ["0%", "33%", "67%", "100%"];
export const LFO_WAVES = ["Triangle", "Saw Down", "Saw Up", "Square", "Sine", "S&Hold"];

export const FX_DEFS = [
  { id: 0, key: "filter", name: "FILTER", types: ["LP", "BP", "HP"], params: [["CUT", 0, 107], ["RES", 0, 10]] },
  { id: 1, key: "reverb", name: "REVERB", types: ["Room", "Hall", "Plate"], params: [["DEC", 0, 100], ["MIX", 0, 100]] },
  { id: 2, key: "delay", name: "DELAY", types: null, params: [["FDBK", 0, 100], ["RATE", 0, 100], ["MIX", 0, 100]] },
  { id: 3, key: "distort", name: "DISTORT", types: ["Soft", "Hard", "Fold"], params: [["GAIN", 0, 100], ["TONE", 0, 100], ["LVL", 0, 100]] },
  { id: 4, key: "chorus", name: "CHORUS", types: null, params: [["RATE", 0, 100], ["DPTH", 0, 100], ["MIX", 0, 100]] },
  { id: 5, key: "phaser", name: "PHASER", types: null, params: [["RATE", 0, 100], ["DPTH", 0, 100], ["MIX", 0, 100]] },
  { id: 6, key: "crush", name: "CRUSH", types: null, params: [["BITS", 1, 16], ["SRATE", 0, 100], ["MIX", 0, 100]] },
];

// Exact Cutoff frequency tables from BaudGirl firmware/src/ui_knobs.cpp
const FREQ_HZ = [
  20, 21, 23, 25, 26, 28, 30, 32, 35, 37, 40, 43, 46, 49, 53, 56, 60, 65, 69, 74,
  80, 85, 91, 98, 105, 112, 121, 129, 138, 148, 159, 170, 182, 195, 209, 224, 240, 258, 276, 296,
  317, 340, 364, 390, 418, 448, 480, 514, 551, 590, 632, 678, 726, 778, 834, 893, 957,
];
const FREQ_HHZ = [
  10, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 23, 25, 26, 28, 30, 33, 35, 38, 40, 43,
  46, 50, 53, 57, 61, 66, 70, 76, 81, 87, 93, 100, 107, 115, 123, 132, 141, 151, 162, 174, 186, 200,
];

export function cutoffToHz(v) {
  const c = clamp(v, 0, 100);
  if (c < 57) return FREQ_HZ[c];
  return FREQ_HHZ[c - 57] * 100;
}

export function cutoffText(v) {
  const c = clamp(v, 0, 100);
  if (c < 57) return `${FREQ_HZ[c]}Hz`;
  const h = FREQ_HHZ[c - 57];
  return h < 100 ? `${Math.floor(h / 10)}.${h % 10}kHz` : `${Math.floor(h / 10)}kHz`;
}

// BaudGirl firmware RESET_RECORD (59 bytes)
export const RESET_RECORD = Uint8Array.from([
  107, 3, 3, 30, 30, 3, 30, 30, 25, 30, 55, 70, 30, 25, 40, 30, 50, 20,
  3, 3, 3, 3, 3, 3, 3, 3, 3,
  0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0,
  6, 0, 0, 7, 0, 0, 8, 0, 0, 0, 0, 100, 0, 0,
]);

// BaudGirl INIT_EDIT (155 bytes) with Break Point 39 (C3) and LFO Sync Off
export const INIT_EDIT = Uint8Array.from([
  ...[0, 1, 2, 3, 4].flatMap(() =>
    [99, 99, 99, 99, 99, 99, 99, 0, 39, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7]
  ),
  99, 99, 99, 99, 99, 99, 99, 0, 39, 0, 0, 0, 0, 0, 0, 0, 99, 0, 1, 0, 7,
  99, 99, 99, 99, 50, 50, 50, 50, 0, 0, 1, 35, 0, 0, 0, 0, 0, 3, 24,
  73, 78, 73, 84, 32, 32, 32, 32, 32, 32,
]);

// 7-bit Yamaha inverted checksum from BaudGirl fm1seq.js
export function ysum(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + (b ^ 0xff)) & 0xff;
  return s & 0x7f;
}

// 8-into-7 byte packing for the 59-byte record -> 68 SysEx bytes
export function pack87(bytes) {
  const out = [];
  for (let g = 0; g < bytes.length; g += 7) {
    const grp = bytes.slice(g, g + 7);
    let hi = 0;
    grp.forEach((b, k) => {
      hi |= ((b >> 7) & 1) << k;
    });
    out.push(hi, ...Array.from(grp, (b) => b & 0x7f));
  }
  return out;
}

export function unpack87(bytes, n = REC_N) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = Math.floor(i / 7) * 8;
    const k = i % 7;
    out[i] = bytes[g + 1 + k] | (((bytes[g] >> k) & 1) << 7);
  }
  return out;
}

// Stock FM-1 155B <-> 128B voice packing (fm1preset.js)
export function packVoice(e) {
  const b = new Uint8Array(VOICE_N);
  for (let n = 0; n < 6; n++) {
    const d = n * 21;
    const p = n * 17;
    for (let k = 0; k < 11; k++) b[p + k] = e[d + k];
    b[p + 11] = (e[d + 11] & 3) | ((e[d + 12] << 2) & 0x0c);
    b[p + 12] = (e[d + 13] & 7) | ((e[d + 20] << 3) & 0x78);
    b[p + 13] = (e[d + 14] & 3) | ((e[d + 15] << 2) & 0x1c);
    b[p + 14] = e[d + 16];
    b[p + 15] = (e[d + 17] & 1) | ((e[d + 18] << 1) & 0x3e);
    b[p + 16] = e[d + 19];
  }
  for (let k = 0; k < 9; k++) b[102 + k] = e[126 + k];
  b[111] = (e[135] & 7) | ((e[136] << 3) & 8);
  for (let k = 0; k < 4; k++) b[112 + k] = e[137 + k];
  b[116] = (e[141] & 1) | ((e[142] << 1) & 0x0e) | ((e[143] << 4) & 0x70);
  b[117] = e[144];
  for (let k = 0; k < 10; k++) b[118 + k] = e[145 + k];
  return b;
}

export function unpackVoice(src) {
  const s8 = (b) => (b > 127 ? b - 256 : b);
  const e = new Uint8Array(EDIT_N);
  for (let n = 0; n < 6; n++) {
    const s = n * 17;
    const d = n * 21;
    for (let k = 0; k < 11; k++) e[d + k] = src[s + k];
    e[d + 11] = src[s + 11] & 3;
    e[d + 12] = (src[s + 11] >> 2) & 3;
    let c = s8(src[s + 12]);
    e[d + 13] = c & 7;
    e[d + 20] = (c >> 3) & 0xff;
    c = s8(src[s + 13]);
    e[d + 14] = c & 3;
    e[d + 15] = (c >> 2) & 0xff;
    e[d + 16] = src[s + 14];
    c = s8(src[s + 15]);
    e[d + 17] = c & 1;
    e[d + 18] = (c >> 1) & 0xff;
    e[d + 19] = src[s + 16];
  }
  for (let k = 0; k < 8; k++) e[126 + k] = src[102 + k];
  e[134] = src[110];
  const c = s8(src[111]);
  e[135] = c & 7;
  e[136] = (c >> 3) & 0xff;
  for (let k = 0; k < 4; k++) e[137 + k] = src[112 + k];
  const b = src[116];
  e[141] = b & 1;
  e[142] = (b >> 1) & 7;
  e[143] = (s8(b) >> 4) & 0xff;
  e[144] = src[117];
  for (let k = 0; k < 10; k++) e[145 + k] = src[118 + k];
  return e;
}

export class VAPatch {
  constructor(init = {}) {
    this.name = VAPatch.sanitizeName(init.name ?? "INIT VA");
    this.slot = clamp(init.slot ?? 112, 0, 127); // Slot 112 = Preset 113 (VA Pack start)
    this.mono = init.mono ? 1 : 0;
    this.transpose = clamp(init.transpose ?? 24, 0, 48);
    this.level = clamp(init.level ?? 78, 0, 99);
    this.velocityToLevel = clamp(init.velocityToLevel ?? 3, 0, 7);

    // VA Oscillator
    this.wave = clamp(init.wave ?? 1, 0, 3); // 0=Sine, 1=Saw, 2=Triangle, 3=Square
    this.super = clamp(init.super ?? 0, 0, 100);
    this.detune = clamp(init.detune ?? 50, 0, 100);
    this.drift = clamp(init.drift ?? 0, 0, 100);
    this.sub = clamp(init.sub ?? 0, 0, 100);
    this.noise = clamp(init.noise ?? 0, 0, 100);
    this.pwm = clamp(init.pwm ?? 0, 0, 100);

    // VA Filter
    this.filterType = clamp(init.filterType ?? 0, 0, 3); // 0=LP12, 1=LP24, 2=BP, 3=HP
    this.keyTracking = clamp(init.keyTracking ?? 0, 0, 3); // 0=0%, 1=33%, 2=67%, 3=100%
    this.cutoff = clamp(init.cutoff ?? 100, 0, 100);
    this.resonance = clamp(init.resonance ?? 0, 0, 100);
    this.filterEnv = clamp(init.filterEnv ?? 0, 0, 100);
    this.filterDecay = clamp(init.filterDecay ?? 50, 0, 100);
    this.shape = clamp(init.shape ?? 0, 0, 100);
    this.filterVelocity = clamp(init.filterVelocity ?? 0, 0, 100);
    this.lfoCutoff = clamp(init.lfoCutoff ?? 0, 0, 100);

    // Performance Envelope (ADSR) & OP6 Amp EG
    this.envOn = init.envOn !== undefined ? Boolean(init.envOn) : true;
    this.attack = clamp(init.attack ?? 5, 0, 100);
    this.decay = clamp(init.decay ?? 45, 0, 100);
    this.sustain = clamp(init.sustain ?? 80, 0, 100);
    this.release = clamp(init.release ?? 25, 0, 100);

    // OP6 underlying DX7 EG (mirrors ADSR so patch sounds right even if ENV switch is toggled)
    this.ampR1 = clamp(init.ampR1 ?? 95, 0, 99);
    this.ampR2 = clamp(init.ampR2 ?? 65, 0, 99);
    this.ampR3 = clamp(init.ampR3 ?? 50, 0, 99);
    this.ampR4 = clamp(init.ampR4 ?? 70, 0, 99);
    this.ampL1 = clamp(init.ampL1 ?? 99, 0, 99);
    this.ampL2 = clamp(init.ampL2 ?? 85, 0, 99);
    this.ampL3 = clamp(init.ampL3 ?? 80, 0, 99);
    this.ampL4 = clamp(init.ampL4 ?? 0, 0, 99);

    // LFO
    this.lfoWave = clamp(init.lfoWave ?? 0, 0, 5);
    this.lfoSpeed = clamp(init.lfoSpeed ?? 35, 0, 99);
    this.lfoDelay = clamp(init.lfoDelay ?? 0, 0, 99);
    this.lfoPmd = clamp(init.lfoPmd ?? 0, 0, 99);
    this.lfoAmd = clamp(init.lfoAmd ?? 0, 0, 99);
    this.lfoPms = clamp(init.lfoPms ?? 3, 0, 7);
    this.lfoSync = init.lfoSync ? 1 : 0;

    // 7 Effects
    this.fx = [
      { on: false, type: 0, p: [107, 3] },        // 0: Filter
      { on: false, type: 0, p: [30, 30] },        // 1: Reverb
      { on: false, type: 0, p: [30, 30, 25] },    // 2: Delay
      { on: false, type: 0, p: [30, 55, 70] },    // 3: Distortion
      { on: false, type: 0, p: [30, 25, 40] },    // 4: Chorus
      { on: false, type: 0, p: [30, 50, 20] },    // 5: Phaser
      { on: false, type: 0, p: [8, 72, 50] },     // 6: Bitcrush
    ];
    if (Array.isArray(init.fx)) {
      init.fx.forEach((f, idx) => {
        if (this.fx[idx] && f) {
          this.fx[idx] = {
            on: Boolean(f.on),
            type: f.type ?? 0,
            p: Array.isArray(f.p) ? [...f.p] : [...this.fx[idx].p],
          };
        }
      });
    }
  }

  static sanitizeName(name) {
    const ascii = String(name ?? "INIT VA").replace(/[^\x20-\x7e]/g, "").toUpperCase();
    return (ascii || "INIT VA").slice(0, 10).padEnd(10, " ");
  }

  syncOp6FromAdsr() {
    this.ampR1 = clamp(Math.round(99 - this.attack * 0.85), 10, 99);
    this.ampR2 = clamp(Math.round(99 - this.decay * 0.82), 10, 99);
    this.ampR3 = 60;
    this.ampR4 = clamp(Math.round(99 - this.release * 0.82), 12, 99);
    this.ampL1 = 99;
    this.ampL2 = clamp(Math.round(this.sustain * 0.99), 0, 99);
    this.ampL3 = this.ampL2;
    this.ampL4 = 0;
  }

  clampAll() {
    this.name = VAPatch.sanitizeName(this.name);
    this.slot = clamp(this.slot, 0, 127);
    this.mono = this.mono ? 1 : 0;
    this.transpose = clamp(this.transpose, 0, 48);
    this.level = clamp(this.level, 0, 99);
    this.velocityToLevel = clamp(this.velocityToLevel, 0, 7);

    this.wave = clamp(this.wave, 0, 3);
    this.super = clamp(this.super, 0, 100);
    this.detune = clamp(this.detune, 0, 100);
    this.drift = clamp(this.drift, 0, 100);
    this.sub = clamp(this.sub, 0, 100);
    this.noise = clamp(this.noise, 0, 100);
    this.pwm = clamp(this.pwm, 0, 100);

    this.filterType = clamp(this.filterType, 0, 3);
    this.keyTracking = clamp(this.keyTracking, 0, 3);
    this.cutoff = clamp(this.cutoff, 0, 100);
    this.resonance = clamp(this.resonance, 0, 100);
    this.filterEnv = clamp(this.filterEnv, 0, 100);
    this.filterDecay = clamp(this.filterDecay, 0, 100);
    this.shape = clamp(this.shape, 0, 100);
    this.filterVelocity = clamp(this.filterVelocity, 0, 100);
    this.lfoCutoff = clamp(this.lfoCutoff, 0, 100);

    this.attack = clamp(this.attack, 0, 100);
    this.decay = clamp(this.decay, 0, 100);
    this.sustain = clamp(this.sustain, 0, 100);
    this.release = clamp(this.release, 0, 100);
    this.syncOp6FromAdsr();

    this.lfoWave = clamp(this.lfoWave, 0, 5);
    this.lfoSpeed = clamp(this.lfoSpeed, 0, 99);
    this.lfoDelay = clamp(this.lfoDelay, 0, 99);
    this.lfoPmd = clamp(this.lfoPmd, 0, 99);
    this.lfoAmd = clamp(this.lfoAmd, 0, 99);
    this.lfoPms = clamp(this.lfoPms, 0, 7);
    return this;
  }

  copy() {
    return new VAPatch({
      ...this,
      fx: this.fx.map((f) => ({ on: f.on, type: f.type, p: [...f.p] })),
    });
  }

  /**
   * Produces the exact { edit (155B), voice (128B), record (59B) } bytes expected by BaudGirl's FM-1+VA firmware.
   */
  toFirmwareBytes() {
    this.clampAll();
    const e = Uint8Array.from(INIT_EDIT);
    const r = Uint8Array.from(RESET_RECORD);

    // Engine marker
    r[18] = MARK_VA;

    // OP6 (bytes 0..20 in unpacked edit buffer)
    e[0] = this.ampR1;
    e[1] = this.ampR2;
    e[2] = this.ampR3;
    e[3] = this.ampR4;
    e[4] = this.ampL1;
    e[5] = this.ampL2;
    e[6] = this.ampL3;
    e[7] = this.ampL4;
    e[15] = this.velocityToLevel;
    e[16] = this.level;

    // LFO & Transpose
    e[137] = this.lfoSpeed;
    e[138] = this.lfoDelay;
    e[139] = this.lfoPmd;
    e[140] = this.lfoAmd;
    e[141] = this.lfoSync ? 1 : 0;
    e[142] = this.lfoWave;
    e[143] = this.lfoPms;
    e[144] = this.transpose;

    // Name (bytes 145..154)
    const padded = VAPatch.sanitizeName(this.name);
    for (let i = 0; i < 10; i++) e[145 + i] = padded.charCodeAt(i);

    // VA Oscillator in record
    r[19] = clamp(this.wave, 0, 3) + 1;
    r[20] = this.super;
    r[21] = this.detune;
    r[22] = this.drift;
    r[45] = 0x80 | this.sub;
    r[46] = 0x80 | this.noise;
    r[48] = 0x80 | this.pwm;

    // VA Filter in record
    r[23] = 0x80 | this.cutoff;
    r[24] = 0x80 | this.resonance;
    r[25] = 0x80 | this.filterEnv;
    r[26] = 0x80 | ((this.keyTracking & 3) << 2) | (this.filterType & 3);
    r[47] = 0x80 | this.filterVelocity;
    r[49] = 0x80 | this.shape;
    r[50] = 0x80 | this.lfoCutoff;
    r[51] = 0x80 | this.filterDecay;

    // Performance Envelope & Mono
    r[53] = (r[53] & ~0x40) | (this.envOn ? 0x40 : 0);
    r[54] = this.attack;
    r[55] = this.decay;
    r[56] = this.sustain;
    r[57] = this.release;
    r[58] = this.mono ? 1 : 0;

    // Effects 0..5
    for (let t = 0; t < 6; t++) {
      const f = this.fx[t];
      r[27 + 3 * t] = t; // default chain slot
      r[28 + 3 * t] = f.on ? 1 : 0;
      r[29 + 3 * t] = f.type ?? 0;
      for (let j = 0; j < f.p.length; j++) {
        r[3 * t + j] = f.p[j];
      }
    }

    // Effect 6: Bitcrush
    const bc = this.fx[6];
    r[5] = 0x80 | (bc.on ? 8 : 0) | 4; // place 4 (after distortion)
    r[35] = clamp(bc.p[0], 1, 16);
    r[41] = clamp(bc.p[1], 0, 100);
    r[44] = clamp(bc.p[2], 0, 100);

    return { edit: e, voice: packVoice(e), record: r };
  }

  static fromFirmwareBytes(voice, record, slot = 112) {
    const e = voice.length === EDIT_N ? voice : unpackVoice(voice);
    const r = record ? Uint8Array.from(record) : Uint8Array.from(RESET_RECORD);
    const name = String.fromCharCode(...e.slice(145, 155)).replace(/[^\x20-\x7e]/g, " ");
    const perf = (at, dflt) => ((r[at] & 0x80) && (r[at] & 0x7f) <= 100 ? r[at] & 0x7f : dflt);
    const mode = r[26] & 0x80 ? r[26] & 0x0f : 0;

    const fx = [0, 1, 2, 3, 4, 5].map((t) => ({
      on: Boolean(r[28 + 3 * t]),
      type: r[29 + 3 * t] <= 2 ? r[29 + 3 * t] : 0,
      p: FX_DEFS[t].params.map(([_, min, max], j) => clamp(r[3 * t + j], min, max)),
    }));
    const bcMarked = (r[5] & 0x80) !== 0;
    fx.push({
      on: bcMarked && (r[5] & 8) !== 0,
      type: 0,
      p: [
        bcMarked && r[35] >= 1 && r[35] <= 16 ? r[35] : 8,
        bcMarked && r[41] <= 100 ? r[41] : 72,
        bcMarked && r[44] <= 100 ? r[44] : 50,
      ],
    });

    return new VAPatch({
      name,
      slot,
      mono: Boolean(r[58]),
      transpose: e[144],
      level: e[16],
      velocityToLevel: e[15],
      wave: r[19] >= 1 && r[19] <= 4 ? r[19] - 1 : 1,
      super: r[20] <= 100 ? r[20] : 0,
      detune: r[21] <= 100 ? r[21] : 50,
      drift: r[22] <= 100 ? r[22] : 0,
      sub: perf(45, 0),
      noise: perf(46, 0),
      pwm: perf(48, 0),
      filterType: mode & 3,
      keyTracking: (mode >> 2) & 3,
      cutoff: perf(23, 100),
      resonance: perf(24, 0),
      filterEnv: perf(25, 0),
      filterDecay: perf(51, 0),
      shape: perf(49, 0),
      filterVelocity: perf(47, 0),
      lfoCutoff: perf(50, 0),
      envOn: Boolean(r[53] & 0x40),
      attack: Math.min(100, r[54]),
      decay: Math.min(100, r[55]),
      sustain: Math.min(100, r[56]),
      release: Math.min(100, r[57]),
      ampR1: e[0],
      ampR2: e[1],
      ampR3: e[2],
      ampR4: e[3],
      ampL1: e[4],
      ampL2: e[5],
      ampL3: e[6],
      ampL4: e[7],
      lfoWave: Math.min(5, e[142]),
      lfoSpeed: e[137],
      lfoDelay: e[138],
      lfoPmd: e[139],
      lfoAmd: e[140],
      lfoSync: e[141],
      lfoPms: e[143],
      fx,
    });
  }
}

/**
 * Encodes a VAPatch into BaudGirl's exact 231-byte v4 SysEx message:
 * F0 43 00 7D 04 <slot> <edit 155B> <pack87(record) 68B> <ysum> F7
 */
export function encodeVAPresetSysex(patch, slotOverride = null) {
  const { edit, record } = patch.toFirmwareBytes();
  const slot = (slotOverride !== null ? slotOverride : patch.slot) & 0x7f;
  const payload = [...edit, ...pack87(record)];
  return Uint8Array.from([0xf0, 0x43, 0x00, SUBID, 0x04, slot, ...payload, ysum(payload), 0xf7]);
}

export function decodeVAPresetSysex(msg) {
  if (
    msg.length !== V4_LEN ||
    msg[0] !== 0xf0 ||
    msg[1] !== 0x43 ||
    msg[3] !== SUBID ||
    msg[4] !== 0x04 ||
    msg[V4_LEN - 1] !== 0xf7
  ) {
    return null;
  }
  const payload = msg.slice(6, V4_LEN - 2);
  if (ysum(payload) !== msg[V4_LEN - 2]) {
    throw new Error("Checksum mismatch in FM-1+VA v4 preset SysEx message");
  }
  const slot = msg[5];
  const edit = payload.slice(0, EDIT_N);
  const record = unpack87(payload.slice(EDIT_N), REC_N);
  return VAPatch.fromFirmwareBytes(edit, record, slot);
}

/**
 * Encodes an array of VAPatches into a multi-message .syx file (BaudGirl toSyx format).
 */
export function encodeVABankSysex(patches, startSlot = 112) {
  const parts = patches.map((p, i) => encodeVAPresetSysex(p, (startSlot + i) & 0x7f));
  const out = new Uint8Array(parts.reduce((acc, b) => acc + b.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function parseVASysexBytes(bytes) {
  const messages = [];
  let start = -1;
  bytes.forEach((b, i) => {
    if (b === 0xf0) start = i;
    else if (b === 0xf7 && start >= 0) {
      messages.push(bytes.slice(start, i + 1));
      start = -1;
    }
  });
  const patches = [];
  for (const m of messages) {
    const p = decodeVAPresetSysex(m);
    if (p) patches.push(p);
  }
  if (patches.length === 0) {
    throw new Error("No valid FM-1+VA v4 preset messages found in .syx file");
  }
  return patches;
}

/**
 * Encodes all real-time MIDI CC messages for BaudGirl's FM-1+VA firmware (Section 11.8 & 11.9.2).
 * Allows instant live parameter auditioning on an active VA slot without flash writes.
 */
export function encodeVALiveCCs(patch, midiChannel = 0, fxChannel = 1) {
  const ch = midiChannel & 0x0f;
  const fxCh = fxChannel & 0x0f;
  const scale100 = (v) => clamp(Math.round((v / 100) * 127), 0, 127);
  const scale99 = (v) => clamp(Math.round((v / 99) * 127), 0, 127);
  const band4 = (v) => [16, 48, 80, 112][clamp(v, 0, 3)];
  const band3 = (v) => [21, 64, 106][clamp(v, 0, 2)];

  const msgs = [
    // VA Oscillator (CC 24..30)
    [0xb0 | ch, 24, band4(patch.wave)],
    [0xb0 | ch, 25, scale100(patch.super)],
    [0xb0 | ch, 26, scale100(patch.detune)],
    [0xb0 | ch, 27, scale100(patch.drift)],
    [0xb0 | ch, 28, scale100(patch.sub)],
    [0xb0 | ch, 29, scale100(patch.noise)],
    [0xb0 | ch, 30, scale100(patch.pwm)],
    // VA Filter (CC 31, 74, 71, 52..57)
    [0xb0 | ch, 31, band4(patch.filterType)],
    [0xb0 | ch, 74, scale100(patch.cutoff)],
    [0xb0 | ch, 71, scale100(patch.resonance)],
    [0xb0 | ch, 52, scale100(patch.filterEnv)],
    [0xb0 | ch, 53, scale100(patch.filterDecay)],
    [0xb0 | ch, 54, scale100(patch.shape)],
    [0xb0 | ch, 55, scale100(patch.filterVelocity)],
    [0xb0 | ch, 56, band4(patch.keyTracking)],
    [0xb0 | ch, 57, scale100(patch.lfoCutoff)],
    // LFO (CC 76, 77, 78)
    [0xb0 | ch, 76, scale99(patch.lfoSpeed)],
    [0xb0 | ch, 77, scale99(patch.lfoPmd)],
    [0xb0 | ch, 78, scale99(patch.lfoDelay)],
  ];

  if (patch.envOn) {
    msgs.push(
      [0xb0 | ch, 73, scale100(patch.attack)],
      [0xb0 | ch, 75, scale100(patch.decay)],
      [0xb0 | ch, 70, scale100(patch.sustain)],
      [0xb0 | ch, 72, scale100(patch.release)]
    );
  }

  // FX Channel CCs (CC 0..23) if fxChannel differs from midiChannel
  if (fxCh !== ch) {
    const f = patch.fx;
    msgs.push(
      [0xb0 | fxCh, 0, f[0].on ? 127 : 0],
      [0xb0 | fxCh, 1, band3(f[0].type)],
      [0xb0 | fxCh, 2, clamp(f[0].p[0], 0, 107)],
      [0xb0 | fxCh, 3, clamp(f[0].p[1], 0, 10)],
      [0xb0 | fxCh, 4, f[1].on ? 127 : 0],
      [0xb0 | fxCh, 5, band3(f[1].type)],
      [0xb0 | fxCh, 6, clamp(f[1].p[0], 0, 100)],
      [0xb0 | fxCh, 7, clamp(f[1].p[1], 0, 100)],
      [0xb0 | fxCh, 8, f[2].on ? 127 : 0],
      [0xb0 | fxCh, 9, clamp(f[2].p[0], 0, 100)],
      [0xb0 | fxCh, 10, clamp(f[2].p[1], 0, 100)],
      [0xb0 | fxCh, 11, clamp(f[2].p[2], 0, 100)],
      [0xb0 | fxCh, 12, f[3].on ? 127 : 0],
      [0xb0 | fxCh, 13, clamp(f[3].p[0], 0, 100)],
      [0xb0 | fxCh, 14, clamp(f[3].p[1], 0, 100)],
      [0xb0 | fxCh, 15, clamp(f[3].p[2], 0, 100)],
      [0xb0 | fxCh, 16, f[4].on ? 127 : 0],
      [0xb0 | fxCh, 17, clamp(f[4].p[0], 0, 100)],
      [0xb0 | fxCh, 18, clamp(f[4].p[1], 0, 100)],
      [0xb0 | fxCh, 19, clamp(f[4].p[2], 0, 100)],
      [0xb0 | fxCh, 20, f[5].on ? 127 : 0],
      [0xb0 | fxCh, 21, clamp(f[5].p[0], 0, 100)],
      [0xb0 | fxCh, 22, clamp(f[5].p[1], 0, 100)],
      [0xb0 | fxCh, 23, clamp(f[5].p[2], 0, 100)]
    );
  }
  return msgs;
}

// ============================================================================
// Procedural VA Recipe Generator, Sonic Profiles, and Mutator
// ============================================================================

const VA_NAME_BANK = {
  acid: ["ACID 303", "TB SQUELCH", "RESO LINE", "LIQUID 303", "PHOS ACID", "RAVE BASS"],
  reese: ["REESE SUB", "DARK DNB", "NEURO BASS", "WIDE REESE", "HOOVER SUB", "TERROR SUB"],
  supersaw: ["TRANCE SAW", "HYPER LEAD", "ANTHEM SAW", "SUPER RAVE", "STADIUM LD", "JP8000 SAW"],
  pad: ["JUNO CLOUD", "WARM DRIFT", "VELVET PAD", "DREAM POLY", "HORIZON VA", "SOLARIS PD"],
  pluck: ["PLUCK ARP", "SNAP SYN", "POLY PLUCK", "GLASS PLK", "TECHNO PLK", "MUTE SYNTH"],
  pwm: ["PWM STRING", "PULSE ENSM", "OBX BRASS", "HOLLOW PWM", "SYMPHONY", "DARK PULSE"],
  brass: ["CS80 BRASS", "PROPHET HR", "POLY HORN", "ANALOG BRS", "BLADE HORN", "SYNTH BRS"],
  chip: ["CHIP LEAD", "NES PULSE", "CRUSH ARP", "ARCADE LD", "BIT SYNTH", "RETRO WAVE"],
  fx: ["NOISE SWP", "LASER DROP", "RISER VA", "SCIFI DRON", "MOD MATRIX", "CHAOS S&H"],
};

export const VA_RECIPES = {
  acid: {
    mono: 1, transpose: 12, waves: [1, 3],
    super: [0, 18], detune: [45, 55], drift: [5, 22], sub: [10, 45], noise: [0, 8], pwm: [0, 40],
    filterTypes: [1], cutoff: [18, 46], resonance: [68, 92], filterEnv: [65, 96], filterDecay: [22, 52],
    shape: [20, 65], keyTrack: [1, 2],
    attack: [0, 4], decay: [25, 50], sustain: [10, 45], release: [8, 22],
    fxChance: { distort: 0.75, delay: 0.45 },
  },
  reese: {
    mono: 1, transpose: 12, waves: [1],
    super: [65, 95], detune: [62, 84], drift: [15, 40], sub: [55, 90], noise: [5, 20], pwm: [0, 0],
    filterTypes: [1, 0], cutoff: [26, 54], resonance: [25, 55], filterEnv: [20, 50], filterDecay: [45, 80],
    shape: [10, 40], keyTrack: [1, 2],
    attack: [5, 18], decay: [50, 80], sustain: [75, 98], release: [20, 40],
    fxChance: { chorus: 0.7, distort: 0.55 },
  },
  supersaw: {
    mono: 0, transpose: 24, waves: [1],
    super: [75, 100], detune: [60, 82], drift: [10, 30], sub: [15, 45], noise: [5, 22], pwm: [0, 0],
    filterTypes: [0, 1], cutoff: [68, 96], resonance: [12, 38], filterEnv: [35, 70], filterDecay: [40, 72],
    shape: [0, 30], keyTrack: [2, 3],
    attack: [0, 8], decay: [45, 75], sustain: [70, 95], release: [28, 52],
    fxChance: { delay: 0.75, reverb: 0.8, chorus: 0.5 },
  },
  pad: {
    mono: 0, transpose: 24, waves: [1, 2, 3],
    super: [45, 85], detune: [56, 74], drift: [20, 55], sub: [10, 35], noise: [0, 12], pwm: [25, 70],
    filterTypes: [0, 1], cutoff: [38, 72], resonance: [10, 35], filterEnv: [15, 45], filterDecay: [60, 92],
    shape: [0, 25], keyTrack: [1, 2],
    attack: [38, 78], decay: [55, 88], sustain: [68, 95], release: [52, 88],
    fxChance: { chorus: 0.85, reverb: 0.9, phaser: 0.35 },
  },
  pluck: {
    mono: 0, transpose: 24, waves: [1, 3, 2],
    super: [20, 65], detune: [52, 68], drift: [5, 20], sub: [10, 40], noise: [5, 25], pwm: [15, 55],
    filterTypes: [0, 1], cutoff: [22, 52], resonance: [20, 58], filterEnv: [60, 92], filterDecay: [15, 40],
    shape: [30, 75], keyTrack: [2, 3],
    attack: [0, 3], decay: [18, 42], sustain: [0, 22], release: [15, 38],
    fxChance: { delay: 0.8, reverb: 0.65, chorus: 0.4 },
  },
  pwm: {
    mono: 0, transpose: 24, waves: [3],
    super: [25, 65], detune: [54, 70], drift: [15, 42], sub: [15, 40], noise: [0, 10], pwm: [55, 92],
    filterTypes: [0, 1], cutoff: [48, 82], resonance: [8, 28], filterEnv: [20, 50], filterDecay: [50, 80],
    shape: [0, 20], keyTrack: [1, 2],
    attack: [18, 48], decay: [50, 78], sustain: [75, 95], release: [38, 68],
    fxChance: { chorus: 0.8, phaser: 0.5, reverb: 0.7 },
  },
  brass: {
    mono: 0, transpose: 24, waves: [1],
    super: [30, 65], detune: [55, 70], drift: [18, 45], sub: [10, 30], noise: [0, 10], pwm: [0, 25],
    filterTypes: [1, 0], cutoff: [32, 62], resonance: [18, 42], filterEnv: [52, 82], filterDecay: [38, 68],
    shape: [15, 45], keyTrack: [2, 3],
    attack: [8, 24], decay: [42, 70], sustain: [65, 88], release: [20, 42],
    fxChance: { reverb: 0.75, chorus: 0.45 },
  },
  chip: {
    mono: 1, transpose: 24, waves: [3, 2],
    super: [0, 15], detune: [48, 54], drift: [0, 8], sub: [0, 35], noise: [0, 20], pwm: [35, 80],
    filterTypes: [0, 2], cutoff: [70, 98], resonance: [10, 40], filterEnv: [25, 65], filterDecay: [20, 45],
    shape: [0, 35], keyTrack: [2, 3],
    attack: [0, 2], decay: [20, 48], sustain: [35, 75], release: [5, 18],
    fxChance: { crush: 0.85, delay: 0.6 },
  },
  fx: {
    mono: 0, transpose: 24, waves: [1, 2, 3, 0],
    super: [40, 95], detune: [65, 95], drift: [40, 90], sub: [20, 70], noise: [30, 85], pwm: [20, 90],
    filterTypes: [1, 2, 3], cutoff: [20, 85], resonance: [55, 92], filterEnv: [40, 95], filterDecay: [30, 90],
    shape: [20, 85], keyTrack: [0, 3],
    attack: [10, 65], decay: [40, 90], sustain: [30, 90], release: [40, 88],
    fxChance: { phaser: 0.7, delay: 0.8, reverb: 0.8, crush: 0.4 },
  },
};

export const VA_PROFILES = {
  warm: (p) => {
    p.cutoff = clamp(Math.round(p.cutoff * 0.72), 18, 72);
    p.drift = clamp(p.drift + 18, 10, 85);
    p.sub = clamp(p.sub + 20, 15, 90);
  },
  bright: (p) => {
    p.cutoff = clamp(p.cutoff + 22, 55, 100);
    p.filterEnv = clamp(p.filterEnv + 15, 25, 100);
  },
  aggressive: (p) => {
    p.resonance = clamp(p.resonance + 22, 40, 95);
    p.fx[3].on = true;
    p.fx[3].p = [clamp(p.fx[3].p[0] + 25, 45, 90), 65, 78];
  },
  wide: (p) => {
    p.super = clamp(Math.max(p.super, 65) + 15, 65, 100);
    p.detune = clamp(Math.max(p.detune, 62) + 8, 60, 88);
    p.fx[4].on = true;
  },
  lofi: (p) => {
    p.drift = clamp(p.drift + 30, 25, 95);
    p.noise = clamp(p.noise + 18, 10, 65);
    p.fx[6].on = true;
    p.fx[6].p = [10, 58, 42];
  },
};

export function generateVAPatch({
  category = "supersaw",
  profile = "none",
  cutoffBias = 0.6,
  unisonSpread = 0.5,
  envSpeed = 0.5,
  fxDensity = 0.5,
  seed = null,
  slot = 112,
} = {}) {
  const rng = new SeededRNG(seed);
  const catKey = VA_RECIPES[category] ? category : rng.choice(Object.keys(VA_RECIPES));
  const rec = VA_RECIPES[catKey];
  const names = VA_NAME_BANK[catKey] || VA_NAME_BANK.supersaw;
  const baseName = rng.choice(names);
  const suffix = rng.randint(1, 99);
  const name = `${baseName.slice(0, 7)} ${String(suffix).padStart(2, "0")}`;

  const patch = new VAPatch({
    name,
    slot,
    mono: rec.mono,
    transpose: rec.transpose,
    level: rng.randint(78, 92),
    velocityToLevel: rng.randint(2, 5),
    wave: rng.choice(rec.waves),
    super: Math.round(rng.randint(rec.super[0], rec.super[1]) * (0.5 + unisonSpread * 0.7)),
    detune: Math.round(50 + (rng.randint(rec.detune[0], rec.detune[1]) - 50) * (0.5 + unisonSpread * 0.8)),
    drift: rng.randint(rec.drift[0], rec.drift[1]),
    sub: rng.randint(rec.sub[0], rec.sub[1]),
    noise: rng.randint(rec.noise[0], rec.noise[1]),
    pwm: rng.randint(rec.pwm[0], rec.pwm[1]),
    filterType: rng.choice(rec.filterTypes),
    keyTracking: rng.randint(rec.keyTrack[0], rec.keyTrack[1]),
    cutoff: Math.round(rng.randint(rec.cutoff[0], rec.cutoff[1]) * (0.55 + cutoffBias * 0.75)),
    resonance: rng.randint(rec.resonance[0], rec.resonance[1]),
    filterEnv: rng.randint(rec.filterEnv[0], rec.filterEnv[1]),
    filterDecay: Math.round(rng.randint(rec.filterDecay[0], rec.filterDecay[1]) * (1.3 - envSpeed * 0.6)),
    shape: rng.randint(rec.shape[0], rec.shape[1]),
    filterVelocity: rng.randint(15, 65),
    lfoCutoff: catKey === "fx" || catKey === "pad" ? rng.randint(10, 45) : rng.randint(0, 15),
    envOn: true,
    attack: Math.round(rng.randint(rec.attack[0], rec.attack[1]) * (1.3 - envSpeed * 0.6)),
    decay: Math.round(rng.randint(rec.decay[0], rec.decay[1]) * (1.3 - envSpeed * 0.6)),
    sustain: rng.randint(rec.sustain[0], rec.sustain[1]),
    release: Math.round(rng.randint(rec.release[0], rec.release[1]) * (1.3 - envSpeed * 0.6)),
    lfoWave: catKey === "fx" ? rng.choice([0, 3, 5]) : rng.choice([0, 4]),
    lfoSpeed: rng.randint(22, 58),
    lfoDelay: rng.randint(0, 35),
    lfoPmd: catKey === "fx" ? rng.randint(15, 55) : rng.randint(0, 10),
    lfoAmd: rng.randint(0, 12),
    lfoPms: 3,
    lfoSync: 0,
  });

  // Apply Effects based on recipe and fxDensity
  const fxMap = { filter: 0, reverb: 1, delay: 2, distort: 3, chorus: 4, phaser: 5, crush: 6 };
  for (const [fxName, baseProb] of Object.entries(rec.fxChance || {})) {
    const idx = fxMap[fxName];
    if (idx !== undefined && rng.random() < baseProb * (0.4 + fxDensity * 1.1)) {
      patch.fx[idx].on = true;
      if (idx === 1) {
        patch.fx[1].type = rng.randint(0, 2);
        patch.fx[1].p = [rng.randint(30, 68), rng.randint(20, 45)];
      } else if (idx === 2) {
        patch.fx[2].p = [rng.randint(25, 55), rng.randint(25, 60), rng.randint(18, 38)];
      } else if (idx === 3) {
        patch.fx[3].type = rng.randint(0, 2);
        patch.fx[3].p = [rng.randint(25, 65), rng.randint(45, 75), rng.randint(65, 82)];
      } else if (idx === 4) {
        patch.fx[4].p = [rng.randint(20, 45), rng.randint(25, 55), rng.randint(30, 55)];
      } else if (idx === 5) {
        patch.fx[5].p = [rng.randint(18, 45), rng.randint(35, 70), rng.randint(20, 45)];
      } else if (idx === 6) {
        patch.fx[6].p = [rng.randint(6, 12), rng.randint(45, 85), rng.randint(35, 65)];
      }
    }
  }

  if (profile && VA_PROFILES[profile]) {
    VA_PROFILES[profile](patch);
  }

  return patch.clampAll();
}

export function mutateVAPatch(patch, { mutationRate = 0.2, seed = null } = {}) {
  const rng = new SeededRNG(seed);
  const p = patch.copy();
  const jitter = (val, max = 100) => {
    if (rng.random() > 0.65) return val;
    const span = Math.max(2, Math.round(max * mutationRate * 0.45));
    return clamp(val + rng.randint(-span, span), 0, max);
  };

  if (rng.random() < mutationRate * 0.35) p.wave = rng.randint(0, 3);
  if (rng.random() < mutationRate * 0.35) p.filterType = rng.randint(0, 3);

  p.super = jitter(p.super, 100);
  p.detune = jitter(p.detune, 100);
  p.drift = jitter(p.drift, 100);
  p.sub = jitter(p.sub, 100);
  p.noise = jitter(p.noise, 100);
  p.pwm = jitter(p.pwm, 100);

  p.cutoff = jitter(p.cutoff, 100);
  p.resonance = jitter(p.resonance, 100);
  p.filterEnv = jitter(p.filterEnv, 100);
  p.filterDecay = jitter(p.filterDecay, 100);
  p.shape = jitter(p.shape, 100);
  p.lfoCutoff = jitter(p.lfoCutoff, 100);

  p.attack = jitter(p.attack, 100);
  p.decay = jitter(p.decay, 100);
  p.sustain = jitter(p.sustain, 100);
  p.release = jitter(p.release, 100);
  p.lfoSpeed = jitter(p.lfoSpeed, 99);

  const base = p.name.trim().replace(/\s*M\d*$/, "").slice(0, 8);
  p.name = VAPatch.sanitizeName(`${base} M${rng.randint(1, 9)}`);
  return p.clampAll();
}

// ============================================================================
// Built-In Web Audio Virtual Analog Synthesizer for Browser Auditioning
// ============================================================================

export class VAAudioPlayer {
  constructor() {
    this.ctx = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  playNote(patch, midiNote = 60, velocity = 100, duration = 0.9) {
    return this.playPatchNote(patch, midiNote, velocity, duration);
  }

  stopAllNotes() {
    // One-shot audio nodes self-terminate; method provided for lifecycle symmetry
  }

  playPatchNote(patch, midiNote = 60, velocity = 100, duration = 0.9) {
    const ctx = this._ensureCtx();
    const now = ctx.currentTime;

    const semitones = (midiNote + (patch.transpose - 24)) - 69;
    const baseFreq = 440 * Math.pow(2, semitones / 12);

    const waveType = ["sine", "sawtooth", "triangle", "square"][patch.wave] || "sawtooth";
    const filterMode = ["lowpass", "lowpass", "bandpass", "highpass"][patch.filterType] || "lowpass";

    // Filter node
    const filter = ctx.createBiquadFilter();
    filter.type = filterMode;
    const baseCutHz = cutoffToHz(patch.cutoff);
    const keyTrackMult = Math.pow(2, ((midiNote - 60) / 12) * (patch.keyTracking / 3));
    const startCut = clamp(baseCutHz * keyTrackMult, 20, 18000);
    const envPeakHz = clamp(startCut * Math.pow(2, (patch.filterEnv / 100) * 4.2), 20, 18500);
    const filtDecaySec = 0.04 + (patch.filterDecay / 100) * 1.4;

    filter.frequency.setValueAtTime(envPeakHz, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, startCut), now + filtDecaySec);
    filter.Q.setValueAtTime(0.7 + (patch.resonance / 100) * (patch.filterType === 1 ? 16 : 11), now);

    // Amp Envelope
    const ampGain = ctx.createGain();
    const atkSec = Math.max(0.004, (patch.attack / 100) * 1.1);
    const decSec = Math.max(0.02, (patch.decay / 100) * 1.2);
    const susLvl = Math.max(0.001, (patch.sustain / 100) * (patch.level / 99) * (velocity / 127) * 0.35);
    const peakLvl = Math.max(0.01, (patch.level / 99) * (velocity / 127) * 0.38);
    const relSec = Math.max(0.03, (patch.release / 100) * 1.5);

    ampGain.gain.setValueAtTime(0.0001, now);
    ampGain.gain.linearRampToValueAtTime(peakLvl, now + atkSec);
    ampGain.gain.linearRampToValueAtTime(susLvl, now + atkSec + decSec);
    ampGain.gain.setValueAtTime(susLvl, now + duration);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + relSec);

    // Optional Distortion WaveShaper
    let postNode = filter;
    if (patch.fx[3]?.on) {
      const shaper = ctx.createWaveShaper();
      const k = 1 + (patch.fx[3].p[0] / 100) * 28;
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = Math.tanh(k * x);
      }
      shaper.curve = curve;
      filter.connect(shaper);
      postNode = shaper;
    }

    postNode.connect(ampGain);
    ampGain.connect(ctx.destination);

    const stopAt = now + duration + relSec + 0.05;

    // Unison / Supersaw oscillators
    const voiceCount = patch.super > 10 ? 5 : 1;
    const spreadCents = (patch.detune - 50) * 0.75 + (patch.super / 100) * 28;
    for (let v = 0; v < voiceCount; v++) {
      const osc = ctx.createOscillator();
      const vGain = ctx.createGain();
      osc.type = waveType;
      const offset = voiceCount === 1 ? 0 : (v / (voiceCount - 1) - 0.5) * 2 * spreadCents;
      const driftCents = (Math.random() - 0.5) * (patch.drift * 0.25);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.detune.setValueAtTime(offset + driftCents, now);
      vGain.gain.value = v === Math.floor(voiceCount / 2) ? 0.65 : (patch.super / 100) * 0.35;
      osc.connect(vGain);
      vGain.connect(filter);
      osc.start(now);
      osc.stop(stopAt);
    }

    // Sub oscillator (-1 Octave)
    if (patch.sub > 0) {
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = "square";
      subOsc.frequency.setValueAtTime(baseFreq * 0.5, now);
      subGain.gain.value = (patch.sub / 100) * 0.4;
      subOsc.connect(subGain);
      subGain.connect(filter);
      subOsc.start(now);
      subOsc.stop(stopAt);
    }

    // White noise generator
    if (patch.noise > 0) {
      const bufLen = Math.ceil(ctx.sampleRate * (duration + relSec));
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noiseSrc = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      noiseSrc.buffer = buf;
      noiseGain.gain.value = (patch.noise / 100) * 0.22;
      noiseSrc.connect(noiseGain);
      noiseGain.connect(filter);
      noiseSrc.start(now);
      noiseSrc.stop(stopAt);
    }
  }
}
