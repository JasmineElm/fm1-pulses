// flock.js — Autonomous Flocking Swarm Chord Engine for FM-1 Pulses.
// Free generative model unlinked to a step sequencer.
// Simulates Craig Reynolds' Boids (Separation, Alignment, Cohesion) in continuous event time.
// When the flock centroid congregates at interactive Attractor Targets, it triggers polyphonic
// chords (up to 8 voices for the FM-1) with kinetic dynamics, and scatters the swarm in a repulsion blast.

import { state, refs, status, setModelGenerator, setModelRandomizer } from "./state.js";
import { registerModel } from "./snapshot.js";
import { SCALES, quantize, midiName } from "./generator.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";
import { liveNoteOn, liveNoteOff, panicPreview, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { getRootMidi, getActiveScaleIntervals } from "./scale.js";

// ---- Swarm & Physics State ----
let boids = [];
let attractors = [];
let animFrameId = null;
let isRunning = false;

// Canvas & DOM references
let containerEl = null;
let canvas = null;
let ctx = null;
let width = 600;
let height = 420;
let voiceInfoEl = null;
let centroidInfoEl = null;

// Dragging target state & note sustain state
let draggedAttractor = null;
let activeHoldingAttractor = null;
let heldChordNotes = [];
let activeNoteKillTimers = [];
const activeSoundingNotes = new Set();

// Reusable DOM refs
const flockRefs = {};
function R(k, el) {
  flockRefs[k] = el;
  refs[k] = el;
  return el;
}

// Preset Curated Swarm States
export const FLOCK_PRESETS = [
  {
    name: "Orbital Whirl",
    desc: "4 cardinal attractors with balanced cohesion, creating cycling modal arpeggios as the swarm orbits",
    setup: () => {
      state.flockBoidCount = 18;
      state.flockSpeed = 5.2;
      state.flockSeparation = 1.6;
      state.flockAlignment = 0.05;
      state.flockCohesion = 0.008;
      state.flockBlast = 8.5;
      state.flockTriggerRadius = 48;
      state.flockResetRadius = 88;
      state.flockMaxVoices = 6;
      spawnPresetAttractors("cardinal");
    }
  },
  {
    name: "Tight Cluster",
    desc: "High cohesion and low separation: the swarm moves as a dense, unified unit, firing heavy closed-position chords",
    setup: () => {
      state.flockBoidCount = 24;
      state.flockSpeed = 4.2;
      state.flockSeparation = 0.9;
      state.flockAlignment = 0.08;
      state.flockCohesion = 0.022;
      state.flockBlast = 11.0;
      state.flockTriggerRadius = 42;
      state.flockResetRadius = 80;
      state.flockMaxVoices = 8;
      spawnPresetAttractors("triangle");
    }
  },
  {
    name: "Wide Open Swarm",
    desc: "High separation and open dispersion producing airy, spread-out Drop-2 and 11th voicings",
    setup: () => {
      state.flockBoidCount = 16;
      state.flockSpeed = 6.0;
      state.flockSeparation = 2.8;
      state.flockAlignment = 0.04;
      state.flockCohesion = 0.004;
      state.flockBlast = 7.0;
      state.flockTriggerRadius = 55;
      state.flockResetRadius = 95;
      state.flockMaxVoices = 6;
      spawnPresetAttractors("pentagram");
    }
  },
  {
    name: "Rapid Churn",
    desc: "High speed with fierce repulsion blasts: quick, energetic triggers with aggressive velocity dynamics",
    setup: () => {
      state.flockBoidCount = 20;
      state.flockSpeed = 8.0;
      state.flockSeparation = 2.0;
      state.flockAlignment = 0.06;
      state.flockCohesion = 0.010;
      state.flockBlast = 14.0;
      state.flockTriggerRadius = 50;
      state.flockResetRadius = 90;
      state.flockMaxVoices = 5;
      spawnPresetAttractors("corners");
    }
  }
];

// ---- Attractor Target Model ----

class Attractor {
  constructor(x, y, degreeOffset = 0) {
    this.x = x;
    this.y = y;
    this.radius = state.flockTriggerRadius || 48;
    this.resetRadius = state.flockResetRadius || 88;
    this.isArmed = true;
    this.degreeOffset = degreeOffset; // Scale root offset (0 = I, 2 = iii, 4 = V, etc.)
    this.pulse = 0;
  }

  draw(ctx, colLine, colLineFocus, colAccent, colErr, colDim, isHolding = false) {
    this.radius = state.flockTriggerRadius || 48;
    this.resetRadius = state.flockResetRadius || 88;

    ctx.save();

    // Outer Hysteresis Reset Boundary (highlighted when active holding attractor)
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.resetRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isHolding ? colAccent : (this.isArmed ? colLine : colLineFocus);
    ctx.lineWidth = isHolding ? 1.5 : 0.5;
    ctx.setLineDash(isHolding ? [4, 2] : [2, 4]);
    ctx.stroke();

    // Trigger Ring
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = this.isArmed ? colAccent : colErr;
    ctx.lineWidth = this.isArmed ? 2 : 1;
    ctx.setLineDash(this.isArmed ? [4, 4] : [2, 2]);
    ctx.stroke();

    // Core Indicator
    ctx.beginPath();
    ctx.arc(this.x, this.y, 6 + this.pulse, 0, Math.PI * 2);
    ctx.fillStyle = this.isArmed ? colAccent : colErr;
    ctx.fill();

    // Roman numeral or degree badge and chord root name from active scale & root
    const romanDegrees = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
    const degLabel = romanDegrees[this.degreeOffset % romanDegrees.length] || "I";
    const scaleIntervals = getActiveScaleIntervals();
    const rootBase = getRootMidi();
    const degIdx = this.degreeOffset % (scaleIntervals.length || 7);
    const chordRootNote = rootBase + (scaleIntervals[degIdx] ?? 0);
    const chordRootName = midiName(chordRootNote);
    const fullBadge = `${degLabel} · ${chordRootName}`;

    ctx.fillStyle = colDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fullBadge, this.x, this.y - this.radius - 8);

    ctx.restore();
    if (this.pulse > 0) this.pulse *= 0.88;
  }
}

