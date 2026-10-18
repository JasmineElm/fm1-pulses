// particles.js — Multi-Head Particle / Collision Simulator (Orca / Plinky Model) for FM-1 Pulses.
// The grid is treated as a 2D physics surface populated by moving directional particles (playheads).
// Particles exist at (x, y) with velocity vectors (dx, dy) in {-1, 0, 1}.
// Clock ticks advance particles along their vectors with smooth 60 FPS interpolated motion.
// Boundary hits reflect elastically (inverting vector components).
// Cell collisions trigger harmonic note events and either deflect at 90°, annihilate, or spawn child particles.
// Includes predictive trajectory rays and predicted collision target crosshairs to visualize physics.

import { SCALES, quantize, midiName } from "./generator.js";
import {
  state, refs, R, doGenerate,
  getBank, setBank, getSelected, setSelected, status,
  setModelGenerator, setModelRandomizer, RATE_NAMES, RATE_QUARTERS
} from "./state.js";
import { knob, dropdown, actionBtn, toggleBtn } from "./controls.js";
import { onStep, isLive } from "./player.js";
import { syncRhythmGrid, randomizeRhythm, onRhythmUserEdit } from "./rhythm.js?v=275";
import { getActiveModel } from "./modes.js";

export const GRID_SIZES = [
  { v: "16", t: "16 × 16 (Standard)" },
  { v: "20", t: "20 × 20" },
  { v: "24", t: "24 × 24" },
  { v: "32", t: "32 × 32 (Expansive)" }
];

export const COLLISION_MODES = [
  { v: "deflect", t: "Deflect (90°)", desc: "Particles bounce elastically at 90° right angles on collision" },
  { v: "spawn", t: "Spawn Child (Finite Life)", desc: "Colliding particles deflect and spawn a temporary child particle" },
  { v: "annihilate", t: "Annihilate", desc: "Colliding particles destroy each other in an energetic burst" },
  { v: "hybrid", t: "Hybrid (Deflect + 50% Spawn)", desc: "Always deflects with 50% chance to spawn an ephemeral child" }
];

export const PITCH_MAPPINGS = [
  { v: "x-pitch-y-oct", t: "X: Scale Pitch · Y: Octave", desc: "X maps across scale degrees; Y shifts octave register" },
  { v: "x-degree-y-vel", t: "X: Scale Pitch · Y: Velocity", desc: "X maps across scale degrees; Y controls accent velocity" },
  { v: "radial", t: "Radial (Distance from Center)", desc: "Center is root bass; distance outward ascends in pitch" },
  { v: "linear", t: "Linear Matrix (Row-Major)", desc: "Standard 2D raster scan index quantized to scale" }
];

export const POLYPHONY_OPTIONS = [
  { v: "1", t: "1 Note (Monophonic Lead)" },
  { v: "2", t: "2 Notes (Duophonic - Default)" },
  { v: "3", t: "3 Notes (Triad Chord)" },
  { v: "4", t: "4 Notes (4-Voice Quad)" }
];

export const DIRECTIONS = [
  { label: "N (↑)", dx: 0, dy: -1 },
  { label: "NE (↗)", dx: 1, dy: -1 },
  { label: "E (→)", dx: 1, dy: 0 },
  { label: "SE (↘)", dx: 1, dy: 1 },
  { label: "S (↓)", dx: 0, dy: 1 },
  { label: "SW (↙)", dx: -1, dy: 1 },
  { label: "W (←)", dx: -1, dy: 0 },
  { label: "NW (↖)", dx: -1, dy: -1 },
  { label: "Random", dx: 0, dy: 0 }
];

// Color palette for parent particles
const PARTICLE_COLORS = [
  "#00f0ff", // Neon Cyan
  "#ff007f", // Hot Pink
  "#ffb700", // Bright Amber
  "#39ff14", // Acid Lime
  "#a855f7", // Electric Violet
  "#38bdf8", // Sky Blue
  "#f43f5e", // Rose
  "#eab308"  // Gold
];

// Obstacle Types (Flat TypedArray Grid representation)
export const OBS_NONE = 0;
export const OBS_SLASH = 1;
export const OBS_BACKSLASH = 2;
export const OBS_BOUNCER = 3;

export const TOOL_TO_OBS = {
  deflector: OBS_SLASH,
  slash: OBS_SLASH,
  backslash: OBS_BACKSLASH,
  bouncer: OBS_BOUNCER
};

// Particle Simulator State
let gridW = 16;
let gridH = 16;
let particles = [];
let seedParticles = [];
let obstacles = new Uint8Array(gridW * gridH);
let seedObstacles = new Uint8Array(gridW * gridH);
const flippedDeflectors = new Set();
const playheadClickCounts = new Map();

let activeTool = "particle"; // "particle" | "deflector" | "bouncer"
let selectedDirectionIdx = 2; // East (1, 0)
let loopMode = state.particleLoopMode || "loop"; // "loop" (resets to seed every sequence length) | "free" (carries on indefinitely)
let totalFreeSteps = 0;
let particleRhythmOverridden = false; // When false, note triggering is strictly determined by particle collisions
let isParticlesActive = false;

export function isParticleRhythmOverridden() {
  return particleRhythmOverridden;
}

export function setParticleRhythmOverridden(val) {
  particleRhythmOverridden = Boolean(val);
}

export function resetRhythmToCollisions() {
  particleRhythmOverridden = false;
  const bank = getBank();
  if (bank?.[0]?.steps) {
    for (const st of bank[0].steps) {
      delete st._userRhythmActive;
    }
  }
  generateParticleBank();
  syncRhythmGrid();
  status("Reset rhythm to particle collisions", "ok");
}

// Visual representation toggles
let showTrajectories = true; // Trajectory path prediction lines

// Cached Trajectory path rays & predicted collision markers (computed on generation/step)
let cachedParticlePaths = null;
let cachedCollisionTargets = [];

// 64-step Precomputed Simulation Ring Buffer (Zero-computation playback)
let precomputedStepStates = [];
let precomputedInitialState = null;

// Timing & State tracking
let lastLiveStep = -1;
let nextParticleId = 1;

// DOM References
let containerEl = null;
let canvasEl = null;
let ctx = null;
let hudStep = null;
let hudParticles = null;
let hudCollisions = null;
let hudNote = null;
let hudMode = null;
let hudStatus = null;
let hoverCoordEl = null;

// Built-in Classic Presets
export const PARTICLE_PRESETS = [
  {
    name: "Head-On Clave",
    desc: "2 particles colliding horizontally on a central axis, creating locked syncopated beats",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "deflect";
      particles = [
        { id: 1, x: 2, y: 8, dx: 1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 12, y: 8, dx: -1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Orbital Cross",
    desc: "4 compass particles converging at center (8, 8), deflecting at 90° into a continuous spinning vortex",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "deflect";
      particles = [
        { id: 1, x: 8, y: 1, dx: 0, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 8, y: 14, dx: 0, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 1, y: 8, dx: 1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] },
        { id: 4, x: 14, y: 8, dx: -1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[3] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Orca Diamond",
    desc: "4 diagonal playheads bouncing through a diamond lattice with 90° deflections",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "deflect";
      particles = [
        { id: 1, x: 4, y: 4, dx: 1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 12, y: 4, dx: -1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 12, y: 12, dx: -1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] },
        { id: 4, x: 4, y: 12, dx: 1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[3] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Plinky Cascade",
    desc: "3 seed particles with 'Spawn Child' mode, generating cascading generative fireworks",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "spawn";
      state.particleChildLife = 16;
      particles = [
        { id: 1, x: 3, y: 6, dx: 1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 11, y: 6, dx: -1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 7, y: 13, dx: 0, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Billiards Polyrhythm",
    desc: "Asymmetric starting coordinates producing evolving polyrhythmic Euclidean-like phasing collisions",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "deflect";
      particles = [
        { id: 1, x: 2, y: 3, dx: 1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 10, y: 3, dx: -1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 6, y: 12, dx: 1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] },
        { id: 4, x: 14, y: 10, dx: -1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[3] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Annihilation Swarm",
    desc: "6 fast particles that annihilate each other on collision, with automatic periodic respawn cycles",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "annihilate";
      particles = [
        { id: 1, x: 3, y: 3, dx: 1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 12, y: 3, dx: -1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 3, y: 12, dx: 1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] },
        { id: 4, x: 12, y: 12, dx: -1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[3] },
        { id: 5, x: 7, y: 2, dx: 0, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[4] },
        { id: 6, x: 8, y: 13, dx: 0, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[5] }
      ];
      clearObstacles(obstacles);
    }
  },
  {
    name: "Chaos Matrix",
    desc: "8 particles with hybrid deflection and deflector obstacles for deep ambient generative flux",
    setup: () => {
      gridW = 16; gridH = 16;
      state.particleCollisionMode = "hybrid";
      state.particleChildLife = 12;
      particles = [
        { id: 1, x: 2, y: 2, dx: 1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[0] },
        { id: 2, x: 13, y: 2, dx: 0, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[1] },
        { id: 3, x: 13, y: 13, dx: -1, dy: 0, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[2] },
        { id: 4, x: 2, y: 13, dx: 0, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[3] },
        { id: 5, x: 5, y: 8, dx: 1, dy: 1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[4] },
        { id: 6, x: 10, y: 8, dx: -1, dy: -1, isChild: false, life: 0, maxLife: 0, color: PARTICLE_COLORS[5] }
      ];
      clearObstacles(obstacles);
      setObstacle(8, 8, OBS_BOUNCER);
      setObstacle(4, 4, OBS_SLASH);
      setObstacle(11, 11, OBS_SLASH);
    }
  }
];

function cloneParticles(list) {
  return list.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    dx: p.dx,
    dy: p.dy,
    isChild: Boolean(p.isChild),
    life: p.life,
    maxLife: p.maxLife,
    color: p.color,
    _clickCount: p._clickCount ?? playheadClickCounts.get(p.id) ?? 0
  }));
}

export function setObstacle(x, y, type, obsGrid = obstacles, W = gridW, H = gridH) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const numType = typeof type === "number" ? type : (TOOL_TO_OBS[type] ?? OBS_NONE);
  obsGrid[y * W + x] = numType;
  if (obsGrid === obstacles) {
    flippedDeflectors.delete(y * W + x);
  }
}

export function removeObstacle(x, y, obsGrid = obstacles, W = gridW, H = gridH) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  obsGrid[y * W + x] = OBS_NONE;
  if (obsGrid === obstacles) {
    flippedDeflectors.delete(y * W + x);
  }
}

