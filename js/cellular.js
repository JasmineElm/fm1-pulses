// cellular.js — 2D Conway's Game of Life Cellular Automata Sequencer Model.
// Inspired by Reaktor's Newscool: resizable square grid (defaults to 64x64),
// interactive cell drawing, Conway's B3/S23 evolution, and real-time generation updates.

import { mulberry32, SCALES, quantize, NOTE_NAMES, midiName } from "./generator.js";
import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES, RATE_QUARTERS
} from "./state.js";
import { fader, dropdown, actionBtn } from "./controls.js";
import { onStep, isLive } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS } from "./scale.js";
import { syncRhythmGrid, randomizeRhythm } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
export { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS };

// Grid sizes supported
export const GRID_SIZES = [16, 32, 48, 64, 80, 96, 128];
export const DEFAULT_GRID_SIZE = 64;

// Note Triggering & Cell Selection Rules
export const NOTE_RULES = [
  // Pitch / X-axis Rules (relative to previous state)
  { v: "closest", t: "Closest Pitch (X Stepwise)", desc: "Cell closest in pitch to previous note — smooth stepwise melody" },
  { v: "median", t: "Median Pitch (X Center)", desc: "Cell closest to the median pitch of all active cells — harmonic center" },
  { v: "furthest", t: "Furthest Pitch (X Leaps)", desc: "Cell furthest in pitch from previous note — wide angular leaps" },
  { v: "lowest", t: "Lowest Pitch (Min X Bass)", desc: "Cell with the lowest pitch — bass voice anchor" },
  { v: "highest", t: "Highest Pitch (Max X Lead)", desc: "Cell with the highest pitch — soprano lead line" },

  // Velocity / Y-axis Rules
  { v: "closest-vel", t: "Closest Velocity (Y Smooth)", desc: "Cell closest in velocity to previous note — dynamic continuity" },
  { v: "furthest-vel", t: "Furthest Velocity (Y Contrast)", desc: "Cell furthest in velocity from previous note — alternates accents and ghost notes" },
  { v: "loudest", t: "Loudest Cell (Max Y)", desc: "Cell highest on the grid with peak velocity" },
  { v: "softest", t: "Softest Cell (Min Y)", desc: "Cell lowest on the grid with quietest velocity" },

  // 2D Spatial & Morphological Rules
  { v: "closest-2d", t: "Closest 2D (Tracks Organisms)", desc: "Cell closest in 2D Euclidean space — tracks gliders & moving creatures" },
  { v: "furthest-2d", t: "Furthest 2D (Spatial Leap)", desc: "Cell furthest in 2D space — jumps across distant colonies" },
  { v: "centroid", t: "Center of Mass (Centroid)", desc: "Cell closest to collective center of mass of living cells" },
  { v: "newborn", t: "Newborn Cells (Wavefront)", desc: "Prioritizes cells born this generation — sparks on active life frontier" },
  { v: "oldest", t: "Oldest Cells (Still-Life)", desc: "Prioritizes oldest surviving cells — anchors repetitive tonal pedal points" },
  { v: "random", t: "Random Cell (Stochastic)", desc: "Picks a random live cell uniformly — unpredictable generative textures" }
];


// Conway Engine State
let gridSize = DEFAULT_GRID_SIZE;
let currentGrid = new Uint8Array(gridSize * gridSize);
let nextGrid = new Uint8Array(gridSize * gridSize);
let seedGrid = new Uint8Array(gridSize * gridSize);

let generation = 0;
let population = 0;
let loopMode = "loop"; // "loop" (resets to seed every sequence-length steps) or "free"
let boundaryMode = "wrap"; // "wrap" (toroidal) or "wall" (zero borders)
let activeTool = "pen"; // "pen" or "eraser"
let brushSize = 1; // 1, 2, or 3
let hoverCell = null;
let isPointerDown = false;
let drawValue = 1; // 1 for drawing alive, 0 for erasing

// Note Triggering Tracking
let prevCell = null; // { x, y }
let lastTriggeredNote = null; // { note, vel, x, y }

// Classic Conway's Game of Life Presets
export const LIFE_PRESETS = [
  {
    name: "Glider",
    desc: "Diagonal traveling spaceship",
    matrix: [
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1]
    ]
  },
  {
    name: "Gosper Glider Gun",
    desc: "Infinite glider generator stream",
    coords: [
      // Left 2x2 square
      [5, 1], [5, 2], [6, 1], [6, 2],
      // Left stator/rotor
      [5, 11], [6, 11], [7, 11], [4, 12], [8, 12], [3, 13], [9, 13], [3, 14], [9, 14],
      [6, 15], [4, 16], [8, 16], [5, 17], [6, 17], [7, 17], [6, 18],
      // Right mechanism
      [3, 21], [4, 21], [5, 21], [3, 22], [4, 22], [5, 22], [2, 23], [6, 23],
      [1, 25], [2, 25], [6, 25], [7, 25],
      // Right 2x2 square
      [3, 35], [4, 35], [3, 36], [4, 36]
    ]
  },
  {
    name: "Pulsar",
    desc: "Period 3 geometric cross oscillator",
    coords: (function () {
      const pts = [];
      const offsets = [1, 2, 3, 7, 8, 9];
      const fixed = [0, 5, 7, 12];
      for (const r of [0, 5, 7, 12]) {
        for (const c of offsets) pts.push([r, c]);
      }
      for (const c of fixed) {
        for (const r of offsets) pts.push([r, c]);
      }
      return pts;
    })()
  },
  {
    name: "Acorn",
    desc: "Methuselah: runs 5,206 generations, spawns 13 gliders",
    matrix: [
      [0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [1, 1, 0, 0, 1, 1, 1]
    ]
  },
  {
    name: "R-Pentomino",
    desc: "Small 5-cell seed evolving over 1,100 generations",
    matrix: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    name: "Pentadecathlon",
    desc: "Period 15 line oscillator",
    matrix: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    ]
  },
  {
    name: "LWSS",
    desc: "Lightweight horizontal spaceship",
    matrix: [
      [0, 1, 0, 0, 1],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 0]
    ]
  },
  {
    name: "Toad & Beacon",
    desc: "Classic dual period 2 oscillators",
    coords: [
      // Toad
      [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3],
      // Beacon
      [5, 8], [5, 9], [6, 8], [6, 9], [7, 10], [7, 11], [8, 10], [8, 11]
    ]
  }
];

