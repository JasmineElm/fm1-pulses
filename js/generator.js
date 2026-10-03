// generator.js — the generative sequence source (Marbles-style, offline).
//
// Produces a 64-step FM-1 pattern from a set of parameters. No timing, no
// real-time — it fills the steps instantly; the FM-1's own clock plays them.
//
// Chain: LFO (pitch source) → distribution (spread/bias) → quantizer (scale)
//        → gate probability (rests) → Deja Vu (reuse the previous generation)

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  pentMajor: [0, 2, 4, 7, 9],
  pentMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  dimHalfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  dimWholeHalf: [0, 2, 3, 5, 6, 8, 9, 11],
  augmented: [0, 3, 4, 7, 8, 11],
  inSen: [0, 1, 5, 7, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const LFO_WAVES = ["sine", "triangle", "saw", "square", "randomWalk", "smoothRandom", "sampleHold"];

// deterministic PRNG so a seed reproduces a generation exactly
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiName = (n) => {
  const m = Math.round(Number(n) || 0);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};

// ---- LFO: value in [0,1] for phase in [0,1), with state for random shapes ----
function lfoFactory(wave, rng) {
  let walk = rng();
  let target = rng();
  let cur = rng();
  return (phase) => {
    switch (wave) {
      case "sine": return 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
      case "triangle": return 1 - Math.abs(2 * phase - 1);
      case "saw": return phase;
      case "square": return phase < 0.5 ? 1 : 0;
      case "randomWalk": {
        walk += (rng() < 0.5 ? -1 : 1) * 0.15;
        if (walk < 0) walk = 0.15; if (walk > 1) walk = 0.85;
        return walk;
      }
      case "smoothRandom": {
        const t = 0.15;
        cur += (target - cur) * t;
        if (Math.abs(target - cur) < 0.01) target = rng();
        return cur;
      }
      case "sampleHold":
      default: return Math.floor(phase * 4) % 2 ? cur : (cur = rng());
    }
  };
}

// ---- distribution shaping (spread: constant/bell/uniform/extremes, bias) ----
function shape(v, spread, bias) {
  // v in [0,1] center 0.5
  switch (spread) {
    case "constant": v = 0.5; break;
    case "bell": v = 0.5 + (v - 0.5) * (v - 0.5) * (v < 0.5 ? -2 : 2) * 0.5 + (v - 0.5) * 0.6; break;
    case "extremes": v = v < 0.5 ? 0 : 1; break;
    case "uniform":
    default: break;
  }
  // bias: skew toward high (>0) or low (<0), probability weight from the center
  if (bias) v = Math.min(1, Math.max(0, v + bias * (v - 0.5) * 0.8));
  return v;
}

// ---- quantize a note value to a scale, `strength` = snap probability ----
function quantize(note, scale, root, strength, rng) {
  const n = Math.round(note);
  if (rng() > strength) return n;
  const rel = ((n - root) % 12 + 12) % 12;
  let best = scale[0], bestD = 99;
  for (const iv of scale) {
    const d = Math.min(Math.abs(rel - iv), 12 - Math.abs(rel - iv));
    if (d < bestD) { bestD = d; best = iv; }
  }
  const oct = Math.floor((n - root - rel) / 12);
  return root + best + oct * 12;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * generate(params, prevSteps) -> pattern fields + steps.
 * params: seed, length(64), rate, tempo, swing, gate(header), gateProb,
 *         scale, root, lfoWave, lfoAmp(0-100), lfoOffset(-100..100), lfoRate(div),
 *         spread, bias(-100..100), quantSteps(0-100), dejaVu(0-100), velocity
 */
export function generate(params, prevSteps = null) {
  const rng = mulberry32(params.seed >>> 0);
  const scale = SCALES[params.scale] || SCALES.pentMinor;
  const len = clamp(params.length || 64, 1, 64);
  const amp = (params.lfoAmp ?? 50) / 100;
  const offset = (params.lfoOffset ?? 0) / 100;         // -1..1
  const center = params.root;                            // notes swing around the root
  const span = 36;                                      // semitones of swing
  const lfo = lfoFactory(params.lfoWave || "sine", rng);
  const div = params.lfoRate || 4;
  const gateProb = (params.gateProb ?? 70) / 100;
  const dejaVu = (params.dejaVu ?? 0) / 100;
  const quantStrength = (params.quantSteps ?? 100) / 100;
  const fixedVel = params.velocity;

  const steps = [];
  for (let i = 0; i < 64; i++) {
    // Deja Vu: reuse the previous generation's step here
    if (prevSteps && i < len && rng() < dejaVu) {
      const p = prevSteps[i];
      steps.push({ rate: params.rate, notes: p ? p.notes.map((n) => ({ ...n })) : [] });
      continue;
    }
    const active = i < len && rng() < gateProb;
    if (!active) { steps.push({ rate: params.rate, notes: [] }); continue; }

    const phase = ((i / div) % 1 + 1) % 1;
    const lfoVal = lfo(phase);
    let v = 0.5 + (lfoVal - 0.5) * amp + offset;   // 0..1 (amp 1 = full span)
    v = shape(clamp(v, 0, 1), params.spread || "uniform", (params.bias ?? 0) / 100);
    // Amplitude 0 = no pitch swing: every note sits on the scale root (quantize
    // then confirms it against the scale). Offset/spread are ignored at 0.
    const raw = amp === 0 ? params.root : center + (v - 0.5) * span;
    let note = quantize(raw, scale, params.root, quantStrength, rng);

    const vel = fixedVel === "random" || fixedVel == null
      ? 20 + Math.floor(rng() * 107)
      : clamp(Math.round(fixedVel), 1, 127);
    steps.push({ rate: params.rate, notes: [{ note: clamp(Math.round(note), 0, 127), vel }] });
  }
  return { length: len, rate: params.rate, tempo: params.tempo, gate: params.gate, swing: params.swing, steps };
}

export const LFO_RATES = [1, 2, 4, 8, 16, 32, 64];
export const SPREADS = ["constant", "bell", "uniform", "extremes"];

/**
 * generateBank(base, driftPct) -> 16 patterns.
 *
 * All 16 are derived from `base.seed` (so the bank is reproducible) but the
 * character parameters *evolve* across them: slot 0 is the base, slot 15 is
 * drifted furthest along a seeded direction. Notes are quantised to the same
 * scale/root, so the bank reads as one evolving idea rather than 16 randoms.
 */
export function generateBank(base, driftPct = 50) {
  const drift = Math.max(0, Math.min(100, driftPct)) / 100;
  const seed = base.seed >>> 0;
  const r = mulberry32(seed ^ 0x9e3779b9);
  // seeded drift direction per parameter
  const dir = {
    gateProb: r() < 0.5 ? -1 : 1,
    lfoAmp: r() < 0.5 ? -1 : 1,
    bias: r() < 0.5 ? -1 : 1,
    lfoOffset: r() < 0.5 ? -1 : 1,
    lfoRate: r() < 0.5 ? -1 : 1,
    spread: r() < 0.5 ? -1 : 1,
  };
  const rateIdx0 = Math.max(0, LFO_RATES.indexOf(base.lfoRate));
  const spreadIdx0 = Math.max(0, SPREADS.indexOf(base.spread));

  const bank = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 15) * drift;                 // 0 .. drift
    const p = {
      ...base,
      // 16 DISTINCT generations, all derived from the one seed (so the bank is
      // reproducible). Drift is the optional evolution on top: at 0% the 16 are
      // 16 fresh takes on the same parameters; higher, the parameters themselves
      // move from slot 1 to slot 16.
      seed: (seed + i * 0x9e3779b1) >>> 0,
      gateProb: clamp(base.gateProb + dir.gateProb * t * 40, 5, 100),
      lfoAmp: clamp(base.lfoAmp + dir.lfoAmp * t * 35, 0, 100),
      bias: clamp(base.bias + dir.bias * t * 55, -100, 100),
      lfoOffset: clamp(base.lfoOffset + dir.lfoOffset * t * 40, -100, 100),
      lfoRate: LFO_RATES[clamp(rateIdx0 + Math.round(dir.lfoRate * t * 2), 0, LFO_RATES.length - 1)],
      spread: SPREADS[clamp(spreadIdx0 + Math.round(dir.spread * t * 2), 0, SPREADS.length - 1)],
    };
    bank.push(generate(p, i > 0 ? bank[i - 1].steps : null));
  }
  return bank;
}
