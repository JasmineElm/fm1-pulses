// storage.js — Session snapshots (download / upload / browser preset slots).
// The file format, versioning and migrations live in snapshot.js; this module wires
// them to the live app state and DOM. Sequencer-model hidden state registers itself
// from each model's own module.
import { state, locks, getSelected, setSelected, DEFAULT, PRESET_N, status, doGenerate } from "./state.js";
import { refreshLockCount } from "./grid.js";
import { getActiveModel, showModel } from "./modes.js";
import { applyTheme } from "./themes.js";
import * as audio from "./audio.js";
import {
  registerModel, getModelDef, pickParams, ownsKey, splitParams,
  buildEnvelope, migrateEnvelope, SnapshotError,
} from "./snapshot.js";

const PRESET_KEY = "fm1p.presets.v2";       // { [modelId]: [envelope|null × PRESET_N] }
const LEGACY_PRESET_KEY = "fm1p.presets";    // pre-envelope array, belonged to "mene311"
const APP_BUILD = "100";
let presetArm = null;   // "save" | "load" | null

// Mene311 is fully determined by seed + parameters; it has no hidden state.
registerModel({ id: "mene311", version: 1, migrations: {} });

let onSyncRackCallback = null;
export function onSyncRack(fn) { onSyncRackCallback = fn; }

// Parameters present in a loaded file that this build doesn't know. They are written
// back out on the next export so a newer file survives a round trip through an older app.
let carriedUnknown = {};

export function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// The sequencer model that owns the current state; falls back to Mene311 when a
// non-sequencer tool or the landing page is showing.
function currentModelId() {
  const id = getActiveModel();
  return id && getModelDef(id) ? id : "mene311";
}

export function captureSession(name = "") {
  const modelId = currentModelId();
  const def = getModelDef(modelId);
  return buildEnvelope({
    modelId,
    name,
    params: { ...pickParams(modelId, state), ...carriedUnknown },
    locks: Object.fromEntries(locks),
    selected: getSelected(),
    hidden: def.capture ? def.capture() : {},
    ui: { theme: document.documentElement.dataset.theme || "dark" },
    output: { sound: audio.getSound(), volume: audio.getVolume() },
    build: APP_BUILD,
  });
}

export function applySession(raw) {
  const env = migrateEnvelope(raw);          // throws SnapshotError on anything unsafe
  const id = env.model.id;
  const def = getModelDef(id);

  const { known, unknown } = splitParams(id, env.state.params, DEFAULT);
  for (const k of Object.keys(DEFAULT)) {
    if (!ownsKey(id, k)) continue;           // never touch another model's parameters
    state[k] = k in known ? known[k] : structuredClone(DEFAULT[k]);
  }
  state.seed = state.seed >>> 0;
  carriedUnknown = unknown;

  locks.clear();
  for (const [k, v] of Object.entries(env.state.locks ?? {})) {
    if (Array.isArray(v)) locks.set(k, v.map((n) => ({ ...n })));
  }
  setSelected(Number(env.state.selected) || 0);

  if (def.restore) def.restore(env.state.hidden);

  if (env.ui?.theme) applyTheme(env.ui.theme);
  const vol = Number(env.output?.volume);
  if (typeof env.output?.sound === "string") { audio.setSound(env.output.sound); localStorage.setItem("fm1p.sound", audio.getSound()); }
  if (Number.isFinite(vol)) { audio.setVolume(vol); localStorage.setItem("fm1p.volume", String(audio.getVolume())); }

  if (onSyncRackCallback) onSyncRackCallback();
  showModel(id);                              // (re)activates the model, which regenerates
  if (def.restore) def.restore(env.state.hidden);
  if (id === "mene311") doGenerate(false);
  refreshLockCount();
  renderPresets();
  return env;
}

function describeError(e) {
  return e instanceof SnapshotError ? e.message : (e?.message || String(e));
}

export function exportState() {
  const env = captureSession();
  const seed = env.state.params.seed >>> 0;
  download(`${env.model.id}-${seed}.fm1p.json`, JSON.stringify(env, null, 2), "application/json");
  status(`exported ${env.model.id} v${env.model.version} · seed ${seed} ✓`);
}

export async function importState(file) {
  try {
    const env = applySession(JSON.parse(await file.text()));
    status(`Loaded ${env.model.id} · seed ${state.seed >>> 0} ✓`, "ok");
    return env;
  } catch (e) {
    status("import failed: " + describeError(e), "err");
  }
}

// ---- Browser preset slots (same envelope as file export, namespaced per model) ----
function readAllPresets() {
  try {
    const all = JSON.parse(localStorage.getItem(PRESET_KEY));
    if (all && typeof all === "object" && !Array.isArray(all)) {
      if (all.traditional && !all.mene311) all.mene311 = all.traditional;   // former model id
      delete all.traditional;
      return all;
    }
  } catch { /* fall through to legacy */ }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PRESET_KEY));
    if (Array.isArray(legacy)) return { mene311: legacy };
  } catch { /* nothing stored */ }
  return {};
}

export function readPresets(modelId = currentModelId()) {
  const list = readAllPresets()[modelId];
  const out = Array(PRESET_N).fill(null);
  if (Array.isArray(list)) for (let i = 0; i < PRESET_N; i++) out[i] = list[i] ?? null;
  return out;
}

export function savePreset(i) {
  const modelId = currentModelId();
  const all = readAllPresets();
  const slots = readPresets(modelId);
  slots[i] = captureSession();
  all[modelId] = slots;
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
  renderPresets();
  status(`preset ${i + 1} saved ✓ seed ${state.seed >>> 0}`);
}

export function recallPreset(i) {
  const d = readPresets()[i];
  if (!d) { status(`preset ${i + 1} is empty`, "err"); return; }
  try {
    applySession(d);
    status(`preset ${i + 1} recalled ✓ seed ${state.seed >>> 0}`);
  } catch (e) {
    status(`preset ${i + 1}: ` + describeError(e), "err");
  }
}

const slotSeed = (p) => p?.state?.params?.seed ?? p?.seed;

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
    b.title = p[i] ? `preset ${i + 1}: seed ${slotSeed(p[i])} — tap to recall, double-click to overwrite` : `preset ${i + 1}: empty`;
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