// ---- Boid Agent Simulation ----

class Boid {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
  }

  update(boidList, target) {
    const maxSpeed = Number(state.flockSpeed ?? 5.2);
    const sepWeight = Number(state.flockSeparation ?? 1.6);
    const aliWeight = Number(state.flockAlignment ?? 0.05);
    const cohWeight = Number(state.flockCohesion ?? 0.008);

    let sepX = 0, sepY = 0, sepCount = 0;
    let aliX = 0, aliY = 0, aliCount = 0;
    let cohX = 0, cohY = 0, cohCount = 0;

    for (let i = 0; i < boidList.length; i++) {
      const other = boidList[i];
      if (other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);

      // Separation: maintain personal space
      if (dist > 0 && dist < 32) {
        sepX += dx / dist;
        sepY += dy / dist;
        sepCount++;
      }
      // Alignment & Cohesion: neighbor radar
      if (dist > 0 && dist < 120) {
        aliX += other.vx;
        aliY += other.vy;
        aliCount++;
        cohX += other.x;
        cohY += other.y;
        cohCount++;
      }
    }

    let ax = 0, ay = 0;

    if (sepCount > 0) {
      sepX /= sepCount;
      sepY /= sepCount;
      ax += sepX * sepWeight;
      ay += sepY * sepWeight;
    }

    if (aliCount > 0) {
      aliX /= aliCount;
      aliY /= aliCount;
      ax += (aliX - this.vx) * aliWeight;
      ay += (aliY - this.vy) * aliWeight;
    }

    if (cohCount > 0) {
      cohX /= cohCount;
      cohY /= cohCount;
      ax += (cohX - this.x) * cohWeight;
      ay += (cohY - this.y) * cohWeight;
    }

    // Steering toward active attractor target
    if (target) {
      const tdx = target.x - this.x;
      const tdy = target.y - this.y;
      const tDist = Math.hypot(tdx, tdy);
      if (tDist > 0) {
        ax += (tdx / tDist) * 0.28;
        ay += (tdy / tDist) * 0.28;
      }
    }

    this.vx += ax;
    this.vy += ay;

    // Cap velocity
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }

    this.x += this.vx;
    this.y += this.vy;

    // Toroidal wrap-around boundaries
    if (this.x < 0) this.x = width;
    if (this.x > width) this.x = 0;
    if (this.y < 0) this.y = height;
    if (this.y > height) this.y = 0;
  }

  draw(ctx, colBoid) {
    const angle = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-7, -4.5);
    ctx.lineTo(-4.5, 0);
    ctx.lineTo(-7, 4.5);
    ctx.closePath();
    ctx.fillStyle = colBoid;
    ctx.fill();
    ctx.restore();
  }
}

// ---- Audio & Polyphonic Chord Engine ----

