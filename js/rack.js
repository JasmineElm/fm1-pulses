// rack.js — Main entrypoint and UI assembly for FM-1 Pulses.
import {
  state, DEFAULT, refs, R, setState, RATE_NAMES, SLOTS, status,
  doGenerate, scheduleRegen, onRegen, onTempoProbe,
  getSelected, setSelected, getBank, getPrevGateBlend, setPrevGateBlend,
  getCurrentModelRandomizer, refreshLoopInfo
} from "./state.js";

export { refreshLoopInfo };
import { knob, dropdown, fader, seedControl, toggleBtn, actionBtn } from "./controls.js";
import { renderBuffer, applyLocks, refreshLockCount, fitSteps, buildEditor, onSelectSlot } from "./grid.js?v=1";
import { buildAudioControls, toggleLive, stopLive, playOnce, isLive, onPlayStartSync } from "./player.js?v=1";
import { syncDeviceTempo, scheduleTempoProbe, initMidi } from "./device.js";
import { exportState, importState, renderPresets, onSyncRack } from "./storage.js";
import { buildTheme } from "./themes.js";
import { initScope, renderScope } from "./scope.js";
import { initModes, getActiveModel } from "./modes.js";
import { SCALES, LFO_WAVES, midiName, classicName } from "./generator.js";
import { createNotesSection } from "./scale.js?v=1";
import { createHumaniseSection } from "./humanise.js?v=1";
import { createVelocitySection } from "./velocity.js?v=1";
import { initCellular, activateCellularModel, deactivateCellularModel } from "./cellular.js?v=1";
import { initTuring, activateTuringModel, deactivateTuringModel } from "./turing.js?v=1";
import { initParticles, activateParticlesModel, deactivateParticlesModel } from "./particles.js?v=1";
import { initPendulum, activatePendulumModel, deactivatePendulumModel } from "./pendulum.js?v=1";
import { initFlock, activateFlockModel, deactivateFlockModel } from "./flock.js?v=1";
import { initRungler, activateRunglerModel, deactivateRunglerModel } from "./rungler.js?v=3";
import { initKrell, activateKrellModel, deactivateKrellModel } from "./krell.js?v=1";
import { initDxPatch, activateDxPatch, deactivateDxPatch } from "./dxpatch.js?v=2";
import { initLibrarian, activateLibrarian, deactivateLibrarian } from "./librarian.js?v=2";
import { initRhythm, syncRhythmGrid } from "./rhythm.js?v=1";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

let mene311NotesSection = null;
let mene311HumaniseSection = null;
let mene311VelocitySection = null;

// Register hooks
onRegen(() => {
  if (getActiveModel() === "mene311") {
    applyLocks();
    renderBuffer();
    syncRhythmGrid();
  }
});

onTempoProbe(() => {
  scheduleTempoProbe();
});

onSelectSlot((slot) => {
  if (!isLive()) playOnce(slot);
});

onSyncRack(() => {
  syncRack();
  refreshLoopInfo();
});

onPlayStartSync(() => {
  syncDeviceTempo().then((held) => {
    if (held) status(`playing · device holds ${held} BPM — Tempo synced`, "ok");
  });
});

let adjustingLoop = false;
export function refreshLoopRanges() {
  if (adjustingLoop) return;
  const from = refs.loopFrom, len = refs.loop;
  if (!from || !len) return;
  adjustingLoop = true;
  try {
    const L = Math.max(3, Math.round(state.length || 64));
    from.setRange(1, Math.max(1, L - 2));
    const a = Math.round(from.value);
    len.setRange(2, Math.max(2, L - a + 1));
  } finally { adjustingLoop = false; }
  refreshLoopInfo();
}



export function syncRack() {
  for (const [k, el] of Object.entries(refs)) if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  if (mene311NotesSection) mene311NotesSection.sync();
  if (mene311HumaniseSection) mene311HumaniseSection.sync();
  if (mene311VelocitySection) mene311VelocitySection.sync();
  if (refs.gateBlend?.setCheckbox) refs.gateBlend.setCheckbox(state.gateBlend <= 0);
  if (refs.randVelAmt?.setCheckbox) refs.randVelAmt.setCheckbox(!!state.randVel);
  if (state.gateBlend > 0) setPrevGateBlend(state.gateBlend);
  refreshLoopRanges();
}