// Set Grid Size (preserving existing center if possible)
export function setGridSize(newSize) {
  newSize = Math.max(16, Math.min(128, Math.round(Number(newSize) || 64)));
  if (newSize === gridSize && currentGrid.length === newSize * newSize) return;

  const oldSize = gridSize;
  const oldGrid = currentGrid;
  const oldSeed = seedGrid;

  gridSize = newSize;
  currentGrid = new Uint8Array(newSize * newSize);
  nextGrid = new Uint8Array(newSize * newSize);
  seedGrid = new Uint8Array(newSize * newSize);

  const offX = Math.floor((newSize - oldSize) / 2);
  const offY = Math.floor((newSize - oldSize) / 2);

  for (let y = 0; y < oldSize; y++) {
    for (let x = 0; x < oldSize; x++) {
      const nx = x + offX;
      const ny = y + offY;
      if (nx >= 0 && nx < newSize && ny >= 0 && ny < newSize) {
        const val = oldGrid[y * oldSize + x];
        currentGrid[ny * newSize + nx] = val;
        seedGrid[ny * newSize + nx] = oldSeed ? oldSeed[y * oldSize + x] : val;
      }
    }
  }

  generation = 0;
  countPopulation();
  redrawCaCanvas();
  updateHud();
}

// Count live cells
export function countPopulation() {
  let count = 0;
  for (let i = 0; i < currentGrid.length; i++) {
    if (currentGrid[i] > 0) count++;
  }
  population = count;
  return count;
}

// Step arbitrary Conway grid buffer: B3 / S23
export function stepGrid(src, dst, N, wrap = true) {
  let liveCount = 0;

  for (let y = 0; y < N; y++) {
    const ym1 = y === 0 ? (wrap ? N - 1 : -1) : y - 1;
    const yp1 = y === N - 1 ? (wrap ? 0 : -1) : y + 1;
    const rowMid = y * N;
    const rowTop = ym1 >= 0 ? ym1 * N : -1;
    const rowBot = yp1 >= 0 ? yp1 * N : -1;

    for (let x = 0; x < N; x++) {
      const xm1 = x === 0 ? (wrap ? N - 1 : -1) : x - 1;
      const xp1 = x === N - 1 ? (wrap ? 0 : -1) : x + 1;

      // Sum of 8 neighbors
      let k = 0;
      if (rowTop >= 0) {
        if (xm1 >= 0 && src[rowTop + xm1] > 0) k++;
        if (src[rowTop + x] > 0) k++;
        if (xp1 >= 0 && src[rowTop + xp1] > 0) k++;
      }
      if (xm1 >= 0 && src[rowMid + xm1] > 0) k++;
      if (xp1 >= 0 && src[rowMid + xp1] > 0) k++;
      if (rowBot >= 0) {
        if (xm1 >= 0 && src[rowBot + xm1] > 0) k++;
        if (src[rowBot + x] > 0) k++;
        if (xp1 >= 0 && src[rowBot + xp1] > 0) k++;
      }

      const idx = rowMid + x;
      const age = src[idx];
      let nextState = 0;

      if (age > 0) {
        // Survival rule: 2 or 3 neighbors
        if (k === 2 || k === 3) {
          nextState = age < 255 ? age + 1 : 255;
          liveCount++;
        }
      } else {
        // Birth rule: exactly 3 neighbors
        if (k === 3) {
          nextState = 1;
          liveCount++;
        }
      }
      dst[idx] = nextState;
    }
  }
  return liveCount;
}

// Conway's Game of Life Evolution Step (B3 / S23)
export function stepConway() {
  const isWrap = boundaryMode === "wrap";
  const liveCount = stepGrid(currentGrid, nextGrid, gridSize, isWrap);

  // Swap buffers
  const temp = currentGrid;
  currentGrid = nextGrid;
  nextGrid = temp;

  generation++;
  population = liveCount;
  return liveCount;
}

// Map a 2D Cell coordinate to Quantized Musical Note and Velocity
// X Axis: Pitch (Scale Quantized)
// Y Axis: Velocity (Top = Loud 120, Bottom = Soft 30)
export function mapCellToNote(cell, N) {
  if (!cell) return null;
  const scaleName = state.scale || state.caScale || "pentMinor";
  let scale = (scaleName === "custom" && (state.customScale || state.caCustomScale)) ? (state.customScale || state.caCustomScale) : (SCALES[scaleName] || SCALES.pentMinor);
  if (!scale || scale.length === 0) scale = [0];
  const root = typeof state.root === "number" ? state.root : (typeof state.caRoot === "number" ? state.caRoot : 48);
  const octaves = typeof state.pitchSpan === "number" ? state.pitchSpan : (typeof state.caOctaves === "number" ? state.caOctaves : 3);
  const minVel = typeof state.caMinVel === "number" ? state.caMinVel : 30;
  const maxVel = typeof state.caMaxVel === "number" ? state.caMaxVel : 120;

  // X Axis -> Pitch: quantize along scale degrees
  const normX = Math.max(0, Math.min(1, cell.x / Math.max(1, N - 1)));
  const rawPitch = root + normX * (octaves * 12);
  const quantStrength = ((state.quantSteps ?? state.caQuantSteps) ?? 100) / 100;
  const quantRng = mulberry32((cell.x * 2654435761 + cell.y * 2246822519) >>> 0);
  let note = Math.max(0, Math.min(127, quantize(rawPitch, scale, root, quantStrength, quantRng)));

  // Octave spread: Up (+12), Down (-12), or Both (±12)
  const octChance = ((state.octave ?? state.caOctave) ?? 0) / 100;
  if (octChance > 0) {
    const octRng = mulberry32((cell.x * 1597334677 + cell.y * 381204887 + generation * 65537) >>> 0);
    if (octRng() < octChance) {
      const mode = (state.octaveMode || state.caOctaveMode || "up").toLowerCase();
      let shift = 12;
      if (mode === "down") shift = -12;
      else if (mode === "both") shift = octRng() < 0.5 ? 12 : -12;
      if (note + shift >= 0 && note + shift <= 127) note += shift;
    }
  }

  // Y Axis -> Velocity: top (y = 0) is loud (maxVel), bottom (y = N-1) is soft (minVel)
  const normY = 1 - Math.max(0, Math.min(1, cell.y / Math.max(1, N - 1)));
  const vel = Math.max(1, Math.min(127, Math.round(minVel + normY * (maxVel - minVel))));

  return { note, vel, x: cell.x, y: cell.y };
}