export function clearObstacles(obsGrid = obstacles) {
  if (obsGrid) obsGrid.fill(OBS_NONE);
  if (obsGrid === obstacles) {
    flippedDeflectors.clear();
  }
}

function cloneObstacles(obsGrid, W = gridW, H = gridH) {
  if (obsGrid instanceof Uint8Array) return obsGrid.slice();
  return new Uint8Array(W * H);
}

function saveToSeed() {
  if (lastLiveStep < 0) {
    seedParticles = cloneParticles(particles.filter((p) => !p.isChild));
  }
  seedObstacles = cloneObstacles(obstacles);
}

function restoreFromSeed() {
  particles = cloneParticles(seedParticles);
  obstacles = cloneObstacles(seedObstacles);
  updateCachedTrajectories();
}

/**
 * Predicts the future path of a particle for N steps (for trajectory ray rendering).
 */
export function predictTrajectory(p, steps = 10, W = gridW, H = gridH, obsGrid = obstacles) {
  const pts = [{ x: p.x, y: p.y, step: 0 }];
  let cx = p.x;
  let cy = p.y;
  let cdx = p.dx;
  let cdy = p.dy;
  const boundary = state.particleBoundary || "reflect";

  for (let s = 1; s <= steps; s++) {
    let tx = cx + cdx;
    let ty = cy + cdy;
    if (boundary === "reflect") {
      if (tx < 0) { cdx = -cdx; tx = 0; }
      else if (tx >= W) { cdx = -cdx; tx = W - 1; }
      if (ty < 0) { cdy = -cdy; ty = 0; }
      else if (ty >= H) { cdy = -cdy; ty = H - 1; }
    } else {
      tx = (tx % W + W) % W;
      ty = (ty % H + H) % H;
    }

    const obs = (obsGrid instanceof Uint8Array && ty >= 0 && ty < H && tx >= 0 && tx < W)
      ? obsGrid[ty * W + tx]
      : OBS_NONE;

    if (obs !== OBS_NONE) {
      if (obs === OBS_SLASH) {
        const odx = cdx; cdx = -cdy; cdy = -odx;
      } else if (obs === OBS_BACKSLASH) {
        const odx = cdx; cdx = cdy; cdy = odx;
      } else if (obs === OBS_BOUNCER) {
        cdx = -cdx; cdy = -cdy;
      }
    }

    cx = tx;
    cy = ty;
    pts.push({ x: cx, y: cy, step: s });
  }
  return pts;
}

// Reusable Map for future trajectory collision analysis (zero per-tick allocations)
const trajectoryCollisionMap = new Map();

/**
 * Computes future trajectory paths and predicted collision markers for an arbitrary particle list.
 */
export function computeTrajectoriesForParticles(pList, obsGrid = obstacles, W = gridW, H = gridH, steps = 10) {
  if (!showTrajectories || !pList || pList.length === 0) {
    return { paths: [], targets: [] };
  }

  trajectoryCollisionMap.clear();
  const paths = pList.map((p) => {
    const path = predictTrajectory(p, steps, W, H, obsGrid);
    for (let s = 1; s < path.length; s++) {
      const pt = path[s];
      // Numeric collision key: step (high 16 bits), y (mid 8 bits), x (low 8 bits)
      const k = (s << 16) | (pt.y << 8) | pt.x;
      const count = (trajectoryCollisionMap.get(k) || 0) + 1;
      trajectoryCollisionMap.set(k, count);
    }
    return { p: { ...p }, path };
  });

  const targets = [];
  for (const [k, count] of trajectoryCollisionMap.entries()) {
    if (count >= 2) {
      targets.push({
        step: k >>> 16,
        y: (k >>> 8) & 0xff,
        x: k & 0xff
      });
    }
  }
  return { paths, targets };
}

/**
 * Computes and caches future trajectory paths and predicted collision markers for current live particles.
 */
export function updateCachedTrajectories() {
  const { paths, targets } = computeTrajectoriesForParticles(particles, obstacles, gridW, gridH);
  cachedParticlePaths = paths;
  cachedCollisionTargets = targets;
}

// Precomputed Note & Velocity Look-Up Table (LUT)
let cachedLutSignature = "";
let noteLUT = null;       // Uint8Array(W * H) of clamped MIDI notes (12..108)
let noteNamesLUT = null;  // Array(W * H) of precomputed note name strings (e.g. "C3")
let velFactorLUT = null;  // Float32Array(W * H) of velocity scaling multipliers

/**
 * Generates a cache signature string for the current harmonic mapping settings.
 */
function getNoteLutSignature(W, H) {
  const scaleName = state.scale || state.particleScale || "pentMinor";
  const customStr = (scaleName === "custom" && state.customScale) ? state.customScale.join(",") : "";
  const rootNote = state.rootNote ?? 0;
  const rootOct = state.rootOctave ?? 3;
  const mapping = state.particleNoteRule || "x-pitch-y-oct";
  const octaves = state.pitchSpan || state.particleOctaves || 3;
  return `${W}x${H}|${scaleName}|${customStr}|${rootNote}|${rootOct}|${mapping}|${octaves}`;
}

/**
 * Rebuilds the Note and Velocity Look-Up Tables across all grid cells.
 * Executed once whenever scale, root, octave, pitch rule, or grid size changes.
 */
export function rebuildNoteLUT(W = gridW, H = gridH, sig = null) {
  const scaleName = state.scale || state.particleScale || "pentMinor";
  const scaleIntervals = (scaleName === "custom" && state.customScale?.length)
    ? state.customScale
    : (SCALES[scaleName] || SCALES.pentMinor);

  const rootMidiBase = Number(state.rootNote ?? 0) || 0;

  const rootOct = state.rootOctave !== undefined ? Number(state.rootOctave) : 3;
  const baseMidi = rootMidiBase + (rootOct + 1) * 12;

  const mapping = state.particleNoteRule || "x-pitch-y-oct";
  const octaves = Number(state.pitchSpan || state.particleOctaves || 3);
  const S = Math.max(1, scaleIntervals.length);
  const totalDegrees = S * octaves;

  const totalCells = W * H;
  noteLUT = new Uint8Array(totalCells);
  noteNamesLUT = new Array(totalCells);
  velFactorLUT = new Float32Array(totalCells);

  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const maxDist = Math.max(0.1, Math.sqrt(cx ** 2 + cy ** 2));
  const denomX = Math.max(1, W - 1);
  const denomY = Math.max(1, H - 1);
  const denomCells = Math.max(1, totalCells - 1);

  for (let y = 0; y < H; y++) {
    const normY = y / denomY;
    const yOctBonus = Math.floor((1 - normY) * 2);
    const yFactor = 1 - normY;
    const velMult = mapping === "x-degree-y-vel" ? (0.7 + yFactor * 0.5) : 1.0;

    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      let rawPitch = baseMidi;

      if (mapping === "x-pitch-y-oct") {
        const normX = x / denomX;
        const degIndex = Math.min(totalDegrees - 1, Math.floor(normX * totalDegrees));
        const octOffset = Math.floor(degIndex / S);
        const degree = scaleIntervals[degIndex % S];
        rawPitch = baseMidi + (octOffset + yOctBonus) * 12 + degree;
      } else if (mapping === "x-degree-y-vel") {
        const normX = x / denomX;
        const degIndex = Math.min(totalDegrees - 1, Math.floor(normX * totalDegrees));
        const octOffset = Math.floor(degIndex / S);
        const degree = scaleIntervals[degIndex % S];
        rawPitch = baseMidi + octOffset * 12 + degree;
      } else if (mapping === "radial") {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const normDist = Math.min(1, dist / maxDist);
        const degIndex = Math.min(totalDegrees - 1, Math.floor(normDist * totalDegrees));
        const octOffset = Math.floor(degIndex / S);
        const degree = scaleIntervals[degIndex % S];
        rawPitch = baseMidi + octOffset * 12 + degree;
      } else {
        const norm = Math.min(1, idx / denomCells);
        const degIndex = Math.min(totalDegrees - 1, Math.floor(norm * totalDegrees));
        const octOffset = Math.floor(degIndex / S);
        const degree = scaleIntervals[degIndex % S];
        rawPitch = baseMidi + octOffset * 12 + degree;
      }

      const quantized = quantize(rawPitch, scaleIntervals, baseMidi, 1);
      const clampedNote = Math.max(12, Math.min(108, quantized));

      noteLUT[idx] = clampedNote;
      noteNamesLUT[idx] = midiName(clampedNote);
      velFactorLUT[idx] = velMult;
    }
  }

  cachedLutSignature = sig || getNoteLutSignature(W, H);
}

