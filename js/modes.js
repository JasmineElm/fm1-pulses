// modes.js — Sequencing models switcher and landing page manager.

export const MODELS = [
  {
    id: "mene311",
    name: "Mene311",
    kicker: "Stochastic S&H · Quantizer · Echo Loop",
    available: true,
    desc: "Classical generative signal chain created by Mene311. Gate probability triggers Sample & Hold and continuous LFO waveshaping, shaped through Gaussian distributions, quantized across 18 scales, with micro-timing humanize, real-time MIDI to the FM-1 and session save/recall.",
    tags: ["64 Steps", "18 Scales", "Echo / Deja-Vu", "Live MIDI", "Audio Audition"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h3l2-6 4 12 3-8 2 4 2-2h4" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="11" cy="18" r="1.2" fill="currentColor" />
      <circle cx="14" cy="10" r="1.2" fill="currentColor" />
    </svg>`
  },
  {
    id: "turing",
    name: "Turing Machine",
    kicker: "Shift Register · Bit Slip · Mutation",
    available: true,
    desc: "Shift-register melody generator inspired by Tom Whitwell's Turing Machine. A circulating loop of bits slowly mutates according to a write probability, locking into hypnotic melodic cycles or drifting into ever-changing variations.",
    tags: ["Shift Register", "Lock Loop", "Bit Slip", "Probabilistic Write"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" stroke-dasharray="3 3" />
      <path d="M12 4v4m0 8v4M4 12h4m8 0h4" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "cellular",
    name: "Cellular Automata",
    kicker: "Wolfram 1D Rules · Step Matrix · Emergent",
    available: true,
    desc: "Step generation driven by 1D elementary cellular automata (Rule 30, 90, 110, 150). Patterns evolve across generations through local neighbor interactions, yielding organic self-similar melodic contours.",
    tags: ["Wolfram 1D Rules", "Rule 30 / 110", "Emergent Evolution", "Seed Genetics", "Polyphonic / Lead"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="5" height="5" />
      <rect x="10" y="3" width="5" height="5" />
      <rect x="17" y="3" width="5" height="5" />
      <rect x="6.5" y="10" width="5" height="5" fill="currentColor" />
      <rect x="13.5" y="10" width="5" height="5" />
      <rect x="10" y="17" width="5" height="5" fill="currentColor" />
    </svg>`
  },
  {
    id: "particles",
    name: "Particles",
    kicker: "2D Kinetic Grid · Multi-Head · Collision Physics",
    available: true,
    desc: "Multi-head particle collision simulator inspired by Orca and Plinky. Moving directional playheads navigate a 2D physics surface, reflecting elastically off boundaries. When particles collide on the same cell, they trigger musical notes and either deflect at 90°, annihilate, or spawn child particles with finite lifetimes.",
    tags: ["2D Kinetic Grid", "Multi-Head", "Elastic Reflection", "Deflect (90°)", "Spawn Child", "Orca / Plinky"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
      <path d="M8 8l8 8M18 6l-3 3M6 18l3-3" />
      <circle cx="12" cy="12" r="3" stroke-dasharray="2 2" />
    </svg>`
  },
  {
    id: "pendulum",
    name: "Double Pendulum",
    kicker: "Deterministic Chaos · Direct Manipulation · Phase Attractor",
    available: true,
    desc: "Chaotic double pendulum physics engine yielding evolving trajectories, strange attractors, and phase-space polyphony. Direct-drag the bobs on canvas to prime initial angles, toggle between repeatable loops and continuous free-running chaos, and map kinetic vectors to scale degrees.",
    tags: ["Deterministic Chaos", "RK4 Integrator", "Direct Drag", "Phase Attractor", "Dual-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="4" r="2" fill="currentColor" />
      <line x1="12" y1="6" x2="16" y2="13" />
      <circle cx="16" cy="13" r="2.5" fill="currentColor" />
      <line x1="16" y1="15.5" x2="8" y2="20" />
      <circle cx="8" cy="20" r="3" fill="currentColor" />
    </svg>`
  },
  {
    id: "flock",
    name: "Flocking Swarm",
    kicker: "Autonomous Boids · Continuous Event Time · Spatial Chords",
    available: true,
    desc: "Autonomous boid flocking simulation unlinked to any step clock. Boids navigate a 2D field via Separation, Alignment, and Cohesion. When the flock congregates at armed attractor targets, it fires up to 8-voice polyphonic chords across custom scales with kinetic dynamics, scattering the swarm in a repulsion blast.",
    tags: ["Continuous Event Time", "Free Boids", "Attractor Targets", "8-Voice Polyphony", "Cluster Chords", "Scatter Blasts"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 18l4-2 3 3 2-6-6 2 3 3" fill="currentColor" />
      <path d="M11 10l3.5-1.8 2.6 2.6 1.8-5.3-5.3 1.8 2.6 2.6" fill="currentColor" />
      <circle cx="18" cy="18" r="3" stroke-dasharray="2 2" />
    </svg>`
  },
  {
    id: "rungler",
    name: "Rob Hordijk Rungler",
    kicker: "Chaotic Stepped Shift Register · Benjolin · Cross-Modulation",
    available: true,
    desc: "Chaotic shift-register melody generator inspired by Rob Hordijk's Benjolin and Blippoo Box. Two cross-modulating analog oscillators feed a comparator into a 16-bit shift register, decoded by a 4-bit Rungler DAC ladder to produce self-steering melodic bifurcations and hypnotic repeating loops.",
    tags: ["16-Bit Register", "4-Bit Rungler DAC", "Benjolin", "Dual Oscillators", "Cross-Mod Feedback", "Hybrid Clock"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
      <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      <circle cx="13" cy="18" r="1.5" fill="currentColor" />
      <rect x="17" y="9" width="4" height="6" rx="1" />
    </svg>`
  },
  {
    id: "krell",
    name: "Buchla Krell Patch",
    kicker: "Dual Function Generators · Source of Uncertainty · Non-Metric Ambient",
    available: true,
    desc: "Self-generating modular patch pioneered by Todd Barton and inspired by Bebe & Louis Barron's 1956 Forbidden Planet. Dual non-linear function generators cross-modulate Rise and Fall slopes via Sample & Hold random voltages, producing organic non-metric ambient melodies and continuous FM filter swells.",
    tags: ["Buchla 266", "Source of Uncertainty", "Sample & Hold", "Cross-Mod Dwell", "Non-Metric", "FM CC#74 Swells"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18l5-12 6 12 7-8" />
      <circle cx="8" cy="6" r="1.8" fill="currentColor" />
      <circle cx="14" cy="18" r="1.8" fill="currentColor" />
      <path d="M3 12h3m3 0h3m3 0h3" stroke-dasharray="1 2" />
    </svg>`
  },
  {
    id: "lsystem",
    name: "L-System Grammar",
    kicker: "Lindenmayer Formal Grammar · Fractal Turtle · Motif Branching",
    available: true,
    desc: "Recursive string-rewriting morphogenetic engine based on Aristid Lindenmayer's biological grammars. A musical turtle navigates branching rewrite rules with bracket stack push/pop, transforming recursive axioms (Fractal Canopy, Dragon Curve, Sierpinski, Hilbert) into self-similar polyphonic motifs and evolving melodic structures.",
    tags: ["Formal Grammar", "Recursive Rewriting", "Stack Push / Pop", "Fractal Turtle", "Self-Similar Motifs", "Direct Rule Edit"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="22" x2="12" y2="13" />
      <line x1="12" y1="13" x2="7" y2="7" />
      <line x1="12" y1="13" x2="17" y2="7" />
      <line x1="7" y1="7" x2="4" y2="3" />
      <line x1="7" y1="7" x2="9" y2="3" />
      <line x1="17" y1="7" x2="15" y2="3" />
      <line x1="17" y1="7" x2="20" y2="3" />
      <circle cx="4" cy="3" r="1.5" fill="currentColor" />
      <circle cx="9" cy="3" r="1.5" fill="currentColor" />
      <circle cx="15" cy="3" r="1.5" fill="currentColor" />
      <circle cx="20" cy="3" r="1.5" fill="currentColor" />
    </svg>`
  }
];

export const TOOLS = [
  {
    id: "dxpatch",
    name: "DX Patch Generator",
    kicker: "6-Op FM Voice Synthesis · 32-Voice Bank · SysEx I/O",
    available: true,
    desc: "Algorithmic patch generator and sound design workbench for Yamaha DX7 and M-VAVE FM-1. Features 11 category recipes, 6 sonic profiles, timbral macros, 6-operator matrix editing, real-time FM audio preview, and 32-voice cartridge bank export.",
    tags: ["6-Op FM", "32 Algorithms", "Voice (163B)", "Bank (4104B)", "SysEx Transmit", "Real-Time Audio"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h12M6 16h4m4 0h4" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "librarian",
    name: "Preset & Pattern Librarian",
    kicker: "Hardware Preset Export · 16-Slot Pattern Pull & Upload · Step Editor",
    available: true,
    desc: "Bi-directional hardware librarian and pattern workbench for the M-VAVE FM-1. Pull and archive all 128 presets (FM, VA, 8-Bit) and 16 64-step sequencer patterns directly from device RAM, edit sequences interactively, or upload new patterns from .syx, .mid, .json, or Pulses banks.",
    tags: ["128 Presets (0x10)", "16 Patterns (0x11)", "Pattern Upload (0x20)", "MIDI (.mid) I/O", "64-Step Editor", "Full Backup"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" />
      <path d="M4 10h16M9 14h6M12 3v3M8 3v3M16 3v3" />
    </svg>`
  }
];

let activeModelId = null;
let callbacks = { onEnterModel: null, onLeaveModel: null };

export function getActiveModel() {
  return activeModelId;
}

export function renderModelsGrid(container) {
  if (!container) return;
  container.innerHTML = "";

  for (const m of MODELS) {
    const card = document.createElement("div");
    card.className = "model-card is-active";
    card.dataset.modelId = m.id;

    card.innerHTML = `
      <div class="model-card-top">
        <div class="model-icon-wrap" aria-hidden="true">${m.icon}</div>
        <div class="model-header-text">
          <div class="model-title-row">
            <h3 class="model-title">${m.name}</h3>
          </div>
          <div class="model-kicker">${m.kicker}</div>
        </div>
      </div>
      <div class="model-card-body">
        <p class="model-desc">${m.desc}</p>
        <div class="model-tags">
          ${m.tags.map((t) => `<span class="model-tag">${t}</span>`).join("")}
        </div>
      </div>
      <div class="model-card-footer">
        <button class="model-launch-btn primary" data-launch="${m.id}" title="Launch ${m.name} Sequencer">
          Launch ${m.name} Engine <span>→</span>
        </button>
      </div>
    `;

    card.querySelector(`[data-launch="${m.id}"]`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      showModel(m.id);
    });
    // Clicking anywhere on the active card also launches it
    card.addEventListener("click", () => {
      showModel(m.id);
    });

    container.appendChild(card);
  }
}

export function renderToolsGrid(container) {
  if (!container) return;
  container.innerHTML = "";

  for (const t of TOOLS) {
    const card = document.createElement("div");
    card.className = "model-card is-active";
    card.dataset.toolId = t.id;

    card.innerHTML = `
      <div class="model-card-top">
        <div class="model-icon-wrap" aria-hidden="true">${t.icon}</div>
        <div class="model-header-text">
          <div class="model-title-row">
            <h3 class="model-title">${t.name}</h3>
          </div>
          <div class="model-kicker">${t.kicker}</div>
        </div>
      </div>
      <div class="model-card-body">
        <p class="model-desc">${t.desc}</p>
        <div class="model-tags">
          ${t.tags.map((tag) => `<span class="model-tag">${tag}</span>`).join("")}
        </div>
      </div>
      <div class="model-card-footer">
        <button class="model-launch-btn primary" data-launch="${t.id}" title="Launch ${t.name}">
          Launch ${t.name} <span>→</span>
        </button>
      </div>
    `;

    card.querySelector(`[data-launch="${t.id}"]`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      showModel(t.id);
    });
    card.addEventListener("click", () => {
      showModel(t.id);
    });

    container.appendChild(card);
  }
}

export function showLanding(updateHash = true) {
  if (callbacks.onLeaveModel && activeModelId) {
    try {
      callbacks.onLeaveModel(activeModelId);
    } catch (err) {
      console.warn("Error in onLeaveModel:", err);
    }
  }
  activeModelId = null;

  const viewLanding = document.getElementById("view-landing");
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-mene311");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const viewLibrarian = document.getElementById("view-librarian");
  const modelMene311 = document.getElementById("model-mene311");
  const modelCellular = document.getElementById("model-cellular");
  const modelTuring = document.getElementById("model-turing");
  const modelParticles = document.getElementById("model-particles");
  const modelPendulum = document.getElementById("model-pendulum");
  const modelFlock = document.getElementById("model-flock");
  const modelRungler = document.getElementById("model-rungler");
  const modelKrell = document.getElementById("model-krell");
  const modelLsystem = document.getElementById("model-lsystem");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");
  const seqBar = document.getElementById("sequence");
  const rhythmBar = document.getElementById("rhythm-bar");
  const grooveBar = document.getElementById("humanise-velocity-bar");

  if (seqBar) seqBar.style.display = "block";
  if (rhythmBar) rhythmBar.style.display = "block";
  if (grooveBar) grooveBar.style.display = "flex";

  if (viewLanding) viewLanding.style.display = "block";
  if (viewWorkspace) viewWorkspace.style.display = "none";
  if (viewDxpatch) viewDxpatch.style.display = "none";
  if (viewLibrarian) viewLibrarian.style.display = "none";
  if (modelMene311) modelMene311.style.display = "none";
  if (modelCellular) modelCellular.style.display = "none";
  if (modelTuring) modelTuring.style.display = "none";
  if (modelParticles) modelParticles.style.display = "none";
  if (modelPendulum) modelPendulum.style.display = "none";
  if (modelFlock) modelFlock.style.display = "none";
  if (modelRungler) modelRungler.style.display = "none";
  if (modelKrell) modelKrell.style.display = "none";
  if (modelLsystem) modelLsystem.style.display = "none";
  if (btnBack) btnBack.style.display = "none";
  if (modeTag) modeTag.style.display = "none";

  if (updateHash && window.location.hash !== "#models") {
    history.replaceState(null, "", "#models");
  }
}

export function showModel(id, updateHash = true) {
  if (id !== "mene311" && id !== "cellular" && id !== "turing" && id !== "particles" && id !== "pendulum" && id !== "flock" && id !== "rungler" && id !== "krell" && id !== "lsystem" && id !== "dxpatch" && id !== "librarian") return;

  const viewLanding = document.getElementById("view-landing");
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-mene311");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const viewLibrarian = document.getElementById("view-librarian");
  const modelMene311 = document.getElementById("model-mene311");
  const modelCellular = document.getElementById("model-cellular");
  const modelTuring = document.getElementById("model-turing");
  const modelParticles = document.getElementById("model-particles");
  const modelPendulum = document.getElementById("model-pendulum");
  const modelFlock = document.getElementById("model-flock");
  const modelRungler = document.getElementById("model-rungler");
  const modelKrell = document.getElementById("model-krell");
  const modelLsystem = document.getElementById("model-lsystem");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");
  const seqBar = document.getElementById("sequence");
  const rhythmBar = document.getElementById("rhythm-bar");
  const grooveBar = document.getElementById("humanise-velocity-bar");

  activeModelId = id;

  if (viewLanding) viewLanding.style.display = "none";

  // Flocking, Pendulum, and Krell are unlinked free models: hide discrete step sequencer bars
  const isStepModel = (id !== "flock" && id !== "pendulum" && id !== "krell" && id !== "dxpatch" && id !== "librarian");
  if (seqBar) seqBar.style.display = isStepModel ? "block" : "none";
  if (rhythmBar) rhythmBar.style.display = isStepModel ? "block" : "none";
  if (grooveBar) grooveBar.style.display = isStepModel ? "flex" : "none";

  if (id === "dxpatch") {
    if (viewWorkspace) viewWorkspace.style.display = "none";
    if (viewLibrarian) viewLibrarian.style.display = "none";
    if (viewDxpatch) viewDxpatch.style.display = "block";
    if (btnBack) {
      btnBack.textContent = "‹ Tools";
      btnBack.title = "Return to Tools & Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      modeTag.textContent = "DX Patch Generator";
      modeTag.style.display = "inline-block";
    }
  } else if (id === "librarian") {
    if (viewWorkspace) viewWorkspace.style.display = "none";
    if (viewDxpatch) viewDxpatch.style.display = "none";
    if (viewLibrarian) viewLibrarian.style.display = "block";
    if (btnBack) {
      btnBack.textContent = "‹ Tools";
      btnBack.title = "Return to Tools & Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      modeTag.textContent = "Librarian";
      modeTag.style.display = "inline-block";
    }
  } else {
    if (viewDxpatch) viewDxpatch.style.display = "none";
    if (viewLibrarian) viewLibrarian.style.display = "none";
    if (viewWorkspace) viewWorkspace.style.display = "block";
    if (modelMene311) modelMene311.style.display = id === "mene311" ? "block" : "none";
    if (modelCellular) modelCellular.style.display = id === "cellular" ? "block" : "none";
    if (modelTuring) modelTuring.style.display = id === "turing" ? "block" : "none";
    if (modelParticles) modelParticles.style.display = id === "particles" ? "block" : "none";
    if (modelPendulum) modelPendulum.style.display = id === "pendulum" ? "block" : "none";
    if (modelFlock) modelFlock.style.display = id === "flock" ? "block" : "none";
    if (modelRungler) modelRungler.style.display = id === "rungler" ? "block" : "none";
    if (modelKrell) modelKrell.style.display = id === "krell" ? "block" : "none";
    if (modelLsystem) modelLsystem.style.display = id === "lsystem" ? "block" : "none";
    if (btnBack) {
      btnBack.textContent = "‹ Models";
      btnBack.title = "Return to Sequencer Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      if (id === "mene311") modeTag.textContent = "Mene311";
      else if (id === "cellular") modeTag.textContent = "Cellular Automata";
      else if (id === "turing") modeTag.textContent = "Turing Machine";
      else if (id === "particles") modeTag.textContent = "Particles";
      else if (id === "pendulum") modeTag.textContent = "Double Pendulum";
      else if (id === "flock") modeTag.textContent = "Flocking Swarm";
      else if (id === "rungler") modeTag.textContent = "Rob Hordijk Rungler";
      else if (id === "krell") modeTag.textContent = "Buchla Krell Patch";
      else if (id === "lsystem") modeTag.textContent = "L-System Grammar";
      modeTag.style.display = "inline-block";
    }
  }

  if (updateHash && window.location.hash !== `#${id}`) {
    history.pushState(null, "", `#${id}`);
  }

  if (callbacks.onEnterModel) {
    callbacks.onEnterModel(id);
  }
}

export function initModes({ onEnterModel, onLeaveModel } = {}) {
  callbacks.onEnterModel = onEnterModel;
  callbacks.onLeaveModel = onLeaveModel;

  const grid = document.getElementById("models-grid");
  if (grid) renderModelsGrid(grid);

  const toolsGrid = document.getElementById("tools-grid");
  if (toolsGrid) renderToolsGrid(toolsGrid);

  // Return to landing page buttons
  const returnToLanding = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    showLanding();
  };

  const btnBack = document.getElementById("btn-back-landing");
  btnBack?.addEventListener("click", returnToLanding);

  document.querySelectorAll(".nav-back-btn").forEach((btn) => {
    btn.addEventListener("click", returnToLanding);
  });

  const linkModels = document.getElementById("link-models");
  linkModels?.addEventListener("click", returnToLanding);

  const linkDxModels = document.getElementById("dxpatch-link-models");
  linkDxModels?.addEventListener("click", returnToLanding);

  const linkLibModels = document.getElementById("lib-link-models");
  linkLibModels?.addEventListener("click", returnToLanding);

  // Handle URL hash changes
  window.addEventListener("hashchange", () => {
    const rawHash = (window.location.hash || "").toLowerCase();
    const h = rawHash.split("?")[0];
    if (h === "#mene311") {
      if (activeModelId !== "mene311") showModel("mene311", false);
    } else if (h === "#cellular") {
      if (activeModelId !== "cellular") showModel("cellular", false);
    } else if (h === "#turing") {
      if (activeModelId !== "turing") showModel("turing", false);
    } else if (h === "#particles") {
      if (activeModelId !== "particles") showModel("particles", false);
    } else if (h === "#pendulum") {
      if (activeModelId !== "pendulum") showModel("pendulum", false);
    } else if (h === "#flock") {
      if (activeModelId !== "flock") showModel("flock", false);
    } else if (h === "#rungler") {
      if (activeModelId !== "rungler") showModel("rungler", false);
    } else if (h === "#krell") {
      if (activeModelId !== "krell") showModel("krell", false);
    } else if (h === "#lsystem") {
      if (activeModelId !== "lsystem") showModel("lsystem", false);
    } else if (h === "#dxpatch" || h === "#dxpatchgen" || h === "#patch-generator") {
      if (activeModelId !== "dxpatch") showModel("dxpatch", false);
    } else if (h === "#librarian" || h === "#sync" || h === "#export") {
      if (activeModelId !== "librarian") showModel("librarian", false);
    } else {
      if (activeModelId !== null) showLanding(false);
    }
  });

  // Initial view selection
  const rawInitial = (window.location.hash || "").toLowerCase();
  const initialHash = rawInitial.split("?")[0];
  if (initialHash === "#mene311") {
    showModel("mene311", false);
  } else if (initialHash === "#cellular") {
    showModel("cellular", false);
  } else if (initialHash === "#turing") {
    showModel("turing", false);
  } else if (initialHash === "#particles") {
    showModel("particles", false);
  } else if (initialHash === "#pendulum") {
    showModel("pendulum", false);
  } else if (initialHash === "#flock") {
    showModel("flock", false);
  } else if (initialHash === "#rungler") {
    showModel("rungler", false);
  } else if (initialHash === "#krell") {
    showModel("krell", false);
  } else if (initialHash === "#lsystem") {
    showModel("lsystem", false);
  } else if (initialHash === "#dxpatch" || initialHash === "#dxpatchgen" || initialHash === "#patch-generator") {
    showModel("dxpatch", false);
  } else if (initialHash === "#librarian" || initialHash === "#sync" || initialHash === "#export") {
    showModel("librarian", false);
  } else {
    showLanding(false);
  }
}