// Cell Selection Rule Algorithm (Monophonic Picker)
export function pickCell(cells, rule = "closest", prevCell = null, grid = null, N = 64) {
  if (!cells || cells.length === 0) return null;
  if (cells.length === 1) return cells[0];

  const px = prevCell ? prevCell.x : Math.floor(N / 2);
  const py = prevCell ? prevCell.y : Math.floor(N / 2);

  switch (rule) {
    case "closest": {
      // Cell whose X (pitch) is closest to previous X (stepwise smooth voice-leading)
      let best = cells[0];
      let minDx = Math.abs(cells[0].x - px);
      let minD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const dx = Math.abs(c.x - px);
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (dx < minDx || (dx === minDx && d2 < minD2)) {
          best = c;
          minDx = dx;
          minD2 = d2;
        }
      }
      return best;
    }

    case "furthest": {
      // Cell whose X (pitch) is furthest from previous X (wide angular leaps)
      let best = cells[0];
      let maxDx = Math.abs(cells[0].x - px);
      let maxD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const dx = Math.abs(c.x - px);
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (dx > maxDx || (dx === maxDx && d2 > maxD2)) {
          best = c;
          maxDx = dx;
          maxD2 = d2;
        }
      }
      return best;
    }

    case "median": {
      // Cell whose X is closest to the median X of all active cells (harmonic center)
      const sorted = [...cells].sort((a, b) => a.x - b.x);
      const medianX = sorted[Math.floor(sorted.length / 2)].x;
      let best = cells[0];
      let minDiff = Math.abs(cells[0].x - medianX);
      let minD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const diff = Math.abs(c.x - medianX);
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (diff < minDiff || (diff === minDiff && d2 < minD2)) {
          best = c;
          minDiff = diff;
          minD2 = d2;
        }
      }
      return best;
    }

    case "lowest": {
      // Minimum X (lowest pitch / bass note)
      let best = cells[0];
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].x < best.x) best = cells[i];
      }
      return best;
    }

    case "highest": {
      // Maximum X (highest pitch / soprano note)
      let best = cells[0];
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].x > best.x) best = cells[i];
      }
      return best;
    }

    case "closest-vel": {
      // Cell whose Y (velocity) is closest to previous Y (smooth dynamic continuity)
      let best = cells[0];
      let minDy = Math.abs(cells[0].y - py);
      let minD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const dy = Math.abs(c.y - py);
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (dy < minDy || (dy === minDy && d2 < minD2)) {
          best = c;
          minDy = dy;
          minD2 = d2;
        }
      }
      return best;
    }

    case "furthest-vel": {
      // Cell whose Y (velocity) is furthest from previous Y (dynamic contrast)
      let best = cells[0];
      let maxDy = Math.abs(cells[0].y - py);
      let maxD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const dy = Math.abs(c.y - py);
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (dy > maxDy || (dy === maxDy && d2 > maxD2)) {
          best = c;
          maxDy = dy;
          maxD2 = d2;
        }
      }
      return best;
    }

    case "loudest": {
      // Minimum Y (top of grid = max velocity)
      let best = cells[0];
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].y < best.y) best = cells[i];
      }
      return best;
    }

    case "softest": {
      // Maximum Y (bottom of grid = min velocity)
      let best = cells[0];
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].y > best.y) best = cells[i];
      }
      return best;
    }

    case "closest-2d": {
      // Cell closest in Euclidean 2D distance to previous cell (tracks moving gliders)
      let best = cells[0];
      let minD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (d2 < minD2) {
          best = c;
          minD2 = d2;
        }
      }
      return best;
    }

    case "furthest-2d": {
      // Cell furthest in Euclidean 2D distance from previous cell (spatial leaps)
      let best = cells[0];
      let maxD2 = (cells[0].x - px) ** 2 + (cells[0].y - py) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (d2 > maxD2) {
          best = c;
          maxD2 = d2;
        }
      }
      return best;
    }

    case "centroid": {
      // Cell closest to collective center of mass
      let sumX = 0, sumY = 0;
      for (const c of cells) { sumX += c.x; sumY += c.y; }
      const cx = sumX / cells.length;
      const cy = sumY / cells.length;
      let best = cells[0];
      let minD2 = (cells[0].x - cx) ** 2 + (cells[0].y - cy) ** 2;
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const d2 = (c.x - cx) ** 2 + (c.y - cy) ** 2;
        if (d2 < minD2) {
          best = c;
          minD2 = d2;
        }
      }
      return best;
    }

    case "newborn": {
      // Prioritize cells born this generation (age === 1)
      const newborns = cells.filter((c) => c.age === 1);
      if (newborns.length > 0) {
        return pickCell(newborns, "closest", prevCell, grid, N);
      }
      return pickCell(cells, "closest", prevCell, grid, N);
    }

    case "oldest": {
      // Prioritize oldest cells (highest age / persistent still-lifes)
      let best = cells[0];
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].age > best.age) best = cells[i];
      }
      return best;
    }

    case "random": {
      return cells[Math.floor(Math.random() * cells.length)];
    }

    default:
      return cells[0];
  }
}

// Reset to initial user-drawn or stamped seed
export function resetToSeed() {
  currentGrid.set(seedGrid);
  generation = 0;
  prevCell = null;
  lastTriggeredNote = null;
  countPopulation();
  redrawCaCanvas();
  updateHud();
}

// Save current grid state as the new seed pattern
export function storeAsSeed() {
  seedGrid.set(currentGrid);
  generation = 0;
  status("Stored current pattern as seed ↺", "ok");
  updateHud();
}

// Clear all cells
export function clearGrid() {
  currentGrid.fill(0);
  seedGrid.fill(0);
  generation = 0;
  population = 0;
  prevCell = null;
  lastTriggeredNote = null;
  generateCaBank();
  redrawCaCanvas();
  updateHud();
  status("Grid cleared");
}

// Invert all cells
export function invertGrid() {
  for (let i = 0; i < currentGrid.length; i++) {
    currentGrid[i] = currentGrid[i] > 0 ? 0 : 1;
  }
  seedGrid.set(currentGrid);
  prevCell = null;
  lastTriggeredNote = null;
  countPopulation();
  generateCaBank();
  redrawCaCanvas();
  updateHud();
  status("Grid inverted");
}

// Helper: find connected components (8-connected groups) of active cells
function getConnectedGroups(grid, N) {
  const visited = new Uint8Array(N * N);
  const groups = [];

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const idx = y * N + x;
      if (grid[idx] === 0 || visited[idx]) continue;

      const queue = [idx];
      visited[idx] = 1;
      const cells = [];
      let minX = x, maxX = x, minY = y, maxY = y;

      let head = 0;
      while (head < queue.length) {
        const curIdx = queue[head++];
        const cx = curIdx % N;
        const cy = Math.floor(curIdx / N);
        cells.push(curIdx);

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
              const nidx = ny * N + nx;
              if (grid[nidx] > 0 && !visited[nidx]) {
                visited[nidx] = 1;
                queue.push(nidx);
              }
            }
          }
        }
      }

      groups.push({
        cells,
        minX, maxX, width: maxX - minX + 1,
        minY, maxY, height: maxY - minY + 1
      });
    }
  }

  return groups;
}