/**
 * Ensures the Note Look-Up Table is initialized and valid for current parameters.
 */
export function ensureNoteLUT(W = gridW, H = gridH) {
  const sig = getNoteLutSignature(W, H);
  if (sig === cachedLutSignature && noteLUT && noteLUT.length === W * H) {
    return;
  }
  rebuildNoteLUT(W, H, sig);
}

/**
 * Invalidates the cached Note Look-Up Table, forcing a rebuild on next query.
 */
export function invalidateNoteLUT() {
  cachedLutSignature = "";
}

/**
 * Maps cell coordinates to musical MIDI note using the precomputed Note LUT.
 * Instantaneous O(1) array read with zero runtime scale quantization loops.
 */
export function mapCoordinateToNote(x, y, W = gridW, H = gridH) {
  ensureNoteLUT(W, H);
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  const idx = cy * W + cx;

  const clampedNote = noteLUT[idx];
  const name = noteNamesLUT[idx];
  const velMult = velFactorLUT[idx];

  // Determine velocity from shared Velocity bar
  const baseVel = state.velocity ?? 100;
  let finalVel = baseVel;

  if (state.randVel) {
    const vMin = state.velMin ?? 1;
    const vMax = state.velMax ?? 127;
    const amt = (state.randVelAmt ?? 0) / 100;
    const rnd = vMin + Math.random() * (vMax - vMin);
    finalVel = Math.round(baseVel * (1 - amt) + rnd * amt);
  }

  if (velMult !== 1.0) {
    finalVel = Math.round(finalVel * velMult);
  }

  finalVel = Math.max(1, Math.min(127, finalVel));

  return { note: clampedNote, vel: finalVel, name };
}

// Zero-Allocation Spatial Hash Buffers for stepPhysics collision detection
const MAX_GRID_CELLS = 32 * 32; // 1024 max cells
const MAX_SIM_PARTICLES = 128;
const spatialCellHead = new Int16Array(MAX_GRID_CELLS).fill(-1);
const spatialCellTail = new Int16Array(MAX_GRID_CELLS).fill(-1);
const spatialParticleNext = new Int16Array(MAX_SIM_PARTICLES).fill(-1);
const spatialCellCount = new Uint8Array(MAX_GRID_CELLS);
const reusableCellGroup = new Array(MAX_SIM_PARTICLES);

/**
 * Step the particle physics engine forward by 1 tick.
 * Zero-allocation inner loop utilizing flat typed arrays for spatial collision hashing.
 */
export function stepPhysics(pList, obsMap, W = gridW, H = gridH) {
  const boundary = state.particleBoundary || "reflect";
  const wallNotes = Boolean(state.particleWallNotes);
  const mode = state.particleCollisionMode || "deflect";
  const childLife = Number(state.particleChildLife || 16);
  const maxCount = Number(state.particleMaxCount || 20);

  const notesTriggered = [];
  const collisionLocs = [];
  const numParticles = pList.length;

  // 1. Advance positions along velocity vectors and handle boundaries
  for (let i = 0; i < numParticles; i++) {
    const p = pList[i];
    p._prevX = p.x;
    p._prevY = p.y;

    let tx = p.x + p.dx;
    let ty = p.y + p.dy;
    let hitWall = false;

    if (boundary === "reflect") {
      // Elastic reflection: inverts vector component
      if (tx < 0) {
        p.dx = -p.dx;
        tx = 0;
        hitWall = true;
      } else if (tx >= W) {
        p.dx = -p.dx;
        tx = W - 1;
        hitWall = true;
      }

      if (ty < 0) {
        p.dy = -p.dy;
        ty = 0;
        hitWall = true;
      } else if (ty >= H) {
        p.dy = -p.dy;
        ty = H - 1;
        hitWall = true;
      }
    } else {
      // Toroidal wrap
      tx = (tx % W + W) % W;
      ty = (ty % H + H) % H;
    }

    p.x = tx;
    p.y = ty;

    // Optional wall bounce trigger note
    if (hitWall && wallNotes) {
      const wallNote = mapCoordinateToNote(p.x, p.y, W, H);
      notesTriggered.push({ note: wallNote.note, vel: Math.max(1, Math.round(wallNote.vel * 0.7)) });
    }

    // Handle fixed obstacles (deflectors & bouncers) via fast typed array read
    const obs = (obsMap instanceof Uint8Array && p.y >= 0 && p.y < H && p.x >= 0 && p.x < W)
      ? obsMap[p.y * W + p.x]
      : OBS_NONE;

    if (obs !== OBS_NONE) {
      if (obs === OBS_SLASH) {
        const odx = p.dx;
        p.dx = -p.dy;
        p.dy = -odx;
      } else if (obs === OBS_BACKSLASH) {
        const odx = p.dx;
        p.dx = p.dy;
        p.dy = odx;
      } else if (obs === OBS_BOUNCER) {
        p.dx = -p.dx;
        p.dy = -p.dy;
      }
    }

    // Age child particles
    if (p.isChild) {
      p.life--;
    }
  }

  // 2. Zero-Allocation Spatial Hash: Group particles by coordinate in flat typed arrays
  // Fast clear of only cells occupied by current particles
  for (let i = 0; i < numParticles; i++) {
    const c = pList[i].y * W + pList[i].x;
    spatialCellHead[c] = -1;
    spatialCellTail[c] = -1;
    spatialCellCount[c] = 0;
  }

  // Populate linked list chains
  for (let i = 0; i < numParticles; i++) {
    const c = pList[i].y * W + pList[i].x;
    if (spatialCellHead[c] === -1) {
      spatialCellHead[c] = i;
    } else {
      spatialParticleNext[spatialCellTail[c]] = i;
    }
    spatialCellTail[c] = i;
    spatialParticleNext[i] = -1;
    spatialCellCount[c]++;
  }

  let spawnedChildrenCount = 0;
  const spawnedChildren = [];

  // 3. Resolve collisions
  for (let i = 0; i < numParticles; i++) {
    const c = pList[i].y * W + pList[i].x;
    const count = spatialCellCount[c];
    if (count < 2) continue;

    // Mark cell as processed so other particles sharing this cell don't duplicate work
    spatialCellCount[c] = 0;

    // Collect cell particles in original insertion order into reusable buffer
    let groupLen = 0;
    let curr = spatialCellHead[c];
    while (curr !== -1 && groupLen < reusableCellGroup.length) {
      reusableCellGroup[groupLen++] = pList[curr];
      curr = spatialParticleNext[curr];
    }

    const cx = reusableCellGroup[0].x;
    const cy = reusableCellGroup[0].y;
    const mapped = mapCoordinateToNote(cx, cy, W, H);

    notesTriggered.push({ note: mapped.note, vel: mapped.vel });
    collisionLocs.push({ x: cx, y: cy, note: mapped.name, count: groupLen });

    // Collision Dynamics
    if (mode === "annihilate") {
      for (let k = 0; k < groupLen; k++) {
        reusableCellGroup[k]._dead = true;
      }
    } else if (mode === "deflect" || mode === "spawn" || mode === "hybrid") {
      for (let k = 0; k < groupLen; k++) {
        const p = reusableCellGroup[k];
        if (p.dx === 0 && p.dy === 0) {
          p.dx = k % 2 === 0 ? 1 : -1;
          p.dy = k % 2 === 0 ? -1 : 1;
        } else if (k % 2 === 0) {
          const odx = p.dx;
          p.dx = -p.dy;
          p.dy = odx;
        } else {
          const odx = p.dx;
          p.dx = p.dy;
          p.dy = -odx;
        }
      }

      const shouldSpawn = mode === "spawn" || (mode === "hybrid" && Math.random() < 0.5);
      if (shouldSpawn && (numParticles + spawnedChildrenCount) < maxCount) {
        const pA = reusableCellGroup[0];
        const pB = reusableCellGroup[1];
        let cdx = pA.dx + pB.dx;
        let cdy = pA.dy + pB.dy;
        if (cdx === 0 && cdy === 0) {
          cdx = (Math.random() < 0.5 ? 1 : -1);
          cdy = (Math.random() < 0.5 ? 1 : -1);
        }
        cdx = Math.max(-1, Math.min(1, cdx));
        cdy = Math.max(-1, Math.min(1, cdy));

        spawnedChildrenCount++;
        spawnedChildren.push({
          id: nextParticleId++,
          x: cx,
          y: cy,
          dx: cdx,
          dy: cdy,
          isChild: true,
          life: childLife,
          maxLife: childLife,
          color: "#ffffff"
        });
      }
    }
  }

  // Check for head-on passing collisions (particles swapping cells on same axis)
  for (let i = 0; i < numParticles; i++) {
    const pA = pList[i];
    if (pA._dead) continue;
    for (let j = i + 1; j < numParticles; j++) {
      const pB = pList[j];
      if (pB._dead) continue;
      if (pA.x === pB._prevX && pA.y === pB._prevY && pB.x === pA._prevX && pB.y === pA._prevY) {
        const cx = pA.x;
        const cy = pA.y;
        const mapped = mapCoordinateToNote(cx, cy, W, H);
        notesTriggered.push({ note: mapped.note, vel: mapped.vel });
        collisionLocs.push({ x: cx, y: cy, note: mapped.name, count: 2 });

        if (mode === "annihilate") {
          pA._dead = true;
          pB._dead = true;
        } else if (mode === "deflect" || mode === "spawn" || mode === "hybrid") {
          const odxA = pA.dx;
          pA.dx = -pA.dy;
          pA.dy = odxA;
          const odxB = pB.dx;
          pB.dx = pB.dy;
          pB.dy = -odxB;
        }
      }
    }
  }

  // 4. Cleanup spatial hash cells for next tick
  for (let i = 0; i < numParticles; i++) {
    const c = pList[i].y * W + pList[i].x;
    spatialCellHead[c] = -1;
    spatialCellTail[c] = -1;
    spatialCellCount[c] = 0;
  }

  // 5. Compact surviving particles (filter dead and expired)
  const nextList = [];
  for (let i = 0; i < numParticles; i++) {
    const p = pList[i];
    if (p._dead) {
      delete p._dead;
      continue;
    }
    if (p.isChild && p.life <= 0) {
      continue;
    }
    nextList.push(p);
  }

  // 6. Add new spawned children
  if (spawnedChildren.length > 0) {
    nextList.push(...spawnedChildren);
  }

  // 7. Auto-respawn safety if particles drop below 2 in Annihilate mode
  if (mode === "annihilate" && nextList.length < 2) {
    const restored = cloneParticles(seedParticles);
    return {
      particles: restored,
      notes: notesTriggered,
      collisions: collisionLocs
    };
  }

  return {
    particles: nextList,
    notes: notesTriggered,
    collisions: collisionLocs
  };
}