function releaseHeldNotes() {
  for (const note of heldChordNotes) {
    activeSoundingNotes.delete(note);
    try { liveNoteOff(note); } catch (_) {}
    try { audio.noteOff(note); } catch (_) {}
  }
  heldChordNotes = [];
  if (activeHoldingAttractor) {
    activeHoldingAttractor.isArmed = true;
    activeHoldingAttractor = null;
  }
  if (voiceInfoEl && activeSoundingNotes.size === 0) {
    voiceInfoEl.textContent = "Voices: Idle (Awaiting Target Congregation)";
  }
}

function killActiveNotes() {
  activeNoteKillTimers.forEach(clearTimeout);
  activeNoteKillTimers = [];
  for (const n of activeSoundingNotes) {
    try { liveNoteOff(n); } catch (_) {}
    try { audio.noteOff(n); } catch (_) {}
  }
  activeSoundingNotes.clear();
  heldChordNotes = [];
  if (activeHoldingAttractor) {
    activeHoldingAttractor.isArmed = true;
    activeHoldingAttractor = null;
  }
  try { panicPreview(); } catch (_) {}
  try { midi.sendAllNotesOff(); } catch (_) {}
}

export function isFlockRunning() {
  return isRunning;
}

export function startFlock() {
  if (isRunning) return;
  isRunning = true;
  state.flockRunning = true;
  audio.unlock();
  const btn = document.getElementById("audition");
  if (btn) {
    btn.textContent = "■ Stop";
    btn.classList.add("playing");
  }
  const badge = document.getElementById("flock-status-badge");
  if (badge) badge.textContent = "Swarm Running";
  if (voiceInfoEl && activeSoundingNotes.size === 0) {
    voiceInfoEl.textContent = "Voices: Idle (Awaiting Target Congregation)";
  }
  status("Swarm playing", "ok");
}

export function stopFlock() {
  isRunning = false;
  state.flockRunning = false;
  killActiveNotes();
  const btn = document.getElementById("audition");
  if (btn) {
    btn.textContent = "▶ Play";
    btn.classList.remove("playing");
  }
  const badge = document.getElementById("flock-status-badge");
  if (badge) badge.textContent = "Swarm Stopped";
  if (voiceInfoEl) {
    voiceInfoEl.textContent = "Voices: Stopped (Press Play or Space to start swarm)";
  }
  status("Swarm stopped");
}

export function toggleFlockRunning() {
  if (isRunning) {
    stopFlock();
    return false;
  } else {
    startFlock();
    return true;
  }
}

export function randomizeFlock() {
  const p = FLOCK_PRESETS[(Math.random() * FLOCK_PRESETS.length) | 0];
  if (p) {
    p.setup();
    setupFlock();
    syncAllControls();
    status(`Randomized Swarm: ${p.name}`, "ok");
  }
}

function buildChord(rootBase, scaleIntervals, degreeOffset, dispersion) {
  const intervals = (Array.isArray(scaleIntervals) && scaleIntervals.length > 0)
    ? scaleIntervals
    : [0, 2, 3, 5, 7, 9, 10];
  const maxVoices = Number(state.flockMaxVoices ?? 6);
  // Dispersion expands polyphony: tightly grouped flock = triad; open flock = extended chord
  const voiceCount = Math.min(maxVoices, Math.max(3, Math.floor(dispersion / 16) + 3));
  const chord = [];

  for (let i = 0; i < voiceCount; i++) {
    // High dispersion opens the chord into Drop-2 or 9th/11th voicings (step by 3 degrees instead of 2)
    const step = dispersion > 45 ? i * 3 : i * 2;
    const scaleIdx = (degreeOffset + step) % intervals.length;
    const oct = Math.floor((degreeOffset + step) / intervals.length) * 12;
    const rawNote = rootBase + intervals[scaleIdx] + oct;
    const note = quantize(rawNote, intervals, rootBase);
    if (note <= 118 && !chord.includes(note)) chord.push(note);
  }

  return chord.slice(0, 8); // FM-1 supports up to 8 voices
}