// Randomize cells respecting constraints:
// 1. Total active cells <= 5% of grid
// 2. Every active cell has at least 2 active neighbours vertically or horizontally
// 3. Every group of highlighted cells has width < 50% of grid width
export function randomizeGrid(density = 25) {
  const N = gridSize;
  const prng = mulberry32(state.seed ^ 0x6e657773);
  currentGrid.fill(0);

  const maxAllowedCells = Math.floor(0.05 * N * N);
  const maxGroupWidth = Math.max(2, Math.floor(0.5 * N) - 1); // Strictly less than 50%

  // Target budget: between 2% and 4.5% of grid (never exceeding maxAllowedCells)
  const minBudget = Math.max(4, Math.floor(0.02 * N * N));
  const maxBudget = Math.min(maxAllowedCells, Math.max(minBudget, Math.floor(0.045 * N * N)));
  const cellBudget = minBudget + Math.floor(prng() * (maxBudget - minBudget + 1));

  // Determine number of clusters based on N and budget
  let numClusters = 1;
  if (N >= 64) numClusters = 2 + Math.floor(prng() * 3); // 2 to 4 clusters
  else if (N >= 32) numClusters = 1 + Math.floor(prng() * 2); // 1 to 2 clusters
  else numClusters = 1;

  const perClusterBudget = Math.max(4, Math.floor(cellBudget / numClusters));
  const placedBoxes = [];

  for (let c = 0; c < numClusters; c++) {
    // Cluster bounding box: width strictly less than 50% grid width
    const maxBoxDim = Math.min(maxGroupWidth, Math.max(4, Math.floor(N * 0.35)));
    const boxW = Math.min(maxGroupWidth, 4 + Math.floor(prng() * Math.max(1, maxBoxDim - 3)));
    const boxH = Math.min(maxGroupWidth, 4 + Math.floor(prng() * Math.max(1, maxBoxDim - 3)));

    // Find position with at least 2 cells gap from other clusters and 1 cell border
    let placedX = -1, placedY = -1;
    for (let attempt = 0; attempt < 30; attempt++) {
      const tx = 1 + Math.floor(prng() * (N - boxW - 2));
      const ty = 1 + Math.floor(prng() * (N - boxH - 2));

      let collides = false;
      for (const b of placedBoxes) {
        if (
          tx < b.x + b.w + 2 &&
          tx + boxW + 2 > b.x &&
          ty < b.y + b.h + 2 &&
          ty + boxH + 2 > b.y
        ) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        placedX = tx;
        placedY = ty;
        break;
      }
    }

    if (placedX === -1) continue;
    placedBoxes.push({ x: placedX, y: placedY, w: boxW, h: boxH });

    // Build cluster shapes using union of 2x2 blocks or hollow frames
    const style = Math.floor(prng() * 4);
    const clusterCells = new Set();

    const addBlock = (bx, by) => {
      const clampedX = Math.max(placedX, Math.min(placedX + boxW - 2, bx));
      const clampedY = Math.max(placedY, Math.min(placedY + boxH - 2, by));
      clusterCells.add(clampedY * N + clampedX);
      clusterCells.add(clampedY * N + (clampedX + 1));
      clusterCells.add((clampedY + 1) * N + clampedX);
      clusterCells.add((clampedY + 1) * N + (clampedX + 1));
    };

    if (style === 0 && boxW >= 5 && boxH >= 5) {
      // Hollow 3x3 or 4x4 frame
      const frameDim = (prng() < 0.5 && boxW >= 6 && boxH >= 6) ? 4 : 3;
      const fx = placedX + Math.floor((boxW - frameDim) / 2);
      const fy = placedY + Math.floor((boxH - frameDim) / 2);
      for (let r = 0; r < frameDim; r++) {
        for (let col = 0; col < frameDim; col++) {
          if (r === 0 || r === frameDim - 1 || col === 0 || col === frameDim - 1) {
            clusterCells.add((fy + r) * N + (fx + col));
          }
        }
      }
      if (prng() < 0.5 && clusterCells.size + 4 <= perClusterBudget) {
        addBlock(fx - 1, fy - 1);
      }
    } else {
      // Organic union of 2x2 blocks
      let curX = placedX + Math.floor(prng() * Math.max(1, boxW - 2));
      let curY = placedY + Math.floor(prng() * Math.max(1, boxH - 2));
      addBlock(curX, curY);

      const targetStamps = 1 + Math.floor(perClusterBudget / 4);
      for (let s = 1; s < targetStamps && clusterCells.size < perClusterBudget; s++) {
        const dx = (Math.floor(prng() * 3) - 1);
        const dy = (Math.floor(prng() * 3) - 1);
        curX = Math.max(placedX, Math.min(placedX + boxW - 2, curX + dx));
        curY = Math.max(placedY, Math.min(placedY + boxH - 2, curY + dy));
        addBlock(curX, curY);
      }
    }

    for (const idx of clusterCells) {
      currentGrid[idx] = 1;
    }
  }

  // 1. Neighbor enforcement: Every active cell MUST have >= 2 active neighbours vertically or horizontally
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = y * N + x;
        if (currentGrid[idx] === 0) continue;
        let count = 0;
        if (y > 0 && currentGrid[(y - 1) * N + x] > 0) count++;
        if (y < N - 1 && currentGrid[(y + 1) * N + x] > 0) count++;
        if (x > 0 && currentGrid[y * N + (x - 1)] > 0) count++;
        if (x < N - 1 && currentGrid[y * N + (x + 1)] > 0) count++;
        if (count < 2) {
          currentGrid[idx] = 0;
          changed = true;
        }
      }
    }
  }

  // 2. Validate group width: Every connected group must be < 50% grid width
  const groups = getConnectedGroups(currentGrid, N);
  for (const g of groups) {
    if (g.width > maxGroupWidth) {
      for (const idx of g.cells) currentGrid[idx] = 0;
    }
  }

  // 3. Validate total active count <= 5%
  let totalActive = 0;
  for (let i = 0; i < currentGrid.length; i++) {
    if (currentGrid[i] > 0) totalActive++;
  }

  if (totalActive > maxAllowedCells) {
    const remaining = getConnectedGroups(currentGrid, N);
    remaining.sort((a, b) => b.cells.length - a.cells.length);
    while (totalActive > maxAllowedCells && remaining.length > 1) {
      const dropped = remaining.pop();
      for (const idx of dropped.cells) {
        currentGrid[idx] = 0;
        totalActive--;
      }
    }
  }

  // 4. Fallback if empty: place a single 2x2 block at center
  if (totalActive === 0) {
    const cx = Math.floor(N / 2) - 1;
    const cy = Math.floor(N / 2) - 1;
    currentGrid[cy * N + cx] = 1;
    currentGrid[cy * N + (cx + 1)] = 1;
    currentGrid[(cy + 1) * N + cx] = 1;
    currentGrid[(cy + 1) * N + (cx + 1)] = 1;
    totalActive = 4;
  }

  seedGrid.set(currentGrid);
  generation = 0;
  prevCell = null;
  lastTriggeredNote = null;
  countPopulation();
  generateCaBank();
  redrawCaCanvas();
  updateHud();

  const pct = ((totalActive / (N * N)) * 100).toFixed(1);
  status(`Randomized ${gridSize}×${gridSize} grid (${totalActive} cells · ${pct}%)`, "ok");
}