export function randomize() {
  const modelRnd = getCurrentModelRandomizer();
  if (modelRnd) {
    modelRnd();
    return;
  }
  state.seed = (Math.random() * 1e9) | 0;
  Object.assign(state, {
    scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
    lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
    lfoShape: (Math.random() * 100) | 0,
    lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
    gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
    spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
    octaveMode: ["up", "down", "both"][(Math.random() * 3) | 0],
    quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    gateQuant: (Math.random() * 100) | 0, humanize: (Math.random() * 100) | 0,
    gateBlend: (Math.random() * 100) | 0, euclidRot: (Math.random() * 16) | 0,
  });
  syncRack();
  doGenerate(true);
}

function sect(title, span, kids) {
  const s = document.createElement("section");
  s.className = "sect";
  s.style.gridColumn = `span ${span}`;
  const h = document.createElement("h3");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "sgrid";
  const hasCustomSpan = kids.some((k) => k.style && k.style.gridColumn);
  const cols = hasCustomSpan ? span : (kids.length || span);
  g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  g.append(...kids);
  s.append(h, g);
  return s;
}

export function buildGlobalBar() {
  const container = document.getElementById("global-controls");
  if (!container) return;
  container.innerHTML = "";
  container.append(
    R("tempo", knob({ label: "Tempo", min: 30, max: 300, value: state.tempo, def: DEFAULT.tempo, size: "sm",
      format: (v) => `${Math.round(v)}`, onInput: setState("tempo"),
      onDblClick: () => {
        syncDeviceTempo().then((held) => {
          status(held ? `device holds ${held} BPM — Tempo synced` : "could not read the device tempo", held ? "ok" : "err");
        });
      },
      tip: "BPM is device-global on the FM-1 — the unit's own BPM governs playback. The app syncs to the device when it connects; double-click re-reads now." })),
    R("seed", seedControl({
      label: "Pattern",
      value: state.seed,
      onInput: (v) => { state.seed = v; scheduleRegen(); },
      onRandomize: () => { randomize(); },
      tip: "Randomise pattern and seed (R or G)"
    })),
    R("rate", dropdown({
      label: "Note",
      options: RATE_NAMES.map((t, v) => ({ v, t })),
      value: state.rate,
      onInput: (v) => {
        state.rate = Number(v);
        refreshLoopRanges();
        scheduleRegen();
      },
      tip: "Step note value"
    })),
    R("length", knob({ label: "Length", min: 1, max: 64, value: state.length, def: DEFAULT.length, size: "sm",
      format: (v) => `${Math.round(v)}`, onInput: (v) => { state.length = v; refreshLoopRanges(); scheduleRegen(); syncRhythmGrid(); },
      tip: "Pattern length in steps (1 to 64)." })),
    R("gate", knob({ label: "Gate Len", min: 5, max: 100, value: state.gate, def: DEFAULT.gate, size: "sm",
      format: (v) => `${Math.round(v)}%`, onInput: setState("gate"),
      tip: "Gate length: duration of each note as a percentage of step time." }))
  );
}

export function buildGrooveBar() {
  const container = document.getElementById("humanise-velocity-bar");
  if (!container) return;
  container.innerHTML = "";

  mene311HumaniseSection = createHumaniseSection({
    title: "Humanise",
    humanizeKey: "humanize",
    swingKey: "swing",
    span: 0,
    onChange: () => {
      scheduleRegen();
    }
  });

  mene311VelocitySection = createVelocitySection({
    title: "Velocity",
    span: 0,
    onChange: () => {
      scheduleRegen();
    }
  });

  container.append(mene311HumaniseSection.sectEl, mene311VelocitySection.sectEl);
}

