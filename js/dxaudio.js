/**
 * Pure-JavaScript Yamaha DX7 6-Operator FM Synthesis Audio Engine & Web Audio Player.
 */

import { getAlgorithm } from "./dx7.js";

export function dx7RateToSeconds(rate) {
  return rate >= 99 ? 0.003 : 30.0 * Math.pow(10.0, -rate / 25.0) + 0.003;
}

export function midiToFreq(noteNumber) {
  return 440.0 * Math.pow(2.0, (noteNumber - 69.0) / 12.0);
}

export class DX7SynthEngine {
  static DEFAULT_SAMPLE_RATE = 44100;

  static renderNoteFloat32(
    patch,
    {
      midiNote = 60,
      velocity = 100,
      duration = 1.5,
      releaseStart = 1.0,
      sampleRate = DX7SynthEngine.DEFAULT_SAMPLE_RATE,
    } = {}
  ) {
    const totalSamples = Math.trunc(duration * sampleRate);
    const relSample = Math.trunc(releaseStart * sampleRate);
    const dt = 1.0 / sampleRate;
    const twoPi = 2.0 * Math.PI;

    const algInfo = getAlgorithm(patch.algorithm);
    const fbOpIdx = algInfo.feedback_op - 1;
    const baseFreq = midiToFreq(midiNote + (patch.transpose - 24));

    const opFreqs = new Float64Array(6);
    const opEnvParams = new Array(6);
    const opVelGains = new Float64Array(6);

    for (let i = 0; i < 6; i++) {
      const op = patch.operators[i];
      let freq =
        op.osc_mode === 0
          ? baseFreq * (op.freq_coarse === 0 ? 0.5 : op.freq_coarse) * (1.0 + op.freq_fine / 100.0)
          : Math.pow(10.0, op.freq_coarse % 4) * (1.0 + op.freq_fine / 100.0);

      freq *= Math.pow(2.0, ((op.detune - 7) * 1.5) / 1200.0);
      opFreqs[i] = freq;

      opEnvParams[i] = {
        tA: dx7RateToSeconds(op.eg_rate_1),
        tD1: dx7RateToSeconds(op.eg_rate_2),
        tD2: dx7RateToSeconds(op.eg_rate_3),
        tR: dx7RateToSeconds(op.eg_rate_4),
        l1: Math.pow(op.eg_level_1 / 99.0, 2),
        l2: Math.pow(op.eg_level_2 / 99.0, 2),
        l3: Math.pow(op.eg_level_3 / 99.0, 2),
        outGain: op.enabled === false ? 0.0 : Math.pow(op.output_level / 99.0, 2.2),
      };

      opVelGains[i] = op.key_vel_sens > 0 ? Math.pow(velocity / 127.0, op.key_vel_sens / 3.0) : 1.0;
    }

    const fbGain = patch.feedback > 0 ? Math.pow(2.0, patch.feedback - 7) * 2.5 : 0.0;
    const lfoHz = 0.1 + Math.pow(patch.lfo.speed / 99.0, 2) * 25.0;
    const lfoDelaySec = (patch.lfo.delay / 99.0) * 1.5;
    const lfoPmd = (patch.lfo.pitch_mod_depth / 99.0) * (patch.lfo.pitch_mod_sens / 7.0) * 0.03;

    const phases = new Float64Array(6);
    const opAmps = new Float64Array(6);
    const opOutputs = new Float64Array(6);
    let fbVal = 0.0;

    const samples = new Float32Array(totalSamples);
    const incomingMods = Array.from({ length: 6 }, () => []);
    for (const [modNumStr, targets] of Object.entries(algInfo.connections)) {
      const modIdx = Number(modNumStr) - 1;
      for (const targetOpNum of targets) incomingMods[targetOpNum - 1].push(modIdx);
    }

    for (let n = 0; n < totalSamples; n++) {
      const t = n * dt;
      const inRelease = n >= relSample;
      const tRel = inRelease ? (n - relSample) * dt : 0.0;

      let pitchMod = 1.0;
      if (lfoPmd > 0 && t > lfoDelaySec) {
        pitchMod += Math.sin(twoPi * lfoHz * t) * lfoPmd * Math.min(1.0, (t - lfoDelaySec) * 2.0);
      }

      for (let i = 0; i < 6; i++) {
        const { tA, tD1, tD2, tR, l1, l2, l3, outGain } = opEnvParams[i];
        let amp;
        if (!inRelease) {
          if (t < tA) amp = (t / tA) * l1;
          else if (t < tA + tD1) amp = l1 + ((t - tA) / tD1) * (l2 - l1);
          else amp = l2 + Math.min(1.0, (t - tA - tD1) / tD2) * (l3 - l2);
        } else {
          amp = l3 * Math.max(0.0, 1.0 - tRel / tR);
        }
        opAmps[i] = amp * outGain * opVelGains[i];
      }

      // Evaluate from OP6 (idx 5) down to OP1 (idx 0)
      for (let idx = 5; idx >= 0; idx--) {
        let phaseMod = 0.0;
        const mods = incomingMods[idx];
        for (let m = 0; m < mods.length; m++) phaseMod += opOutputs[mods[m]] * 4.0;
        if (idx === fbOpIdx && patch.feedback > 0) phaseMod += fbVal * fbGain;

        const out = Math.sin(phases[idx] + phaseMod) * opAmps[idx];
        opOutputs[idx] = out;
        if (idx === fbOpIdx) fbVal = (fbVal + out) * 0.5;
        phases[idx] = (phases[idx] + twoPi * opFreqs[idx] * pitchMod * dt) % twoPi;
      }

      let audioSample = 0.0;
      for (let c = 0; c < algInfo.carriers.length; c++) {
        audioSample += opOutputs[algInfo.carriers[c] - 1];
      }
      samples[n] = Math.tanh(audioSample * 1.1) * 0.85;
    }

    return samples;
  }