/**
 * Executes a single physics step (used during manual step button).
 */
export function stepPhysicsTick(triggerSound = true) {
  if (loopMode === "free") {
    totalFreeSteps++;
    lastLiveStep = lastLiveStep < 0 ? 0 : lastLiveStep + 1;
    const { particles: updated, notes, collisions } = stepPhysics(particles, obstacles, gridW, gridH);
    particles = updated;
    updateCachedTrajectories();
    updateHud(lastLiveStep, collisions.length, collisions[0]?.note || null);
    renderCanvas();
    return;
  }

  const seqLen = precomputedStepStates.length || 64;
  const nextStep = lastLiveStep < 0 ? 0 : (lastLiveStep + 1) % seqLen;
  lastLiveStep = nextStep;

  const stepState = precomputedStepStates[nextStep];
  if (stepState) {
    particles = stepState.particles;
    cachedParticlePaths = stepState.paths;
    cachedCollisionTargets = stepState.targets;
    updateHud(nextStep, stepState.collisionsCount, stepState.primaryNote);
  } else {
    const { particles: updated, notes, collisions } = stepPhysics(particles, obstacles, gridW, gridH);
    particles = updated;
    updateCachedTrajectories();
    updateHud(nextStep, collisions.length, collisions[0]?.note || null);
  }

  renderCanvas();
}

/**
 * Generates the full 64-step sequence bank from particle physics simulation.
 * Precomputes and caches all discrete simulation states for zero-overhead playback.
 */
export function generateParticleBank() {
  ensureNoteLUT(gridW, gridH);
  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  let rateIdx = typeof state.rate === "number" ? state.rate : RATE_NAMES.indexOf(state.rate);
  if (rateIdx < 0 || rateIdx >= RATE_QUARTERS.length) rateIdx = 6;
  const tempo = state.tempo || 120;
  const polyLimit = Math.max(1, Math.min(4, Number(state.particlePolyphony || 2)));

  let simParticles = cloneParticles(seedParticles.length > 0 ? seedParticles : particles);
  const simObstacles = cloneObstacles(seedObstacles.some((v) => v !== 0) ? seedObstacles : obstacles);
  const precomputedSteps = [];

  // 1. Initial State (step -1 / stopped / preview state)
  const initTrajectories = computeTrajectoriesForParticles(simParticles, simObstacles, gridW, gridH);
  precomputedInitialState = {
    particles: cloneParticles(simParticles),
    collisions: [],
    collisionsCount: 0,
    primaryNote: null,
    paths: initTrajectories.paths,
    targets: initTrajectories.targets
  };

  // 2. Precompute all sequence steps
  precomputedStepStates = [];
  for (let step = 0; step < seqLen; step++) {
    const { particles: updated, notes, collisions } = stepPhysics(simParticles, simObstacles, gridW, gridH);
    simParticles = updated;

    const stepNotes = notes.slice(0, polyLimit);
    const stepTrajectories = computeTrajectoriesForParticles(simParticles, simObstacles, gridW, gridH);

    precomputedStepStates.push({
      particles: cloneParticles(simParticles),
      collisions,
      collisionsCount: collisions.length,
      primaryNote: collisions[0]?.note || null,
      paths: stepTrajectories.paths,
      targets: stepTrajectories.targets
    });

    precomputedSteps.push({
      notes: stepNotes,
      collisionsCount: collisions.length,
      rate: rateIdx,
      gate: state.gate ?? 50
    });
  }

  const curBank = getBank();
  const existingSteps = curBank?.[0]?.steps;

  const steps = precomputedSteps.map((st, i) => {
    const hasCollision = st.notes.length > 0;
    const isStepActive = particleRhythmOverridden
      ? Boolean(existingSteps?.[i]?.notes && existingSteps[i].notes.length > 0)
      : hasCollision;

    // Determine fallback note for this step in case user turns it on manually
    let fallbackNotes = null;
    if (existingSteps?.[i]?.notes && existingSteps[i].notes.length > 0) {
      fallbackNotes = existingSteps[i].notes.map((n) => ({ ...n }));
    } else if (existingSteps?.[i]?._savedNotes && existingSteps[i]._savedNotes.length > 0) {
      fallbackNotes = existingSteps[i]._savedNotes.map((n) => ({ ...n }));
    } else if (existingSteps?.[i]?._savedNote) {
      fallbackNotes = [{ ...existingSteps[i]._savedNote }];
    } else if (precomputedStepStates[i]?.particles?.[0]) {
      const p0 = precomputedStepStates[i].particles[0];
      const defM = mapCoordinateToNote(p0.x, p0.y, gridW, gridH);
      fallbackNotes = [{ note: defM.note, vel: defM.vel }];
    } else {
      const root = state.root ?? 48;
      const vel = state.velocity ?? 100;
      fallbackNotes = [{ note: root, vel }];
    }

    const collisionNotes = hasCollision ? st.notes.map((n) => ({ ...n })) : null;

    let finalNotes;
    if (isStepActive) {
      finalNotes = (collisionNotes && collisionNotes.length > 0)
        ? collisionNotes
        : (fallbackNotes || []);
    } else {
      finalNotes = [];
    }

    const savedNotes = collisionNotes || fallbackNotes;

    return {
      notes: finalNotes,
      _savedNotes: savedNotes ? savedNotes.map((n) => ({ ...n })) : null,
      _savedNote: savedNotes?.[0] ? { ...savedNotes[0] } : null,
      _userRhythmActive: particleRhythmOverridden ? isStepActive : undefined,
      rate: st.rate,
      gate: st.gate
    };
  });

  const bank = [{
    length: seqLen,
    rate: rateIdx,
    tempo: tempo,
    gate: state.gate ?? 50,
    swing: state.swing ?? 50,
    steps: steps,
    gridSize: gridW
  }];

  setBank(bank);
  syncRhythmGrid();

  // Sync active visual display to current step or initial state
  if (lastLiveStep >= 0 && lastLiveStep < precomputedStepStates.length) {
    const activeState = precomputedStepStates[lastLiveStep];
    particles = activeState.particles;
    cachedParticlePaths = activeState.paths;
    cachedCollisionTargets = activeState.targets;
  } else if (precomputedInitialState) {
    particles = precomputedInitialState.particles;
    cachedParticlePaths = precomputedInitialState.paths;
    cachedCollisionTargets = precomputedInitialState.targets;
  }

  return bank;
}

