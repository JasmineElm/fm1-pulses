// snapshot.js — Versioned session snapshot format shared by every sequencer model.
//
// A snapshot is a JSON "envelope" that records the *recipe* needed to rebuild the
// exact browser state a pattern was made in (parameters, seed, and any hidden model
// buffers such as Turing bits or Cellular grids) — never the generated notes.
//
// Versioning is strict and two-level:
//   formatVersion  — the envelope layout itself (this file).
//   model.version  — each sequencer model's own schema, upgraded by ordered migrations.
// Files from a NEWER version than the app understands are refused (never truncated);
// older files are migrated step by step. Unknown parameters are preserved, not deleted.
//
// This module is pure: no DOM, no app state. It is unit-testable in Node.

export const FORMAT = "fm1-pulses.session";
export const FORMAT_VERSION = 1;

export class SnapshotError extends Error {
  constructor(message) { super(message); this.name = "SnapshotError"; }
}

// ---- Model registry --------------------------------------------------------------
// def = {
//   id, version,
//   migrations: { 1: (state) => state, ... },  // key n upgrades model state n -> n+1
//   capture?: () => object,                    // hidden model buffers (JSON-safe)
//   restore?: (object) => void,
// }
const models = new Map();

export function registerModel(def) {
  if (!def || !def.id || !Number.isInteger(def.version) || def.version < 1) {
    throw new SnapshotError("invalid model definition");
  }
  for (let v = 1; v < def.version; v++) {
    if (typeof def.migrations?.[v] !== "function") {
      throw new SnapshotError(`model "${def.id}" is v${def.version} but has no migration ${v}→${v + 1}`);
    }
  }
  models.set(def.id, def);
}

export function getModelDef(id) { return models.get(id) || null; }
export function modelIds() { return [...models.keys()]; }

// ---- Parameter ownership ---------------------------------------------------------
// The app keeps one flat `state` bag. Keys prefixed per model belong to that model;
// every other key (seed, tempo, rate, length, scale, …) is shared by all models.
const PREFIX = {
  cellular: /^ca[A-Z]/,
  turing: /^turing[A-Z]/,
  particles: /^particle[A-Z]/,
  pendulum: /^pendulum[A-Z]/,
  flock: /^flock[A-Z]/,
  rungler: /^rungler[A-Z]/,
  krell: /^krell[A-Z]/,
};

export function ownsKey(modelId, key) {
  if (PREFIX[modelId]?.test(key)) return true;
  return !Object.values(PREFIX).some((re) => re.test(key));
}

export function pickParams(modelId, state) {
  const out = {};
  for (const k of Object.keys(state)) if (ownsKey(modelId, k)) out[k] = state[k];
  return out;
}

// Splits file params into those the app knows (matching type) and unknown ones that
// must be carried through untouched.
export function splitParams(modelId, params, defaults) {
  const known = {}, unknown = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (!(k in defaults)) { unknown[k] = v; continue; }
    if (!ownsKey(modelId, k)) continue;
    const want = defaults[k];
    const okType = Array.isArray(want) ? Array.isArray(v) : typeof v === typeof want;
    if (okType) known[k] = v;
  }
  return { known, unknown };
}

// ---- Build / validate / migrate --------------------------------------------------
export function buildEnvelope({ modelId, name = "", params, locks = {}, selected = 0, hidden = {}, ui = {}, output = {}, build = "" }) {
  const def = getModelDef(modelId);
  if (!def) throw new SnapshotError(`unknown model "${modelId}"`);
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    name,
    app: { build },
    model: { id: def.id, version: def.version },
    state: { params, locks, selected, hidden },
    ui,
    output,
  };
}

export function detectModelFromObject(d) {
  if (d.model && typeof d.model === "object" && d.model.id) return MODEL_ALIASES[d.model.id] ?? d.model.id;
  if (typeof d.model === "string") return MODEL_ALIASES[d.model] ?? d.model;
  if (typeof d.modelId === "string") return MODEL_ALIASES[d.modelId] ?? d.modelId;
  const keys = Object.keys(d.params ?? d.state?.params ?? d);
  if (keys.some((k) => k.startsWith("pendulum"))) return "pendulum";
  if (keys.some((k) => k.startsWith("flock"))) return "flock";
  if (keys.some((k) => k.startsWith("rungler"))) return "rungler";
  if (keys.some((k) => k.startsWith("krell"))) return "krell";
  if (keys.some((k) => k.startsWith("particle"))) return "particles";
  if (keys.some((k) => k.startsWith("ca"))) return "cellular";
  if (keys.some((k) => k.startsWith("turing"))) return "turing";
  return "mene311";
}

// Pre-envelope files: { app:"fm1-pulses", version:1, seed, params, locks, selected } or raw state objects
export function upgradeLegacy(d) {
  const modelId = detectModelFromObject(d);
  const def = getModelDef(modelId);
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    savedAt: d.savedAt ?? null,
    name: d.name ?? "",
    app: { build: (d.app && typeof d.app === "object" && d.app.build) ? d.app.build : (typeof d.app === "string" ? d.app : "legacy") },
    model: { id: modelId, version: def?.version ?? 1 },
    state: {
      params: d.params ?? d.state?.params ?? d,
      locks: d.locks ?? d.state?.locks ?? {},
      selected: Number(d.selected ?? d.state?.selected) || 0,
      hidden: d.hidden ?? d.state?.hidden ?? {}
    },
    ui: d.ui ?? {},
    output: d.output ?? {},
  };
}

// Former model ids, accepted on import so older files keep loading.
const MODEL_ALIASES = { traditional: "mene311" };

// Returns an envelope whose state is at the current version of its model.
export function migrateEnvelope(input) {
  if (!input || typeof input !== "object") throw new SnapshotError("not a session file");
  let d = input;
  if (d.format === undefined && (d.app === "fm1-pulses" || d.model !== undefined || d.modelId !== undefined || (d.params && typeof d.params === "object"))) {
    d = upgradeLegacy(d);
  }
  if (d.format !== FORMAT) throw new SnapshotError("not an FM-1 Pulses session file");
  if (!Number.isInteger(d.formatVersion) || d.formatVersion < 1) throw new SnapshotError("bad formatVersion");
  if (d.formatVersion > FORMAT_VERSION) {
    throw new SnapshotError(`file format v${d.formatVersion} is newer than this app (v${FORMAT_VERSION}) — update the app`);
  }
  const rawId = d.model?.id;
  const id = MODEL_ALIASES[rawId] ?? rawId;
  const def = getModelDef(id);
  if (!def) throw new SnapshotError(`unknown model "${id}"`);
  let v = d.model?.version;
  if (!Number.isInteger(v) || v < 1) throw new SnapshotError("bad model version");
  if (v > def.version) {
    throw new SnapshotError(`${id} file is v${v}, app supports up to v${def.version} — update the app`);
  }
  let state = structuredClone(d.state ?? {});
  for (; v < def.version; v++) {
    const step = def.migrations[v];
    if (typeof step !== "function") throw new SnapshotError(`missing migration ${id} v${v}→v${v + 1}`);
    state = step(state) ?? state;
  }
  return { ...d, model: { id, version: def.version }, state };
}
