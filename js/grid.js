// grid.js — Pattern grid, bank slot selector, and step note editor.
import { state, getBank, getSelected, setSelected, locks, RATE_NAMES, SLOTS, status } from "./state.js?v=100";
import { midiName } from "./generator.js?v=100";
import { renderScope } from "./scope.js?v=100";

let editStep = -1;
let onSelectSlotCallback = null;

export function onSelectSlot(fn) { onSelectSlotCallback = fn; }

export function noteCount(p) {
  return p ? p.steps.slice(0, p.length).reduce((a, s) => a + s.notes.length, 0) : 0;
}

export function applyLocks() {
  const bank = getBank();
  for (const [key, notes] of locks) {
    const [s, i] = key.split(":").map(Number);
    const p = bank[s];
    if (p && p.steps[i]) p.steps[i].notes = notes.map((n) => ({ ...n }));
  }
}

export function refreshLockCount() {
  const el = document.getElementById("lockcount");
  if (el) el.textContent = locks.size ? `${locks.size} locked` : "";
}

export function renderBank() {
  const el = document.getElementById("bank");
  if (!el) return;
  el.innerHTML = "";
  const bank = getBank();
  const selected = getSelected();
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // loop region, 0-based
  const ln = Math.round(state.loop ?? 0);
  for (let s = 0; s < SLOTS; s++) {
    const p = bank[s];
    const cell = document.createElement("button");
    cell.className = "bankcell" + (s === selected ? " sel" : "");
    const num = document.createElement("span"); num.className = "bn"; num.textContent = s + 1;
    const mini = document.createElement("div"); mini.className = "mini";
    const loopOn = p && ln >= 2 && ls + ln <= p.length;
    for (let i = 0; i < 64; i++) {
      const d = document.createElement("i");
      const cls = [];
      if (p && i < p.length && p.steps[i] && p.steps[i].notes.length) cls.push("on");
      if (loopOn && i >= ls && i < ls + ln) {
        cls.push("loop");
        if (i === ls) cls.push("loopstart");
      }
      d.className = cls.join(" ");
      mini.appendChild(d);
    }
    const cnt = document.createElement("span"); cnt.className = "bc"; cnt.textContent = noteCount(p);
    cell.append(num, mini, cnt);
    cell.title = `slot ${s + 1}: ${noteCount(p)} notes`;
    cell.addEventListener("click", () => {
      setSelected(s);
      renderBank();
      renderBuffer();
      if (onSelectSlotCallback) onSelectSlotCallback(s);
    });
    el.appendChild(cell);
  }
  const el2 = document.getElementById("bufinfo");
  if (el2) el2.textContent = bank.length ? `drift ${state.drift}%` : "";
}

export function renderEditor() {
  const bank = getBank();
  const selected = getSelected();
  const p = bank[selected];
  const has = editStep >= 0 && p && p.steps[editStep];
  const stepEl = document.getElementById("estep");
  if (stepEl) stepEl.textContent = editStep >= 0 ? String(editStep + 1) : "—";
  const noteEl = document.getElementById("enote");
  const lockBtn = document.getElementById("elock");
  if (!noteEl || !lockBtn) return;
  if (!has) {
    noteEl.textContent = "—";
    lockBtn.textContent = "🔓"; lockBtn.classList.remove("on");
    return;
  }
  const notes = p.steps[editStep].notes;
  noteEl.textContent = notes.length ? notes.map((n) => midiName(n.note)).join(" ") : "(empty)";
  const isL = locks.has(`${selected}:${editStep}`);
  lockBtn.textContent = isL ? "🔒" : "🔓";
  lockBtn.classList.toggle("on", isL);
}

export function selectStep(i) {
  editStep = i;
  renderBuffer();
}