export function buildNotesBar() {
  const container = document.getElementById("notes-bar");
  if (!container) return;

  mene311NotesSection = createNotesSection({
    container,
    title: "Notes",
    scaleKey: "scale",
    customScaleKey: "customScale",
    rootKey: "root",
    rootNoteKey: "rootNote",
    rootOctaveKey: "rootOctave",
    pitchSpanKey: "pitchSpan",
    defaultPitchSpan: 3,
    quantKey: "quantSteps",
    octaveKey: "octave",
    octaveModeKey: "octaveMode",
    defaultOctave: 4,
    scaleLabel: "Scale",
    isFullWidth: true,
    badgeText: "Key & Scale",
    onChange: () => {
      // Mirror to ca*, turing*, particle*, flock*, and pendulum*
      state.caScale = state.scale;
      state.turingScale = state.scale;
      state.particleScale = state.scale;
      state.flockScale = state.scale;
      state.pendulumScale = state.scale;
      state.runglerScale = state.scale;
      state.krellScale = state.scale;
      state.caCustomScale = state.customScale;
      state.turingCustomScale = state.customScale;
      state.particleCustomScale = state.customScale;
      state.flockCustomScale = state.customScale;
      state.pendulumCustomScale = state.customScale;
      state.runglerCustomScale = state.customScale;
      state.krellCustomScale = state.customScale;
      state.caRoot = state.root;
      state.turingRoot = state.root;
      state.particleRoot = state.root;
      state.flockRoot = state.root;
      state.pendulumRoot = state.root;
      state.runglerRoot = state.root;
      state.krellRoot = state.root;
      state.caRootNote = state.rootNote;
      state.turingRootNote = state.rootNote;
      state.particleRootNote = state.rootNote;
      state.flockRootNote = state.rootNote;
      state.pendulumRootNote = state.rootNote;
      state.runglerRootNote = state.rootNote;
      state.krellRootNote = state.rootNote;
      state.caRootOctave = state.rootOctave;
      state.turingRootOctave = state.rootOctave;
      state.particleRootOctave = state.rootOctave;
      state.flockRootOctave = state.rootOctave;
      state.pendulumRootOctave = state.rootOctave;
      state.runglerRootOctave = state.rootOctave;
      state.krellRootOctave = state.rootOctave;
      state.caPitchSpan = state.pitchSpan;
      state.caOctaves = state.pitchSpan;
      state.turingSpan = state.pitchSpan;
      state.particleOctaves = state.pitchSpan;
      state.pendulumPitchSpan = state.pitchSpan;
      state.pendulumOctaves = state.pitchSpan;
      state.runglerSpan = state.pitchSpan;
      state.krellSpan = state.pitchSpan;
      if (refs.turingSpan?.setValue) refs.turingSpan.setValue(state.pitchSpan, false);
      if (refs.runglerSpan?.setValue) refs.runglerSpan.setValue(state.pitchSpan, false);
      if (refs.krellSpan?.setValue) refs.krellSpan.setValue(state.pitchSpan, false);
      state.caQuantSteps = state.quantSteps;
      state.turingQuantSteps = state.quantSteps;
      state.particleQuantSteps = state.quantSteps;
      state.caOctave = state.octave;
      state.turingOctave = state.octave;
      state.particleOctave = state.octave;
      state.caOctaveMode = state.octaveMode;
      state.turingOctaveMode = state.octaveMode;
      state.particleOctaveMode = state.octaveMode;

      scheduleRegen();
    }
  });
}