/**
 * Randomize particles configuration and generate new sequence.
 */
export function randomizeParticles() {
  particleRhythmOverridden = false;
  state.seed = (Math.random() * 1e9) | 0;
  if (refs.seed?.setValue) refs.seed.setValue(state.seed, false);

  const numParticles = 4 + Math.floor(Math.random() * 4);
  particles = [];
  playheadClickCounts.clear();
  clearObstacles(obstacles);

  for (let i = 0; i < numParticles; i++) {
    const rx = Math.floor(Math.random() * gridW);
    const ry = Math.floor(Math.random() * gridH);
    const dirs = DIRECTIONS.slice(0, 8);
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    particles.push({
      id: nextParticleId++,
      x: rx,
      y: ry,
      dx: dir.dx,
      dy: dir.dy,
      isChild: false,
      life: 0,
      maxLife: 0,
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length]
    });
  }

  if (Math.random() < 0.6) {
    const ox = Math.floor(gridW / 2);
    const oy = Math.floor(gridH / 2);
    setObstacle(ox, oy, OBS_BOUNCER);
  }

  saveToSeed();
  generateParticleBank();
  randomizeRhythm();
  updateHud(0, 0, null);
  status(`Randomized Particles physics & Rhythm · seed ${state.seed >>> 0}`, "ok");
}

/**
 * Render Function: Draws particles, trajectory rays, obstacles, and grid for the current step.
 * Shows discrete step positions with no glows or intermediate interpolated motion.
 */
