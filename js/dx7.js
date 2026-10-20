/**
 * Core DX7 Domain Models, 32-Algorithm Topologies, 32-Voice Bank, and SysEx Codec (128B/155B/163B/4104B).
 */

export function clamp(val, minVal, maxVal) {
  return Math.max(minVal, Math.min(Math.trunc(val), maxVal));
}

// 21 Operator parameters in exact Yamaha DX7 VCED (155-byte) order: [key, max, default]
export const OP_SPECS = [
  ["eg_rate_1", 99, 99],
  ["eg_rate_2", 99, 99],
  ["eg_rate_3", 99, 99],
  ["eg_rate_4", 99, 99],
  ["eg_level_1", 99, 99],
  ["eg_level_2", 99, 99],
  ["eg_level_3", 99, 99],
  ["eg_level_4", 99, 0],
  ["break_point", 99, 39],
  ["left_depth", 99, 0],
  ["right_depth", 99, 0],
  ["left_curve", 3, 0],
  ["right_curve", 3, 0],
  ["rate_scaling", 7, 0],
  ["amp_mod_sens", 3, 0],
  ["key_vel_sens", 7, 0],
  ["output_level", 99, 99],
  ["osc_mode", 1, 0],
  ["freq_coarse", 31, 1],
  ["freq_fine", 99, 0],
  ["detune", 14, 7],
];

export const PITCH_EG_SPECS = [
  ["rate_1", 99, 99],
  ["rate_2", 99, 99],
  ["rate_3", 99, 99],
  ["rate_4", 99, 99],
  ["level_1", 99, 50],
  ["level_2", 99, 50],
  ["level_3", 99, 50],
  ["level_4", 99, 50],
];

export const LFO_SPECS = [
  ["speed", 99, 35],
  ["delay", 99, 0],
  ["pitch_mod_depth", 99, 0],
  ["amp_mod_depth", 99, 0],
  ["key_sync", 1, 1],
  ["waveform", 5, 0],
  ["pitch_mod_sens", 7, 0],
];

function applySpecs(target, init, specs) {
  for (const [key, max, def] of specs) {
    const raw = init && init[key] !== undefined ? init[key] : def;
    target[key] = clamp(raw, 0, max);
  }
}

function clampSpecs(target, specs) {
  for (const [key, max] of specs) {
    target[key] = clamp(target[key], 0, max);
  }
}

export class Operator {
  constructor(init = {}) {
    applySpecs(this, init, OP_SPECS);
    this.enabled = init.enabled !== undefined ? Boolean(init.enabled) : true;
  }

  clampAll() {
    clampSpecs(this, OP_SPECS);
  }

  get frequency_ratio() {
    if (this.osc_mode === 1) {
      return Math.pow(10.0, this.freq_coarse % 4) * (1.0 + this.freq_fine / 100.0);
    }
    const coarse = this.freq_coarse === 0 ? 0.5 : Number(this.freq_coarse);
    return coarse * (1.0 + this.freq_fine / 100.0);
  }

  get detune_cents() {
    return this.detune - 7;
  }

  copy() {
    return new Operator(this);
  }
}

export class PitchEG {
  constructor(init = {}) {
    applySpecs(this, init, PITCH_EG_SPECS);
  }

  clampAll() {
    clampSpecs(this, PITCH_EG_SPECS);
  }

  copy() {
    return new PitchEG(this);
  }
}

export class LFO {
  static WAVEFORM_NAMES = ["Triangle", "Saw Down", "Saw Up", "Square", "Sine", "Sample & Hold"];

  constructor(init = {}) {
    applySpecs(this, init, LFO_SPECS);
  }

  clampAll() {
    clampSpecs(this, LFO_SPECS);
  }

  get waveform_name() {
    return LFO.WAVEFORM_NAMES[this.waveform] || "Triangle";
  }

  copy() {
    return new LFO(this);
  }
}