export function buildRack() {
  buildGlobalBar();
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.innerHTML = "";

  panel.append(

    (() => {
      const span = (el, cols) => { el.style.gridColumn = `span ${cols}`; return el; };
      const blank = () => span(document.createElement("div"), 2);
      const hr = () => span(document.createElement("hr"), 6);

      return sect("Shape", 6, [
        span(R("gravity", fader({ label: "Root grav", min: 0, max: 100, value: state.gravity, def: DEFAULT.gravity,
          format: (v) => `${Math.round(v)}%`, onInput: setState("gravity"), tip: "Pulls pitches towards the root note." })), 4),
        blank(),

        span(R("lfoOffset", fader({ label: "Offset", min: -100, max: 100, value: state.lfoOffset, def: DEFAULT.lfoOffset,
          format: (v) => `${Math.round(v)}`, onInput: setState("lfoOffset"), tip: "Center pitch of the phrase range, relative to Root." })), 4),
        span(R("unipolar", toggleBtn("Unipolar", state.unipolar, (v) => { state.unipolar = !!v; scheduleRegen(); }, "Unipolar range: off = bipolar around Offset; on = Offset is floor and notes only rise.", "right")), 2),

        hr(),

        span(R("lfoAmp", fader({ label: "Amp", min: 0, max: 100, value: state.lfoAmp, def: DEFAULT.lfoAmp,
          format: (v) => `${Math.round(v)}%`, onInput: setState("lfoAmp"), tip: "Pitch span reach around Offset." })), 4),
        blank(),

        span(R("lfoRate", fader({ label: "Cycles", min: 1, max: 16, step: 0.5, value: state.lfoRate, def: DEFAULT.lfoRate,
          format: (v) => `${v}`, onInput: setState("lfoRate"), tip: "Number of wave cycles across the pattern." })), 4),
        span(R("lfoWave", dropdown({ label: "Wave", options: LFO_WAVES.map((w) => ({ v: w, t: w })), value: state.lfoWave, onInput: (v) => { state.lfoWave = v; scheduleRegen(); }, tip: "LFO wave pitch source", labelPos: "right" })), 2),

        span(R("lfoShape", fader({ label: "Morph", min: 0, max: 100, value: state.lfoShape, def: DEFAULT.lfoShape,
          format: (v) => `${Math.round(v)}%`, onInput: setState("lfoShape"), tip: "Wave morph — sine: fold; triangle/saw: bend; square: pulse width; perlin: shimmer; random: slew." })), 4),
        blank(),

        span(R("bias", fader({ label: "Bias", min: -100, max: 100, value: state.bias, def: DEFAULT.bias,
          format: (v) => `${Math.round(v)}`, onInput: setState("bias"), tip: "Pitch distribution bias: negative favors lower notes, positive favors higher." })), 4),
        span(R("spread", dropdown({ label: "Spread", options: ["constant", "bell", "uniform", "extremes"].map((s) => ({ v: s, t: s })), value: state.spread, onInput: (v) => { state.spread = v; scheduleRegen(); }, tip: "Pitch distribution spread", labelPos: "right" })), 2),
      ]);
    })(),

    (() => {
      const span = (el, cols) => { el.style.gridColumn = `span ${cols}`; return el; };
      const blank = () => span(document.createElement("div"), 2);

      return sect("Memory", 6, [
        span(R("loopFrom", fader({
          label: "Loop from", min: 1, max: Math.max(1, state.length - 2), step: 1, value: state.loopFrom, def: DEFAULT.loopFrom,
          format: (v) => `${Math.round(v)}`,
          tip: "where the motif starts. Everything before it plays once as an intro. The motif itself sounds once too — the copies begin one motif later (motif 42-49, copies from 50).",
          onInput: (v) => { state.loopFrom = Math.round(v); refreshLoopRanges(); scheduleRegen(); }
        })), 4),
        blank(),

        span(R("loop", fader({
          label: "Loop len", min: 2, max: Math.max(2, state.length - 1), step: 1, value: state.loop, def: DEFAULT.loop,
          format: (v) => `${Math.round(v)}`,
          tip: "how many steps the motif holds. The motif tiles from its own end to the end of the phrase.",
          onInput: (v) => { state.loop = Math.round(v); refreshLoopInfo(); scheduleRegen(); }
        })), 4),
        blank(),

        span(R("dejaVu", fader({
          label: "Deja Vu", min: 0, max: 100, value: state.dejaVu, def: DEFAULT.dejaVu,
          format: (v) => `${Math.round(v)}%`,
          tip: "chance each step past the motif copies it instead of playing a fresh note. 100% = solid repeat; lower lets new notes bleed through. Copied steps are marked in the grid.",
          onInput: setState("dejaVu")
        })), 4),
        span(actionBtn("Lock", () => {
          state.dejaVu = 0;
          if (refs.dejaVu) refs.dejaVu.setValue(0);
          scheduleRegen();
          status("Deja Vu set to 0%");
        }, "Set Deja Vu to 0%"), 2),
      ]);
    })(),
  );
}