// Stamp or load a preset into the center of the grid
export function loadPreset(preset) {
  currentGrid.fill(0);
  const N = gridSize;

  if (preset.matrix) {
    const mRows = preset.matrix.length;
    const mCols = preset.matrix[0].length;
    const startY = Math.floor((N - mRows) / 2);
    const startX = Math.floor((N - mCols) / 2);

    for (let r = 0; r < mRows; r++) {
      for (let c = 0; c < mCols; c++) {
        if (preset.matrix[r][c]) {
          const y = (startY + r + N) % N;
          const x = (startX + c + N) % N;
          currentGrid[y * N + x] = 1;
        }
      }
    }
  } else if (preset.coords) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [r, c] of preset.coords) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    const h = maxR - minR + 1;
    const w = maxC - minC + 1;
    const startY = Math.floor((N - h) / 2) - minR;
    const startX = Math.floor((N - w) / 2) - minC;

    for (const [r, c] of preset.coords) {
      const y = (r + startY + N) % N;
      const x = (c + startX + N) % N;
      currentGrid[y * N + x] = 1;
    }
  }

  seedGrid.set(currentGrid);
  generation = 0;
  prevCell = null;
  lastTriggeredNote = null;
  countPopulation();
  generateCaBank();
  redrawCaCanvas();
  updateHud();
  status(`Loaded Life preset: ${preset.name}`, "ok");
}

// Stamp default pattern on startup (e.g. Glider Gun on 64+, or Glider + Pulsar on smaller)
function setupDefaultPattern() {
  if (gridSize >= 48) {
    const gun = LIFE_PRESETS.find((p) => p.name === "Gosper Glider Gun");
    if (gun) loadPreset(gun);
  } else {
    const glider = LIFE_PRESETS.find((p) => p.name === "Glider");
    if (glider) loadPreset(glider);
  }
}

// Paint cells at (x, y) with current brush size
function paintCell(cx, cy, val) {
  const N = gridSize;
  const r = brushSize - 1;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dy === 0 && dx === 0 ? null : null, dx++) {
      let x = cx + dx;
      let y = cy + dy;
      if (boundaryMode === "wrap") {
        x = (x + N) % N;
        y = (y + N) % N;
      } else {
        if (x < 0 || x >= N || y < 0 || y >= N) continue;
      }
      currentGrid[y * N + x] = val ? 1 : 0;
    }
  }
}

// RENDER 2D GAME OF LIFE CANVAS
export function renderCaCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const displayW = Math.floor(rect.width);
  const displayH = Math.floor(rect.height);

  if (displayW <= 0 || displayH <= 0) return;

  const targetW = Math.floor(displayW * dpr);
  const targetH = Math.floor(displayH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Theme detection
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const bgCol = isLight ? "#f8fafc" : "#0a0f1d";
  const gridLineCol = isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.04)";
  const majorLineCol = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.09)";

  // Live cell colors: Newborn vs Mature vs Ancient
  const newbornCol = isLight ? "#2563eb" : "#38bdf8"; // Bright sky blue / royal blue
  const matureCol = isLight ? "#4f46e5" : "#818cf8";  // Indigo
  const ancientCol = isLight ? "#7c3aed" : "#c084fc"; // Violet / Purple

  ctx.fillStyle = bgCol;
  ctx.fillRect(0, 0, displayW, displayH);

  const N = gridSize;
  const cellW = displayW / N;
  const cellH = displayH / N;

  // Draw Grid Lines (subtle, if cell size is large enough)
  if (cellW >= 4) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridLineCol;
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      const isMajor = i % 8 === 0 || i % 16 === 0;
      if (isMajor) continue;
      const x = Math.floor(i * cellW) + 0.5;
      const y = Math.floor(i * cellH) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, displayH);
      ctx.moveTo(0, y);
      ctx.lineTo(displayW, y);
    }
    ctx.stroke();

    // Major grid lines every 8 or 16 cells
    ctx.strokeStyle = majorLineCol;
    ctx.beginPath();
    for (let i = 8; i < N; i += 8) {
      const x = Math.floor(i * cellW) + 0.5;
      const y = Math.floor(i * cellH) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, displayH);
      ctx.moveTo(0, y);
      ctx.lineTo(displayW, y);
    }
    ctx.stroke();
  }

  // Draw Live Cells
  const inset = cellW >= 6 ? 0.6 : 0;
  for (let y = 0; y < N; y++) {
    const rowIdx = y * N;
    const cy = y * cellH;
    for (let x = 0; x < N; x++) {
      const age = currentGrid[rowIdx + x];
      if (age > 0) {
        if (age === 1) {
          ctx.fillStyle = newbornCol;
        } else if (age < 8) {
          ctx.fillStyle = matureCol;
        } else {
          ctx.fillStyle = ancientCol;
        }

        const cx = x * cellW;
        if (cellW >= 7) {
          // Rounded cell rect
          const rw = cellW - inset * 2;
          const rh = cellH - inset * 2;
          const rad = Math.min(2, rw / 4);
          ctx.beginPath();
          ctx.roundRect(cx + inset, cy + inset, rw, rh, rad);
          ctx.fill();
        } else {
          ctx.fillRect(cx + inset, cy + inset, cellW - inset * 2, cellH - inset * 2);
        }
      }
    }
  }

  // Draw Crosshairs and Highlight for Active Triggered Note (X = Pitch, Y = Velocity)
  if (lastTriggeredNote && lastTriggeredNote.x >= 0 && lastTriggeredNote.x < N && lastTriggeredNote.y >= 0 && lastTriggeredNote.y < N) {
    const tx = lastTriggeredNote.x;
    const ty = lastTriggeredNote.y;
    const tcx = tx * cellW;
    const tcy = ty * cellH;

    // Pitch Column Highlight (X Axis)
    ctx.fillStyle = isLight ? "rgba(37, 99, 235, 0.14)" : "rgba(56, 189, 248, 0.18)";
    ctx.fillRect(tcx, 0, cellW, displayH);

    // Velocity Row Highlight (Y Axis)
    ctx.fillStyle = isLight ? "rgba(245, 158, 11, 0.14)" : "rgba(251, 191, 36, 0.18)";
    ctx.fillRect(0, tcy, displayW, cellH);

    // Active Triggered Cell Box
    ctx.fillStyle = "#f59e0b"; // Vibrant Amber
    ctx.fillRect(tcx, tcy, cellW, cellH);

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, Math.min(3, cellW * 0.25));
    ctx.strokeRect(tcx - 0.5, tcy - 0.5, cellW + 1, cellH + 1);

    // Outer Target Rings if cells are large enough
    if (cellW >= 8) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tcx - 3, tcy - 3, cellW + 6, cellH + 6);
    }
  }

  // Hover Cell Indicator
  if (hoverCell && hoverCell.x >= 0 && hoverCell.x < N && hoverCell.y >= 0 && hoverCell.y < N) {
    ctx.strokeStyle = isLight ? "#2563eb" : "#38bdf8";
    ctx.lineWidth = 1.5;
    const r = brushSize - 1;
    const hx = (hoverCell.x - r) * cellW;
    const hy = (hoverCell.y - r) * cellH;
    const hw = (r * 2 + 1) * cellW;
    const hh = (r * 2 + 1) * cellH;
    ctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);
  }

  ctx.restore();
}

