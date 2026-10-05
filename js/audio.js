// audio.js — a tiny FM preview so you can HEAR the phrase in the browser, with
// or without the FM-1 attached. Not meant to match the FM-1's engine exactly —
// just enough to hear pitches, rhythm and the parameter changes. Five timbres
// cover the common FM check-list: e-piano (default), bell, bass, organ, square.

let ctx = null;
let master = null;
let muted = false;
const voices = new Map();   // note -> { oscs: [], gain, rel }

export const SOUNDS = [
  { id: "epiano", name: "e-piano" },
  { id: "bell", name: "bell" },
  { id: "bass", name: "bass" },
  { id: "organ", name: "organ" },
  { id: "chip", name: "square" },
];
let sound = "epiano";
export function setSound(id) { if (SOUNDS.some((s) => s.id === id)) sound = id; }
export function getSound() { return sound; }

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }
export function unlock() { ensure(); }        // call from a user gesture

const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);

// Each timbre builds its oscillators and its own envelope; all share the same
// gain node + release ramp so noteOff stays uniform.
function buildVoice(c, t, f, vel, id) {
  const gain = c.createGain();
  const v = vel > 0 ? vel / 127 : 1;
  const peak = 0.28 * v;
  const oscs = [];
  const stops = [];

  const osc = (type, freq, g = 1) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const og = c.createGain();
    og.gain.value = g;
    o.connect(og).connect(gain);
    oscs.push(o);
    return { o, og };
  };
  const fm = (carrier, ratio, depth0, depth1, decayTo) => {
    const { o, og } = osc("sine", carrier.frequency.value * ratio);
    og.gain.setValueAtTime(depth0, t);
    if (depth1 != null) og.gain.exponentialRampToValueAtTime(Math.max(1, depth1), t + decayTo);
    o.connect(og).connect(carrier.frequency);
    return o;
  };

  let rel = 0.09;
  switch (id) {
    case "bell": {
      const { o: c0 } = osc("sine", f);
      fm(c0, 3.01, f * 2.2, f * 0.2, 0.6);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 1.05, t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      rel = 0.3;
      break;
    }
    case "bass": {
      const { o: c0 } = osc("sine", f);
      fm(c0, 1, f * 4.5, f * 1.1, 0.25);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 1.15, t + 0.005);
      gain.gain.linearRampToValueAtTime(peak * 0.65, t + 0.2);
      rel = 0.12;
      break;
    }
    case "organ": {
      osc("sine", f, 1);
      osc("sine", f * 2, 0.38);
      const c0 = oscs[0];
      fm(c0, 1, f * 0.8);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 0.8, t + 0.012);
      rel = 0.08;
      break;
    }
    case "chip": {
      osc("square", f);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(f * 5, 7000);
      gain.connect(lp).connect(master);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 0.72, t + 0.004);
      gain.gain.linearRampToValueAtTime(peak * 0.36, t + 0.18);
      rel = 0.05;
      break;
    }
    case "epiano":
    default: {
      const { o: c0 } = osc("sine", f);
      fm(c0, 2, f * 1.2);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.008);
      gain.gain.linearRampToValueAtTime(peak * 0.55, t + 0.35);
      rel = 0.09;
      break;
    }
  }
  if (id !== "chip") gain.connect(master);
  return { oscs, gain, rel };
}

export function noteOn(note, vel = 100) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  noteOff(note);                              // retrigger cleanly
  const t = c.currentTime;
  const f = hz(note);

  const voice = buildVoice(c, t, f, vel, sound);
  for (const o of voice.oscs) o.start(t);
  voices.set(note, voice);
}

export function noteOff(note) {
  const v = voices.get(note);
  if (!v || !ctx) return;
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + v.rel);          // release
  try { for (const o of v.oscs) o.stop(t + v.rel + 0.03); } catch { /* already stopped */ }
  voices.delete(note);
}

export function allOff() { for (const n of [...voices.keys()]) noteOff(n); }