function triggerCongregation(target, dispersion, avgSpeed) {
  // Clear any existing sounding notes before holding the new chord
  killActiveNotes();

  target.isArmed = false;
  target.pulse = 16;
  activeHoldingAttractor = target;

  const rootBase = getRootMidi();
  const scaleIntervals = getActiveScaleIntervals();
  const chordNotes = buildChord(rootBase, scaleIntervals, target.degreeOffset, dispersion);

  const baseVel = Number(state.flockVelocity ?? 100);
  // Velocity influenced by kinetic energy: 50..127
  const velocity = Math.min(127, Math.max(45, Math.floor((avgSpeed / 5.2) * baseVel)));

  heldChordNotes = [...chordNotes];

  const noteNames = chordNotes.map((n) => midiName(n)).join(", ");
  if (voiceInfoEl) {
    voiceInfoEl.textContent = `Voices: Held (${chordNotes.length} notes: ${noteNames}) · Vel: ${velocity}`;
  }

  // 1. Web MIDI CC 1 Modulation Wheel reflecting kinetic energy
  try {
    midi.sendCC(1, Math.min(127, Math.floor(velocity * 0.9)));
  } catch (_) {}

  // 2. Play and hold notes on FM-1 / Web Audio continuously until exiting reset radius
  chordNotes.forEach((note) => {
    activeSoundingNotes.add(note);
    liveNoteOn(note, velocity);
    audio.noteOn(note, velocity);
  });

  // 3. Advance chord mode: if Cycle on Trigger mode is active, cycle to next chord in sequence!
  const numDegrees = scaleIntervals.length || 7;
  const mode = state.flockChordMode || "cycle";
  if (mode === "cycle") {
    target.degreeOffset = (target.degreeOffset + 1) % numDegrees;
  } else if (mode === "random") {
    target.degreeOffset = Math.floor(Math.random() * numDegrees);
  }

  // Repulsion blast: scatter boids away from trigger center
  const blastStrength = Number(state.flockBlast ?? 8.5);
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i];
    const dx = b.x - target.x;
    const dy = b.y - target.y;
    const dist = Math.hypot(dx, dy) || 1;
    b.vx += (dx / dist) * blastStrength;
    b.vy += (dy / dist) * blastStrength;
  }
}

// ---- Main Continuous Swarm Animation Loop ----

function stepSwarm() {
  if (!ctx || !canvas) return;

  const style = getComputedStyle(document.documentElement);
  const colPanel = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colOk = style.getPropertyValue("--ok").trim() || "#22c55e";
  const colErr = style.getPropertyValue("--err").trim() || "#ef4444";

  // Trailing background when running, solid semantic fill when paused
  if (isRunning) {
    ctx.fillStyle = "rgba(24, 25, 31, 0.32)";
  } else {
    ctx.fillStyle = colPanel;
  }
  ctx.fillRect(0, 0, width, height);

  if (boids.length === 0) {
    setupFlock();
  }

  // 1. Compute Centroid, Dispersion, and Average Speed
  let cx = 0, cy = 0, totalSpeed = 0;
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i];
    cx += b.x;
    cy += b.y;
    totalSpeed += Math.hypot(b.vx, b.vy);
  }
  cx /= boids.length;
  cy /= boids.length;
  const avgSpeed = totalSpeed / boids.length;

  let dispersion = 0;
  for (let i = 0; i < boids.length; i++) {
    dispersion += Math.hypot(boids[i].x - cx, boids[i].y - cy);
  }
  dispersion /= boids.length;

  if (centroidInfoEl) {
    centroidInfoEl.textContent = `Centroid: (${Math.round(cx)}, ${Math.round(cy)}) · Disp: ${Math.round(dispersion)}px · Speed: ${avgSpeed.toFixed(1)}`;
  }

  // Draw Centroid Indicator
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = colFg;
  ctx.fill();

  // 2. Find Primary Nearest Armed Target
  let nearestTarget = null;
  let minDist = Infinity;
  for (let i = 0; i < attractors.length; i++) {
    const att = attractors[i];
    const d = Math.hypot(att.x - cx, att.y - cy);
    if (att.isArmed && d < minDist) {
      minDist = d;
      nearestTarget = att;
    }
    // Hysteresis re-arming for inactive non-holding attractors
    if (!att.isArmed && att !== activeHoldingAttractor && d > att.resetRadius) {
      att.isArmed = true;
    }
  }

  // Check active holding attractor: notes stay held until the boid exits the reset radius!
  if (activeHoldingAttractor) {
    const dActive = Math.hypot(activeHoldingAttractor.x - cx, activeHoldingAttractor.y - cy);
    if (dActive > activeHoldingAttractor.resetRadius) {
      releaseHeldNotes();
    }
  }

  // 3. Evaluate Chord Triggers: UNTIL the boid exits the reset radius, new notes should not be triggered!
  if (isRunning && !activeHoldingAttractor) {
    for (let i = 0; i < attractors.length; i++) {
      const att = attractors[i];
      const d = Math.hypot(att.x - cx, att.y - cy);
      if (att.isArmed && d < att.radius) {
        triggerCongregation(att, dispersion, avgSpeed);
        break; // Trigger one attractor at a time
      }
    }
  }

  // 4. Render Attractors
  for (let i = 0; i < attractors.length; i++) {
    const isHolding = (attractors[i] === activeHoldingAttractor);
    attractors[i].draw(ctx, colLine, colLineFocus, colAccent, colErr, colDim, isHolding);
  }

  // 5. Update & Render Boids
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i];
    if (isRunning) {
      b.update(boids, nearestTarget);
    }
    b.draw(ctx, colOk);
  }

  animFrameId = requestAnimationFrame(stepSwarm);
}

