// modes.js — Sequencing models switcher and landing page manager.

export const MODELS = [
  {
    id: "traditional",
    name: "Mene311",
    kicker: "Stochastic S&H · Quantizer · Echo Loop",
    available: true,
    desc: "Classical generative signal chain created by Mene311. Gate probability triggers Sample & Hold and continuous LFO waveshaping, shaped through Gaussian distributions, quantized across 18 scales, with micro-timing humanize and 16-slot bank synthesis for FM-1 SysEx freeze.",
    tags: ["64 Steps", "16-Slot Bank", "18 Scales", "Echo / Deja-Vu", "SysEx Freeze", "Audio Audition"],
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
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-traditional");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const modelTraditional = document.getElementById("model-traditional");
  const modelCellular = document.getElementById("model-cellular");
  const modelTuring = document.getElementById("model-turing");
  const modelParticles = document.getElementById("model-particles");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");

  if (viewLanding) viewLanding.style.display = "block";
  if (viewWorkspace) viewWorkspace.style.display = "none";
  if (viewDxpatch) viewDxpatch.style.display = "none";
  if (modelTraditional) modelTraditional.style.display = "none";
  if (modelCellular) modelCellular.style.display = "none";
  if (modelTuring) modelTuring.style.display = "none";
  if (modelParticles) modelParticles.style.display = "none";
  if (btnBack) btnBack.style.display = "none";
  if (modeTag) modeTag.style.display = "none";

  if (updateHash && window.location.hash !== "#models") {
    history.replaceState(null, "", "#models");
  }
}

export function showModel(id, updateHash = true) {
  if (id !== "traditional" && id !== "cellular" && id !== "turing" && id !== "particles" && id !== "dxpatch") return;

  const viewLanding = document.getElementById("view-landing");
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-traditional");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const modelTraditional = document.getElementById("model-traditional");
  const modelCellular = document.getElementById("model-cellular");
  const modelTuring = document.getElementById("model-turing");
  const modelParticles = document.getElementById("model-particles");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");

  activeModelId = id;

  if (viewLanding) viewLanding.style.display = "none";

  if (id === "dxpatch") {
    if (viewWorkspace) viewWorkspace.style.display = "none";
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
  } else {
    if (viewDxpatch) viewDxpatch.style.display = "none";
    if (viewWorkspace) viewWorkspace.style.display = "block";
    if (modelTraditional) modelTraditional.style.display = id === "traditional" ? "block" : "none";
    if (modelCellular) modelCellular.style.display = id === "cellular" ? "block" : "none";
    if (modelTuring) modelTuring.style.display = id === "turing" ? "block" : "none";
    if (modelParticles) modelParticles.style.display = id === "particles" ? "block" : "none";
    if (btnBack) {
      btnBack.textContent = "‹ Models";
      btnBack.title = "Return to Sequencer Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      if (id === "traditional") modeTag.textContent = "Mene311";
      else if (id === "cellular") modeTag.textContent = "Cellular Automata";
      else if (id === "turing") modeTag.textContent = "Turing Machine";
      else if (id === "particles") modeTag.textContent = "Particles";
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

  // Handle URL hash changes
  window.addEventListener("hashchange", () => {
    const rawHash = (window.location.hash || "").toLowerCase();
    const h = rawHash.split("?")[0];
    if (h === "#traditional" || h === "#mene311") {
      if (activeModelId !== "traditional") showModel("traditional", false);
    } else if (h === "#cellular") {
      if (activeModelId !== "cellular") showModel("cellular", false);
    } else if (h === "#turing") {
      if (activeModelId !== "turing") showModel("turing", false);
    } else if (h === "#particles") {
      if (activeModelId !== "particles") showModel("particles", false);
    } else if (h === "#dxpatch" || h === "#dxpatchgen" || h === "#patch-generator") {
      if (activeModelId !== "dxpatch") showModel("dxpatch", false);
    } else {
      if (activeModelId !== null) showLanding(false);
    }
  });

  // Initial view selection
  const rawInitial = (window.location.hash || "").toLowerCase();
  const initialHash = rawInitial.split("?")[0];
  if (initialHash === "#traditional" || initialHash === "#mene311") {
    showModel("traditional", false);
  } else if (initialHash === "#cellular") {
    showModel("cellular", false);
  } else if (initialHash === "#turing") {
    showModel("turing", false);
  } else if (initialHash === "#particles") {
    showModel("particles", false);
  } else if (initialHash === "#dxpatch" || initialHash === "#dxpatchgen" || initialHash === "#patch-generator") {
    showModel("dxpatch", false);
  } else {
    showLanding(false);
  }
}
