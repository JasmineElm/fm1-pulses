// scope.js — Canvas wave and trigger scope visualization.
import { state, getBank, getSelected } from "./state.js?v=100";
import { midiName } from "./generator.js?v=100";

const SCOPE_PADT = 14, SCOPE_PADB = 16, SCOPE_PADX = 20;
let scopeNow = null;
let scopeHover = null;

export function setScopeNow(i) { scopeNow = i; }
export function getScopeNow() { return scopeNow; }
export function setScopeHover(i) { scopeHover = i; }

export function renderScope() {
  const cv = document.getElementById("wave");
  const bank = getBank();
  const selected = getSelected();
  const p = bank[selected];
  if (!cv || !p) return;
  const w = cv.clientWidth || 320, h = cv.clientHeight || 150;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0b0e";
  ctx.fillRect(0, 0, w, h);

  const n = 64;
  const cont = p.contour || [];
  const played = [];
  let lo = 127, hi = 0;
  for (let i = 0; i < n; i++) {
    const v = cont[i];
    if (v != null && v < lo) lo = v;
    if (v != null && v > hi) hi = v;
    const nt = i < p.length && p.steps[i]?.notes.length ? p.steps[i].notes[0].note : null;
    if (nt != null) { played.push([i, nt]); if (nt < lo) lo = nt; if (nt > hi) hi = nt; }
  }
  if (hi - lo < 4) { const c = (lo + hi) / 2; lo = c - 2; hi = c + 2; }
  const Y = (v) => SCOPE_PADT + (h - SCOPE_PADT - SCOPE_PADB) * (1 - (v - lo) / (hi - lo));
  const X = (i) => SCOPE_PADX + i / (n - 1) * (w - 2 * SCOPE_PADX);

  // C-octave reference lines + labels (left)
  ctx.font = "8px 'Barlow Semi Condensed', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (let c = Math.ceil(lo / 12) * 12; c <= hi; c += 12) {
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(SCOPE_PADX, Y(c) + 0.5); ctx.lineTo(w - 4, Y(c) + 0.5); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(midiName(c), 3, Y(c));
  }

  // Cycle boundaries (the LFO's own grid, same math as the generator)
  const cycles = Math.max(0.1, Math.min(16, state.lfoRate || 4));
  const isRandom = state.lfoWave === "random";
  const div = Math.max(isRandom ? 1 : 2.5, p.length / cycles);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.setLineDash([2, 3]);
  for (let x = div; x < p.length; x += div) {
    ctx.beginPath(); ctx.moveTo(X(x) + 0.5, SCOPE_PADT); ctx.lineTo(X(x) + 0.5, h - SCOPE_PADB); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Loop region backdrop + start guide
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);
  const ln = Math.round(state.loop ?? 0);
  if (ln >= 2 && ls + ln <= p.length) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(X(ls), SCOPE_PADT, X(ls + ln) - X(ls), h - SCOPE_PADT - SCOPE_PADB);
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(ls) + 0.5, SCOPE_PADT); ctx.lineTo(X(ls) + 0.5, h - SCOPE_PADB); ctx.stroke();
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8a33d";
  // Contour: full accent inside the phrase, dimmed past its length
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  const seg = (i0, i1, alpha) => {
    if (i0 > i1 || cont[i0] == null) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(X(i0), Y(cont[i0]));
    for (let i = i0 + 1; i <= i1; i++) {
      if (cont[i] == null) continue;
      ctx.lineTo(X(i), Y(cont[i]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  seg(0, p.length - 1, 1);
  if (p.length < n) seg(p.length, n - 1, 0.35);

  // Staircase: the quantized melody as the ear gets it (connect played dots)
  if (played.length > 1) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(played[0][0]), Y(played[0][1]));
    for (let k = 1; k < played.length; k++) ctx.lineTo(X(played[k][0]), Y(played[k][1]));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Played notes: stem from the contour, dot at the quantized pitch
  for (const [i, nt] of played) {
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), Y(cont[i] ?? nt)); ctx.lineTo(X(i), Y(nt)); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(X(i), Y(nt), 2.6, 0, Math.PI * 2); ctx.fill();
  }

  // Gate trigger lane: dim bar = gate opened, accent bar = a note survived
  const laneY = h - SCOPE_PADB;
  const laneH = SCOPE_PADB - 4;
  const bw = (w - 2 * SCOPE_PADX) / n;
  for (let i = 0; i < p.length; i++) {
    const gated = p.gates?.[i] === 1;
    const on = p.steps[i]?.notes.length;
    if (!gated && !on) continue;
    ctx.fillStyle = on ? accent : "rgba(255,255,255,0.22)";
    ctx.fillRect(X(i) - bw / 2 + 0.5, laneY + 2, Math.max(1, bw - 1), laneH - 2);
  }

  // Playhead
  if (scopeNow != null) {
    ctx.strokeStyle = "#ececf0";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(scopeNow) + 0.5, SCOPE_PADT); ctx.lineTo(X(scopeNow) + 0.5, h - 2); ctx.stroke();
  }
  // Hover guide
  if (scopeHover != null) {
    ctx.strokeStyle = "rgba(236,236,240,0.45)";
    ctx.beginPath(); ctx.moveTo(X(scopeHover) + 0.5, SCOPE_PADT); ctx.lineTo(X(scopeHover) + 0.5, h - 2); ctx.stroke();
  }

  // Labels: wave · cycles · div | hover readout | lo/hi notes
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#9a9aa2";
  ctx.font = "9px 'Barlow Semi Condensed', sans-serif";
  ctx.fillText(`${state.lfoWave ?? "sine"} · ${cycles} cyc · div ${div.toFixed(1)}`, 4, 2);
  if (scopeHover != null) {
    const i = scopeHover;
    const gated = i < p.length && p.gates?.[i] === 1;
    const nt = i < p.length && p.steps[i]?.notes.length ? p.steps[i].notes[0].note : null;
    ctx.fillStyle = "#ececf0";
    ctx.fillText(`step ${i + 1}: ${midiName(cont[i] ?? 0)}${nt != null ? " → " + midiName(nt) : gated ? " (gated, no note)" : " (rest)"}`, 150, 2);
  }
  ctx.textAlign = "right";
  ctx.fillText(midiName(Math.round(hi)), w - 4, 2);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(midiName(Math.round(lo)), w - 4, h - SCOPE_PADB - 1);
  ctx.textAlign = "left";
}

export function initScope() {
  const wcv = document.getElementById("wave");
  wcv?.addEventListener("mousemove", (e) => {
    const rect = wcv.getBoundingClientRect();
    const stepW = (wcv.clientWidth - 2 * SCOPE_PADX) / 63;
    scopeHover = Math.max(0, Math.min(63, Math.round((e.clientX - rect.left - SCOPE_PADX) / stepW)));
    renderScope();
  });
  wcv?.addEventListener("mouseleave", () => { scopeHover = null; renderScope(); });
}
