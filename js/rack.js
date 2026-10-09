// rack.js — Main entrypoint and UI assembly for FM-1 Pulses.
import {
  state, DEFAULT, refs, R, setState, RATE_NAMES, SLOTS, status,
  doGenerate, scheduleRegen, onRegen, onTempoProbe,
  getSelected, setSelected, getBank, getPrevGateBlend, setPrevGateBlend
} from "./state.js?v=100";
import { knob, dropdown, fader, seedControl, toggleBtn, actionBtn } from "./controls.js?v=100";
import { renderBank, renderBuffer, applyLocks, refreshLockCount, fitSteps, buildEditor, onSelectSlot } from "./grid.js?v=100";
import { buildAudioControls, toggleLive, stopLive, playOnce, isLive, onPlayStartSync } from "./player.js?v=100";
import { doFreeze, doSendAll, doClearAll, dumpGset, syncDeviceTempo, scheduleTempoProbe, initMidi } from "./device.js?v=100";
import { exportState, importState, exportSysex, renderPresets, onSyncRack } from "./storage.js?v=100";
import { buildTheme } from "./themes.js?v=100";
import { initScope, renderScope } from "./scope.js?v=100";
import { SCALES, LFO_WAVES, midiName, classicName } from "./generator.js?v=100";
import * as midi from "./midi.js?v=100";
import * as audio from "./audio.js?v=100";