export function redrawCaCanvas() {
  const canvas = document.getElementById("ca-canvas");
  if (canvas) renderCaCanvas(canvas);
}

// UPDATE HUD & HEADER INFO
export function updateHud() {
  const genEl = document.getElementById("ca-hud-gen");
  const popEl = document.getElementById("ca-hud-pop");
  const sizeEl = document.getElementById("ca-hud-size");
  const modeEl = document.getElementById("ca-hud-mode");
  const statusEl = document.getElementById("ca-hud-status");
  const noteEl = document.getElementById("ca-hud-note");
  const velEl = document.getElementById("ca-hud-vel");
  const footerNoteEl = document.getElementById("ca-step-hover");

  if (genEl) genEl.textContent = String(generation);
  if (popEl) {
    const total = gridSize * gridSize;
    const pct = ((population / total) * 100).toFixed(1);
    popEl.textContent = `${population} cells (${pct}%)`;
  }
  if (sizeEl) sizeEl.textContent = `${gridSize} × ${gridSize}`;
  if (modeEl) {
    const loopLen = Math.max(1, Math.min(64, state.length || 64));
    modeEl.textContent = loopMode === "loop" ? `Loop (${loopLen} steps)` : "Free Run (Continuous)";
  }
  if (statusEl) {
    const running = isLive();
    statusEl.textContent = running ? "▶ RUNNING" : "■ STOPPED";
    statusEl.style.color = running ? "var(--accent)" : "var(--dim)";
  }
  if (noteEl) {
    if (lastTriggeredNote) {
      const name = midiName(lastTriggeredNote.note);
      noteEl.textContent = `${name} (${lastTriggeredNote.note})`;
    } else {
      noteEl.textContent = isLive() ? "Rest" : "—";
    }
  }
  if (velEl) {
    if (lastTriggeredNote) {
      velEl.textContent = String(lastTriggeredNote.vel);
    } else {
      velEl.textContent = "—";
    }
  }
  if (footerNoteEl && !hoverCell) {
    if (lastTriggeredNote) {
      const name = midiName(lastTriggeredNote.note);
      const scaleName = SCALE_LABELS[state.caScale] || state.caScale || "Scale";
      footerNoteEl.textContent = `Active Note: ${name} (${lastTriggeredNote.note}) · Velocity: ${lastTriggeredNote.vel} · Cell (${lastTriggeredNote.x}, ${lastTriggeredNote.y}) · [${scaleName}]`;
    } else {
      footerNoteEl.textContent = isLive() ? "Rest (no live cells)" : "—";
    }
  }
}

// WIRE CANVAS MOUSE & TOUCH INTERACTIONS
function wireCanvasEvents(canvas) {
  if (!canvas) return;

  const getCellCoords = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) return null;
    const col = Math.floor((x / rect.width) * gridSize);
    const row = Math.floor((y / rect.height) * gridSize);
    return {
      x: Math.max(0, Math.min(gridSize - 1, col)),
      y: Math.max(0, Math.min(gridSize - 1, row))
    };
  };

  const handlePointerDown = (clientX, clientY) => {
    const c = getCellCoords(clientX, clientY);
    if (!c) return;
    isPointerDown = true;

    if (activeTool === "eraser") {
      drawValue = 0;
    } else {
      // Toggle mode: if target is currently alive, erase; if dead, draw
      const curr = currentGrid[c.y * gridSize + c.x];
      drawValue = curr > 0 ? 0 : 1;
    }

    paintCell(c.x, c.y, drawValue);
    seedGrid.set(currentGrid); // Update seed so looping uses latest drawn state
    countPopulation();
    redrawCaCanvas();
    updateHud();
  };

  const handlePointerMove = (clientX, clientY) => {
    const c = getCellCoords(clientX, clientY);
    hoverCell = c;

    if (isPointerDown && c) {
      paintCell(c.x, c.y, drawValue);
      countPopulation();
      redrawCaCanvas();
      updateHud();
    } else {
      redrawCaCanvas();
    }
  };

  const handlePointerUp = () => {
    if (isPointerDown) {
      isPointerDown = false;
      seedGrid.set(currentGrid);
      countPopulation();
      updateHud();
    }
  };

  // Mouse Listeners
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.button === 2) {
      // Right click erases
      drawValue = 0;
    }
    handlePointerDown(e.clientX, e.clientY);
  });

  canvas.addEventListener("mousemove", (e) => {
    handlePointerMove(e.clientX, e.clientY);
  });

  window.addEventListener("mouseup", () => {
    handlePointerUp();
  });

  canvas.addEventListener("mouseleave", () => {
    hoverCell = null;
    if (isPointerDown) {
      isPointerDown = false;
      seedGrid.set(currentGrid);
    }
    redrawCaCanvas();
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // Prevent right-click context menu when drawing
  });

  // Touch Listeners
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    handlePointerUp();
  });

  // Resize listener
  window.addEventListener("resize", () => {
    redrawCaCanvas();
  });
}


