// storage.js — Preset storage, state JSON export/import, and .syx export.
import { state, refs, locks, getBank, getSelected, setSelected, DEFAULT, SLOTS, PRESET_N, STATE_VERSION, status, doGenerate } from "./state.js?v=100";
import { syncHeader } from "./device.js?v=100";
import { encodeWrite } from "./pattern.js?v=100";
import { renderBank, renderBuffer, refreshLockCount } from "./grid.js?v=100";

const PRESET_KEY = "fm1p.presets";
let presetArm = null;   // "save" | "load" | null

let onSyncRackCallback = null;
export function onSyncRack(fn) { onSyncRackCallback = fn; }

export function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function exportState() {
  const data = {
    app: "fm1-pulses",
    version: STATE_VERSION,
    seed: state.seed >>> 0,
    params: { ...state },
    locks: Object.fromEntries(locks),
    selected: getSelected(),
  };
  download(`fm1p-${state.seed >>> 0}.json`, JSON.stringify(data, null, 2), "application/json");
  status(`exported seed ${state.seed >>> 0} ✓`);
}

export async function importState(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== "fm1-pulses") throw new Error("not an FM-1 Pulses file");
    applyStateData(d);
    status(`imported seed ${state.seed >>> 0} ✓`);
  } catch (e) {
    status("import failed: " + (e.message || e), "err");
  }
}

export function readPresets() {
  try {
    const p = JSON.parse(localStorage.getItem(PRESET_KEY));
    return Array.isArray(p) ? p.slice(0, PRESET_N) : Array(PRESET_N).fill(null);
  } catch { return Array(PRESET_N).fill(null); }
}

export function applyStateData(d) {
  if (d.params) Object.assign(state, d.params);
  else if (d.seed != null) Object.assign(state, d);
  for (const k of Object.keys(state)) if (!(k in DEFAULT)) delete state[k];
  state.seed = (d.seed ?? state.seed) >>> 0;
  locks.clear();
  for (const [k, v] of Object.entries(d.locks ?? {})) locks.set(k, v.map((n) => ({ ...n })));
  setSelected(Math.max(0, Math.min(SLOTS - 1, Number(d.selected) || 0)));
  if (onSyncRackCallback) onSyncRackCallback();
  doGenerate(false);
  refreshLockCount();
}

export function savePreset(i) {
  const p = readPresets();
  p[i] = {
    app: "fm1-pulses",
    version: STATE_VERSION,
    seed: state.seed >>> 0,
    params: { ...state },
    locks: Object.fromEntries(locks),
    selected: getSelected(),
  };
  localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  renderPresets();
  status(`preset ${i + 1} saved ✓ seed ${state.seed >>> 0}`);
}

export function recallPreset(i) {
  const d = readPresets()[i];
  if (!d) { status(`preset ${i + 1} is empty`, "err"); return; }
  applyStateData(d);
  status(`preset ${i + 1} recalled ✓ seed ${state.seed >>> 0}`);
}

export function renderPresets() {
  const el = document.getElementById("preset-slots") || document.getElementById("presets");
  if (!el) return;
  el.innerHTML = "";
  const p = readPresets();
  const armBtn = (label, arm, title) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = presetArm === arm ? "armed" : "";
    b.title = title;
    b.addEventListener("click", () => {
      presetArm = presetArm === arm ? null : arm;
      renderPresets();
    });
    return b;
  };
  el.append(armBtn("save ▸", "save", "Arm saving, then tap a slot. Or double-click a slot to save it directly."));
  for (let i = 0; i < PRESET_N; i++) {
    const b = document.createElement("button");
    b.className = "pslot" + (p[i] ? " filled" : "");
    b.textContent = String(i + 1);
    b.title = p[i] ? `preset ${i + 1}: seed ${p[i].seed} — tap to recall, double-click to overwrite` : `preset ${i + 1}: empty`;
    b.addEventListener("click", () => {
      if (presetArm === "save") { savePreset(i); presetArm = null; }
      else if (presetArm === "load") { recallPreset(i); presetArm = null; }
      else recallPreset(i);
    });
    b.addEventListener("dblclick", () => savePreset(i));
    el.appendChild(b);
  }
  el.append(armBtn("◂ load", "load", "Arm recalling, then tap a filled slot. Or just tap a slot: tap = recall, double-click = save."));
}

export function exportSysex() {
  syncHeader();
  const bank = getBank();
  const bytes = [];
  for (let i = 0; i < SLOTS; i++) for (const m of encodeWrite(bank[i], i, true)) bytes.push(...m);
  download(`fm1p-${state.seed >>> 0}.syx`, new Uint8Array(bytes), "application/octet-stream");
  status(`bank .syx downloaded ✓ (${bytes.length} bytes, 16 slots)`);
}
