// cellular.js — 2D Conway's Game of Life Cellular Automata Sequencer Model.
// Inspired by Reaktor's Newscool: resizable square grid (defaults to 64x64),
// interactive cell drawing, Conway's B3/S23 evolution, and real-time generation updates.

import { mulberry32 } from "./generator.js?v=100";
import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js?v=104";
import { fader, dropdown, actionBtn } from "./controls.js?v=104";
import { onStep, isLive, toggleLive } from "./player.js?v=104";

// Grid sizes supported
export const GRID_SIZES = [16, 32, 48, 64, 80, 96, 128];
export const DEFAULT_GRID_SIZE = 64;

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

// Conway's Game of Life Evolution Step (B3 / S23)
export function stepConway() {
  const N = gridSize;
  const isWrap = boundaryMode === "wrap";
  let liveCount = 0;

  for (let y = 0; y < N; y++) {
    const ym1 = y === 0 ? (isWrap ? N - 1 : -1) : y - 1;
    const yp1 = y === N - 1 ? (isWrap ? 0 : -1) : y + 1;
    const rowMid = y * N;
    const rowTop = ym1 >= 0 ? ym1 * N : -1;
    const rowBot = yp1 >= 0 ? yp1 * N : -1;

    for (let x = 0; x < N; x++) {
      const xm1 = x === 0 ? (isWrap ? N - 1 : -1) : x - 1;
      const xp1 = x === N - 1 ? (isWrap ? 0 : -1) : x + 1;

      // Sum of 8 neighbors
      let k = 0;
      if (rowTop >= 0) {
        if (xm1 >= 0 && currentGrid[rowTop + xm1] > 0) k++;
        if (currentGrid[rowTop + x] > 0) k++;
        if (xp1 >= 0 && currentGrid[rowTop + xp1] > 0) k++;
      }
      if (xm1 >= 0 && currentGrid[rowMid + xm1] > 0) k++;
      if (xp1 >= 0 && currentGrid[rowMid + xp1] > 0) k++;
      if (rowBot >= 0) {
        if (xm1 >= 0 && currentGrid[rowBot + xm1] > 0) k++;
        if (currentGrid[rowBot + x] > 0) k++;
        if (xp1 >= 0 && currentGrid[rowBot + xp1] > 0) k++;
      }

      const idx = rowMid + x;
      const age = currentGrid[idx];
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
      nextGrid[idx] = nextState;
    }
  }

  // Swap buffers
  const temp = currentGrid;
  currentGrid = nextGrid;
  nextGrid = temp;

  generation++;
  population = liveCount;
}

// Reset to initial user-drawn or stamped seed
export function resetToSeed() {
  currentGrid.set(seedGrid);
  generation = 0;
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
  countPopulation();
  redrawCaCanvas();
  updateHud();
  status("Grid inverted");
}