export function renderCanvas() {
  if (!canvasEl || !ctx) return;

  const rect = canvasEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || 560;
  const h = rect.height || 560;

  if (canvasEl.width !== Math.floor(w * dpr) || canvasEl.height !== Math.floor(h * dpr)) {
    canvasEl.width = Math.floor(w * dpr);
    canvasEl.height = Math.floor(h * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  // Background
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  ctx.fillStyle = isDark ? "#0f0d19" : "#f4f3f8";
  ctx.fillRect(0, 0, w, h);

  const cellW = w / gridW;
  const cellH = h / gridH;

  // 1. Grid Lines
  ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.06)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= gridW; x++) {
    const px = Math.floor(x * cellW) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
  for (let y = 0; y <= gridH; y++) {
    const py = Math.floor(y * cellH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }

  // 2. Obstacles (Deflectors & Bouncers)
  const pad = Math.min(cellW, cellH) * 0.25;
  const bouncerRad = Math.min(cellW, cellH) * 0.35;

  for (let idx = 0; idx < obstacles.length; idx++) {
    const type = obstacles[idx];
    if (type === OBS_NONE) continue;

    const ox = idx % gridW;
    const oy = Math.floor(idx / gridW);
    const cx = ox * cellW + cellW / 2;
    const cy = oy * cellH + cellH / 2;

    if (type === OBS_SLASH) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ox * cellW + pad, (oy + 1) * cellH - pad);
      ctx.lineTo((ox + 1) * cellW - pad, oy * cellH + pad);
      ctx.stroke();
    } else if (type === OBS_BACKSLASH) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ox * cellW + pad, oy * cellH + pad);
      ctx.lineTo((ox + 1) * cellW - pad, (oy + 1) * cellH - pad);
      ctx.stroke();
    } else if (type === OBS_BOUNCER) {
      ctx.strokeStyle = "#ec4899";
      ctx.fillStyle = "rgba(236, 72, 153, 0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, bouncerRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
      ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
      ctx.stroke();
    }
  }

  // 3. Predictive Trajectory Rays & Target Crosshairs (Rendered from cached data)
  if (showTrajectories) {
    if (!cachedParticlePaths) {
      updateCachedTrajectories();
    }

    if (cachedParticlePaths.length > 0) {
      // Draw dashed path rays directly from step position
      for (let i = 0; i < cachedParticlePaths.length; i++) {
        const { p, path } = cachedParticlePaths[i];
        if (!path || path.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = p.isChild ? "rgba(255, 255, 255, 0.45)" : p.color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x * cellW + cellW / 2, p.y * cellH + cellH / 2);

        for (let s = 1; s < path.length; s++) {
          ctx.lineTo(path[s].x * cellW + cellW / 2, path[s].y * cellH + cellH / 2);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Draw predicted collision target markers
      if (cachedCollisionTargets.length > 0) {
        const targetRad = Math.min(cellW, cellH) * 0.38;

        ctx.save();
        ctx.strokeStyle = "#ff007f";
        ctx.fillStyle = "rgba(255, 0, 127, 0.18)";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([2, 2]);
        ctx.font = "bold 8.5px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let i = 0; i < cachedCollisionTargets.length; i++) {
          const { x, y, step } = cachedCollisionTargets[i];
          const tcx = x * cellW + cellW / 2;
          const tcy = y * cellH + cellH / 2;

          ctx.beginPath();
          ctx.arc(tcx, tcy, targetRad, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#ff007f";
          ctx.fillText(`+${step}t`, tcx, tcy);
        }
        ctx.restore();
      }
    }
  }

  // 4. Particles (Discrete Step Rendering, Clean Discs with Vector Chevrons & IDs)
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cx = p.x * cellW + cellW / 2;
    const cy = p.y * cellH + cellH / 2;
    const rad = Math.min(cellW, cellH) * (p.isChild ? 0.32 : 0.4);

    ctx.save();

    // Solid Particle Body (No Glow/Blur)
    ctx.fillStyle = p.isChild ? "#ffffff" : p.color;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();

    // Particle ID label
    ctx.fillStyle = "#0f0d19";
    ctx.font = `bold ${Math.max(8, Math.floor(rad * 0.95))}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${p.id}`, cx, cy + 0.5);

    // Direction Vector Chevron / Arrow
    if (p.dx !== 0 || p.dy !== 0) {
      const arrowLen = Math.min(cellW, cellH) * 0.55;
      const ax = cx + p.dx * arrowLen;
      const ay = cy + p.dy * arrowLen;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      const angle = Math.atan2(p.dy, p.dx);
      const headLen = 5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle - Math.PI / 6), ay - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle + Math.PI / 6), ay - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    // Child lifetime countdown ring
    if (p.isChild && p.maxLife > 0) {
      const frac = Math.max(0, p.life / p.maxLife);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, rad + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Updates the HUD readout elements.
 */
function updateHud(stepIndex = 0, collisionCount = 0, lastNoteName = null) {
  if (hudStep) {
    if (loopMode === "free") {
      const live = isLive();
      if (live && totalFreeSteps > 0) {
        hudStep.textContent = `${totalFreeSteps} (Free)`;
      } else {
        hudStep.textContent = "Free Run (∞)";
      }
    } else {
      const s = typeof stepIndex === "number" && stepIndex >= 0 ? stepIndex + 1 : 1;
      hudStep.textContent = `${s} / ${state.length || 64}`;
    }
  }
  if (hudParticles) {
    const parents = particles.filter((p) => !p.isChild).length;
    const children = particles.filter((p) => p.isChild).length;
    hudParticles.textContent = `${particles.length} (${parents}P / ${children}C)`;
  }
  if (hudCollisions) {
    hudCollisions.textContent = String(collisionCount);
  }
  if (hudNote) {
    if (lastNoteName) {
      hudNote.textContent = lastNoteName;
      hudNote.classList.add("particle-hud-highlight");
    } else if (lastLiveStep < 0) {
      hudNote.textContent = "—";
      hudNote.classList.remove("particle-hud-highlight");
    }
  }
  if (hudMode) {
    const sel = COLLISION_MODES.find((m) => m.v === state.particleCollisionMode);
    const modeName = sel ? sel.t : "Deflect (90°)";
    hudMode.textContent = loopMode === "free" ? `${modeName} · Free` : modeName;
  }
  if (hudStatus) {
    const live = isLive();
    if (live) {
      hudStatus.textContent = loopMode === "free" ? "▶ FREE RUN" : "▶ PLAYING";
      hudStatus.style.color = "var(--accent)";
    } else {
      hudStatus.textContent = "■ STOPPED";
      hudStatus.style.color = "var(--dim)";
    }
  }
}

/**
 * Interactive Mouse & Touch Handler for Canvas.
 */
function wireCanvasEvents(canvas) {
  let isPointerDown = false;
  let dragStartCell = null;

  function getCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX == null || clientY == null) return null;

    const x = Math.floor(((clientX - rect.left) / rect.width) * gridW);
    const y = Math.floor(((clientY - rect.top) / rect.height) * gridH);

    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return null;
    return { x, y };
  }

  canvas.addEventListener("pointerdown", (e) => {
    isPointerDown = true;
    const cell = getCellFromEvent(e);
    if (!cell) return;
    dragStartCell = cell;

    if (activeTool === "particle") {
      const dir = DIRECTIONS[selectedDirectionIdx];
      let dx = dir.dx;
      let dy = dir.dy;
      if (dir.label === "Random") {
        const d = DIRECTIONS[Math.floor(Math.random() * 8)];
        dx = d.dx;
        dy = d.dy;
      }

      const existingIdx = particles.findIndex((p) => p.x === cell.x && p.y === cell.y);
      if (existingIdx >= 0) {
        const cur = particles[existingIdx];
        const prevCount = cur._clickCount ?? playheadClickCounts.get(cur.id) ?? 0;
        const newCount = prevCount + 1;
        cur._clickCount = newCount;
        playheadClickCounts.set(cur.id, newCount);

        if (newCount >= 8) {
          particles.splice(existingIdx, 1);
          seedParticles = seedParticles.filter((p) => p.id !== cur.id);
          playheadClickCounts.delete(cur.id);
          status(`Removed playhead at (${cell.x}, ${cell.y})`);
        } else {
          const curIdx = DIRECTIONS.findIndex((d) => d.dx === cur.dx && d.dy === cur.dy);
          const nextIdx = ((curIdx >= 0 ? curIdx : 0) + 1) % 8;
          cur.dx = DIRECTIONS[nextIdx].dx;
          cur.dy = DIRECTIONS[nextIdx].dy;
          const seedP = seedParticles.find((p) => p.id === cur.id);
          if (seedP) {
            seedP.dx = cur.dx;
            seedP.dy = cur.dy;
            seedP._clickCount = newCount;
          }
          status(`Playhead (${cell.x}, ${cell.y}) → ${DIRECTIONS[nextIdx].label} (${newCount}/8 clicks)`);
        }
      } else {
        const newId = nextParticleId++;
        particles.push({
          id: newId,
          x: cell.x,
          y: cell.y,
          dx,
          dy,
          isChild: false,
          life: 0,
          maxLife: 0,
          _clickCount: 0,
          color: PARTICLE_COLORS[particles.length % PARTICLE_COLORS.length]
        });
        playheadClickCounts.set(newId, 0);
        status(`Placed playhead at (${cell.x}, ${cell.y}) → ${DIRECTIONS[selectedDirectionIdx].label}`);
      }
      saveToSeed();
      generateParticleBank();
      renderCanvas();
      updateHud();
    } else if (activeTool === "deflector" || activeTool === "slash" || activeTool === "backslash") {
      const obsIdx = cell.y * gridW + cell.x;
      const currentObs = obstacles[obsIdx];
      if (currentObs === OBS_SLASH || currentObs === OBS_BACKSLASH) {
        if (flippedDeflectors.has(obsIdx)) {
          flippedDeflectors.delete(obsIdx);
          removeObstacle(cell.x, cell.y);
          status(`Removed deflector at (${cell.x}, ${cell.y})`);
        } else {
          const newObs = currentObs === OBS_SLASH ? OBS_BACKSLASH : OBS_SLASH;
          obstacles[obsIdx] = newObs;
          flippedDeflectors.add(obsIdx);
          status(`Flipped deflector at (${cell.x}, ${cell.y}) to ${newObs === OBS_SLASH ? "/" : "\\"}`);
        }
      } else {
        setObstacle(cell.x, cell.y, "deflector");
        flippedDeflectors.delete(obsIdx);
        status(`Placed Deflector at (${cell.x}, ${cell.y})`);
      }
      saveToSeed();
      generateParticleBank();
      renderCanvas();
    } else if (activeTool === "bouncer") {
      const obsIdx = cell.y * gridW + cell.x;
      const currentObs = obstacles[obsIdx];
      if (currentObs === OBS_BOUNCER) {
        removeObstacle(cell.x, cell.y);
        status(`Removed Omni Bounce at (${cell.x}, ${cell.y})`);
      } else {
        setObstacle(cell.x, cell.y, "bouncer");
        flippedDeflectors.delete(obsIdx);
        status(`Placed Omni Bounce at (${cell.x}, ${cell.y})`);
      }
      saveToSeed();
      generateParticleBank();
      renderCanvas();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const cell = getCellFromEvent(e);
    if (!cell) {
      if (hoverCoordEl) hoverCoordEl.textContent = "—";
      return;
    }

    const note = mapCoordinateToNote(cell.x, cell.y);
    if (hoverCoordEl) {
      hoverCoordEl.textContent = `(${cell.x}, ${cell.y}) → ${note.name} (Vel ${note.vel})`;
    }

    if (isPointerDown && activeTool === "particle" && dragStartCell) {
      const dX = cell.x - dragStartCell.x;
      const dY = cell.y - dragStartCell.y;
      if (dX !== 0 || dY !== 0) {
        const ndx = Math.max(-1, Math.min(1, Math.sign(dX)));
        const ndy = Math.max(-1, Math.min(1, Math.sign(dY)));
        const targetParticle = particles.find((p) => p.x === dragStartCell.x && p.y === dragStartCell.y);
        if (targetParticle) {
          targetParticle.dx = ndx;
          targetParticle.dy = ndy;
          targetParticle._clickCount = 0;
          playheadClickCounts.delete(targetParticle.id);
          const seedP = seedParticles.find((p) => p.id === targetParticle.id);
          if (seedP) {
            seedP.dx = ndx;
            seedP.dy = ndy;
            seedP._clickCount = 0;
          }
          saveToSeed();
          generateParticleBank();
          renderCanvas();
        }
      }
    }
  });

  window.addEventListener("pointerup", () => {
    isPointerDown = false;
    dragStartCell = null;
  });

  canvas.addEventListener("mouseleave", () => {
    if (hoverCoordEl) hoverCoordEl.textContent = "—";
  });
}

/**
 * Initializes the Particle Simulator UI and registers with FM-1 Pulses.
 */
