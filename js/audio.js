// audio.js — a tiny 2-operator FM preview so you can HEAR the phrase in the
// browser, with or without the FM-1 attached. Not meant to match the FM-1's
// engine exactly — just enough to hear pitches, rhythm and the parameter changes.

let ctx = null;
let master = null;
let muted = false;
const voices = new Map();   // note -> { carrier, mod, gain }

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

export function noteOn(note, vel = 100) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  noteOff(note);                              // retrigger cleanly
  const t = c.currentTime;
  const f = hz(note);

  const carrier = c.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = f;

  const gain = c.createGain();
  const peak = 0.28 * (Math.max(1, Math.min(127, vel)) / 127);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.008);        // attack
  gain.gain.linearRampToValueAtTime(peak * 0.55, t + 0.35);  // decay to sustain
  carrier.connect(gain).connect(master);

  // simple FM: a modulator at 2x, depth tracking the pitch
  const mod = c.createOscillator();
  mod.type = "sine";
  mod.frequency.value = f * 2;
  const modGain = c.createGain();
  modGain.gain.value = f * 1.2;
  mod.connect(modGain).connect(carrier.frequency);

  carrier.start(t);
  mod.start(t);
  voices.set(note, { carrier, mod, gain });
}

export function noteOff(note) {
  const v = voices.get(note);
  if (!v || !ctx) return;
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + 0.09);          // release
  try { v.carrier.stop(t + 0.12); v.mod.stop(t + 0.12); } catch { /* already stopped */ }
  voices.delete(note);
}

export function allOff() { for (const n of [...voices.keys()]) noteOff(n); }