// ---- Setup & Target Presets ----

function setupFlock() {
  const count = Number(state.flockBoidCount ?? 16);
  boids = [];
  const midX = width * 0.5;
  const midY = height * 0.5;
  for (let i = 0; i < count; i++) {
    boids.push(new Boid(midX + (Math.random() - 0.5) * 120, midY + (Math.random() - 0.5) * 120));
  }
}

function spawnPresetAttractors(type = "cardinal") {
  killActiveNotes();
  attractors = [];
  const cx = width * 0.5;
  const cy = height * 0.5;

  if (type === "cardinal") {
    // 4 cardinal points (I, IV, V, vi)
    const dist = Math.min(width, height) * 0.32;
    attractors.push(new Attractor(cx, cy - dist, 0)); // North: I
    attractors.push(new Attractor(cx + dist, cy, 3)); // East: IV
    attractors.push(new Attractor(cx, cy + dist, 4)); // South: V
    attractors.push(new Attractor(cx - dist, cy, 5)); // West: vi
  } else if (type === "triangle") {
    // 3 harmonic nodes (I, iii, V)
    const r = Math.min(width, height) * 0.34;
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      attractors.push(new Attractor(cx + r * Math.cos(ang), cy + r * Math.sin(ang), i * 2));
    }
  } else if (type === "pentagram") {
    // 5 modal nodes (I, ii, iii, V, vi)
    const r = Math.min(width, height) * 0.35;
    const offsets = [0, 1, 2, 4, 5];
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      attractors.push(new Attractor(cx + r * Math.cos(ang), cy + r * Math.sin(ang), offsets[i]));
    }
  } else if (type === "corners") {
    const pad = 90;
    attractors.push(new Attractor(pad, pad, 0));
    attractors.push(new Attractor(width - pad, pad, 2));
    attractors.push(new Attractor(width - pad, height - pad, 4));
    attractors.push(new Attractor(pad, height - pad, 5));
  }
}

// ---- Canvas Interaction ----

function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(rect.width || 600);
  const h = Math.floor(rect.height || 420);

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    width = w;
    height = h;
  }
}

