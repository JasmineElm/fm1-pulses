// humanise.js — Unified Humanise & Swing Groove section for FM-1 Pulses.
import { state, refs, R, status } from "./state.js";
import { fader } from "./controls.js";

// Swing Groove Presets
export const SWING_PRESETS = [
  { label: "50% Straight", value: 50 },
  { label: "54% Light", value: 54 },
  { label: "58% MPC", value: 58 },
  { label: "66% Hard", value: 66 },
  { label: "75% Triplet", value: 75 },
];

// Humanize Jitter Presets
export const HUMANIZE_PRESETS = [
  { label: "0% Tight", value: 0 },
  { label: "20% Subtle", value: 20 },
  { label: "45% Loose", value: 45 },
  { label: "80% Wild", value: 80 },
];

/**
 * Creates a reusable "Humanise" section containing:
 * - Humanize: micro-timing jitter fader (0%–100%)
 * - Swing: step swing groove fader (50%–75%)
 * - Quick groove preset pills for instant setting
 *
 * @param {Object} options
 * @param {string} [options.title="Humanise"] - Section title
 * @param {string} [options.humanizeKey="humanize"] - State key for humanize
 * @param {string} [options.swingKey="swing"] - State key for swing
 * @param {number} [options.span=6] - Grid column span for Traditional panel
 * @param {string} [options.extraClass=""] - Extra CSS class
 * @param {Function} [options.onChange] - Callback on input change
 * @returns {{ sectEl: HTMLElement, humCtrl: HTMLElement, swingCtrl: HTMLElement, sync: Function }}
 */
export function createHumaniseSection(options = {}) {
  const title = options.title || "Humanise";
  const humanizeKey = options.humanizeKey || "humanize";
  const swingKey = options.swingKey || "swing";
  const span = options.span || 6;
  const extraClass = options.extraClass || "";
  const onChange = options.onChange || null;

  const sectEl = document.createElement("section");
  sectEl.className = `sect humanise-section ${extraClass}`.trim();
  if (span) sectEl.style.gridColumn = `span ${span}`;

  // Section Header
  const headEl = document.createElement("div");
  headEl.className = "humanise-head";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const badge = document.createElement("span");
  badge.className = "humanise-badge";
  badge.textContent = "Timing & Groove";
  headEl.append(h3, badge);
  sectEl.appendChild(headEl);

  const bodyEl = document.createElement("div");
  bodyEl.className = "humanise-body";

  // 1. Humanize Fader
  const humCtrl = fader({
    label: "Humanize",
    min: 0,
    max: 100,
    step: 1,
    value: state[humanizeKey] ?? 0,
    def: 0,
    format: (v) => `${Math.round(v)}%`,
    tip: "Adds subtle micro-timing jitter to make playback feel human and organic.",
    onInput: (v) => {
      state[humanizeKey] = Math.round(v);
      updatePillStates();
      if (onChange) onChange();
      status(`Humanise: ${Math.round(v)}%`);
    }
  });

  // Humanize Pills
  const humPillsWrap = document.createElement("div");
  humPillsWrap.className = "humanise-presets-row";
  const humTag = document.createElement("span");
  humTag.className = "humanise-preset-tag";
  humTag.textContent = "Jitter:";
  humPillsWrap.appendChild(humTag);

  const humPillButtons = [];
  for (const hp of HUMANIZE_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "humanise-pill-btn";
    btn.textContent = hp.label;
    btn.title = `Set humanize jitter to ${hp.value}%`;
    btn.addEventListener("click", () => {
      state[humanizeKey] = hp.value;
      humCtrl.setValue(hp.value, false);
      updatePillStates();
      if (onChange) onChange();
      status(`Humanise set to ${hp.value}%`);
    });
    humPillsWrap.appendChild(btn);
    humPillButtons.push({ btn, value: hp.value });
  }

  // 2. Swing Fader
  const swingCtrl = fader({
    label: "Swing",
    min: 50,
    max: 75,
    step: 1,
    value: state[swingKey] ?? 50,
    def: 50,
    format: (v) => `${Math.round(v)}%`,
    tip: "Delays every other step. 50% is straight, 75% is triplet (2:1). Applied to preview audio and frozen patterns.",
    onInput: (v) => {
      state[swingKey] = Math.round(v);
      updatePillStates();
      if (onChange) onChange();
      status(`Swing: ${Math.round(v)}%`);
    }
  });

  // Swing Pills
  const swingPillsWrap = document.createElement("div");
  swingPillsWrap.className = "humanise-presets-row";
  const swingTag = document.createElement("span");
  swingTag.className = "humanise-preset-tag";
  swingTag.textContent = "Swing:";
  swingPillsWrap.appendChild(swingTag);

  const swingPillButtons = [];
  for (const sp of SWING_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "humanise-pill-btn";
    btn.textContent = sp.label;
    btn.title = `Set step swing to ${sp.value}%`;
    btn.addEventListener("click", () => {
      state[swingKey] = sp.value;
      swingCtrl.setValue(sp.value, false);
      updatePillStates();
      if (onChange) onChange();
      status(`Swing set to ${sp.value}%`);
    });
    swingPillsWrap.appendChild(btn);
    swingPillButtons.push({ btn, value: sp.value });
  }

  function updatePillStates() {
    const currentHum = state[humanizeKey] ?? 0;
    const currentSwing = state[swingKey] ?? 50;

    for (const item of humPillButtons) {
      item.btn.classList.toggle("is-active", Math.round(currentHum) === item.value);
    }
    for (const item of swingPillButtons) {
      item.btn.classList.toggle("is-active", Math.round(currentSwing) === item.value);
    }
  }

  // Register in refs if standard keys
  if (humanizeKey === "humanize") R("humanize", humCtrl);
  if (swingKey === "swing") R("swing", swingCtrl);

  bodyEl.append(humCtrl, humPillsWrap, swingCtrl, swingPillsWrap);
  sectEl.appendChild(bodyEl);

  updatePillStates();

  return {
    sectEl,
    humCtrl,
    swingCtrl,
    sync: () => {
      const hVal = state[humanizeKey] ?? 0;
      const sVal = state[swingKey] ?? 50;
      humCtrl.setValue(hVal, false);
      swingCtrl.setValue(sVal, false);
      updatePillStates();
    }
  };
}