export class DX7Patch {
  constructor({
    name = "INIT VOICE",
    operators = null,
    pitch_eg = null,
    lfo = null,
    algorithm = 1,
    feedback = 0,
    key_sync = 1,
    transpose = 24,
  } = {}) {
    this.operators = operators
      ? operators.map((op) => (op instanceof Operator ? op : new Operator(op)))
      : Array.from({ length: 6 }, () => new Operator());

    if (this.operators.length !== 6) {
      throw new Error(`DX7Patch must have exactly 6 operators, got ${this.operators.length}`);
    }

    this.pitch_eg = pitch_eg instanceof PitchEG ? pitch_eg : new PitchEG(pitch_eg || {});
    this.lfo = lfo instanceof LFO ? lfo : new LFO(lfo || {});
    this.algorithm = algorithm;
    this.feedback = feedback;
    this.key_sync = key_sync;
    this.transpose = transpose;
    this.name = DX7Patch.sanitizeName(name);
    this.clampAll();
  }

  static sanitizeName(name) {
    const str = String(name || "");
    let cleaned = "";
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      cleaned += code >= 32 && code <= 126 ? str[i] : " ";
    }
    return cleaned.slice(0, 10).padEnd(10, " ");
  }

  clampAll() {
    this.algorithm = clamp(this.algorithm, 1, 32);
    this.feedback = clamp(this.feedback, 0, 7);
    this.key_sync = clamp(this.key_sync, 0, 1);
    this.transpose = clamp(this.transpose, 0, 48);
    this.pitch_eg.clampAll();
    this.lfo.clampAll();
    for (const op of this.operators) op.clampAll();
    this.name = DX7Patch.sanitizeName(this.name);
  }

  op(opNum) {
    if (opNum < 1 || opNum > 6) throw new RangeError(`Operator number must be 1-6, got ${opNum}`);
    return this.operators[opNum - 1];
  }

  get algorithm_0indexed() {
    return this.algorithm - 1;
  }

  get transpose_note() {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${notes[this.transpose % 12]}${Math.floor(this.transpose / 12) + 1}`;
  }

  copy() {
    return new DX7Patch({
      name: this.name,
      operators: this.operators.map((op) => op.copy()),
      pitch_eg: this.pitch_eg.copy(),
      lfo: this.lfo.copy(),
      algorithm: this.algorithm,
      feedback: this.feedback,
      key_sync: this.key_sync,
      transpose: this.transpose,
    });
  }

  summary() {
    return `Patch '${this.name}' (Alg ${this.algorithm}, FB ${this.feedback}, Trans ${this.transpose_note})`;
  }
}

/* ============================================================================
 * 32 DX7 Algorithms (Compact Data-Driven Definition)
 * Format: [carriers, feedbackOp, connections, description]
 * ========================================================================== */

const RAW_ALGORITHMS = [
  [[1, 3], 6, { 6: [5], 5: [4], 4: [3], 2: [1] }, "Dual Stacks: [6->5->4->3] + [2->1]"],
  [[1, 3], 2, { 6: [5], 5: [4], 4: [3], 2: [1] }, "Dual Stacks: [6->5->4->3] + [2(FB)->1]"],
  [[1, 4], 6, { 6: [5], 5: [4], 3: [2], 2: [1] }, "Dual 3-op Stacks: [6->5->4] + [3->2->1]"],
  [[1, 4], 6, { 6: [4], 5: [4], 3: [2], 2: [1] }, "Branching 3-op Stacks: [6,5->4] + [3->2->1]"],
  [[1, 3, 5], 6, { 6: [5], 4: [3], 2: [1] }, "Three 2-op Stacks: [6->5], [4->3], [2->1]"],
  [[1, 3, 5], 6, { 6: [5, 3], 4: [3], 2: [1] }, "Three 2-op Stacks with shared OP6 modulation"],
  [[1, 3, 5], 6, { 6: [5], 4: [3], 2: [1] }, "Three Carriers: [6(FB)->5], [4->3], [2->1]"],
  [[1, 3, 5], 4, { 6: [5], 4: [3], 2: [1] }, "Three 2-op Stacks: [6->5], [4(FB)->3], [2->1]"],
  [[1, 3, 5], 2, { 6: [5], 4: [3], 2: [1] }, "Three 2-op Stacks: [6->5], [4->3], [2(FB)->1]"],
  [[1, 4], 3, { 6: [5], 5: [4], 3: [2], 2: [1] }, "Dual 3-op Stacks: [6->5->4] + [3(FB)->2->1]"],
  [[1, 4], 6, { 6: [4], 5: [4], 3: [2], 2: [1] }, "Dual Stacks: [6(FB),5->4] + [3->2->1]"],
  [[1, 3, 4, 5], 6, { 6: [5, 4, 3], 2: [1] }, "Master Modulator [6] -> [5,4,3] + [2->1]"],
  [[1, 4, 5], 6, { 6: [5, 4], 3: [2], 2: [1] }, "Modulator [6] -> [5,4] + [3->2->1]"],
  [[1, 3, 5], 6, { 6: [5, 4], 4: [3], 2: [1] }, "Modulator [6] -> [5, 4->3] + [2->1]"],
  [[1, 3, 5], 2, { 6: [5, 4], 4: [3], 2: [1] }, "Modulator [6] -> [5, 4->3] + [2(FB)->1]"],
  [[1], 6, { 6: [5], 5: [4], 4: [3], 3: [2], 2: [1] }, "Single 6-op Tower: [6->5->4->3->2->1]"],
  [[1], 2, { 6: [5], 5: [4], 4: [3], 3: [2], 2: [1] }, "Single 6-op Tower (FB on OP2)"],
  [[1], 3, { 6: [5], 5: [4], 4: [1], 3: [2], 2: [1] }, "Single Carrier: Parallel branches into [1]"],
  [[1], 6, { 6: [5, 3], 5: [4], 4: [1], 3: [1], 2: [1] }, "Single Carrier: [6->5->4, 6->3, 2] -> [1]"],
  [[1, 2, 3], 3, { 6: [2], 5: [1], 4: [1] }, "Three Carriers: [3(FB)], [6->2], [5,4->1]"],
  [[1, 2, 3], 6, { 6: [3], 5: [2], 4: [1] }, "Three Carriers: [6->3], [5->2], [4->1]"],
  [[1, 2, 3, 4], 6, { 6: [5], 5: [4] }, "Four Carriers: [6->5->4], [3], [2], [1]"],
  [[1, 2, 3, 4], 6, { 6: [5], 5: [4, 3] }, "Four Carriers: [6->5->(4,3)], [2], [1]"],
  [[1, 2, 3, 4], 6, { 6: [5, 4] }, "Four Carriers: [6->(5,4)], [3], [2], [1]"],
  [[1, 2, 3, 4, 5], 6, { 6: [5] }, "Five Carriers: [6->5] + [4, 3, 2, 1]"],
  [[1, 2, 3], 6, { 6: [5], 5: [3], 4: [3] }, "Three Carriers: [6->5->3, 4->3], [2], [1]"],
  [[1, 2, 3], 3, { 6: [5], 5: [4], 4: [2] }, "Three Carriers: [6->5->4->2], [3(FB)], [1]"],
  [[1, 3, 5], 2, { 6: [5], 4: [3], 2: [1] }, "Three Carriers: [6->5], [4->3], [2(FB)->1]"],
  [[1, 2, 3, 4, 5], 6, { 6: [5] }, "Five Carriers: [6->5], [4], [3], [2], [1]"],
  [[1, 2, 3, 4, 5], 5, { 5: [4] }, "Five Carriers: [5(FB)->4], [6], [3], [2], [1]"],
  [[1, 2, 3, 4, 5, 6], 6, {}, "All 6 Carriers: Additive with [6(FB)]"],
  [[1, 2, 3, 4, 5, 6], 6, {}, "Pure Additive: 6 independent carrier sinewaves"],
];

export class AlgorithmInfo {
  constructor(id, carriers, feedback_op, connections, description) {
    this.id = id;
    this.carriers = Object.freeze([...carriers]);
    this.feedback_op = feedback_op;
    this.connections = connections;
    this.description = description;
    Object.freeze(this);
  }

  get modulators() {
    const cSet = new Set(this.carriers);
    return [1, 2, 3, 4, 5, 6].filter((op) => !cSet.has(op));
  }

  isCarrier(op) {
    return this.carriers.includes(op);
  }

  isModulator(op) {
    return !this.carriers.includes(op);
  }

  modulates(op) {
    return this.connections[op] || [];
  }
}

export const ALGORITHMS = Object.fromEntries(
  RAW_ALGORITHMS.map(([carriers, fb, conn, desc], idx) => [
    idx + 1,
    new AlgorithmInfo(idx + 1, carriers, fb, conn, desc),
  ])
);

export function getAlgorithm(algId) {
  const alg = ALGORITHMS[Number(algId)];
  if (!alg) throw new RangeError(`Algorithm ID must be 1-32, got ${algId}`);
  return alg;
}

export const isCarrier = (algId, opNum) => getAlgorithm(algId).isCarrier(opNum);
export const getCarrierOps = (algId) => getAlgorithm(algId).carriers;
export const getModulatorOps = (algId) => getAlgorithm(algId).modulators;

/* ============================================================================
 * SysEx Codec (128B Packed, 155B Unpacked, 163B VCED, 4104B VMEM)
 * ========================================================================== */

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const YAMAHA_ID = 0x43;
export const SINGLE_VOICE_FORMAT = 0x00;
export const BANK_FORMAT = 0x09;

export function calculateChecksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return (-sum) & 0x7f;
}

function encodeAscii10(name) {
  const s = DX7Patch.sanitizeName(name);
  return Uint8Array.from({ length: 10 }, (_, i) => s.charCodeAt(i) & 0x7f);
}

function decodeAscii(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] & 0x7f;
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
  }
  return s;
}

export function packVoice155(patch) {
  const buf = new Uint8Array(155);

  for (let opIdx = 0; opIdx < 6; opIdx++) {
    const op = patch.op(6 - opIdx);
    const base = opIdx * 21;
    for (let p = 0; p < 21; p++) {
      buf[base + p] = op[OP_SPECS[p][0]] & 0x7f;
    }
  }

  for (let i = 0; i < 8; i++) {
    buf[126 + i] = patch.pitch_eg[PITCH_EG_SPECS[i][0]] & 0x7f;
  }

  buf[134] = patch.algorithm_0indexed & 0x1f;
  buf[135] = patch.feedback & 0x07;
  buf[136] = patch.key_sync & 0x01;

  for (let i = 0; i < 7; i++) {
    buf[137 + i] = patch.lfo[LFO_SPECS[i][0]] & 0x7f;
  }

  buf[144] = patch.transpose & 0x7f;
  buf.set(encodeAscii10(patch.name), 145);
  return buf;
}

export function unpackVoice155(data, offset = 0) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < offset + 155) {
    throw new Error(`Expected at least ${offset + 155} bytes for 155-byte voice, got ${bytes.length}`);
  }
  const chunk = bytes.subarray(offset, offset + 155);
  const operators = new Array(6);

  for (let opIdx = 0; opIdx < 6; opIdx++) {
    const base = opIdx * 21;
    const init = {};
    for (let p = 0; p < 21; p++) {
      init[OP_SPECS[p][0]] = chunk[base + p] & 0x7f;
    }
    operators[5 - opIdx] = new Operator(init);
  }

  const pegInit = {};
  for (let i = 0; i < 8; i++) pegInit[PITCH_EG_SPECS[i][0]] = chunk[126 + i] & 0x7f;

  const lfoInit = {};
  for (let i = 0; i < 7; i++) lfoInit[LFO_SPECS[i][0]] = chunk[137 + i] & 0x7f;

  return new DX7Patch({
    name: decodeAscii(chunk.subarray(145, 155)),
    operators,
    pitch_eg: new PitchEG(pegInit),
    lfo: new LFO(lfoInit),
    algorithm: (chunk[134] & 0x1f) + 1,
    feedback: chunk[135] & 0x07,
    key_sync: chunk[136] & 0x01,
    transpose: chunk[144] & 0x7f,
  });
}

export function packVoice128(patch) {
  const buf = new Uint8Array(128);

  for (let opIdx = 0; opIdx < 6; opIdx++) {
    const op = patch.op(6 - opIdx);
    const base = opIdx * 17;
    // First 11 params (rates 1-4, levels 1-4, break_point, left_depth, right_depth) map 1:1
    for (let p = 0; p < 11; p++) {
      buf[base + p] = op[OP_SPECS[p][0]] & 0x7f;
    }
    buf[base + 11] = ((op.right_curve & 0x03) << 2) | (op.left_curve & 0x03);
    buf[base + 12] = ((op.detune & 0x0f) << 3) | (op.rate_scaling & 0x07);
    buf[base + 13] = ((op.key_vel_sens & 0x07) << 2) | (op.amp_mod_sens & 0x03);
    buf[base + 14] = op.output_level & 0x7f;
    buf[base + 15] = ((op.freq_coarse & 0x1f) << 1) | (op.osc_mode & 0x01);
    buf[base + 16] = op.freq_fine & 0x7f;
  }

  for (let i = 0; i < 8; i++) {
    buf[102 + i] = patch.pitch_eg[PITCH_EG_SPECS[i][0]] & 0x7f;
  }

  buf[110] = patch.algorithm_0indexed & 0x1f;
  buf[111] = ((patch.key_sync & 0x01) << 3) | (patch.feedback & 0x07);
  buf[112] = patch.lfo.speed & 0x7f;
  buf[113] = patch.lfo.delay & 0x7f;
  buf[114] = patch.lfo.pitch_mod_depth & 0x7f;
  buf[115] = patch.lfo.amp_mod_depth & 0x7f;
  buf[116] =
    ((patch.lfo.pitch_mod_sens & 0x07) << 4) |
    ((patch.lfo.waveform & 0x07) << 1) |
    (patch.lfo.key_sync & 0x01);
  buf[117] = patch.transpose & 0x7f;
  buf.set(encodeAscii10(patch.name), 118);

  return buf;
}

export function unpackVoice128(data, offset = 0) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < offset + 128) {
    throw new Error(`Expected at least ${offset + 128} bytes for packed voice, got ${bytes.length}`);
  }
  const chunk = bytes.subarray(offset, offset + 128);
  const operators = new Array(6);

  for (let opIdx = 0; opIdx < 6; opIdx++) {
    const base = opIdx * 17;
    const init = {};
    for (let p = 0; p < 11; p++) {
      init[OP_SPECS[p][0]] = chunk[base + p] & 0x7f;
    }
    init.left_curve = chunk[base + 11] & 0x03;
    init.right_curve = (chunk[base + 11] >> 2) & 0x03;
    init.rate_scaling = chunk[base + 12] & 0x07;
    init.detune = (chunk[base + 12] >> 3) & 0x0f;
    init.amp_mod_sens = chunk[base + 13] & 0x03;
    init.key_vel_sens = (chunk[base + 13] >> 2) & 0x07;
    init.output_level = chunk[base + 14] & 0x7f;
    init.osc_mode = chunk[base + 15] & 0x01;
    init.freq_coarse = (chunk[base + 15] >> 1) & 0x1f;
    init.freq_fine = chunk[base + 16] & 0x7f;
    operators[5 - opIdx] = new Operator(init);
  }

  const pegInit = {};
  for (let i = 0; i < 8; i++) pegInit[PITCH_EG_SPECS[i][0]] = chunk[102 + i] & 0x7f;

  const lfoInit = {
    speed: chunk[112] & 0x7f,
    delay: chunk[113] & 0x7f,
    pitch_mod_depth: chunk[114] & 0x7f,
    amp_mod_depth: chunk[115] & 0x7f,
    key_sync: chunk[116] & 0x01,
    waveform: (chunk[116] >> 1) & 0x07,
    pitch_mod_sens: (chunk[116] >> 4) & 0x07,
  };

  return new DX7Patch({
    name: decodeAscii(chunk.subarray(118, 128)),
    operators,
    pitch_eg: new PitchEG(pegInit),
    lfo: new LFO(lfoInit),
    algorithm: (chunk[110] & 0x1f) + 1,
    feedback: chunk[111] & 0x07,
    key_sync: (chunk[111] >> 3) & 0x01,
    transpose: chunk[117] & 0x7f,
  });
}

export function encodeSingleVoiceSysex(patch, channel = 0) {
  const vced = packVoice155(patch);
  const out = new Uint8Array(163);
  out[0] = SYSEX_START;
  out[1] = YAMAHA_ID;
  out[2] = channel & 0x0f;
  out[3] = SINGLE_VOICE_FORMAT;
  out[4] = 0x01;
  out[5] = 0x1b;
  out.set(vced, 6);
  out[161] = calculateChecksum(vced);
  out[162] = SYSEX_END;
  return out;
}

export function decodeSingleVoiceSysex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length !== 163) {
    throw new Error(`Expected 163 bytes for DX7 single-voice SysEx, got ${data.length}`);
  }
  if (data[0] !== SYSEX_START || data[1] !== YAMAHA_ID || (data[3] & 0x7e) !== 0 || data[162] !== SYSEX_END) {
    throw new Error("Invalid DX7 single voice SysEx header/footer");
  }
  const vced = data.subarray(6, 161);
  const expectedSum = calculateChecksum(vced);
  if (data[161] !== expectedSum) {
    throw new Error(`Checksum mismatch: expected 0x${expectedSum.toString(16)}, got 0x${data[161].toString(16)}`);
  }
  return unpackVoice155(vced);
}

export function encodeBankSysex(patches, channel = 0) {
  if (patches.length !== 32) {
    throw new Error(`Bank must contain exactly 32 patches, got ${patches.length}`);
  }
  const vmem = new Uint8Array(4096);
  for (let i = 0; i < 32; i++) {
    vmem.set(packVoice128(patches[i]), i * 128);
  }

  const out = new Uint8Array(4104);
  out[0] = SYSEX_START;
  out[1] = YAMAHA_ID;
  out[2] = channel & 0x0f;
  out[3] = BANK_FORMAT;
  out[4] = 0x20;
  out[5] = 0x00;
  out.set(vmem, 6);
  out[4102] = calculateChecksum(vmem);
  out[4103] = SYSEX_END;
  return out;
}

export function decodeBankSysex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length !== 4104) {
    throw new Error(`Expected 4104 bytes for DX7 bank SysEx, got ${data.length}`);
  }
  if (data[0] !== SYSEX_START || data[1] !== YAMAHA_ID || data[3] !== BANK_FORMAT || data[4103] !== SYSEX_END) {
    throw new Error("Invalid DX7 bank SysEx header/footer");
  }
  const vmem = data.subarray(6, 4102);
  const expectedSum = calculateChecksum(vmem);
  if (data[4102] !== expectedSum) {
    throw new Error(`Bank checksum mismatch: expected 0x${expectedSum.toString(16)}, got 0x${data[4102].toString(16)}`);
  }
  const patches = new Array(32);
  for (let i = 0; i < 32; i++) {
    patches[i] = unpackVoice128(vmem, i * 128);
  }
  return patches;
}

export function parseSysexBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length === 163) {
    return { type: "voice", patch: decodeSingleVoiceSysex(data) };
  }
  if (data.length === 4104) {
    return { type: "bank", patches: decodeBankSysex(data) };
  }
  if (data.length === 128) {
    return { type: "voice", patch: unpackVoice128(data) };
  }
  if (data.length === 155) {
    return { type: "voice", patch: unpackVoice155(data) };
  }
  if (data.length === 4096) {
    const patches = new Array(32);
    for (let i = 0; i < 32; i++) patches[i] = unpackVoice128(data, i * 128);
    return { type: "bank", patches };
  }
  throw new Error(`Unrecognized SysEx / patch file format (${data.length} bytes)`);
}

export class DX7Bank {
  constructor(patches = null) {
    if (patches) {
      if (patches.length !== 32) throw new Error(`Bank requires exactly 32 patches, got ${patches.length}`);
      this.patches = patches.map((p) => (p instanceof DX7Patch ? p.copy() : new DX7Patch(p)));
    } else {
      this.patches = Array.from({ length: 32 }, (_, i) => new DX7Patch({ name: `INIT ${i + 1}` }));
    }
  }

  getPatch(slot1to32) {
    if (slot1to32 < 1 || slot1to32 > 32) throw new RangeError(`Bank slot must be 1-32, got ${slot1to32}`);
    return this.patches[slot1to32 - 1];
  }

  setPatch(slot1to32, patch) {
    if (slot1to32 < 1 || slot1to32 > 32) throw new RangeError(`Bank slot must be 1-32, got ${slot1to32}`);
    this.patches[slot1to32 - 1] = patch.copy();
  }

  toSysex(channel = 0) {
    return encodeBankSysex(this.patches, channel);
  }
}