// BUILD CELLULAR AUTOMATA UI
export function buildCellularPanel(container) {
  container.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "ca-layout";

  // LEFT COLUMN: Controls & Presets
  const module = document.createElement("div");
  module.className = "ca-module";

  // 1. GRID DIMENSIONS & BOUNDARY
  const gridSect = document.createElement("section");
  gridSect.className = "sect ca-sect";
  gridSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Grid Dimensions</h3>
      <span class="ca-rule-badge" id="ca-badge-dim">${gridSize}×${gridSize}</span>
    </div>
  `;

  const gridForm = document.createElement("div");
  gridForm.className = "ca-grid-2col";
  gridForm.append(
    R("caGridSize", dropdown({
      label: "Grid Size",
      options: GRID_SIZES.map((sz) => ({
        v: String(sz),
        t: sz === 64 ? `${sz} × ${sz} (Default)` : `${sz} × ${sz}`
      })),
      value: String(gridSize),
      onInput: (v) => {
        const sz = Number(v) || 64;
        setGridSize(sz);
        const badge = document.getElementById("ca-badge-dim");
        if (badge) badge.textContent = `${sz}×${sz}`;
        status(`Grid resized to ${sz}×${sz}`);
      },
      tip: "Grid resolution. Defaults to 64x64."
    })),
    R("caBoundaryMode", dropdown({
      label: "Boundary",
      options: [
        { v: "wrap", t: "Torus (Wrap)" },
        { v: "wall", t: "Wall (Zero Border)" }
      ],
      value: boundaryMode,
      onInput: (v) => {
        boundaryMode = v;
        status(`Boundary: ${v === "wrap" ? "Torus Wrap" : "Wall"}`);
      },
      tip: "Edge behavior when cells travel beyond grid boundaries."
    }))
  );
  gridSect.appendChild(gridForm);

  // 2. EVOLUTION & SEED CONTROLS
  const evoSect = document.createElement("section");
  evoSect.className = "sect ca-sect";
  evoSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Evolution & Seed</h3>
      <span class="ca-rule-badge">Conway B3/S23</span>
    </div>
  `;

  const transportRow = document.createElement("div");
  transportRow.className = "ca-transport-row";

  const resetBtn = document.createElement("button");
  resetBtn.className = "ca-transport-btn";
  resetBtn.textContent = "↺ Reset Seed";
  resetBtn.title = "Revert to initial user-drawn pattern";
  resetBtn.addEventListener("click", () => {
    resetToSeed();
    status("Reverted to initial seed pattern");
  });

  const storeBtn = document.createElement("button");
  storeBtn.className = "ca-transport-btn";
  storeBtn.textContent = "📌 Store Seed";
  storeBtn.title = "Snapshot current generation as loop seed";
  storeBtn.addEventListener("click", () => {
    storeAsSeed();
  });

  const clearBtn = document.createElement("button");
  clearBtn.className = "ca-transport-btn";
  clearBtn.textContent = "✕ Clear Grid";
  clearBtn.title = "Clear all living cells from the grid";
  clearBtn.addEventListener("click", () => {
    clearGrid();
  });

  transportRow.append(resetBtn, storeBtn, clearBtn);

  const loopWrap = document.createElement("div");
  loopWrap.className = "ca-loop-mode-wrap";
  loopWrap.append(
    R("caLoopMode", dropdown({
      label: "Cycle Mode",
      options: [
        { v: "loop", t: "Loop (Reset at Length)" },
        { v: "free", t: "Free Run (Continuous)" }
      ],
      value: loopMode,
      onInput: (v) => {
        loopMode = v;
        updateHud();
        status(`Cycle mode: ${v === "loop" ? "Loop cycle" : "Free run"}`);
      },
      tip: "Loop mode resets to initial pattern every sequence length (set by global LENGTH knob). Free run evolves forever."
    }))
  );

  evoSect.append(transportRow, loopWrap);

  // 3. CELL TRIGGERING & PITCH SPAN
  const triggerSect = document.createElement("section");
  triggerSect.className = "sect ca-sect";
  triggerSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Cell Triggering</h3>
      <span class="ca-rule-badge">X: Pitch · Y: Vel</span>
    </div>
  `;

  const triggerControls = document.createElement("div");
  triggerControls.className = "ca-grid-2col";

  const ruleCtrl = R("caNoteRule", dropdown({
    label: "Cell Picker Rule",
    options: NOTE_RULES.map((r) => ({ v: r.v, t: r.t })),
    value: state.caNoteRule || "closest",
    onInput: (v) => {
      state.caNoteRule = v;
      const sel = NOTE_RULES.find((r) => r.v === v);
      generateCaBank();
      status(`Note Rule: ${sel ? sel.t : v}`);
    },
    tip: "Rule governing which live cell triggers a note at each step. Choose Pitch (X), Velocity (Y), or 2D Spatial/Morphological rules."
  }));
  ruleCtrl.classList.add("ca-span-full");

  triggerControls.append(ruleCtrl);
  triggerSect.append(triggerControls);

  // 4. PRESET PATTERNS LIBRARY
  const presetSect = document.createElement("section");
  presetSect.className = "sect ca-sect";
  presetSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Classic Life Presets</h3>
      <span class="ca-hint-inline">1-Click Stamp</span>
    </div>
  `;

  const presetList = document.createElement("div");
  presetList.className = "ca-preset-grid";

  LIFE_PRESETS.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "ca-preset-btn";
    btn.textContent = p.name;
    btn.title = `${p.name}: ${p.desc}`;
    btn.addEventListener("click", () => {
      loadPreset(p);
    });
    presetList.appendChild(btn);
  });

  presetSect.appendChild(presetList);

  module.append(gridSect, evoSect, triggerSect, presetSect);

  // RIGHT COLUMN: 2D GAME OF LIFE SQUARE CANVAS & HUD
  const display = document.createElement("div");
  display.className = "display ca-display";

  display.innerHTML = `
    <div class="ca-display-header">
      <div class="ca-hud-bar">
        <div class="ca-hud-item"><span class="ca-hud-lbl">GEN</span><b id="ca-hud-gen" class="ca-hud-val">0</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">POP</span><b id="ca-hud-pop" class="ca-hud-val">0 cells</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">GRID</span><b id="ca-hud-size" class="ca-hud-val">${gridSize} × ${gridSize}</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">NOTE (X)</span><b id="ca-hud-note" class="ca-hud-val ca-hud-highlight">—</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">VEL (Y)</span><b id="ca-hud-vel" class="ca-hud-val ca-hud-highlight">—</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">CYCLE</span><b id="ca-hud-mode" class="ca-hud-val">Loop (64 steps)</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">STATUS</span><b id="ca-hud-status" class="ca-hud-val">■ STOPPED</b></div>
      </div>
    </div>
    <div class="ca-canvas-wrap">
      <canvas id="ca-canvas" class="ca-canvas"></canvas>
    </div>
    <div class="ca-display-footer">
      <span class="ca-hint">💡 X: Pitch (Scale Quantized) · Y: Velocity · Click/Drag to draw · Global Play (Spacebar) to step</span>
      <span id="ca-step-hover" class="ca-step-hover">—</span>
    </div>
  `;

  layout.append(module, display);
  container.appendChild(layout);

  // Initialize Canvas
  const canvas = document.getElementById("ca-canvas");
  if (canvas) {
    wireCanvasEvents(canvas);
    setupDefaultPattern();
    generateCaBank();
    redrawCaCanvas();
    updateHud();
  }
}