function setupCanvasInteraction() {
  if (!canvas) return;

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  let downPos = null;
  let downAttractor = null;
  let isDragging = false;

  canvas.addEventListener("pointerdown", (e) => {
    const pos = getMousePos(e);
    downPos = pos;
    isDragging = false;

    // Check if clicking on an existing attractor
    let clickedAtt = null;
    let minDist = Infinity;
    for (let i = 0; i < attractors.length; i++) {
      const att = attractors[i];
      const d = Math.hypot(pos.x - att.x, pos.y - att.y);
      if (d <= Math.max(28, att.radius) && d < minDist) {
        minDist = d;
        clickedAtt = att;
      }
    }

    downAttractor = clickedAtt;
    draggedAttractor = clickedAtt;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (clickedAtt) {
      canvas.style.cursor = "grabbing";
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = getMousePos(e);

    if (downPos && (Math.hypot(pos.x - downPos.x, pos.y - downPos.y) > 5)) {
      isDragging = true;
    }

    if (draggedAttractor && isDragging) {
      draggedAttractor.x = Math.max(30, Math.min(width - 30, pos.x));
      draggedAttractor.y = Math.max(30, Math.min(height - 30, pos.y));
      return;
    }

    // Hover feedback and tooltip
    let hoverAtt = null;
    let minDist = Infinity;
    for (let i = 0; i < attractors.length; i++) {
      const att = attractors[i];
      const d = Math.hypot(pos.x - att.x, pos.y - att.y);
      if (d <= Math.max(28, att.radius) && d < minDist) {
        minDist = d;
        hoverAtt = att;
      }
    }

    if (hoverAtt) {
      const scaleIntervals = getActiveScaleIntervals();
      const numDegrees = scaleIntervals.length || 7;
      const deg = (hoverAtt.degreeOffset % numDegrees) + 1;
      canvas.style.cursor = "pointer";
      canvas.title = `Chord ${deg}/${numDegrees} — Click to cycle chord (exhausts to delete) · Drag to move`;
    } else {
      canvas.style.cursor = "crosshair";
      canvas.title = "Click empty canvas to place a new attractor node";
    }
  });

  const onPointerUp = (e) => {
    const pos = getMousePos(e);

    if (!isDragging && downPos) {
      // Distinct click action (pointer did not drag)
      if (downAttractor) {
        // Clicked an existing node: cycle through chords!
        const scaleIntervals = getActiveScaleIntervals();
        const numDegrees = scaleIntervals.length || 7;

        if (downAttractor === activeHoldingAttractor) {
          releaseHeldNotes();
        }

        downAttractor.degreeOffset++;

        if (downAttractor.degreeOffset >= numDegrees) {
          // When chords are exhausted, delete the node!
          const idx = attractors.indexOf(downAttractor);
          if (idx !== -1) attractors.splice(idx, 1);
          status("Attractor node deleted (all chords exhausted)");
        } else {
          // Cycled to next chord in the scale
          downAttractor.pulse = 14;
          const romanDegrees = [
            "I", "ii", "iii", "IV", "V", "vi", "vii°",
            "VIII", "ix", "x", "xi", "xii"
          ];
          const degLabel = romanDegrees[downAttractor.degreeOffset] || `Deg ${downAttractor.degreeOffset + 1}`;
          const chordRootNote = getRootMidi() + (scaleIntervals[downAttractor.degreeOffset] ?? 0);
          const chordRootName = midiName(chordRootNote);
          status(`Cycled node to ${degLabel} (${chordRootName}) · [${downAttractor.degreeOffset + 1}/${numDegrees}]`);
        }
      } else {
        // Clicked empty space: place a new node starting on Degree I (offset 0)
        const newAtt = new Attractor(pos.x, pos.y, 0);
        newAtt.pulse = 16;
        attractors.push(newAtt);
        const scaleIntervals = getActiveScaleIntervals();
        const chordRootNote = getRootMidi() + (scaleIntervals[0] ?? 0);
        const chordRootName = midiName(chordRootNote);
        status(`Placed Node: I (${chordRootName}) — Click node to cycle chords (${scaleIntervals.length} in scale), drag to move`);
      }
    }

    draggedAttractor = null;
    downAttractor = null;
    downPos = null;
    isDragging = false;
    canvas.style.cursor = "crosshair";
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
}

function syncAllControls() {
  for (const [k, el] of Object.entries(flockRefs)) {
    if (el?.setValue && state[k] !== undefined) {
      el.setValue(state[k], false);
    }
  }
}

// ---- Lifecycle Activation & Deactivation ----

export function activateFlockModel() {
  setModelGenerator(() => {
    return Array.from({ length: 16 }, () => ({
      length: 0,
      rate: 6,
      steps: []
    }));
  });
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleFlockRunning,
    stop: stopFlock,
    start: startFlock,
    isRunning: isFlockRunning
  });
  setModelRandomizer(randomizeFlock);

  // Initialize in paused/stopped state awaiting Play button
  stopFlock();

  syncAllControls();
  setTimeout(() => {
    resizeCanvas();
    if (attractors.length === 0) spawnPresetAttractors("cardinal");
    setupFlock();
  }, 20);

  if (!animFrameId) {
    animFrameId = requestAnimationFrame(stepSwarm);
  }
  status("Flocking Swarm Engine: Ready (Press Play to start swarm)", "ok");
}