  static renderArpeggioFloat32(
    patch,
    { notes = [48, 52, 55, 60], noteLength = 0.32, sampleRate = DX7SynthEngine.DEFAULT_SAMPLE_RATE } = {}
  ) {
    const buffers = [];
    let totalLen = 0;
    for (let idx = 0; idx < notes.length; idx++) {
      const isLast = idx === notes.length - 1;
      const buf = DX7SynthEngine.renderNoteFloat32(patch, {
        midiNote: notes[idx],
        velocity: 100,
        duration: isLast ? noteLength * 2.5 : noteLength,
        releaseStart: isLast ? noteLength * 1.5 : noteLength * 0.8,
        sampleRate,
      });
      buffers.push(buf);
      totalLen += buf.length;
    }
    const combined = new Float32Array(totalLen);
    let offset = 0;
    for (const buf of buffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }
    return combined;
  }
}

export class WebAudioPlayer {
  constructor() {
    this._ctx = null;
    this._activeSource = null;
  }

  _getContext() {
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this._ctx = new AudioCtx();
    }
    if (this._ctx.state === "suspended") this._ctx.resume();
    return this._ctx;
  }

  stop() {
    if (this._activeSource) {
      try {
        this._activeSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this._activeSource = null;
    }
  }

  stopAllNotes() {
    this.stop();
  }

  playFloat32(samples, sampleRate = DX7SynthEngine.DEFAULT_SAMPLE_RATE) {
    this.stop();
    const ctx = this._getContext();
    const audioBuffer = ctx.createBuffer(1, samples.length, sampleRate);
    audioBuffer.copyToChannel(samples, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (this._activeSource === source) this._activeSource = null;
    };
    this._activeSource = source;
    source.start();
    return source;
  }

  playPatchArpeggio(patch, notes = [48, 52, 55, 60]) {
    const ctx = this._getContext();
    const samples = DX7SynthEngine.renderArpeggioFloat32(patch, { notes, sampleRate: ctx.sampleRate });
    return this.playFloat32(samples, ctx.sampleRate);
  }

  playPatchNote(patch, midiNote = 60, velocity = 100, duration = 1.2) {
    const ctx = this._getContext();
    const samples = DX7SynthEngine.renderNoteFloat32(patch, {
      midiNote,
      velocity,
      duration,
      releaseStart: duration * 0.65,
      sampleRate: ctx.sampleRate,
    });
    return this.playFloat32(samples, ctx.sampleRate);
  }
}
