/**
 * Consolidated DX7 Patch Generation Suite:
 * - SeededRNG (deterministic Mulberry32 PRNG)
 * - PatchNamer (vintage 10-char name generator)
 * - Data-driven Category Recipes & Sonic Profiles
 * - PatchMutator
 */

import { getAlgorithm, DX7Patch, Operator, PitchEG, LFO, clamp } from "./dx7.js";

/* ============================================================================
 * Seedable PRNG (Mulberry32)
 * ========================================================================== */

export class SeededRNG {
  constructor(seed = null) {
    if (seed === null || seed === undefined || seed === "") {
      this._state = (Math.random() * 0xffffffff) >>> 0;
    } else {
      const num = Number(seed);
      this._state = Number.isFinite(num) ? (num >>> 0) || 0x6d2b79f5 : this._hashString(String(seed));
    }
  }

  _hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  random() {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randint(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(this.random() * (hi - lo + 1)) + lo;
  }

  choice(seq) {
    if (!seq || seq.length === 0) throw new Error("Cannot choose from an empty sequence");
    return seq[Math.floor(this.random() * seq.length)];
  }

  sample(population, k) {
    const pool = [...population];
    if (k < 0 || k > pool.length) throw new RangeError("Sample larger than population or is negative");
    const result = [];
    for (let i = 0; i < k; i++) {
      const j = this.randint(0, pool.length - 1);
      result.push(pool[j]);
      pool.splice(j, 1);
    }
    return result;
  }

  /**
   * Resolve a declarative spec value:
   * - number: returned as-is
   * - [min, max]: random integer in [min, max]
   * - { choice: [...] }: random choice from array
   */
  resolve(spec) {
    if (typeof spec === "number") return spec;
    if (Array.isArray(spec)) return this.randint(spec[0], spec[1]);
    if (spec && Array.isArray(spec.choice)) return this.choice(spec.choice);
    return 0;
  }
}

export class GenerationOptions {
  constructor({
    seed = null,
    algorithm = null,
    category = "constrained",
    profile = null,
    brightness = 0.6,
    dissonance = 0.0,
    envelope_speed = 0.5,
    detune_amount = 0.3,
    velocity_sensitivity = 0.5,
    feedback = null,
    enable_lfo = true,
    name = null,
    name_style = null,
  } = {}) {
    Object.assign(this, {
      seed,
      algorithm,
      category,
      profile,
      brightness,
      dissonance,
      envelope_speed,
      detune_amount,
      velocity_sensitivity,
      feedback,
      enable_lfo,
      name,
      name_style,
    });
  }
}

/* ============================================================================
 * Vintage 10-Character Patch Namer
 * ========================================================================== */

const CATEGORY_PREFIXES = {
  keys: ["E.PNO", "TINE", "RHODS", "DX-PNO", "CLAV", "HRPSI", "DYNA-EP", "GLS-EP", "FM-KEY", "JAZZ-EP", "WRTZR", "PNO-DX", "STNG-EP", "TNE-PNO", "VIB-PNO"],
  bass: ["SLAP-BS", "SUB-BS", "SLD-BS", "ACD-BS", "FNK-BS", "DX-B", "SYN-B", "PNCH-BS", "SUB-LOW", "THMP-BS", "REZ-BS", "FZZ-BS", "GRT-BS", "PLK-BS", "303-BS", "WOB-BS"],
  pad: ["LSH-PD", "WM-PD", "SPCE-PD", "GLS-PD", "VOX-PD", "SOLAR-PD", "AURA-PD", "DRM-PD", "NBLA-PD", "ETHR-PD", "STRG-PD", "CHOR-PD", "VOID-PD", "SWP-PD", "ANLG-PD", "DARK-PD"],
  percussive: ["BONK", "K-1", "SN-FM", "TOM-DX", "CYMBAL", "CLANG", "HIT-FM", "MET-DRUM", "HIHAT", "BARREL", "RIM-SHT", "KCK-SUB", "ZAP-PRC", "COWBL", "SHKR", "LOG-DRM", "KICK", "SNARE", "CLST-DR", "MRZBW-D", "THUMP"],
  lead: ["SYNC-LD", "SOLO-LD", "SAW-LD", "PULS-LD", "DIGI-LD", "NEO-LD", "LZR-LD", "EDGE-LD", "HYPER-LD", "HERO-LD", "REZ-LD", "DIST-LD", "SHRP-LD", "GLD-LD", "TOX-LD", "VNTG-LD"],
  bell: ["CHIME", "TUBULAR", "CRYSTAL", "GLCK", "MARIMBA", "VIBES", "GAMELAN", "BELL", "ICE-BELL", "CELESTE", "TNE-BEL", "GLS-BEL", "METL-CHM", "RING-BL", "TIN-BEL"],
  brass: ["BRASS 1", "SYN-BRS", "HORNS", "TRUMPET", "FANFARE", "POLY-BRS", "BRASS-ST", "MELLOW-B", "WM-BRS", "HI-BRS", "FR-HORN", "STB-BRS", "POW-BRS", "BRS-SEC", "MUT-BRS"],
  pluck: ["KOTO", "KALIMBA", "HARP", "PLUCK-1", "SITAR", "ZITHER", "PIZZ-STR", "MET-PLK", "GUIT-FM", "RAZOR-PLK", "MNDLN", "STNG-PK", "BJO-FM", "HRPS-PK", "SHRP-PK"],
  fx: ["COSMIC", "WARP.FX", "ALIEN", "RISE", "DROP.FX", "CYBER", "LZR", "NOISE.X", "GLITCH", "VRTX", "DRONE", "ZAP-FX", "SWEEP", "ALRM", "RAYGUN", "VOX-FX", "BLIP-FX"],
  random: ["DX-SYNTH", "FM-TONE", "MATRIX", "VECTOR", "HYBRID", "SPECTRA", "QUANTUM", "CYBER", "CHROMA", "SONIC", "NEXUS", "PRSM", "FLUX", "PULSE", "VIBE", "ORBIT"],
};
CATEGORY_PREFIXES.pd = CATEGORY_PREFIXES.pad;
CATEGORY_PREFIXES.drum = CATEGORY_PREFIXES.percussive;

const PROFILE_ADJECTIVES = {
  warm: ["WM", "ANALOG", "MLW", "DEEP", "FAT", "RICH", "SMOOTH", "TUBE", "VNTG", "DK-WM", "LSH-WM", "GLOW", "WOOL"],
  atonal: ["ATONAL", "MTL", "CLANG", "NOISE", "MRZBW", "HIT", "PERC", "RNG", "DSNT", "INHRM", "RAW-NZ", "ZAP", "METL", "CLST"],
  crisp: ["CRISP", "GLASS", "CRYSTAL", "BRIGHT", "RAZOR", "ICE", "CLEAN", "COLD", "PURE", "DIGI", "HYPER", "SPARK", "SHARP", "GLNT", "SHN"],
  gritty: ["GRITTY", "DIRTY", "DRIVE", "RAW", "BITE", "FUZZ", "PUNCH", "ACID", "CRNCH", "EDGE", "AGGR", "HARD", "DIST", "TOXIC", "RUST"],
  ethereal: ["ETHER", "AURA", "SPACE", "DREAM", "DRIFT", "VOID", "LUSH", "SOLAR", "ASTR", "NBLA", "MYST", "GLOW", "COSM", "HAZE"],
};

const ADJECTIVES = [
  "WM", "COLD", "DARK", "BRGHT", "LUSH", "HARD", "SOFT", "DEEP", "PURE", "RAW", "SILK", "NEO", "VNTG", "RETRO", "MEGA",
  "HYPR", "SWT", "FAT", "THIN", "CRISP", "SLOW", "FAST", "ACID", "GLAS", "SOLAR", "LUNAR", "POLY", "MONO", "FM", "DX",
  "DIGI", "CYBER", "SHRP", "AIRY", "DENSE", "HVY", "MUTNT", "REZ", "TOXIC", "ASTR", "GLD", "DRTY", "GRTY", "CHRM", "FLUX",
  "VIBE", "DRFT", "FST", "SLW", "SMTH", "MLW", "NOIR", "ELEC", "HYBD", "PRSM", "VOID", "NBLA", "GLOW", "SHN", "ICE", "RUST",
];

const NOUNS = [
  "PNO", "B", "PD", "LEAD", "BELL", "BRS", "PLK", "STRNG", "STRNGS", "FLT", "REED", "ORGN", "HORN", "VOX", "WAVE", "PULS",
  "TONE", "CHM", "VIBE", "TINE", "CLAV", "WOOD", "MTL", "WIND", "SYN", "SWP", "AURA", "SPCE", "DRM", "STRK", "FRC", "ECHO",
  "BEAT", "DRUM", "K", "SN", "TOM", "HIT", "CLNG", "CYMB", "ZAP", "NOIZ", "DROP", "RISR", "SHK", "GLCH", "TXTR", "CLST",
  "KOTO", "KLMB", "SITR", "CHOR", "GONG", "PRC", "SLAP", "STAB", "BLIP", "DRON", "PULZ", "FLAR", "ZONE", "RAY", "GLNT",
  "CHRD", "VOICE", "BASS", "TIN", "TUB", "SAW", "SQR", "PIANO", "BRASS", "PLUCK", "FLUTE",
];

const SHORT_PREFIXES = ["DX", "FM", "HI", "LO", "80S", "PRO", "NEO", "BIG", "DRY", "WET", "DK", "WM", "RAW", "REZ", "SUB", "FAT", "VNT", "DIG", "FX", "HOT"];
const SUFFIX_TAGS = ["I", "II", "III", "IV", "V", "VI", "VII", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "A", "B", "C", "D", "E", "F", "G", "H", "V", "W", "X", "Y", "Z", "DX", "FM", "86", "88", "303", "808", "909", "MAX", "PRO"];

export function disemvowel(word, maxLen) {
  if (word.length <= maxLen) return word;
  const vowels = new Set(["A", "E", "I", "O", "U"]);
  const chars = [word[0]];
  for (let i = 1; i < word.length && chars.length < maxLen; i++) {
    if (!vowels.has(word[i]) || chars.length < 2) chars.push(word[i]);
  }
  return chars.join("").slice(0, maxLen);
}

export class PatchNamer {
  static generate(category = "random", rng = null, style = null, profile = null) {
    const r = rng || new SeededRNG();
    const cat = String(category || "random").toLowerCase().trim();

    if (style) {
      return `${String(style).toUpperCase()} ${r.randint(1, 99)}`.slice(0, 10).padEnd(10, " ");
    }

    const mode = r.randint(0, 4);
    const profKey = profile ? String(profile).toLowerCase().trim() : null;
    let rawName = "";

    if (profKey && PROFILE_ADJECTIVES[profKey] && r.random() < 0.65) {
      rawName = `${r.choice(PROFILE_ADJECTIVES[profKey])} ${r.choice(NOUNS)}`;
    } else if (mode === 0 && CATEGORY_PREFIXES[cat]) {
      const base = r.choice(CATEGORY_PREFIXES[cat]);
      const tag = r.choice(["1", "2", "3", "7", "8", "9", "I", "II", "A", "B", "X", "DX", "FM"]);
      rawName = base.length + 1 + tag.length <= 10 ? `${base} ${tag}` : base;
    } else if (mode === 2 && CATEGORY_PREFIXES[cat]) {
      const adj = r.choice(SHORT_PREFIXES);
      const base = r.choice(CATEGORY_PREFIXES[cat]);
      rawName =
        adj.length + 1 + base.length <= 10
          ? `${adj} ${base}`
          : `${adj} ${disemvowel(base, 10 - adj.length - 1)}`;
    } else if (mode === 3) {
      rawName = `${r.choice(NOUNS)} ${r.choice(SUFFIX_TAGS)}`;
    } else {
      rawName = `${r.choice(ADJECTIVES)} ${r.choice(NOUNS)}`;
    }

    if (rawName.length > 10) {
      const parts = rawName.trim().split(/\s+/);
      if (parts.length === 2) {
        const [w1, w2] = parts;
        const w2Sq = disemvowel(w2, 10 - w1.length - 1);
        if (w1.length + 1 + w2Sq.length <= 10) {
          rawName = `${w1} ${w2Sq}`;
        } else {
          const w1Sq = disemvowel(w1, 4);
          rawName = `${w1Sq} ${disemvowel(w2, 10 - w1Sq.length - 1)}`;
        }
      }
    }

    return DX7Patch.sanitizeName(rawName.toUpperCase());
  }
}

/* ============================================================================
 * Sonic Profile Layer Functions
 * ========================================================================== */

export const PROFILE_REGISTRY = {
  warm(patch, options, rng) {
    const carrierSet = new Set(getAlgorithm(patch.algorithm).carriers);
    if (options.feedback === null || options.feedback === undefined) {
      patch.feedback = rng.choice([2, 3, 4]);
    }
    let carrierSeen = 0;
    for (let opNum = 1; opNum <= 6; opNum++) {
      const op = patch.op(opNum);
      if (carrierSet.has(opNum)) {
        carrierSeen++;
        if (carrierSeen === 1 && carrierSet.size > 1 && rng.random() < 0.6) {
          op.freq_coarse = 0;
          op.freq_fine = 0;
          op.detune = 7;
        } else {
          op.detune = clamp(7 + rng.choice([-2, -1, 1, 2]), 0, 14);
        }
        op.eg_rate_1 = clamp(op.eg_rate_1, 35, 90);
        op.eg_level_3 = clamp(op.eg_level_3, 70, 95);
      } else {
        op.output_level = clamp(Math.trunc(op.output_level * 0.82) + rng.randint(-4, 4), 20, 85);
        op.break_point = rng.randint(39, 55);
        op.right_curve = 1; // -EXP
        op.right_depth = rng.randint(25, 65);
        op.left_curve = rng.choice([0, 2]);
        op.detune = clamp(7 + rng.randint(-2, 2), 0, 14);
      }
    }
    return patch;
  },

  atonal(patch, options, rng) {
    const carrierSet = new Set(getAlgorithm(patch.algorithm).carriers);
    if (options.feedback === null || options.feedback === undefined) {
      patch.feedback = rng.choice([3, 4, 5, 6]);
    }
    const fixedIndices = new Set(rng.sample([0, 1, 2, 3, 4, 5], rng.randint(2, 5)));
    for (let idx = 0; idx < 6; idx++) {
      const op = patch.operators[idx];
      if (fixedIndices.has(idx)) {
        op.osc_mode = 1;
        op.freq_coarse = rng.choice([0, 1, 2, 3]);
        op.freq_fine = rng.randint(5, 95);
      } else {
        op.osc_mode = 0;
        op.freq_coarse = rng.choice([0, 1, 3, 7, 11, 13, 17, 19, 23, 29, 31]);
        op.freq_fine = rng.randint(15, 85);
      }
      op.rate_scaling = 0;
      op.break_point = rng.randint(20, 80);
      op.left_depth = rng.randint(0, 15);
      op.right_depth = rng.randint(0, 15);
      if (!carrierSet.has(idx + 1)) {
        op.output_level = rng.randint(60, 98);
        op.eg_rate_1 = 99;
        op.eg_rate_2 = rng.randint(50, 85);
        op.eg_level_2 = rng.randint(0, 40);
        op.eg_level_3 = 0;
      }
    }
    if (rng.random() < 0.7) {
      patch.pitch_eg = new PitchEG({
        rate_1: rng.randint(85, 99),
        rate_2: rng.randint(60, 90),
        rate_3: 90,
        rate_4: 90,
        level_1: rng.choice([80, 88, 95, 20, 15]),
      });
    }
    return patch;
  },

  crisp(patch, _options, rng) {
    const carrierSet = new Set(getAlgorithm(patch.algorithm).carriers);
    for (let opNum = 1; opNum <= 6; opNum++) {
      const op = patch.op(opNum);
      if (!carrierSet.has(opNum)) {
        op.output_level = clamp(Math.trunc(op.output_level * 1.15) + rng.randint(3, 8), 50, 99);
        op.freq_coarse = rng.choice([2, 3, 4, 5, 7, 9, 14]);
        op.right_curve = 3; // +LIN
        op.right_depth = rng.randint(15, 40);
      }
      op.detune = clamp(7 + rng.choice([-1, 0, 1]), 0, 14);
    }
    return patch;
  },

  gritty(patch, _options, rng) {
    patch.feedback = rng.choice([5, 6, 7]);
    for (const op of patch.operators) {
      op.key_vel_sens = rng.randint(4, 7);
      op.output_level = clamp(op.output_level + rng.randint(5, 12), 40, 99);
      op.detune = clamp(7 + rng.choice([-3, -2, 2, 3]), 0, 14);
    }
    return patch;
  },

  ethereal(patch, _options, rng) {
    for (const op of patch.operators) {
      op.eg_rate_1 = rng.randint(20, 42);
      op.eg_rate_2 = rng.randint(20, 45);
      op.eg_rate_4 = rng.randint(18, 38);
      op.detune = clamp(7 + rng.choice([-3, -2, -1, 1, 2, 3]), 0, 14);
    }
    patch.lfo = new LFO({
      speed: rng.randint(25, 38),
      delay: rng.randint(20, 45),
      pitch_mod_depth: rng.randint(15, 35),
      waveform: 0,
      pitch_mod_sens: 2,
    });
    return patch;
  },
};

export function applyProfile(patch, options, rng) {
  if (!options || !options.profile || options.profile === "none") return patch;
  const fn = PROFILE_REGISTRY[String(options.profile).toLowerCase().trim()];
  return fn ? fn(patch, options, rng) : patch;
}

/* ============================================================================
 * Data-Driven Sound Design Category Recipes
 * ========================================================================== */

const HARMONIC_RATIOS = [0, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16];
const INHARMONIC_RATIOS = [0, 1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];

export const CATEGORY_RECIPES = {
  keys: {
    description: "Electric pianos, FM tines, rhodes, clavs and harpsichords",
    algorithms: [5, 1, 3, 11, 7],
    feedback: [2, 5],
    transpose: 24,
    rateScaling: [1, 3],
    detuneSpan: 2,
    carrier: {
      coarse: { choice: [1, 1, 2] },
      fine: [0, 3],
      level: [90, 99],
      r1: 95, r2: [25, 45], r3: [15, 30], r4: 45,
      l1: 99, l2: [65, 85], l3: [40, 65], l4: 0,
      vel: [2, 4],
    },
    modulator: {
      coarse: { choice: [1, 3, 5, 7, 14] },
      fine: [0, 10],
      brightnessScale: 82, levelJitter: [-10, 8], levelClamp: [45, 95],
      r1: 99, r2: [50, 75], r3: [30, 50], r4: 50,
      l1: [85, 99], l2: [20, 55], l3: 0, l4: 0,
      vel: [4, 7],
    },
  },

  bass: {
    description: "Punchy FM slap bass, solid sub bass, funk, and acid basslines",
    algorithms: [1, 2, 8, 16, 21, 5],
    feedback: [3, 6],
    transpose: 12,
    rateScaling: [1, 2],
    detuneSpan: 1,
    carrier: {
      coarse: { choice: [0, 1, 1] },
      fine: [0, 4],
      level: [92, 99],
      r1: 99, r2: [40, 70], r3: [20, 50], r4: 55,
      l1: 99, l2: [50, 80], l3: 0, l4: 0,
      vel: [2, 4],
    },
    modulator: {
      coarse: { choice: [1, 2, 3, 4, 6] },
      fine: [0, 4],
      brightnessScale: 88, levelJitter: [-8, 8], levelClamp: [50, 98],
      r1: 99, r2: [55, 85], r3: [35, 60], r4: 60,
      l1: [85, 99], l2: [10, 45], l3: 0, l4: 0,
      vel: [3, 7],
    },
  },

  pad: {
    description: "Lush ambient pads, warm string textures, glass choirs, and slow sweeps",
    algorithms: [5, 6, 21, 22, 12, 32],
    warmAlgorithm: 5,
    feedback: [1, 4],
    transpose: 24,
    rateScaling: [0, 1],
    detuneChoices: [-4, -3, -2, -1, 1, 2, 3, 4],
    carrier: {
      coarse: { choice: [1, 2, 2, 3, 4] },
      fine: [0, 15],
      level: [85, 99],
      r1: [25, 45], r2: [20, 40], r3: [15, 35], r4: [20, 40],
      l1: 99, l2: [80, 95], l3: [75, 90], l4: 0,
      vel: [1, 3],
    },
    modulator: {
      coarse: { choice: [1, 2, 2, 3, 4] },
      fine: [0, 15],
      brightnessScale: 75, levelJitter: [-10, 10], levelClamp: [30, 85],
      r1: [25, 45], r2: [20, 40], r3: [15, 35], r4: [20, 40],
      l1: 99, l2: [80, 95], l3: [75, 90], l4: 0,
      vel: [1, 3],
    },
    lfo: { speed: [28, 42], delay: [15, 35], pmd: [12, 30], pms: 2 },
  },

  percussive: {
    description: "FM drums, punchy kicks, metallic snares, toms, cymbals, and percussive hits",
    algorithms: [1, 2, 4, 11, 16, 21, 27],
    feedback: [4, 7],
    transpose: 12,
    rateScaling: [1, 3],
    detuneSpan: 2,
    carrier: {
      coarse: { choice: [0, 1, 2] },
      fine: [0, 30],
      level: [90, 99],
      r1: 99, r2: [60, 88], r3: [45, 75], r4: [60, 90],
      l1: 99, l2: [10, 40], l3: 0, l4: 0,
      vel: [3, 6],
    },
    modulator: {
      coarse: { choice: [1, 2, 3, 5, 7, 11, 17, 23] },
      fine: [0, 30],
      brightnessScale: 90, levelJitter: [-8, 8], levelClamp: [50, 99],
      r1: 99, r2: [70, 95], r3: [50, 80], r4: 75,
      l1: [85, 99], l2: [0, 25], l3: 0, l4: 0,
      vel: [4, 7],
    },
    pitchEg: { r1: [85, 99], r2: [60, 90], r3: 90, r4: 90, l1: { choice: [85, 92, 98, 15, 25] } },
  },

  bell: {
    description: "Crystal bells, tubular chimes, vibraphones, celestes, and metallic gamelan",
    algorithms: [1, 2, 4, 11, 14, 5],
    feedback: [0, 3],
    transpose: 36,
    rateScaling: [2, 4],
    detuneSpan: 2,
    fixedOpRatios: [[1, 0], [2, 76], [3, 41], [5, 40], [7, 0], [1, 41]],
    carrier: {
      level: [90, 99],
      r1: 99, r2: [20, 40], r3: [10, 25], r4: 35,
      l1: 99, l2: [40, 70], l3: 0, l4: 0,
      vel: [3, 7],
    },
    modulator: {
      brightnessScale: 88, levelJitter: [-10, 8], levelClamp: [45, 95],
      r1: 99, r2: [35, 60], r3: [15, 35], r4: 40,
      l1: [85, 99], l2: [15, 40], l3: 0, l4: 0,
      vel: [3, 7],
    },
  },

  lead: {
    description: "Cutting FM synth leads, sync leads, and 80s pitch solos",
    algorithms: [1, 2, 16, 17, 18, 20],
    feedback: [4, 7],
    transpose: 24,
    rateScaling: [1, 2],
    detuneSpan: 3,
    carrier: {
      coarse: { choice: [1, 2, 3, 4] },
      fine: [0, 8],
      level: [95, 99],
      r1: 99, r2: 85, r3: 70, r4: 60,
      l1: 99, l2: 92, l3: 85, l4: 0,
      vel: [2, 5],
    },
    modulator: {
      coarse: { choice: [1, 2, 3, 4] },
      fine: [0, 8],
      brightnessScale: 92, levelJitter: [-5, 6], levelClamp: [55, 99],
      r1: 99, r2: [45, 75], r3: 60, r4: 60,
      l1: 99, l2: [60, 88], l3: [50, 80], l4: 0,
      vel: [2, 5],
    },
    lfo: { speed: [40, 55], delay: [10, 25], pmd: [10, 25], pms: 2 },
  },

  brass: {
    description: "Warm 80s poly-brass, horn sections, and punchy synth brass stabs",
    algorithms: [1, 2, 16, 18, 22, 5],
    feedback: [5, 7],
    transpose: 24,
    rateScaling: [1, 2],
    detuneSpan: 3,
    carrier: {
      coarse: { choice: [1, 1, 2] },
      fine: [0, 6],
      level: [92, 99],
      r1: [68, 88], r2: [45, 70], r3: [30, 55], r4: [45, 65],
      l1: 99, l2: [85, 95], l3: [78, 92], l4: 0,
      vel: [2, 4],
    },
    modulator: {
      coarse: { choice: [1, 1, 2, 3] },
      fine: [0, 6],
      brightnessScale: 88, levelJitter: [-6, 8], levelClamp: [55, 96],
      r1: [52, 76], r2: [40, 65], r3: [30, 50], r4: [45, 65],
      l1: [90, 99], l2: [70, 88], l3: [60, 80], l4: 0,
      vel: [3, 6],
    },
    pitchEg: { r1: 94, r2: 82, r3: 90, r4: 90, l1: { choice: [48, 49, 50] } },
  },

  pluck: {
    description: "Acoustic & synth plucks: koto, kalimba, harp, sitar, and FM guitars",
    algorithms: [1, 3, 5, 8, 14, 21],
    feedback: [2, 6],
    transpose: 24,
    rateScaling: [2, 4],
    detuneSpan: 2,
    carrier: {
      coarse: { choice: [1, 1, 2] },
      fine: [0, 4],
      level: [90, 99],
      r1: 99, r2: [45, 72], r3: [25, 50], r4: [45, 70],
      l1: 99, l2: [35, 70], l3: 0, l4: 0,
      vel: [2, 5],
    },
    modulator: {
      coarse: { choice: [1, 2, 3, 4, 5, 7, 9] },
      fine: [0, 12],
      brightnessScale: 88, levelJitter: [-8, 8], levelClamp: [50, 96],
      r1: 99, r2: [60, 88], r3: [40, 70], r4: [55, 80],
      l1: [88, 99], l2: [10, 40], l3: 0, l4: 0,
      vel: [4, 7],
    },
  },
};
CATEGORY_RECIPES.drum = CATEGORY_RECIPES.percussive;

function generateFromRecipe(categoryKey, recipe, opts, rng) {
  let alg = opts.algorithm;
  if (alg === null || alg === undefined) {
    alg = opts.profile === "warm" && recipe.warmAlgorithm ? recipe.warmAlgorithm : rng.choice(recipe.algorithms);
  }
  const carriers = new Set(getAlgorithm(alg).carriers);
  const operators = [];

  for (let opNum = 1; opNum <= 6; opNum++) {
    const isCarr = carriers.has(opNum);
    const roleSpec = isCarr ? recipe.carrier : recipe.modulator;

    let coarse, fine;
    if (recipe.fixedOpRatios) {
      [coarse, fine] = recipe.fixedOpRatios[opNum - 1];
    } else {
      coarse = rng.resolve(roleSpec.coarse);
      fine = rng.resolve(roleSpec.fine);
    }

    const outLvl = isCarr
      ? rng.resolve(roleSpec.level)
      : clamp(
          Math.trunc(opts.brightness * roleSpec.brightnessScale) + rng.resolve(roleSpec.levelJitter),
          roleSpec.levelClamp[0],
          roleSpec.levelClamp[1]
        );

    const detune = recipe.detuneChoices
      ? clamp(7 + rng.choice(recipe.detuneChoices), 0, 14)
      : clamp(7 + rng.randint(-recipe.detuneSpan, recipe.detuneSpan), 0, 14);

    operators.push(
      new Operator({
        eg_rate_1: rng.resolve(roleSpec.r1),
        eg_rate_2: rng.resolve(roleSpec.r2),
        eg_rate_3: rng.resolve(roleSpec.r3),
        eg_rate_4: rng.resolve(roleSpec.r4),
        eg_level_1: rng.resolve(roleSpec.l1),
        eg_level_2: rng.resolve(roleSpec.l2),
        eg_level_3: rng.resolve(roleSpec.l3),
        eg_level_4: rng.resolve(roleSpec.l4),
        rate_scaling: rng.resolve(recipe.rateScaling),
        key_vel_sens: rng.resolve(roleSpec.vel),
        output_level: outLvl,
        freq_coarse: coarse,
        freq_fine: fine,
        detune,
      })
    );
  }

  const lfo = recipe.lfo
    ? new LFO({
        speed: rng.resolve(recipe.lfo.speed),
        delay: rng.resolve(recipe.lfo.delay),
        pitch_mod_depth: rng.resolve(recipe.lfo.pmd),
        pitch_mod_sens: recipe.lfo.pms,
      })
    : new LFO();

  const pitch_eg = recipe.pitchEg
    ? new PitchEG({
        rate_1: rng.resolve(recipe.pitchEg.r1),
        rate_2: rng.resolve(recipe.pitchEg.r2),
        rate_3: rng.resolve(recipe.pitchEg.r3),
        rate_4: rng.resolve(recipe.pitchEg.r4),
        level_1: rng.resolve(recipe.pitchEg.l1),
      })
    : new PitchEG();

  const feedback = opts.feedback !== null && opts.feedback !== undefined ? opts.feedback : rng.resolve(recipe.feedback);
  const name = opts.name || PatchNamer.generate(categoryKey, rng, opts.name_style, opts.profile);

  const patch = new DX7Patch({
    name,
    operators,
    lfo,
    pitch_eg,
    algorithm: alg,
    feedback,
    transpose: recipe.transpose,
  });

  return applyProfile(patch, opts, rng);
}

function generateFX(opts, rng) {
  const alg = opts.algorithm !== null && opts.algorithm !== undefined
    ? opts.algorithm
    : rng.choice([16, 17, 18, 19, 27, 28]);

  const operators = Array.from({ length: 6 }, () =>
    new Operator({
      eg_rate_1: rng.randint(20, 99),
      eg_rate_2: rng.randint(20, 99),
      eg_rate_3: rng.randint(20, 99),
      eg_rate_4: rng.randint(20, 99),
      eg_level_1: rng.randint(40, 99),
      eg_level_2: rng.randint(20, 99),
      eg_level_3: rng.randint(0, 99),
      eg_level_4: 0,
      output_level: rng.randint(65, 99),
      osc_mode: rng.choice([0, 1]),
      freq_coarse: rng.randint(0, 31),
      freq_fine: rng.randint(0, 99),
      detune: rng.randint(0, 14),
    })
  );

  const pitch_eg = new PitchEG({
    rate_1: rng.randint(30, 99),
    rate_2: rng.randint(30, 99),
    rate_3: rng.randint(30, 99),
    rate_4: rng.randint(30, 99),
    level_1: rng.choice([10, 20, 80, 90]),
    level_2: rng.randint(30, 70),
  });

  const lfo = new LFO({
    speed: rng.randint(30, 99),
    pitch_mod_depth: rng.randint(20, 80),
    amp_mod_depth: rng.randint(0, 60),
    waveform: rng.randint(0, 5),
    pitch_mod_sens: rng.randint(3, 7),
  });

  const patch = new DX7Patch({
    name: opts.name || PatchNamer.generate("fx", rng, opts.name_style, opts.profile),
    operators,
    pitch_eg,
    lfo,
    algorithm: alg,
    feedback: opts.feedback !== null && opts.feedback !== undefined ? opts.feedback : rng.randint(4, 7),
    transpose: 24,
  });

  return applyProfile(patch, opts, rng);
}

function generateConstrained(opts, rng) {
  const algorithm = opts.algorithm !== null && opts.algorithm !== undefined ? opts.algorithm : rng.randint(1, 32);
  const carrierOps = new Set(getAlgorithm(algorithm).carriers);
  const feedback = opts.feedback !== null && opts.feedback !== undefined
    ? clamp(opts.feedback, 0, 7)
    : rng.choice([0, 1, 2, 3, 4, 5, 6]);

  const operators = [];
  for (let opNum = 1; opNum <= 6; opNum++) {
    const isCarr = carrierOps.has(opNum);
    let coarse, fine;
    if (opts.dissonance < 0.2) {
      coarse = rng.choice(HARMONIC_RATIOS);
      fine = rng.randint(0, Math.trunc(opts.dissonance * 50));
    } else if (opts.dissonance < 0.6) {
      coarse = rng.choice([...HARMONIC_RATIOS, 0, 1, 3, 7, 11]);
      fine = rng.randint(0, Math.trunc(opts.dissonance * 80));
    } else {
      coarse = rng.choice(INHARMONIC_RATIOS);
      fine = rng.randint(0, 99);
    }

    const detRange = Math.trunc(opts.detune_amount * 6);
    const detune = detRange > 0 ? clamp(7 + rng.randint(-detRange, detRange), 0, 14) : 7;
    const spd = opts.envelope_speed;

    let r1, r2, r3, r4, l1, l2, l3, outputLevel, keyVel;
    if (isCarr) {
      outputLevel = rng.randint(82, 99);
      keyVel = Math.trunc(opts.velocity_sensitivity * rng.randint(1, 4));
      r1 = clamp(Math.trunc(60 + spd * 38) + rng.randint(-5, 5), 30, 99);
      l1 = 99;
      r2 = clamp(Math.trunc(40 + spd * 45) + rng.randint(-10, 10), 10, 99);
      l2 = clamp(rng.randint(75, 95), 40, 99);
      r3 = clamp(rng.randint(20, 60), 5, 80);
      l3 = spd < 0.7 ? l2 : clamp(l2 - rng.randint(10, 40), 0, 99);
      r4 = clamp(Math.trunc(35 + spd * 45) + rng.randint(-10, 10), 15, 99);
    } else {
      outputLevel = clamp(Math.trunc(opts.brightness * 85) + rng.randint(-15, 12), 20, 99);
      keyVel = Math.trunc(opts.velocity_sensitivity * rng.randint(2, 6));
      r1 = clamp(Math.trunc(70 + spd * 28) + rng.randint(-5, 5), 40, 99);
      l1 = rng.randint(80, 99);
      r2 = clamp(Math.trunc(30 + spd * 55) + rng.randint(-10, 10), 10, 99);
      l2 = clamp(rng.randint(20, 75), 0, 95);
      r3 = clamp(rng.randint(20, 60), 5, 80);
      l3 = clamp(l2 - rng.randint(0, 30), 0, 90);
      r4 = clamp(Math.trunc(30 + spd * 45) + rng.randint(-10, 10), 15, 99);
    }

    operators.push(
      new Operator({
        eg_rate_1: r1, eg_rate_2: r2, eg_rate_3: r3, eg_rate_4: r4,
        eg_level_1: l1, eg_level_2: l2, eg_level_3: l3, eg_level_4: 0,
        left_depth: rng.randint(0, 20),
        right_depth: rng.randint(0, 20),
        rate_scaling: rng.choice([0, 1, 2, 3]),
        key_vel_sens: keyVel,
        output_level: outputLevel,
        freq_coarse: coarse,
        freq_fine: fine,
        detune,
      })
    );
  }

  const pitch_eg = rng.random() < 0.15
    ? new PitchEG({
        rate_1: rng.randint(70, 99),
        rate_2: rng.randint(50, 99),
        rate_3: rng.randint(50, 99),
        rate_4: rng.randint(50, 99),
        level_1: rng.randint(48, 56),
      })
    : new PitchEG();

  const lfo = !opts.enable_lfo || rng.random() < 0.3
    ? new LFO()
    : new LFO({
        speed: rng.randint(25, 45),
        delay: rng.randint(10, 40),
        pitch_mod_depth: rng.randint(5, 30),
        pitch_mod_sens: rng.choice([1, 2, 3]),
      });

  const patch = new DX7Patch({
    name: opts.name || PatchNamer.generate(opts.category, rng, opts.name_style, opts.profile),
    operators,
    pitch_eg,
    lfo,
    algorithm,
    feedback,
    transpose: 24,
  });

  return applyProfile(patch, opts, rng);
}

function generatePureRandom(opts, rng) {
  const algorithm = opts.algorithm !== null && opts.algorithm !== undefined ? opts.algorithm : rng.randint(1, 32);
  const feedback = opts.feedback !== null && opts.feedback !== undefined ? opts.feedback : rng.randint(0, 7);

  const operators = Array.from({ length: 6 }, () =>
    new Operator({
      eg_rate_1: rng.randint(0, 99), eg_rate_2: rng.randint(0, 99), eg_rate_3: rng.randint(0, 99), eg_rate_4: rng.randint(0, 99),
      eg_level_1: rng.randint(0, 99), eg_level_2: rng.randint(0, 99), eg_level_3: rng.randint(0, 99), eg_level_4: rng.randint(0, 99),
      break_point: rng.randint(0, 99), left_depth: rng.randint(0, 99), right_depth: rng.randint(0, 99),
      left_curve: rng.randint(0, 3), right_curve: rng.randint(0, 3),
      rate_scaling: rng.randint(0, 7), amp_mod_sens: rng.randint(0, 3), key_vel_sens: rng.randint(0, 7),
      output_level: rng.randint(0, 99), osc_mode: rng.choice([0, 0, 0, 1]),
      freq_coarse: rng.randint(0, 31), freq_fine: rng.randint(0, 99), detune: rng.randint(0, 14),
    })
  );

  return new DX7Patch({
    name: opts.name || PatchNamer.generate("random", rng, opts.name_style, opts.profile),
    operators,
    pitch_eg: new PitchEG({
      rate_1: rng.randint(50, 99), rate_2: rng.randint(50, 99), rate_3: rng.randint(50, 99), rate_4: rng.randint(50, 99),
      level_1: rng.randint(40, 60), level_2: rng.randint(40, 60), level_3: rng.randint(40, 60), level_4: 50,
    }),
    lfo: new LFO({
      speed: rng.randint(10, 80), delay: rng.randint(0, 50), pitch_mod_depth: rng.randint(0, 40),
      amp_mod_depth: rng.randint(0, 30), key_sync: rng.randint(0, 1), waveform: rng.randint(0, 5), pitch_mod_sens: rng.randint(0, 4),
    }),
    algorithm,
    feedback,
    key_sync: rng.randint(0, 1),
    transpose: 24,
  });
}

export const GENERATOR_REGISTRY = {
  keys: (opts, rng) => generateFromRecipe("keys", CATEGORY_RECIPES.keys, opts, rng),
  bass: (opts, rng) => generateFromRecipe("bass", CATEGORY_RECIPES.bass, opts, rng),
  pad: (opts, rng) => generateFromRecipe("pad", CATEGORY_RECIPES.pad, opts, rng),
  percussive: (opts, rng) => generateFromRecipe("percussive", CATEGORY_RECIPES.percussive, opts, rng),
  drum: (opts, rng) => generateFromRecipe("percussive", CATEGORY_RECIPES.percussive, opts, rng),
  bell: (opts, rng) => generateFromRecipe("bell", CATEGORY_RECIPES.bell, opts, rng),
  lead: (opts, rng) => generateFromRecipe("lead", CATEGORY_RECIPES.lead, opts, rng),
  brass: (opts, rng) => generateFromRecipe("brass", CATEGORY_RECIPES.brass, opts, rng),
  pluck: (opts, rng) => generateFromRecipe("pluck", CATEGORY_RECIPES.pluck, opts, rng),
  fx: generateFX,
  constrained: generateConstrained,
  random: generatePureRandom,
};

export function generatePatch(options = null) {
  const opts = options instanceof GenerationOptions ? options : new GenerationOptions(options || {});
  const rng = new SeededRNG(opts.seed);
  const cat = String(opts.category || "constrained").toLowerCase().trim();
  const fn = GENERATOR_REGISTRY[cat] || generateConstrained;
  return fn(opts, rng);
}

export function getGenerator(category = "constrained") {
  const cat = String(category || "constrained").toLowerCase().trim();
  return {
    name: cat,
    generate(options = null) {
      const opts = options instanceof GenerationOptions ? options : new GenerationOptions({ ...(options || {}), category: cat });
      return generatePatch(opts);
    },
  };
}

/* ============================================================================
 * Patch Mutator
 * ========================================================================== */

export class PatchMutator {
  static mutate(patch, { mutationRate = 0.2, seed = null, mutateAlgorithm = false, newName = null } = {}) {
    const rng = new SeededRNG(seed);
    const mutated = patch.copy();
    const rate = clamp(Math.trunc(mutationRate * 100), 0, 100) / 100.0;

    if (mutateAlgorithm && rng.random() < rate * 0.5) {
      mutated.algorithm = rng.randint(1, 32);
    }
    if (rng.random() < rate) {
      mutated.feedback = clamp(mutated.feedback + rng.choice([-1, 1, 0]), 0, 7);
    }

    for (const op of mutated.operators) {
      if (rng.random() < rate) {
        const span = Math.trunc(rate * 25);
        op.output_level = clamp(op.output_level + rng.randint(-span, span), 0, 99);
      }
      if (rng.random() < rate) {
        const span = Math.trunc(rate * 20);
        op.freq_fine = clamp(op.freq_fine + rng.randint(-span, span), 0, 99);
      }
      if (rng.random() < rate * 0.7) {
        op.detune = clamp(op.detune + rng.choice([-1, 1]), 0, 14);
      }
      if (rng.random() < rate) {
        op.eg_rate_1 = clamp(op.eg_rate_1 + rng.randint(-15, 15), 0, 99);
        op.eg_rate_2 = clamp(op.eg_rate_2 + rng.randint(-15, 15), 0, 99);
        op.eg_rate_3 = clamp(op.eg_rate_3 + rng.randint(-15, 15), 0, 99);
        op.eg_rate_4 = clamp(op.eg_rate_4 + rng.randint(-15, 15), 0, 99);
      }
      if (rng.random() < rate) {
        op.eg_level_2 = clamp(op.eg_level_2 + rng.randint(-20, 20), 0, 99);
        op.eg_level_3 = clamp(op.eg_level_3 + rng.randint(-20, 20), 0, 99);
      }
    }

    if (newName) {
      mutated.name = newName;
    } else {
      const suffix = rng.choice(["+", "*", "VAR", "M", "2", "'", "X"]);
      mutated.name = `${patch.name.trim().slice(0, 7)} ${suffix}`.trim();
    }

    mutated.clampAll();
    return mutated;
  }
}