export function deactivateFlockModel() {
  stopFlock();
  setModelGenerator(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  setModelRandomizer(null);
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- UI Construction ----

export function initFlock() {
  containerEl = document.getElementById("model-flock");
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout particle-layout flock-layout";

  // LEFT COLUMN: Control Modules Rack
  const module = document.createElement("div");
  module.className = "module particle-module flock-module";

  // 1. Swarm Physics & Steering Section
  const physSect = document.createElement("section");
  physSect.className = "sect particle-sect";
  physSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Swarm Physics &amp; Steering</h3>
      <span class="particle-badge" id="flock-status-badge">Swarm Stopped</span>
    </div>
  `;

  const physGrid = document.createElement("div");
  physGrid.className = "particle-grid-2col";

  const boidKnob = R("flockBoidCount", knob({
    label: "Boid Count",
    min: 1,
    max: 48,
    step: 1,
    value: state.flockBoidCount || 16,
    def: 16,
    size: "sm",
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      state.flockBoidCount = Math.round(v);
      setupFlock();
    },
    tip: "Number of autonomous boids navigating the 2D field."
  }));

  const speedKnob = R("flockSpeed", knob({
    label: "Max Speed",
    min: 2,
    max: 12,
    step: 0.5,
    value: state.flockSpeed || 5.2,
    def: 5.2,
    size: "sm",
    format: (v) => `${v.toFixed(1)}`,
    onInput: (v) => {
      state.flockSpeed = Number(v);
    },
    tip: "Maximum velocity cap for individual boids."
  }));

  const sepKnob = R("flockSeparation", knob({
    label: "Separation",
    min: 0.5,
    max: 4.0,
    step: 0.1,
    value: state.flockSeparation || 1.6,
    def: 1.6,
    size: "sm",
    format: (v) => `${v.toFixed(1)}x`,
    onInput: (v) => {
      state.flockSeparation = Number(v);
    },
    tip: "Repulsion force steering boids away from crowded local neighbors."
  }));

  const aliKnob = R("flockAlignment", knob({
    label: "Alignment",
    min: 0.01,
    max: 0.20,
    step: 0.01,
    value: state.flockAlignment || 0.05,
    def: 0.05,
    size: "sm",
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      state.flockAlignment = Number(v);
    },
    tip: "Steering force matching the average velocity heading of neighbors."
  }));

  const cohKnob = R("flockCohesion", knob({
    label: "Cohesion",
    min: 0.001,
    max: 0.030,
    step: 0.002,
    value: state.flockCohesion || 0.008,
    def: 0.008,
    size: "sm",
    format: (v) => `${Math.round(v * 1000)}m`,
    onInput: (v) => {
      state.flockCohesion = Number(v);
    },
    tip: "Attractive force pulling boids towards the center of mass of the local swarm."
  }));

  const blastKnob = R("flockBlast", knob({
    label: "Scatter Blast",
    min: 0,
    max: 20,
    step: 0.5,
    value: state.flockBlast || 8.5,
    def: 8.5,
    size: "sm",
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      state.flockBlast = Number(v);
    },
    tip: "Kinetic explosion impulse scattering boids outwards when a chord triggers."
  }));

  physGrid.append(boidKnob, speedKnob, sepKnob, aliKnob, cohKnob, blastKnob);
  physSect.append(physGrid);

  // 2. Attractors & Trigger Configuration Section
  const trigSect = document.createElement("section");
  trigSect.className = "sect particle-sect";
  trigSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Target Triggers &amp; Chords</h3>
    </div>
  `;

  const trigGrid = document.createElement("div");
  trigGrid.className = "particle-grid-2col";

  const trigRadKnob = R("flockTriggerRadius", knob({
    label: "Trigger Radius",
    min: 24,
    max: 80,
    step: 2,
    value: state.flockTriggerRadius || 48,
    def: 48,
    size: "sm",
    format: (v) => `${Math.round(v)}px`,
    onInput: (v) => {
      state.flockTriggerRadius = Math.round(v);
    },
    tip: "Radius required for centroid to enter and trigger the chord."
  }));

  const resetRadKnob = R("flockResetRadius", knob({
    label: "Reset Radius",
    min: 50,
    max: 140,
    step: 4,
    value: state.flockResetRadius || 88,
    def: 88,
    size: "sm",
    format: (v) => `${Math.round(v)}px`,
    onInput: (v) => {
      state.flockResetRadius = Math.round(v);
    },
    tip: "Hysteresis perimeter the centroid must leave before the attractor re-arms."
  }));

  const voiceLimitCtrl = R("flockMaxVoices", dropdown({
    label: "Voice Limit",
    options: [
      { v: "3", t: "3 Voices (Triad)" },
      { v: "4", t: "4 Voices (7th Chord)" },
      { v: "5", t: "5 Voices (9th Chord)" },
      { v: "6", t: "6 Voices (Extended)" },
      { v: "8", t: "8 Voices (FM-1 Maximum)" }
    ],
    value: String(state.flockMaxVoices || 6),
    onInput: (v) => {
      state.flockMaxVoices = Number(v);
      status(`Max Voices: ${v}`);
    },
    tip: "Maximum polyphonic notes fired simultaneously (FM-1 supports up to 8)."
  }));

  const chordModeCtrl = R("flockChordMode", dropdown({
    label: "Chord Mode",
    options: [
      { v: "cycle", t: "Cycle on Trigger" },
      { v: "fixed", t: "Fixed Chords" },
      { v: "random", t: "Random on Trigger" }
    ],
    value: state.flockChordMode || "cycle",
    onInput: (v) => {
      state.flockChordMode = v;
      status(`Chord Mode: ${v === "cycle" ? "Cycle on Trigger (Progression)" : (v === "random" ? "Random on Trigger" : "Fixed Chords")}`);
    },
    tip: "Progression mode: Cycle on Trigger advances the node to the next chord in sequence each time it triggers; Fixed holds assigned chords."
  }));

  trigGrid.append(trigRadKnob, resetRadKnob, voiceLimitCtrl, chordModeCtrl);
  trigSect.append(trigGrid);

  // Target Actions Row
  const targetBtnRow = document.createElement("div");
  targetBtnRow.className = "particle-btn-row";
  targetBtnRow.style.marginTop = "8px";

  const makeTargetBtn = (label, fn, tip) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action-btn";
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", fn);
    return b;
  };

  targetBtnRow.append(
    makeTargetBtn("Cardinal 4", () => spawnPresetAttractors("cardinal"), "Place 4 cardinal attractor targets"),
    makeTargetBtn("Triangle 3", () => spawnPresetAttractors("triangle"), "Place 3 harmonic attractor nodes"),
    makeTargetBtn("Pentagram 5", () => spawnPresetAttractors("pentagram"), "Place 5 modal attractor nodes"),
    makeTargetBtn("Clear Targets", () => { killActiveNotes(); attractors = []; status("Cleared all attractor targets"); }, "Clear all attractors"),
    makeTargetBtn("PANIC (Mute)", () => { killActiveNotes(); status("Panic: Sent All Notes Off", "err"); }, "Send All Notes Off immediately")
  );
  trigSect.append(targetBtnRow);

  // 3. Swarm Presets Section
  const presetSect = document.createElement("section");
  presetSect.className = "sect particle-sect";
  presetSect.innerHTML = `
    <div class="particle-sect-head">
      <h3>Flocking Swarm Presets</h3>
    </div>
  `;

  const presetGrid = document.createElement("div");
  presetGrid.className = "particle-preset-grid";

  FLOCK_PRESETS.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "particle-preset-btn";
    btn.textContent = p.name;
    btn.title = `${p.name}: ${p.desc}`;
    btn.addEventListener("click", () => {
      p.setup();
      setupFlock();
      syncAllControls();
      status(`Loaded Swarm Preset: ${p.name}`, "ok");
    });
    presetGrid.appendChild(btn);
  });

  presetSect.append(presetGrid);

  module.append(physSect, trigSect, presetSect);

  // RIGHT COLUMN: 2D Interactive Flocking Canvas
  const display = document.createElement("div");
  display.className = "display particle-display flock-display";

  display.innerHTML = `
    <div class="particle-canvas-wrap">
      <canvas id="flock-canvas" class="particle-canvas"></canvas>
    </div>
    <div class="particle-display-footer">
      <span id="flock-voice-info" class="particle-hint-inline">Voices: Stopped (Press Play or Space to start swarm)</span>
      <span id="flock-centroid-info" class="particle-step-hover">—</span>
    </div>
  `;

  layout.append(module, display);
  containerEl.appendChild(layout);

  canvas = display.querySelector("#flock-canvas");
  ctx = canvas.getContext("2d");
  voiceInfoEl = display.querySelector("#flock-voice-info");
  centroidInfoEl = display.querySelector("#flock-centroid-info");

  setupCanvasInteraction();
  window.addEventListener("resize", resizeCanvas);
}

// ---- Session Snapshot Registry (see snapshot.js) ----

registerModel({
  id: "flock",
  version: 1,
  migrations: {},
  capture() {
    return {
      attractors: attractors.map((a) => ({
        x: Math.round(a.x),
        y: Math.round(a.y),
        degreeOffset: a.degreeOffset
      })),
      boidCount: Number(state.flockBoidCount ?? 16),
      boids: boids.slice(0, 32).map((b) => ({
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: Math.round(b.vx * 100) / 100,
        vy: Math.round(b.vy * 100) / 100
      }))
    };
  },
  restore(h) {
    if (!h) return;
    if (Array.isArray(h.attractors)) {
      attractors = h.attractors.map((a) => new Attractor(a.x, a.y, a.degreeOffset || 0));
    }
    if (Array.isArray(h.boids) && h.boids.length > 0) {
      boids = h.boids.map((b) => {
        const nb = new Boid(b.x, b.y);
        nb.vx = b.vx || 0;
        nb.vy = b.vy || 0;
        return nb;
      });
    } else {
      setupFlock();
    }
    syncAllControls();
  }
});