function buildTransport() {
  document.getElementById("audition")?.addEventListener("click", toggleLive);
  buildAudioControls();
  document.getElementById("export")?.addEventListener("click", exportState);
  const finp = document.getElementById("importfile");
  document.getElementById("import")?.addEventListener("click", () => finp?.click());
  finp?.addEventListener("change", () => {
    const f = finp.files[0];
    if (f) importState(f);
    finp.value = "";
  });

  // Landing Page LOAD button, footer link, and Drag-and-Drop
  const landingFile = document.getElementById("landing-load-file");
  landingFile?.addEventListener("change", () => {
    const f = landingFile.files?.[0];
    if (f) importState(f);
    landingFile.value = "";
  });

  const landingFooterFile = document.getElementById("landing-footer-load-file");
  landingFooterFile?.addEventListener("change", () => {
    const f = landingFooterFile.files?.[0];
    if (f) importState(f);
    landingFooterFile.value = "";
  });

  const landingEl = document.getElementById("view-landing");
  if (landingEl) {
    landingEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      landingEl.classList.add("drag-hover");
    });
    landingEl.addEventListener("dragleave", () => {
      landingEl.classList.remove("drag-hover");
    });
    landingEl.addEventListener("drop", (e) => {
      e.preventDefault();
      landingEl.classList.remove("drag-hover");
      const f = e.dataTransfer?.files?.[0];
      if (f) importState(f);
    });
  }

  const bleBtn = document.getElementById("ble");
  const blePaint = (s) => {
    if (!bleBtn) return;
    if (s === "open") bleBtn.textContent = "bluetooth ✓";
    else if (s === "reconnecting") bleBtn.textContent = "bluetooth …";
    else bleBtn.textContent = "bluetooth";
  };
  if (bleBtn) {
    if (!midi.bleSupported()) bleBtn.style.display = "none";
    else {
      bleBtn.addEventListener("click", async () => {
        if (midi.bleConnected()) {
          midi.disconnectBle();
          status("bluetooth disconnected");
          return;
        }
        try {
          status("bluetooth: connect…");
          const name = await midi.connectBle();
          status(`bluetooth ✓ ${name} — notes ride BLE`, "ok");
        } catch (e) {
          status("bluetooth: " + (e.message || e), "err");
        }
      });
      midi.onBleState((s) => {
        blePaint(s);
        if (s === "drop") status("bluetooth dropped — reconnecting…", "err");
        else if (s === "reconnecting") status("bluetooth reconnecting…");
        else if (s === "open") status("bluetooth ✓ reconnected — notes ride BLE", "ok");
        else if (s === "lost") status("bluetooth reconnect failed — tap bluetooth to retry", "err");
        else if (s === "closed") status("bluetooth disconnected");
      });
    }
  }

  renderPresets();
}

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const active = getActiveModel();
  if (!active || active === "dxpatch" || active === "va" || active === "librarian") return;
  if (e.code === "Space") { e.preventDefault(); toggleLive(); return; }
  if (e.key === "m" || e.key === "M") {
    const muteBtn = document.getElementById("mute");
    const m = !audio.isMuted();
    audio.setMuted(m);
    if (muteBtn) muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
    return;
  }
  if (e.key === "r" || e.key === "R" || e.key === "g" || e.key === "G") {
    randomize();
    return;
  }
});

// Tab visibility re-sync
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && midi.hasAccess() && midi.findFm1()) syncDeviceTempo();
});