// Generate Bank of 16 Patterns for SysEx / Player compatibility
export function generateCaBank() {
  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  let rateIdx = typeof state.rate === "number" ? state.rate : RATE_NAMES.indexOf(state.rate);
  if (rateIdx < 0 || rateIdx >= RATE_QUARTERS.length) rateIdx = 6;
  const tempo = state.tempo || 120;
  const N = gridSize;
  const rule = state.caNoteRule || "closest";
  const isWrap = boundaryMode === "wrap";

  // Pre-simulate pattern from seedGrid to compute notes for each step
  const simGrid = new Uint8Array(seedGrid);
  const simNext = new Uint8Array(seedGrid.length);
  let pCell = null;
  const precomputedSteps = [];

  for (let i = 0; i < seqLen; i++) {
    // 1. Gather active cells
    const liveCells = [];
    for (let y = 0; y < N; y++) {
      const rowIdx = y * N;
      for (let x = 0; x < N; x++) {
        const age = simGrid[rowIdx + x];
        if (age > 0) liveCells.push({ x, y, age });
      }
    }

    // 2. Pick cell and map to note
    const picked = pickCell(liveCells, rule, pCell, simGrid, N);
    let stepNotes = [];
    if (picked) {
      pCell = { x: picked.x, y: picked.y };
      const mapped = mapCellToNote(picked, N);
      if (mapped) stepNotes = [{ note: mapped.note, vel: mapped.vel }];
    }

    precomputedSteps.push({
      notes: stepNotes,
      rate: rateIdx,
      gate: state.gate ?? 50
    });

    // 3. Advance simulation 1 step
    stepGrid(simGrid, simNext, N, isWrap);
    simGrid.set(simNext);
  }

  const curBank = getBank();
  const existingSteps = curBank?.[0]?.steps;
  const hasExistingRhythm = existingSteps && existingSteps.length > 0;

  const steps = precomputedSteps.map((st, i) => {
    const simNote = st.notes.length > 0 ? { ...st.notes[0] } : null;
    const isStepActive = hasExistingRhythm
      ? (existingSteps[i]?.notes && existingSteps[i].notes.length > 0)
      : (simNote !== null);

    const savedNote = simNote || existingSteps?.[i]?._savedNote || null;

    return {
      notes: (isStepActive && savedNote) ? [{ ...savedNote }] : [],
      _savedNote: savedNote ? { ...savedNote } : null,
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
    gridSize: gridSize
  }];
  setBank(bank);
  syncRhythmGrid();
  return bank;
}

// Randomize active CA configuration and rhythm
export function randomizeCa() {
  state.seed = (Math.random() * 1e9) | 0;
  if (refs.seed?.setValue) refs.seed.setValue(state.seed, false);
  randomizeGrid(state.caDensity ?? 25);
  randomizeRhythm();
  status(`Randomized Cellular Automata pattern & Rhythm · seed ${state.seed >>> 0}`, "ok");
}

// INITIALIZATION
export function initCellular() {
  const container = document.getElementById("model-cellular");
  if (!container) return;
  buildCellularPanel(container);

  // Hook step clock advancement from live transport loop
  onStep((stepIndex) => {
    if (stepIndex === null) {
      lastTriggeredNote = null;
      redrawCaCanvas();
      updateHud();
      return;
    }
    if (getActiveModel && getActiveModel() !== "cellular") return;
    const modelEl = document.getElementById("model-cellular");
    if (!modelEl || modelEl.style.display === "none") return;

    // Check loop mode: reset to seed when wrapping around
    if (loopMode === "loop") {
      const loopLen = Math.max(1, Math.min(64, state.length || 64));
      if (stepIndex === 0 && generation > 0) {
        resetToSeed();
      }
    }

    // 1. Collect all live cells from currentGrid
    const N = gridSize;
    const liveCells = [];
    for (let y = 0; y < N; y++) {
      const rowIdx = y * N;
      for (let x = 0; x < N; x++) {
        const age = currentGrid[rowIdx + x];
        if (age > 0) liveCells.push({ x, y, age });
      }
    }

    // 2. Pick cell using active rule
    const rule = state.caNoteRule || "closest";
    const picked = pickCell(liveCells, rule, prevCell, currentGrid, N);

    const bank = getBank();
    const curP = bank[getSelected()];
    const st = curP?.steps?.[stepIndex];
    const isRhythmActive = st && st.notes && st.notes.length > 0;

    if (picked) {
      prevCell = { x: picked.x, y: picked.y };
      const mapped = mapCellToNote(picked, N);
      if (st) {
        st._savedNote = { note: mapped.note, vel: mapped.vel };
        if (isRhythmActive) {
          lastTriggeredNote = mapped;
          st.notes = [{ note: mapped.note, vel: mapped.vel }];
        } else {
          lastTriggeredNote = null;
          st.notes = [];
        }
      }
    } else {
      lastTriggeredNote = null;
      if (st) {
        st.notes = [];
      }
    }

    // 3. Step 1 generation of Conway's Game of Life
    stepConway();
    redrawCaCanvas();
    updateHud();
  });

  // Hook bank regenerations
  onRegen(() => {
    if (container.style.display !== "none") {
      updateHud();
      redrawCaCanvas();
    }
  });

  // Watch for theme changes (Dark / Light) to instantly update canvas colors
  const themeObserver = new MutationObserver(() => {
    if (container.style.display !== "none") {
      redrawCaCanvas();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

// When activating Cellular Automata Model
export function activateCellularModel() {
  setSelected(0);
  setModelGenerator(generateCaBank);
  setModelRandomizer(randomizeCa);
  if (state.rate === undefined) state.rate = 6;
  if (refs.rate) refs.rate.setValue(state.rate);
  doGenerate(false);
  syncRhythmGrid();
  redrawCaCanvas();
  updateHud();
}

// When deactivating Cellular Automata Model
export function deactivateCellularModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
}
