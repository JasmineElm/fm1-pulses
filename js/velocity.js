// velocity.js — Unified Velocity & Dynamics section for FM-1 Pulses.
import { state, DEFAULT, refs, R, status } from "./state.js";
import { fader, knob } from "./controls.js";

/**
 * Creates a reusable "Velocity" section containing:
 * - Velocity: Base note velocity fader (1 to 127)
 * - Rnd Amt: Velocity randomisation intensity fader (0% to 100%) with "Rnd" checkbox toggle
 * - Min/Max: Dual knobs for velocity randomisation range (1 to 127)
 *
 * @param {Object} [options={}]
 * @param {string} [options.title="Velocity"] - Section title
 * @param {string} [options.velocityKey="velocity"] - State key for base velocity
 * @param {string} [options.randVelKey="randVel"] - State key for random velocity enabled
 * @param {string} [options.randVelAmtKey="randVelAmt"] - State key for random velocity amount
 * @param {string} [options.velMinKey="velMin"] - State key for velocity min bound
 * @param {string} [options.velMaxKey="velMax"] - State key for velocity max bound
 * @param {number} [options.span=6] - Grid column span for panel layout
 * @param {string} [options.extraClass=""] - Extra CSS class
 * @param {Function} [options.onChange] - Callback on input change
 * @returns {{ sectEl: HTMLElement, velCtrl: HTMLElement, randVelAmtCtrl: HTMLElement, minCtrl: HTMLElement, maxCtrl: HTMLElement, sync: Function }}
 */
export function createVelocitySection(options = {}) {
  const title = options.title || "Velocity";
  const velocityKey = options.velocityKey || "velocity";
  const randVelKey = options.randVelKey || "randVel";
  const randVelAmtKey = options.randVelAmtKey || "randVelAmt";
  const velMinKey = options.velMinKey || "velMin";
  const velMaxKey = options.velMaxKey || "velMax";
  const span = options.span ?? 6;
  const extraClass = options.extraClass || "";
  const onChange = options.onChange || null;

  const sectEl = document.createElement("section");
  sectEl.className = `sect velocity-sect ${extraClass}`.trim();
  if (span) sectEl.style.gridColumn = `span ${span}`;

  // Section Header
  const headEl = document.createElement("div");
  headEl.className = "humanise-head";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  headEl.append(h3);
  sectEl.appendChild(headEl);

  // Section Body Grid (6 rails)
  const grid = document.createElement("div");
  grid.className = "sgrid velocity-sgrid";
  grid.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))";

  // 1. Velocity Fader (Span 6)
  const velCtrl = R(velocityKey, fader({
    label: "Velocity",
    min: 1,
    max: 127,
    value: state[velocityKey] ?? DEFAULT.velocity ?? 100,
    def: DEFAULT.velocity ?? 100,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      state[velocityKey] = Math.round(v);
      if (onChange) onChange();
      status(`Velocity: ${Math.round(v)}`);
    },
    tip: "Base note velocity (1-127)."
  }));
  velCtrl.style.gridColumn = "span 6";

  // 2. Random Velocity Amount Fader (Span 4) with Rnd Checkbox
  const randVelAmtCtrl = R(randVelAmtKey, fader({
    label: "Rnd Amt",
    min: 0,
    max: 100,
    value: state[randVelAmtKey] ?? DEFAULT.randVelAmt ?? 0,
    def: DEFAULT.randVelAmt ?? 0,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state[randVelAmtKey] = Math.round(v);
      if (onChange) onChange();
      status(`Velocity Rnd: ${Math.round(v)}%`);
    },
    tip: "Intensity of velocity randomisation.",
    checkbox: {
      label: "Rnd",
      value: !!state[randVelKey],
      tip: "Enable random velocity variation",
      onInput: (v) => {
        state[randVelKey] = !!v;
        if (onChange) onChange();
        status(state[randVelKey] ? "Random velocity enabled" : "Random velocity disabled");
      }
    }
  }));
  randVelAmtCtrl.style.gridColumn = "span 4";

  // 3. Min/Max Velocity Bounds Knobs (Span 2)
  const boundsWrap = document.createElement("div");
  boundsWrap.className = "vel-bounds-wrap";
  boundsWrap.style.gridColumn = "span 2";

  const minCtrl = R(velMinKey, knob({
    label: "Min",
    min: 1,
    max: 127,
    value: state[velMinKey] ?? DEFAULT.velMin ?? 1,
    def: DEFAULT.velMin ?? 1,
    size: "sm",
    onInput: (v) => {
      state[velMinKey] = Number(v);
      if (onChange) onChange();
    },
    tip: "Lower bound for velocity randomisation (1–127)"
  }));

  const maxCtrl = R(velMaxKey, knob({
    label: "Max",
    min: 1,
    max: 127,
    value: state[velMaxKey] ?? DEFAULT.velMax ?? 127,
    def: DEFAULT.velMax ?? 127,
    size: "sm",
    onInput: (v) => {
      state[velMaxKey] = Number(v);
      if (onChange) onChange();
    },
    tip: "Upper bound for velocity randomisation (1–127)"
  }));

  boundsWrap.append(minCtrl, maxCtrl);

  grid.append(velCtrl, randVelAmtCtrl, boundsWrap);
  sectEl.appendChild(grid);

  function sync() {
    if (velCtrl?.setValue && state[velocityKey] !== undefined) {
      velCtrl.setValue(state[velocityKey], false);
    }
    if (randVelAmtCtrl?.setValue && state[randVelAmtKey] !== undefined) {
      randVelAmtCtrl.setValue(state[randVelAmtKey], false);
    }
    if (randVelAmtCtrl?.setCheckbox && state[randVelKey] !== undefined) {
      randVelAmtCtrl.setCheckbox(!!state[randVelKey]);
    }
    if (minCtrl?.setValue && state[velMinKey] !== undefined) {
      minCtrl.setValue(state[velMinKey], false);
    }
    if (maxCtrl?.setValue && state[velMaxKey] !== undefined) {
      maxCtrl.setValue(state[velMaxKey], false);
    }
  }

  return {
    sectEl,
    velCtrl,
    randVelAmtCtrl,
    minCtrl,
    maxCtrl,
    sync
  };
}