export function initParticles() {
  containerEl = document.getElementById("model-particles");
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout particle-layout";

  // LEFT COLUMN: Controls Rack
  const module = document.createElement("div");
  module.className = "module particle-module";

  // 1. Physics & Collision Section
  const physSect = document.createElement("section");
  physSect.className = "sect particle-sect";
  physSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Physics &amp; Collisions</h3>
    </div>
  `;

  const physGrid = document.createElement("div");
  physGrid.className = "particle-grid-2col";

  const modeCtrl = R("particleCollisionMode", dropdown({
    label: "Collision Rule",
    options: COLLISION_MODES.map((m) => ({ v: m.v, t: m.t })),
    value: state.particleCollisionMode || "deflect",
    onInput: (v) => {
      state.particleCollisionMode = v;
      generateParticleBank();
      updateHud();
      const sel = COLLISION_MODES.find((m) => m.v === v);
      status(`Collision Mode: ${sel ? sel.t : v}`);
    },
    tip: "Physical behavior when two particles collide on the same cell: Deflect at 90° right angles, Annihilate each other, or Spawn a finite-lifetime child."
  }));
  modeCtrl.classList.add("particle-span-full");

  const cycleCtrl = R("particleLoopMode", dropdown({
    label: "Cycle Mode",
    options: [
      { v: "loop", t: "Loop (Reset at Length)" },
      { v: "free", t: "Free Run (Indefinite)" }
    ],
    value: loopMode,
    onInput: (v) => {
      loopMode = v;
      state.particleLoopMode = v;
      if (v === "loop") {
        totalFreeSteps = 0;
        restoreFromSeed();
        generateParticleBank();
      }
      updateHud();
      renderCanvas();
      status(`Cycle Mode: ${v === "loop" ? "Loop cycle (resets at length)" : "Free run (carries on indefinitely)"}`);
    },
    tip: "Loop mode repeats a frozen sequence cycle. Free run carries on moving and colliding indefinitely without resetting."
  }));

  const boundCtrl = R("particleBoundary", dropdown({
    label: "Wall Boundary",
    options: [
      { v: "reflect", t: "Reflect (Elastic Bounce)" },
      { v: "wrap", t: "Wrap (Toroidal Surface)" }
    ],
    value: state.particleBoundary || "reflect",
    onInput: (v) => {
      state.particleBoundary = v;
      generateParticleBank();
      renderCanvas();
      status(`Boundary: ${v === "reflect" ? "Elastic Reflection" : "Toroidal Wrap"}`);
    },
    tip: "When particles reach the grid perimeter: Reflect elastically inverting vector component, or Toroidal wrap around to opposite edge."
  }));

  const wallNoteCtrl = toggleBtn(
    "Wall Notes",
    Boolean(state.particleWallNotes),
    (on) => {
      state.particleWallNotes = on;
      generateParticleBank();
      status(`Wall Bounce Notes: ${on ? "On" : "Off"}`);
    },
    "Whether bouncing on walls also triggers gentle perimeter notes.",
    "top"
  );

  const lifeKnob = R("particleChildLife", knob({
    label: "Child Life",
    min: 4,
    max: 32,
    step: 1,
    value: state.particleChildLife || 16,
    def: 16,
    size: "sm",
    format: (v) => `${Math.round(v)}t`,
    onInput: (v) => {
      state.particleChildLife = Math.round(v);
      generateParticleBank();
    },
    tip: "Finite lifetime (in clock ticks) for spawned child particles before natural decay."
  }));

  const maxCountKnob = R("particleMaxCount", knob({
    label: "Max Heads",
    min: 4,
    max: 32,
    step: 1,
    value: state.particleMaxCount || 20,
    def: 20,
    size: "sm",
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      state.particleMaxCount = Math.round(v);
      generateParticleBank();
    },
    tip: "Upper bound on simultaneous active particles on the grid."
  }));

  // Visual simulation toggles
  const trajToggle = toggleBtn(
    "Path Rays",
    showTrajectories,
    (on) => {
      showTrajectories = on;
      if (on) updateCachedTrajectories();
      renderCanvas();
      status(`Trajectory Rays: ${on ? "On" : "Off"}`);
    },
    "Render projected path rays and predicted collision target crosshairs.",
    "top"
  );

  physGrid.append(modeCtrl, cycleCtrl, boundCtrl, lifeKnob, maxCountKnob, wallNoteCtrl, trajToggle);
  physSect.append(physGrid);

  // 2. Grid & Editing Tools Section
  const toolSect = document.createElement("section");
  toolSect.className = "sect particle-sect";
  toolSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Interactive Tools</h3>
    </div>
  `;

  const toolGrid = document.createElement("div");
  toolGrid.className = "particle-grid-2col";

  const stampToolWrap = document.createElement("div");
  stampToolWrap.className = "particle-tool-wrap particle-span-full";

  const stampLabel = document.createElement("div");
  stampLabel.className = "k-lab";
  stampLabel.textContent = "Active Stamp Tool";

  const stampBtnGroup = document.createElement("div");
  stampBtnGroup.className = "particle-tool-group";

  const STAMP_TOOLS = [
    { v: "particle", label: "Playhead •", title: "Playhead Particle (•) — Click grid to place playhead, drag to aim direction, click 8 times to cycle compass and remove." },
    { v: "deflector", label: "Deflector", title: "Deflector (/) — Reflects particles at 45°. Click grid to place; click deflector to flip rotation, click again to remove." },
    { v: "bouncer", label: "Omni Bounce *", title: "Omni Bouncer * (180°) — Bounces particles straight back. Click placed bouncer to erase." }
  ];

  const stampButtons = [];

  STAMP_TOOLS.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `particle-tool-btn${activeTool === t.v ? " is-active" : ""}`;
    btn.textContent = t.label;
    btn.title = t.title;
    btn.id = `btn-stamp-${t.v}`;
    btn.addEventListener("click", () => {
      activeTool = t.v;
      stampButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      status(`Tool: ${t.label}`);
    });
    stampBtnGroup.appendChild(btn);
    stampButtons.push(btn);
  });

  stampToolWrap.append(stampLabel, stampBtnGroup);

  const dirCtrl = dropdown({
    label: "Vector Direction",
    options: DIRECTIONS.map((d, idx) => ({ v: String(idx), t: d.label })),
    value: String(selectedDirectionIdx),
    onInput: (v) => {
      selectedDirectionIdx = Number(v);
      status(`Direction: ${DIRECTIONS[selectedDirectionIdx].label}`);
    },
    tip: "Initial velocity vector (dx, dy) assigned when stamping new particles."
  });

  const sizeCtrl = dropdown({
    label: "Grid Resolution",
    options: GRID_SIZES,
    value: String(gridW),
    onInput: (v) => {
      const s = Number(v);
      const oldW = gridW;
      const oldH = gridH;
      const oldObs = obstacles;
      gridW = s;
      gridH = s;
      state.particleGridSize = s;
      particles.forEach((p) => {
        p.x = Math.min(gridW - 1, p.x);
        p.y = Math.min(gridH - 1, p.y);
      });
      const newObs = new Uint8Array(gridW * gridH);
      for (let oy = 0; oy < Math.min(oldH, gridH); oy++) {
        for (let ox = 0; ox < Math.min(oldW, gridW); ox++) {
          newObs[oy * gridW + ox] = oldObs[oy * oldW + ox];
        }
      }
      obstacles = newObs;
      flippedDeflectors.clear();
      saveToSeed();
      generateParticleBank();
      renderCanvas();
      updateHud();
      status(`Grid: ${s} × ${s}`);
    },
    tip: "2D surface grid dimensions."
  });

  toolGrid.append(stampToolWrap, dirCtrl, sizeCtrl);

  // Quick Action Buttons
  const btnRow = document.createElement("div");
  btnRow.className = "particle-btn-row particle-span-full";

  const addRndBtn = actionBtn("+ Random Head", () => {
    const rx = Math.floor(Math.random() * gridW);
    const ry = Math.floor(Math.random() * gridH);
    const d = DIRECTIONS[Math.floor(Math.random() * 8)];
    particles.push({
      id: nextParticleId++,
      x: rx,
      y: ry,
      dx: d.dx,
      dy: d.dy,
      isChild: false,
      life: 0,
      maxLife: 0,
      color: PARTICLE_COLORS[particles.length % PARTICLE_COLORS.length]
    });
    saveToSeed();
    generateParticleBank();
    renderCanvas();
    updateHud();
    status("Added particle playhead", "ok");
  }, "Add a new randomized particle playhead to the grid");

  const stepBtn = actionBtn("Step ▶", () => {
    stepPhysicsTick(false);
  }, "Advance particle physics forward by 1 step tick");

  const resetBtn = actionBtn("Reset Seed", () => {
    particleRhythmOverridden = false;
    totalFreeSteps = 0;
    flippedDeflectors.clear();
    playheadClickCounts.clear();
    restoreFromSeed();
    generateParticleBank();
    renderCanvas();
    updateHud(0, 0, null);
    status("Reset particles to seed layout", "ok");
  }, "Restore particles to original seed positions");

  const clearBtn = actionBtn("Clear All", () => {
    particles = [];
    playheadClickCounts.clear();
    clearObstacles(obstacles);
    saveToSeed();
    generateParticleBank();
    renderCanvas();
    updateHud();
    status("Cleared all particles and obstacles");
  }, "Remove all particles and obstacles from the grid");

  addRndBtn.id = "btn-particle-random";
  stepBtn.id = "btn-particle-step";
  resetBtn.id = "btn-particle-reset";
  clearBtn.id = "btn-particle-clear";

  btnRow.append(addRndBtn, stepBtn, resetBtn, clearBtn);
  toolGrid.appendChild(btnRow);
  toolSect.append(toolGrid);

  // 3. Harmonic Mapping Section
  const harmSect = document.createElement("section");
  harmSect.className = "sect particle-sect";
  harmSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Harmonic Mapping</h3>
    </div>
  `;

  const harmGrid = document.createElement("div");
  harmGrid.className = "particle-grid-2col";

  const mapCtrl = R("particleNoteRule", dropdown({
    label: "Pitch Geometry",
    options: PITCH_MAPPINGS.map((m) => ({ v: m.v, t: m.t })),
    value: state.particleNoteRule || "x-pitch-y-oct",
    onInput: (v) => {
      state.particleNoteRule = v;
      generateParticleBank();
      status(`Pitch Mapping: ${v}`);
    },
    tip: "Geometric mapping from 2D collision coordinates to musical scale intervals."
  }));

  const polyCtrl = R("particlePolyphony", dropdown({
    label: "Polyphony",
    options: POLYPHONY_OPTIONS,
    value: String(state.particlePolyphony || 2),
    onInput: (v) => {
      state.particlePolyphony = Number(v);
      generateParticleBank();
      status(`Polyphony: ${v} notes`);
    },
    tip: "Maximum simultaneous collision notes triggered on any step."
  }));

  harmGrid.append(mapCtrl, polyCtrl);
  harmSect.append(harmGrid);

  const harmBtnRow = document.createElement("div");
  harmBtnRow.className = "particle-btn-row";
  harmBtnRow.style.marginTop = "8px";
  const resetRhythmBtn = actionBtn("Reset Rhythm to Collisions", () => {
    resetRhythmToCollisions();
  }, "Restore note triggers to exact particle collisions, clearing Euclidean or manual rhythm overrides");
  resetRhythmBtn.id = "btn-particle-reset-rhythm";
  harmBtnRow.appendChild(resetRhythmBtn);
  harmSect.appendChild(harmBtnRow);

  // 4. Presets Library Section
  const presetSect = document.createElement("section");
  presetSect.className = "sect particle-sect";
  presetSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Orca / Plinky Presets</h3>
    </div>
  `;

  const presetGrid = document.createElement("div");
  presetGrid.className = "particle-preset-grid";

  PARTICLE_PRESETS.forEach((p) => {
    const btn = document.createElement("button");
    btn.id = `preset-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    btn.className = "particle-preset-btn";
    btn.textContent = p.name;
    btn.title = `${p.name}: ${p.desc}`;
    btn.addEventListener("click", () => {
      particleRhythmOverridden = false;
      playheadClickCounts.clear();
      p.setup();
      saveToSeed();
      generateParticleBank();
      renderCanvas();
      updateHud();
      status(`Loaded Preset: ${p.name}`, "ok");
    });
    presetGrid.appendChild(btn);
  });

  presetSect.appendChild(presetGrid);

  module.append(physSect, toolSect, harmSect, presetSect);

  // RIGHT COLUMN: 2D Interactive Canvas & HUD
  const display = document.createElement("div");
  display.className = "display particle-display";

  display.innerHTML = `
    <div class="particle-display-header">
      <div class="particle-hud-bar">
        <div class="particle-hud-item"><span class="particle-hud-lbl">STEP</span><b id="particle-hud-step" class="particle-hud-val">1 / 64</b></div>
        <div class="particle-hud-item"><span class="particle-hud-lbl">HEADS</span><b id="particle-hud-particles" class="particle-hud-val">0</b></div>
        <div class="particle-hud-item"><span class="particle-hud-lbl">COLLISIONS</span><b id="particle-hud-collisions" class="particle-hud-val">0</b></div>
        <div class="particle-hud-item"><span class="particle-hud-lbl">NOTE</span><b id="particle-hud-note" class="particle-hud-val particle-hud-highlight">—</b></div>
        <div class="particle-hud-item"><span class="particle-hud-lbl">MODE</span><b id="particle-hud-mode" class="particle-hud-val">Deflect (90°)</b></div>
        <div class="particle-hud-item"><span class="particle-hud-lbl">STATUS</span><b id="particle-hud-status" class="particle-hud-val">■ STOPPED</b></div>
      </div>
    </div>
    <div class="particle-canvas-wrap">
      <canvas id="particle-canvas" class="particle-canvas"></canvas>
    </div>
    <div class="particle-display-footer">
      <span id="particle-step-hover" class="particle-step-hover">—</span>
    </div>
  `;

  layout.append(module, display);
  containerEl.appendChild(layout);

  // Capture HUD elements
  hudStep = document.getElementById("particle-hud-step");
  hudParticles = document.getElementById("particle-hud-particles");
  hudCollisions = document.getElementById("particle-hud-collisions");
  hudNote = document.getElementById("particle-hud-note");
  hudMode = document.getElementById("particle-hud-mode");
  hudStatus = document.getElementById("particle-hud-status");
  hoverCoordEl = document.getElementById("particle-step-hover");

  // Canvas setup
  canvasEl = document.getElementById("particle-canvas");
  if (canvasEl) {
    ctx = canvasEl.getContext("2d");
    wireCanvasEvents(canvasEl);
  }

  // Load default preset (Head-On Clave)
  PARTICLE_PRESETS[0].setup();
  saveToSeed();
  updateCachedTrajectories();

  // Step Hook for Live Transport Playback
  onStep((stepIndex) => {
    if (stepIndex === null) {
      lastLiveStep = -1;
      if (loopMode === "loop" && precomputedInitialState) {
        particles = precomputedInitialState.particles;
        cachedParticlePaths = precomputedInitialState.paths;
        cachedCollisionTargets = precomputedInitialState.targets;
      }
      updateHud(-1, 0, null);
      renderCanvas();
      return;
    }

    if (!isParticlesActive && getActiveModel && getActiveModel() !== "particles") return;
    if (!containerEl || containerEl.style.display === "none") return;

    if (loopMode === "free") {
      totalFreeSteps++;
      lastLiveStep = stepIndex;

      // 1. Advance particle physics forward 1 continuous tick
      const { particles: updated, notes, collisions } = stepPhysics(particles, obstacles, gridW, gridH);
      particles = updated;

      updateCachedTrajectories();

      // 2. Route notes directly to the current bank step so player.js plays them
      const polyLimit = Math.max(1, Math.min(4, Number(state.particlePolyphony || 2)));
      const stepNotes = notes.slice(0, polyLimit);

      const bank = getBank();
      const curP = bank?.[getSelected()];
      const st = curP?.steps?.[stepIndex];
      if (st) {
        if (!particleRhythmOverridden) {
          // Default: note triggering determined strictly by particle collisions
          st.notes = stepNotes.map((n) => ({ ...n }));
        } else {
          // Override: respect user Euclidean or manual rhythm gate
          const isGateOn = st._userRhythmActive ?? (st.notes && st.notes.length > 0);
          if (isGateOn) {
            if (stepNotes.length > 0) {
              st.notes = stepNotes.map((n) => ({ ...n }));
            } else if (!st.notes || st.notes.length === 0) {
              const defNote = st._savedNote || { note: state.root ?? 48, vel: state.velocity ?? 100 };
              st.notes = [{ ...defNote }];
            }
          } else {
            if (st.notes && st.notes.length > 0) {
              st._savedNotes = st.notes.map((n) => ({ ...n }));
              st._savedNote = { ...st.notes[0] };
            }
            st.notes = [];
          }
        }
      }

      updateHud(stepIndex, collisions.length, collisions[0]?.note || null);
      renderCanvas();
      return;
    }

    // Loop Mode: O(1) Ring Buffer Lookup
    lastLiveStep = stepIndex;

    const stepState = (stepIndex >= 0 && stepIndex < precomputedStepStates.length)
      ? precomputedStepStates[stepIndex]
      : null;

    if (stepState) {
      particles = stepState.particles;
      cachedParticlePaths = stepState.paths;
      cachedCollisionTargets = stepState.targets;
      updateHud(stepIndex, stepState.collisionsCount, stepState.primaryNote);
    } else {
      if (stepIndex === 0) {
        restoreFromSeed();
      }
      const { particles: updated, notes, collisions } = stepPhysics(particles, obstacles, gridW, gridH);
      particles = updated;
      updateCachedTrajectories();
      updateHud(stepIndex, collisions.length, collisions[0]?.note || null);
    }

    renderCanvas();
  });

  // Watch for theme changes (Dark / Light)
  const themeObserver = new MutationObserver(() => {
    if (containerEl.style.display !== "none") {
      renderCanvas();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("resize", () => {
    if (containerEl && containerEl.style.display !== "none") {
      renderCanvas();
    }
  });

  // Listen for user edits from Euclidean controls or manual rhythm step toggling
  onRhythmUserEdit(() => {
    if (!isParticlesActive && getActiveModel && getActiveModel() !== "particles") return;
    particleRhythmOverridden = true;
    const curBank = getBank();
    const curP = curBank?.[0];
    if (curP?.steps) {
      for (const s of curP.steps) {
        s._userRhythmActive = Boolean(s.notes && s.notes.length > 0);
      }
    }
  });
}

/**
 * When activating the Particle Collision Simulator model.
 */
export function activateParticlesModel() {
  isParticlesActive = true;
  particleRhythmOverridden = false;
  setSelected(0);
  setModelGenerator(generateParticleBank);
  setModelRandomizer(randomizeParticles);

  if (state.rate === undefined) state.rate = 6;
  if (refs.rate) refs.rate.setValue(state.rate);

  doGenerate(false);
  syncRhythmGrid();
  renderCanvas();
  updateHud(0, 0, null);
}

/**
 * When deactivating the Particle Collision Simulator model.
 */
export function deactivateParticlesModel() {
  isParticlesActive = false;
  setModelGenerator(null);
  setModelRandomizer(null);
}