// Register hooks
onRegen(() => {
  applyLocks();
  renderBank();
  renderBuffer();
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

export function refreshLoopInfo() {
  const el = document.getElementById("loopinfo");
  if (!el) return;
  const L = Math.max(3, Math.round(state.length || 64));
  const a = Math.round(refs.loopFrom?.value ?? 1);
  const n = Math.round(refs.loop?.value ?? 8);
  const reps = (L - a + 1) / n;
  const loopTxt = n >= 2 && a + n - 1 <= L ? `loop ${a}–${a + n - 1} ×${reps.toFixed(1)}` : "loop off";
  if (state.gateBlend > 0) {
    const blend = Math.min(100, Math.max(0, state.gateBlend ?? 0)) / 100;
    const divSetting = state.euclidDiv;
    const M = (divSetting && divSetting !== "auto" && !isNaN(Number(divSetting)))
      ? Math.max(2, Math.min(32, Math.round(Number(divSetting))))
      : Math.max(2, n >= 2 ? n : 16);
    const N = Math.max(0, Math.min(M, Math.round((state.gateProb ?? 70) / 100 * M)));
    const rot = ((state.euclidRot ?? 0) % M + M) % M;
    const classic = classicName(N, M);
    el.textContent = `${loopTxt} · E(${N},${M})${classic ? " (" + classic + ")" : ""}${rot ? " rot " + rot : ""}${blend < 1 ? " @" + Math.round(blend * 100) + "%" : ""}`;
  } else el.textContent = loopTxt;
}

export function syncRack() {
  for (const [k, el] of Object.entries(refs)) if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  if (refs.gateBlend?.setCheckbox) refs.gateBlend.setCheckbox(state.gateBlend <= 0);
  if (refs.randVelAmt?.setCheckbox) refs.randVelAmt.setCheckbox(!!state.randVel);
  if (state.gateBlend > 0) setPrevGateBlend(state.gateBlend);
  refreshLoopRanges();
}

export function randomize() {
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

export function buildRack() {
  const panel = document.getElementById("panel");
  if (!panel) return;

  panel.append(
    sect("Global", 6, [
      R("tempo", knob({ label: "Tempo", min: 30, max: 300, value: state.tempo, def: DEFAULT.tempo, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: setState("tempo"),
        onDblClick: () => {
          syncDeviceTempo().then((held) => {
            status(held ? `device holds ${held} BPM — Tempo synced` : "could not read the device tempo", held ? "ok" : "err");
          });
        },
        tip: "BPM is device-global on the FM-1 — freezing cannot change it; the unit's own BPM governs playback. The app re-syncs to the device after a freeze; double-click re-reads now." })),
      R("drift", knob({ label: "Drift", min: 0, max: 100, value: state.drift, def: DEFAULT.drift, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("drift"),
        tip: "Bank evolution: how much parameters mutate across slots 1 to 16. 0% = all slots share identical settings; higher = parameters progressively drift across the bank." })),
      R("seed", seedControl({ label: "Seed", value: state.seed, onInput: (v) => { state.seed = v; scheduleRegen(); }, tip: "Pattern seed (numeric or text)" })),
      R("rate", dropdown({ label: "Note", options: RATE_NAMES.map((t, v) => ({ v, t })), value: state.rate, onInput: (v) => { state.rate = Number(v); refreshLoopRanges(); scheduleRegen(); }, tip: "Step note value" })),
      R("length", knob({ label: "Length", min: 1, max: 64, value: state.length, def: DEFAULT.length, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.length = v; refreshLoopRanges(); scheduleRegen(); },
        tip: "Pattern length in steps (1 to 64)." })),
    ]),

    (() => {
      const span = (el, cols) => { el.style.gridColumn = `span ${cols}`; return el; };
      const blank = () => span(document.createElement("div"), 2);

      return sect("Rhythm", 6, [
        span(R("gateProb", fader({ label: "Gate", min: 0, max: 100, value: state.gateProb, def: DEFAULT.gateProb,
          format: (v) => `${Math.round(v)}%`,
          onInput: (v) => { state.gateProb = v; refreshLoopInfo(); scheduleRegen(); },
          tip: "random mode: chance each step fires. euclid mode: the DENSITY — Gate % becomes N hits evenly spaced over the cycle (see the loop info line)." })), 4),
        blank(),

        span(R("gateBlend", fader({ label: "Euclid", min: 0, max: 100, value: state.gateBlend, def: DEFAULT.gateBlend,
          format: (v) => v <= 0 ? "random" : v >= 100 ? "euclid" : `${Math.round(v)}%`,
          checkbox: {
            value: state.gateBlend <= 0,
            tip: "Random override: checked = random (0%); unchecked = restore Euclid %",
            onInput: (checked) => {
              if (checked) {
                if (state.gateBlend > 0) setPrevGateBlend(state.gateBlend);
                state.gateBlend = 0;
                refs.gateBlend.setValue(0);
                refreshLoopInfo();
                scheduleRegen();
                status("Euclid overridden to random (0%)");
              } else {
                const restored = getPrevGateBlend() > 0 ? getPrevGateBlend() : 100;
                state.gateBlend = restored;
                refs.gateBlend.setValue(restored);
                refreshLoopInfo();
                scheduleRegen();
                status(`Euclid restored to ${Math.round(restored)}%`);
              }
            }
          },
          onInput: (v) => {
            state.gateBlend = v;
            if (v > 0) setPrevGateBlend(v);
            refs.gateBlend?.setCheckbox(v <= 0);
            refreshLoopInfo();
            scheduleRegen();
          },
          tip: "Gradient between random placement (0%) and even Euclidean spacing (100%). In between, each step rolls which law it follows — Gate % is the density either way." })), 4),
        span(R("euclidDiv", dropdown({
          label: "Division",
          options: [
            { v: "auto", t: "Auto" },
            { v: "16", t: "16" },
            { v: "12", t: "12" },
            { v: "8", t: "8" },
            { v: "7", t: "7" },
            { v: "6", t: "6" },
            { v: "5", t: "5" },
            { v: "4", t: "4" },
            { v: "3", t: "3" },
          ],
          value: state.euclidDiv || "auto",
          onInput: (v) => { state.euclidDiv = v; refreshLoopInfo(); scheduleRegen(); },
          tip: "Euclidean pattern cycle division (total steps per cycle)",
          labelPos: "right"
        })), 2),

        span(R("euclidRot", fader({ label: "Rotate", min: 0, max: 15, step: 1, value: state.euclidRot, def: DEFAULT.euclidRot,
          format: (v) => `${Math.round(v)}`,
          onInput: (v) => { state.euclidRot = v; refreshLoopInfo(); scheduleRegen(); },
          tip: "Rotates the Euclidean hit pattern within its cycle (wraps). Only affects the euclid side of the gradient." })), 4),
        blank(),

        span(R("gateQuant", fader({ label: "Grid snap", min: 0, max: 100, value: state.gateQuant, def: DEFAULT.gateQuant,
          format: (v) => `${Math.round(v)}%`, onInput: setState("gateQuant"), tip: "Grid snap: probability a note survives only if it lands on a grid line." })), 4),
        span(R("snapGrid", dropdown({
          label: "Snap Grid",
          options: [2, 3, 4, 5, 6, 7, 8].map((n) => ({ v: n, t: String(n) })),
          value: state.snapGrid,
          onInput: (v) => { state.snapGrid = Number(v); scheduleRegen(); },
          tip: "Grid spacing in steps for the grid snap probability",
          labelPos: "right"
        })), 2),

        span(R("gate", fader({ label: "Gate len", min: 5, max: 100, value: state.gate, def: DEFAULT.gate,
          format: (v) => `${Math.round(v)}%`, onInput: setState("gate"), tip: "Gate length: duration of each note as a percentage of step time." })), 4),
        blank(),

        span(R("humanize", fader({ label: "Humanize", min: 0, max: 100, value: state.humanize, def: DEFAULT.humanize,
          format: (v) => `${Math.round(v)}%`, onInput: setState("humanize"), tip: "Adds subtle timing jitter to make playback feel human." })), 4),
        blank(),

        span(R("swing", fader({ label: "Swing", min: 50, max: 75, value: state.swing, def: DEFAULT.swing,
          format: (v) => `${Math.round(v)}%`, onInput: setState("swing"), tip: "Delays every other step. 50% is straight, 75% is triplet (2:1)." })), 4),
        blank(),
      ]);
    })(),

    (() => {
      const span = (el, cols) => { el.style.gridColumn = `span ${cols}`; return el; };
      const blank = () => span(document.createElement("div"), 2);
      const hr = () => span(document.createElement("hr"), 6);

      return sect("Shape", 6, [
        span(R("root", fader({ label: "Root", min: 24, max: 84, value: state.root, def: DEFAULT.root,
          format: (v) => midiName(v), onInput: setState("root"), tip: "Scale root note (MIDI pitch). At Amp 0 every note lands on Offset." })), 4),
        span(R("scale", dropdown({ label: "Scale", options: Object.keys(SCALES).map((s) => ({ v: s, t: s })), value: state.scale, onInput: (v) => { state.scale = v; scheduleRegen(); }, tip: "Musical scale for pitch quantization", labelPos: "right" })), 2),

        span(R("quantSteps", fader({ label: "Quantize", min: 0, max: 100, value: state.quantSteps, def: DEFAULT.quantSteps,
          format: (v) => `${Math.round(v)}%`, onInput: setState("quantSteps"),
          tip: "Scale snap strength: probability notes lock to the chosen scale. 100% = strictly in-key; lower allows raw, out-of-scale chromatic pitches." })), 4),
        blank(),

        span(R("octave", fader({ label: "Octave Spread", min: 0, max: 100, value: state.octave, def: DEFAULT.octave,
          format: (v) => `${Math.round(v)}%`, onInput: setState("octave"), tip: "Chance of shifting a note by one octave (Up, Down, or Both)." })), 4),
        span(R("octaveMode", dropdown({ label: "Oct Spread", options: [{ v: "up", t: "Up" }, { v: "down", t: "Down" }, { v: "both", t: "Both" }], value: state.octaveMode, onInput: (v) => { state.octaveMode = v; scheduleRegen(); }, tip: "Octave spread direction: Up (+12 st), Down (-12 st), or Both (±12 st).", labelPos: "right" })), 2),

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

        span(R("velocity", fader({ label: "Velocity", min: 1, max: 127, value: state.velocity, def: DEFAULT.velocity,
          format: (v) => `${Math.round(v)}`,
          onInput: setState("velocity"),
          tip: "Base note velocity (1-127)."
        })), 4),
        span(R("randVelAmt", fader({ label: "Rnd Amt", min: 0, max: 100, value: state.randVelAmt ?? 0, def: DEFAULT.randVelAmt ?? 0,
          format: (v) => `${Math.round(v)}%`,
          onInput: setState("randVelAmt"),
          tip: "Intensity of velocity randomisation.",
          checkbox: { label: "Rnd", value: state.randVel, tip: "Enable random velocity variation", onInput: (v) => { state.randVel = v; scheduleRegen(); } }
        })), 4),
        span((() => {
          const wrap = document.createElement("div");
          wrap.className = "vel-bounds-wrap";
          wrap.append(
            R("velMin", knob({
              label: "Min",
              min: 1,
              max: 127,
              value: state.velMin ?? 1,
              def: DEFAULT.velMin ?? 1,
              size: "sm",
              onInput: (v) => { state.velMin = Number(v); scheduleRegen(); },
              tip: "Lower bound for velocity randomisation (1–127)"
            })),
            R("velMax", knob({
              label: "Max",
              min: 1,
              max: 127,
              value: state.velMax ?? 127,
              def: DEFAULT.velMax ?? 127,
              size: "sm",
              onInput: (v) => { state.velMax = Number(v); scheduleRegen(); },
              tip: "Upper bound for velocity randomisation (1–127)"
            }))
          );
          return wrap;
        })(), 2),
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
  document.getElementById("gen")?.addEventListener("click", () => doGenerate(true));
  document.getElementById("rand")?.addEventListener("click", randomize);
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
  document.getElementById("syx")?.addEventListener("click", exportSysex);

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
          status(`bluetooth ✓ ${name} — notes ride BLE, freeze still uses USB`, "ok");
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

  document.getElementById("freeze")?.addEventListener("click", () => doFreeze(getSelected()));
  document.getElementById("fill")?.addEventListener("click", doSendAll);
  document.getElementById("clearall")?.addEventListener("click", doClearAll);
  document.getElementById("diag")?.addEventListener("click", dumpGset);
  renderPresets();
}

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); toggleLive(); }
  if (e.key === "m" || e.key === "M") {
    const muteBtn = document.getElementById("mute");
    const m = !audio.isMuted();
    audio.setMuted(m);
    if (muteBtn) muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
  }
  if (e.key === "f" || e.key === "F") doFreeze(getSelected());
  if (e.key === "g" || e.key === "G") doGenerate(true);
  if (e.key === "ArrowRight") {
    setSelected((getSelected() + 1) % SLOTS);
    renderBank();
    renderBuffer();
  }
  if (e.key === "ArrowLeft") {
    setSelected((getSelected() + SLOTS - 1) % SLOTS);
    renderBank();
    renderBuffer();
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
refreshLoopRanges();
buildTransport();
buildEditor();
initScope();
doGenerate(true);
initMidi();
setTimeout(applyTips, 0);
