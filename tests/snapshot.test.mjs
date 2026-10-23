// Run with: npm test   (node --test tests/)
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT, FORMAT_VERSION, SnapshotError, registerModel, getModelDef,
  ownsKey, pickParams, splitParams, buildEnvelope, migrateEnvelope,
} from "../js/snapshot.js";

// A model that has evolved to v3, to exercise the migration chain.
registerModel({
  id: "demo", version: 3,
  migrations: {
    1: (s) => ({ ...s, hidden: { ...s.hidden, bits: s.hidden.register } }),   // rename
    2: (s) => ({ ...s, params: { ...s.params, demoSlip: 0 } }),                // new param
  },
});
registerModel({ id: "mene311", version: 1, migrations: {} });
registerModel({ id: "turing", version: 1, migrations: {} });

const DEFAULTS = { seed: 1, tempo: 120, scale: "x", turingProb: 0, caRule: 30, particleScale: "y", pendulumL1: 100, flockBoidCount: 16, customScale: [0, 3] };

test("registerModel refuses a version with a gap in its migrations", () => {
  assert.throws(() => registerModel({ id: "bad", version: 3, migrations: { 1: (s) => s } }), SnapshotError);
});

test("key ownership: shared keys go to every model, prefixed keys only to their own", () => {
  assert.ok(ownsKey("turing", "seed"));
  assert.ok(ownsKey("mene311", "tempo"));
  assert.ok(ownsKey("turing", "turingProb"));
  assert.ok(!ownsKey("mene311", "turingProb"));
  assert.ok(!ownsKey("turing", "caRule"));
  assert.ok(!ownsKey("cellular", "particleScale"));
  assert.ok(ownsKey("pendulum", "pendulumL1"));
  assert.ok(ownsKey("pendulum", "pendulumSectors"));
  assert.ok(!ownsKey("turing", "pendulumL1"));
  assert.ok(!ownsKey("turing", "pendulumSectors"));
  assert.ok(!ownsKey("pendulum", "turingProb"));
  assert.ok(ownsKey("flock", "flockBoidCount"));
  assert.ok(!ownsKey("turing", "flockBoidCount"));
  assert.ok(!ownsKey("flock", "pendulumL1"));
  assert.deepEqual(Object.keys(pickParams("turing", DEFAULTS)).sort(), ["customScale", "seed", "scale", "tempo", "turingProb"].sort());
});

test("splitParams keeps typed known keys and carries unknown ones", () => {
  const { known, unknown } = splitParams("turing", { seed: 5, tempo: "fast", turingProb: 10, caRule: 90, futureThing: 1 }, DEFAULTS);
  assert.deepEqual(known, { seed: 5, turingProb: 10 });   // wrong type and foreign-model keys dropped
  assert.deepEqual(unknown, { futureThing: 1 });
});

test("envelope round trip is stable and current", () => {
  const env = buildEnvelope({ modelId: "turing", params: { seed: 9 }, hidden: { bits: [1, 0] } });
  assert.equal(env.format, FORMAT);
  assert.equal(env.formatVersion, FORMAT_VERSION);
  assert.deepEqual(env.model, { id: "turing", version: 1 });
  const back = migrateEnvelope(JSON.parse(JSON.stringify(env)));
  assert.deepEqual(back.state, env.state);
});

test("old model versions migrate step by step", () => {
  const v1 = { format: FORMAT, formatVersion: 1, model: { id: "demo", version: 1 },
    state: { params: { seed: 1 }, hidden: { register: [1, 1] }, locks: {}, selected: 0 } };
  const out = migrateEnvelope(v1);
  assert.equal(out.model.version, 3);
  assert.deepEqual(out.state.hidden.bits, [1, 1]);
  assert.equal(out.state.params.demoSlip, 0);
  assert.equal(v1.model.version, 1, "input is not mutated");
});

test("newer versions are refused, never truncated", () => {
  const base = { format: FORMAT, formatVersion: 1, model: { id: "demo", version: 3 }, state: {} };
  assert.throws(() => migrateEnvelope({ ...base, model: { id: "demo", version: 4 } }), /newer|up to v3/);
  assert.throws(() => migrateEnvelope({ ...base, formatVersion: FORMAT_VERSION + 1 }), /newer/);
});

test("rejects foreign, malformed and unknown-model input", () => {
  assert.throws(() => migrateEnvelope(null), SnapshotError);
  assert.throws(() => migrateEnvelope({ hello: 1 }), /not an FM-1 Pulses/);
  assert.throws(() => migrateEnvelope({ format: FORMAT, formatVersion: 1, model: { id: "nope", version: 1 }, state: {} }), /unknown model/);
  assert.throws(() => migrateEnvelope({ format: FORMAT, formatVersion: 1, model: { id: "demo", version: "1" }, state: {} }), /bad model version/);
});

test("legacy pre-envelope files load as Mene311 v1", () => {
  const legacy = { app: "fm1-pulses", version: 1, seed: 42, params: { seed: 42, scale: "dorian" }, locks: { "0:3": [{ note: 60, vel: 100 }] }, selected: 0 };
  const out = migrateEnvelope(legacy);
  assert.equal(out.model.id, "mene311");
  assert.equal(out.state.params.scale, "dorian");
  assert.deepEqual(out.state.locks["0:3"], [{ note: 60, vel: 100 }]);
});

test("registry exposes definitions", () => {
  assert.equal(getModelDef("demo").version, 3);
  assert.equal(getModelDef("missing"), null);
});