// Tooltips on/off observer
let tipsOn = localStorage.getItem("fm1p.tips") !== "off";
const tipsLink = document.getElementById("tips");
function applyTips() {
  document.querySelectorAll("[title], [data-tip]").forEach((el) => {
    if (tipsOn) { if (el.dataset.tip) el.setAttribute("title", el.dataset.tip); }
    else if (el.hasAttribute("title")) { el.dataset.tip = el.getAttribute("title"); el.removeAttribute("title"); }
  });
  if (tipsLink) tipsLink.textContent = tipsOn ? "tips on" : "tips off";
}
tipsLink?.addEventListener("click", () => {
  tipsOn = !tipsOn;
  localStorage.setItem("fm1p.tips", tipsOn ? "on" : "off");
  applyTips();
  status(tipsOn ? "tooltips on" : "tooltips off");
});
new MutationObserver((muts) => {
  if (tipsOn) return;
  for (const m of muts) {
    const el = m.target, t = el.getAttribute && el.getAttribute("title");
    if (t != null) { el.dataset.tip = t; el.removeAttribute("title"); }
  }
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["title"] });

window.addEventListener("resize", () => { fitSteps(); renderScope(); });

// Application Bootstrap
buildTheme();
buildRack();
buildNotesBar();
buildGrooveBar();
refreshLoopRanges();
buildTransport();
buildEditor();
initScope();
initRhythm(document.getElementById("rhythm-bar"), document.getElementById("sequence"));
initCellular();
initTuring();
initParticles();
initPendulum();
initFlock();
initRungler();
initKrell();
initDxPatch();
initLibrarian();
doGenerate(true);
initMidi();
initModes({
  onEnterModel: (modelId) => {
    renderPresets();
    if (mene311NotesSection) mene311NotesSection.sync();
    if (mene311HumaniseSection) mene311HumaniseSection.sync();
    if (mene311VelocitySection) mene311VelocitySection.sync();
    if (modelId === "mene311") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      fitSteps();
      renderScope();
      renderBuffer();
      syncRhythmGrid();
    } else if (modelId === "cellular") {
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      activateCellularModel();
    } else if (modelId === "turing") {
      deactivateCellularModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      activateTuringModel();
    } else if (modelId === "particles") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      activateParticlesModel();
    } else if (modelId === "pendulum") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      activatePendulumModel();
    } else if (modelId === "flock") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      if (isLive()) stopLive();
      activateFlockModel();
    } else if (modelId === "rungler") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateKrellModel();
      deactivateDxPatch();
      deactivateLibrarian();
      activateRunglerModel();
    } else if (modelId === "krell") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateDxPatch();
      deactivateLibrarian();
      if (isLive()) stopLive();
      activateKrellModel();
    } else if (modelId === "dxpatch") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateLibrarian();
      if (isLive()) stopLive();
      activateDxPatch();
    } else if (modelId === "librarian") {
      deactivateCellularModel();
      deactivateTuringModel();
      deactivateParticlesModel();
      deactivatePendulumModel();
      deactivateFlockModel();
      deactivateRunglerModel();
      deactivateKrellModel();
      deactivateDxPatch();
      if (isLive()) stopLive();
      activateLibrarian();
    }
  },
  onLeaveModel: () => {
    try {
      if (isLive()) {
        stopLive();
      }
    } catch (e) {
      console.warn("Error stopping live audio:", e);
    }
    try { deactivateCellularModel(); } catch (e) { console.warn("Error deactivating cellular model:", e); }
    try { deactivateTuringModel(); } catch (e) { console.warn("Error deactivating turing model:", e); }
    try { deactivateParticlesModel(); } catch (e) { console.warn("Error deactivating particles model:", e); }
    try { deactivatePendulumModel(); } catch (e) { console.warn("Error deactivating pendulum model:", e); }
    try { deactivateFlockModel(); } catch (e) { console.warn("Error deactivating flock model:", e); }
    try { deactivateRunglerModel(); } catch (e) { console.warn("Error deactivating rungler model:", e); }
    try { deactivateKrellModel(); } catch (e) { console.warn("Error deactivating krell model:", e); }
    try { deactivateDxPatch(); } catch (e) { console.warn("Error deactivating dxpatch model:", e); }
    try { deactivateLibrarian(); } catch (e) { console.warn("Error deactivating librarian model:", e); }
  }
});
setTimeout(applyTips, 0);
