// controls.js — UI control components for the rack interface.
import { knob, sw, toggle, dropdown, fader } from "./knob.js?v=100";
import { state, status, scheduleRegen } from "./state.js?v=100";

export { knob, sw, toggle, dropdown, fader };

export function parseSeed(str) {
  if (typeof str === "number") return (str >>> 0);
  if (!str) return 0;
  const trimmed = String(str).trim().slice(0, 10);
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) >>> 0;
  }
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) {
    h = (Math.imul(31, h) + trimmed.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function seedControl({ label = "Seed", value = 0, onInput, tip = "Pattern seed (numeric or text)" }) {
  const wrap = document.createElement("div");
  wrap.className = "seed-wrap";

  const lab = document.createElement("div");
  lab.className = "k-lab";
  lab.textContent = label;

  const rndBtn = document.createElement("button");
  rndBtn.type = "button";
  rndBtn.className = "toggle seed-rnd-btn";
  rndBtn.textContent = "Randomise";
  rndBtn.title = "Generate a new random seed (keeps all other parameters unchanged)";
  rndBtn.style.width = "calc(100% - 8px)";
  rndBtn.style.maxWidth = "64px";
  rndBtn.style.boxSizing = "border-box";
  rndBtn.style.margin = "0 auto";
  rndBtn.addEventListener("click", () => {
    const s = (Math.random() * 1e9) | 0;
    input.value = String(s >>> 0).slice(0, 10);
    if (onInput) onInput(s);
    status(`New seed: ${s >>> 0}`);
  });

  const input = document.createElement("input");
  input.type = "text";
  input.className = "seed-input";
  input.maxLength = 10;
  input.size = 1;
  input.value = String(value >>> 0).slice(0, 10);
  input.title = tip;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.style.width = "calc(100% - 8px)";
  input.style.maxWidth = "64px";
  input.style.boxSizing = "border-box";
  input.style.margin = "0 auto";

  const update = () => {
    const s = parseSeed(input.value);
    if (onInput) onInput(s);
  };

  input.addEventListener("input", update);
  input.addEventListener("change", () => {
    const s = parseSeed(input.value);
    input.value = String(s >>> 0).slice(0, 10);
    if (onInput) onInput(s);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  wrap.append(lab, rndBtn, input);

  wrap.setValue = (v) => {
    const s = parseSeed(v);
    input.value = String(s >>> 0).slice(0, 10);
  };
  Object.defineProperty(wrap, "value", { get: () => parseSeed(input.value) });
  return wrap;
}

export function toggleBtn(label, value, onInput, tip = "", labelPos = "top") {
  const isRight = labelPos === "right";
  const wrap = document.createElement("div");
  wrap.className = isRight ? "toggle-wrap lab-right" : "ctrl-wrap";
  if (!isRight) {
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "flex-start";
    wrap.style.width = "100%";
  }

  const lab = document.createElement("div");
  lab.className = "k-lab";
  lab.textContent = label;
  if (!isRight) {
    lab.style.marginBottom = "6px";
  }

  const btn = toggle({
    label: value ? "on" : "off",
    value,
    onInput: (on) => {
      btn.textContent = on ? "on" : "off";
      onInput(on);
    },
  });
  if (tip) {
    btn.title = `${label}: ${tip}`;
    wrap.title = `${label}: ${tip}`;
  }
  if (!isRight) {
    btn.style.width = "calc(100% - 6px)";
    btn.style.margin = "0 auto";
  }

  if (isRight) {
    wrap.append(btn, lab);
  } else {
    wrap.append(lab, btn);
  }

  wrap.setValue = (v) => {
    btn.setValue(v);
    btn.textContent = v ? "on" : "off";
  };
  return wrap;
}

export function actionBtn(label, onClick, tip = "") {
  const wrap = document.createElement("div");
  wrap.className = "toggle-wrap lab-right";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toggle action-btn";
  btn.textContent = label;
  if (tip) btn.title = tip;
  btn.addEventListener("click", onClick);
  wrap.appendChild(btn);
  return wrap;
}

export function rotary(label, opts, value, onInput, size = "md") {
  const el = knob({
    label, min: 0, max: opts.length - 1, step: 1,
    value: Math.max(0, opts.findIndex((o) => String(o.v) === String(value))),
    def: 0, size, ticks: Math.max(1, opts.length - 1), majorEvery: 0, smallVal: true,
    format: (v) => opts[Math.min(opts.length - 1, Math.max(0, Math.round(v)))]?.t ?? "",
    onInput: (v) => { const o = opts[Math.round(v)]; if (o) onInput(o.v); },
  });
  const setIdx = el.setValue;
  el.setValue = (v) => {
    const i = opts.findIndex((o) => String(o.v) === String(v));
    if (i >= 0) setIdx(i, false);
  };
  return el;
}
