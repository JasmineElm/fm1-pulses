// knob.js — rotary knob + toggle for the rack panel. Pure DOM/SVG, no deps.
//
// A knob is an SVG dial with a 270° sweep, a pointer, a value readout and a label.
// Interaction: drag vertically, mouse wheel, arrow keys, double-click to reset,
// hold shift while dragging for fine control. touch-action:none keeps the page
// from scrolling under a finger drag.

const NS = "http://www.w3.org/2000/svg";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const polar = (cx, cy, r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

const SWEEP = 270;
const A0 = -SWEEP / 2;
const A1 = SWEEP / 2;
const SIZES = { lg: 66, md: 52, sm: 40 };

export function knob({ label, min, max, step = 1, value = 0, def, size = "md", format, onInput }) {
  const px = SIZES[size] || SIZES.md;
  const el = document.createElement("div");
  el.className = `knob k-${size}`;
  el.tabIndex = 0;
  el.setAttribute("role", "slider");

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", px);
  svg.setAttribute("height", px);

  const track = document.createElementNS(NS, "path");
  track.setAttribute("d", arc(50, 50, 40, A0, A1));
  track.setAttribute("class", "k-track");
  const fill = document.createElementNS(NS, "path");
  fill.setAttribute("class", "k-fill");
  const ptr = document.createElementNS(NS, "line");
  ptr.setAttribute("class", "k-ptr");
  const hub = document.createElementNS(NS, "circle");
  hub.setAttribute("cx", 50); hub.setAttribute("cy", 50); hub.setAttribute("r", 4.5);
  hub.setAttribute("class", "k-hub");
  svg.append(track, fill, ptr, hub);

  const val = document.createElement("div");
  val.className = "k-val";
  const lab = document.createElement("div");
  lab.className = "k-lab";
  lab.textContent = label;

  el.append(svg, val, lab);

  const fmt = format || ((v) => (step < 1 ? String(Math.round(v * 100) / 100) : String(Math.round(v))));
  let cur = clamp(value, min, max);
  let drag = null;

  function paint() {
    const t = (cur - min) / (max - min);
    const ang = A0 + t * SWEEP;
    fill.setAttribute("d", t <= 0.001 ? "" : arc(50, 50, 40, A0, ang));
    const [x, y] = polar(50, 50, 29, ang);
    ptr.setAttribute("x1", 50); ptr.setAttribute("y1", 50);
    ptr.setAttribute("x2", x); ptr.setAttribute("y2", y);
    val.textContent = fmt(cur);
    el.title = `${label}: ${fmt(cur)}`;
    el.setAttribute("aria-valuemin", String(min));
    el.setAttribute("aria-valuemax", String(max));
    el.setAttribute("aria-valuenow", String(cur));
  }

  function set(v, fire = true) {
    let n = clamp(Number(v) || 0, min, max);
    if (step > 0) n = clamp(Math.round(n / step) * step, min, max);
    if (n === cur) { paint(); return; }
    cur = n;
    paint();
    if (fire && onInput) onInput(cur);
  }

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drag = { y: e.clientY, v: cur };
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const range = max - min;
    const sens = e.shiftKey ? 900 : 180;   // px of travel for the full range
    set(drag.v + (drag.y - e.clientY) / sens * range);
  });
  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    el.classList.remove("dragging");
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  el.addEventListener("wheel", (e) => { e.preventDefault(); set(cur + (e.deltaY < 0 ? 1 : -1) * step); }, { passive: false });
  el.addEventListener("dblclick", () => { if (def != null) set(def); });
  el.addEventListener("keydown", (e) => {
    const mult = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); set(cur + step * mult); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); set(cur - step * mult); }
    else if (e.key === "Home") { e.preventDefault(); set(min); }
    else if (e.key === "End") { e.preventDefault(); set(max); }
  });

  paint();
  el.setValue = (v, fire) => set(v, fire);
  el.setRange = (lo, hi) => {
    min = lo; max = hi;
    if (cur > max) set(max); else if (cur < min) set(min); else paint();
  };
  Object.defineProperty(el, "value", { get: () => cur });
  return el;
}

export function toggle({ label, value = false, onInput }) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "toggle" + (value ? " on" : "");
  el.textContent = label;
  el.addEventListener("click", () => {
    const on = !el.classList.contains("on");
    el.classList.toggle("on", on);
    if (onInput) onInput(on);
  });
  el.setValue = (v) => el.classList.toggle("on", !!v);
  return el;
}