// Randomize cells (soup) using Seed and density
export function randomizeGrid(density = 25) {
  const prng = mulberry32(state.seed ^ 0x6e657773);
  const prob = Math.max(0.05, Math.min(0.85, (density || 25) / 100));
  for (let i = 0; i < currentGrid.length; i++) {
    currentGrid[i] = prng() < prob ? 1 : 0;
  }
  seedGrid.set(currentGrid);
  generation = 0;
  countPopulation();
  redrawCaCanvas();
  updateHud();
  status(`Randomized ${gridSize}×${gridSize} grid (${Math.round(prob * 100)}% density)`, "ok");
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
  countPopulation();
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
  const runBtn = document.getElementById("ca-run-btn");

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
  if (runBtn) {
    const playing = isLive();
    runBtn.textContent = playing ? "■ Pause" : "▶ Run";
    if (playing) {
      runBtn.classList.add("running");
    } else {
      runBtn.classList.remove("running");
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

  // 2. DRAW & EDIT TOOLS
  const drawSect = document.createElement("section");
  drawSect.className = "sect ca-sect";
  drawSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Draw & Edit Tools</h3>
      <span class="ca-hint-inline">Click & drag to paint</span>
    </div>
  `;

  const toolsWrap = document.createElement("div");
  toolsWrap.className = "ca-tools-bar";

  const penBtn = document.createElement("button");
  penBtn.className = `ca-tool-btn ${activeTool === "pen" ? "active" : ""}`;
  penBtn.innerHTML = `✏️ Pen`;
  penBtn.title = "Pen: Draw live cells (drag to paint, click alive to erase)";
  penBtn.addEventListener("click", () => {
    activeTool = "pen";
    penBtn.classList.add("active");
    eraserBtn.classList.remove("active");
  });

  const eraserBtn = document.createElement("button");
  eraserBtn.className = `ca-tool-btn ${activeTool === "eraser" ? "active" : ""}`;
  eraserBtn.innerHTML = `🧹 Eraser`;
  eraserBtn.title = "Eraser: Drag to clear cells";
  eraserBtn.addEventListener("click", () => {
    activeTool = "eraser";
    eraserBtn.classList.add("active");
    penBtn.classList.remove("active");
  });

  const brushWrap = document.createElement("div");
  brushWrap.className = "ca-brush-sizes";
  [1, 2, 3].forEach((b) => {
    const bBtn = document.createElement("button");
    bBtn.className = `ca-brush-btn ${brushSize === b ? "active" : ""}`;
    bBtn.textContent = `${b}px`;
    bBtn.title = `Brush width: ${b} cell${b > 1 ? "s" : ""}`;
    bBtn.addEventListener("click", () => {
      brushSize = b;
      brushWrap.querySelectorAll(".ca-brush-btn").forEach((el) => el.classList.remove("active"));
      bBtn.classList.add("active");
    });
    brushWrap.appendChild(bBtn);
  });

  toolsWrap.append(penBtn, eraserBtn, brushWrap);

  const editActions = document.createElement("div");
  editActions.className = "ca-edit-actions";
  editActions.append(
    actionBtn("Clear", () => clearGrid(), "Clear all cells"),
    actionBtn("Invert", () => invertGrid(), "Invert all cells"),
    actionBtn("Randomize", () => randomizeGrid(state.caDensity ?? 25), "Spawn random soup"),
    R("caSoupDensity", fader({
      label: "Soup %", min: 10, max: 60, value: state.caDensity ?? 25, def: 25,
      format: (v) => `${Math.round(v)}%`,
      onInput: setState("caDensity"),
      tip: "Live cell probability density when randomizing."
    }))
  );

  drawSect.append(toolsWrap, editActions);

  // 3. EVOLUTION & TRANSPORT CONTROLS
  const evoSect = document.createElement("section");
  evoSect.className = "sect ca-sect";
  evoSect.innerHTML = `
    <div class="ca-sect-head">
      <h3>Evolution & Transport</h3>
      <span class="ca-rule-badge">Conway B3/S23</span>
    </div>
  `;

  const transportRow = document.createElement("div");
  transportRow.className = "ca-transport-row";

  const runBtn = document.createElement("button");
  runBtn.id = "ca-run-btn";
  runBtn.className = "ca-transport-btn ca-run-btn";
  runBtn.textContent = isLive() ? "■ Pause" : "▶ Run";
  runBtn.title = "Start/Stop Conway evolution (synchronized with Global Transport)";
  runBtn.addEventListener("click", () => {
    toggleLive();
    updateHud();
  });

  const stepBtn = document.createElement("button");
  stepBtn.className = "ca-transport-btn";
  stepBtn.textContent = "▶| Step";
  stepBtn.title = "Advance by 1 generation manually";
  stepBtn.addEventListener("click", () => {
    stepConway();
    redrawCaCanvas();
    updateHud();
    status(`Advanced to Generation ${generation}`);
  });

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

  transportRow.append(runBtn, stepBtn, resetBtn, storeBtn);

  const loopModeWrap = document.createElement("div");
  loopModeWrap.className = "ca-loop-mode-wrap";
  loopModeWrap.append(
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

  evoSect.append(transportRow, loopModeWrap);

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

  module.append(gridSect, drawSect, evoSect, presetSect);

  // RIGHT COLUMN: 2D GAME OF LIFE SQUARE CANVAS & HUD
  const display = document.createElement("div");
  display.className = "display ca-display";

  display.innerHTML = `
    <div class="ca-display-header">
      <div class="ca-hud-bar">
        <div class="ca-hud-item"><span class="ca-hud-lbl">GEN</span><b id="ca-hud-gen" class="ca-hud-val">0</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">POPULATION</span><b id="ca-hud-pop" class="ca-hud-val">0 cells</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">GRID</span><b id="ca-hud-size" class="ca-hud-val">${gridSize} × ${gridSize}</b></div>
        <div class="ca-hud-item"><span class="ca-hud-lbl">MODE</span><b id="ca-hud-mode" class="ca-hud-val">Loop (64 steps)</b></div>
      </div>
    </div>
    <div class="ca-canvas-wrap">
      <canvas id="ca-canvas" class="ca-canvas"></canvas>
    </div>
    <div class="ca-display-footer">
      <span class="ca-hint">💡 Click & drag to draw cells · Right-click or Eraser to erase · Spacebar to Run/Pause</span>
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
    redrawCaCanvas();
    updateHud();
  }
}

// Generate Bank of 16 Patterns for SysEx / Player compatibility
export function generateCaBank() {
  const bank = [];
  const seqLen = Math.max(1, Math.min(64, state.length || 64));
  const rate = state.rate || "1/16";
  const tempo = state.tempo || 120;

  for (let s = 0; s < 16; s++) {
    const steps = [];
    for (let i = 0; i < seqLen; i++) {
      steps.push({
        notes: [], // Visual sequence focus first; note rules will be added in follow-up step
        rate: rate,
        gate: state.gate ?? 50
      });
    }
    bank.push({
      length: seqLen,
      rate: rate,
      tempo: tempo,
      gate: state.gate ?? 50,
      swing: state.swing ?? 50,
      steps: steps,
      gridSize: gridSize
    });
  }
  setBank(bank);
  return bank;
}

// Randomize active CA configuration
export function randomizeCa() {
  randomizeGrid(state.caDensity ?? 25);
  status("Randomized Cellular Automata pattern", "ok");
}

// INITIALIZATION
export function initCellular() {
  const container = document.getElementById("model-cellular");
  if (!container) return;
  buildCellularPanel(container);

  // Hook step clock advancement from live transport loop
  onStep((stepIndex) => {
    if (stepIndex === null) {
      updateHud();
      return;
    }
    if (container.style.display === "none") return;

    // Check loop mode
    if (loopMode === "loop") {
      const loopLen = Math.max(1, Math.min(64, state.length || 64));
      if (stepIndex === 0 && generation > 0) {
        // Reset to initial seed pattern at loop boundary
        resetToSeed();
        return;
      }
    }

    // Step 1 generation of Conway's Game of Life
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
  setModelGenerator(generateCaBank);
  setModelRandomizer(randomizeCa);
  doGenerate(false);
  redrawCaCanvas();
  updateHud();
}

// When deactivating Cellular Automata Model
export function deactivateCellularModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
}