export function setStepNote(i, note) {
  const bank = getBank();
  const selected = getSelected();
  const p = bank[selected];
  if (!p || !p.steps[i]) return;
  if (note == null) p.steps[i].notes = [];
  else {
    const v = p.steps[i].notes[0]?.vel ?? state.velocity ?? 100;
    p.steps[i].notes = [{ note: Math.max(0, Math.min(127, note)), vel: Math.max(1, Math.min(127, v)) }];
  }
  delete p.steps[i].echo;   // an edited step is no longer a pure copy of the motif
  locks.set(`${selected}:${i}`, p.steps[i].notes.map((n) => ({ ...n })));
  renderBank(); renderBuffer(); refreshLockCount();
}

export function clearLocks() {
  locks.clear();
  renderBank(); renderBuffer(); refreshLockCount();
  status("locks cleared");
}

export function renderBuffer() {
  const el = document.getElementById("steps");
  if (!el) return;
  el.innerHTML = "";
  const bank = getBank();
  const selected = getSelected();
  const p = bank[selected];
  if (!p) return;
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // loop region, 0-based
  const ln = Math.round(state.loop ?? 0);
  const loopOn = ln >= 2 && ls + ln <= p.length;
  for (let i = 0; i < 64; i++) {
    const st = p.steps[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    const dot = document.createElement("span");
    dot.className = "dot";
    cell.appendChild(dot);
    const on = i < p.length && st && st.notes.length;
    if (on) {
      const n0 = st.notes[0];
      dot.textContent = midiName(n0.note);
      cell.classList.add("on");
      const vel = Math.max(1, Math.min(127, n0.vel ?? 100));
      // Opacity scales continuously from 0.25 (vel 1) to 1.0 (vel 127)
      const alpha = 0.25 + 0.75 * (vel / 127);
      dot.style.setProperty("--vel-alpha", alpha.toFixed(3));
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else if (i >= p.length) cell.classList.add("off");
    if (loopOn && i >= ls && i < ls + ln) {
      cell.classList.add("loop");
      if (i === ls) cell.classList.add("loopstart");
    }
    if (st && st.echo != null) cell.classList.add("echo");   // a step the loop copied from the motif
    if (locks.has(`${selected}:${i}`)) cell.classList.add("locked");
    if (i === editStep) cell.classList.add("edit");
    cell.addEventListener("click", () => selectStep(i));
    el.appendChild(cell);
  }
  const selnum = document.getElementById("selnum");
  if (selnum) selnum.textContent = String(selected + 1);
  const bufinfo = document.getElementById("bufinfo");
  if (bufinfo) bufinfo.textContent = `${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount(p)} notes`;
  renderEditor();
  fitSteps();
  renderScope();
}

export function fitSteps() {
  const grid = document.getElementById("steps");
  if (!grid) return;
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.gap) || 0;
  const cellW = (grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * 7) / 8;
  let dot = cellW;
  const hSpace = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - gap * 7;
  if (hSpace > 0 && hSpace / 8 < cellW - 4) dot = hSpace / 8;
  grid.style.setProperty("--dot", Math.max(8, Math.floor(dot) - 2) + "px");
}

export function buildEditor() {
  const getSelectedPat = () => getBank()[getSelected()];
  document.getElementById("edown")?.addEventListener("click", () => {
    const p = getSelectedPat();
    if (editStep < 0 || !p) return;
    const cur = p.steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur - 1);
  });
  document.getElementById("eup")?.addEventListener("click", () => {
    const p = getSelectedPat();
    if (editStep < 0 || !p) return;
    const cur = p.steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur + 1);
  });
  document.getElementById("eclear")?.addEventListener("click", () => {
    if (editStep >= 0) setStepNote(editStep, null);
  });
  document.getElementById("elock")?.addEventListener("click", () => {
    const p = getSelectedPat();
    if (editStep < 0 || !p) return;
    const key = `${getSelected()}:${editStep}`;
    if (locks.has(key)) locks.delete(key);
    else locks.set(key, p.steps[editStep].notes.map((n) => ({ ...n })));
    renderBuffer(); refreshLockCount();
  });
  document.getElementById("eclearlocks")?.addEventListener("click", clearLocks);
  refreshLockCount();
}
