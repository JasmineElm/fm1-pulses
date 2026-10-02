# FM-1 Pulses — Implementation Plan (phone-first)

# FM-1 Pulses — Implementation Plan (phone-first)

> **UPDATE (2026-10-02): the pattern-write premise below is obsolete.**
> "The FM-1 has no pattern-write path over MIDI" is **wrong** for the FM-1+VA
> (Baud Girl) firmware. SysEx command `0x20` writes 8 steps of a pattern at a
> time directly into the sequencer — proven on the live device (byte-verified
> against jbschooley/Virtual-FM-1's `sync/Fm1Seq.cpp`, 8/8 acked, read-back
> matches). The **MVP is now the sequence generator + "freeze" (phrase dump)**:
> generate a phrase → write it to pattern slot N via `0x20` over Web MIDI → the
> FM-1 plays it standalone. Live MIDI (sound-module) mode is **also** wanted, but
> second. See `js/pattern.js` (verified encoder), `js/generator.js`, `js/app.js`.
> The "Deliberately out of scope: writing patterns into the FM-1's internal
> sequencer" line further down is now a core feature, not out of scope.

**Status:** plan. No code yet. This supersedes the "Desktop Chrome First" section in
DESIGN.md — the target is the user's **phone** (Xiaomi 14t, Android 14) driving the
FM-1 over USB OTG, with BLE MIDI as fallback.

## Ground truths (from `mvave-fm1/notes/`, key files copied into `notes/`)

- **The FM-1 has no pattern-write path over MIDI** (RE-confirmed in
  `sequencer-data-structure.md`). It is a *sound module*: you send Note On/Off + CC,
  never patterns. So this app is purely a note/CC generator. Do not chase pattern-writing.
- **Note channel defaults to Omni/All; FX channel defaults to ch2** — notes on ch1 work
  by default. See `notes/fm1-midi-official.txt` (the canonical spec).
- **USB OTG is the reliable transport.** BLE works but jitters (worse at fast rates).
- **Termux and Chrome fight over the USB device** — release any Termux USB claim before
  opening Chrome, or Chrome won't enumerate the FM-1.
- **Web MIDI needs a secure context** (localhost or HTTPS) plus a permission prompt.

Each phase ends with a pass/fail gate. **Do not start the next phase until the current
gate passes.**

---

## Phase 0 — Connectivity spike (THE gate)

Goal: prove the phone can drive the FM-1 at all. Everything depends on this.

- Serve a minimal page over the network (phone + laptop on same LAN, or
  `python3 -m http.server` + `adb reverse` port-forward; `localhost` counts as secure).
- `navigator.requestMIDIAccess()` → list outputs → find the FM-1 (`4c4a:c755`).
- One button: "Test note" → Note On/Off on ch1.
- Test **USB OTG first**, then BLE. Release Termux's USB claim first.

**Done when:** the FM-1 audibly plays a note sent from phone Chrome.

**If this fails, STOP.** Options: different OTG cable, BLE, or fall back to desktop
Chrome as host (the phone premise dies if Chrome can't see the device).

## Phase 1 — Clock + MIDI out (the metronome)

Goal: prove the timing layer on mobile (GOTCHAS #1 and #4).

- Lookahead scheduler: Web Worker 25ms tick + bare `AudioContext.currentTime` as the
  precision reference, scheduling `MIDIOutput.send(data, timestamp)` ~100ms ahead.
- Controls: BPM, rate, swing, jitter. One fixed note.

**Done when:** even, steady pulse at 120 BPM for 5 minutes, no drift/drops;
rate/swing/jitter audibly change it.

## Phase 2 — Note generation chain (the brain)

Goal: random, scale-quantized melodies.

- Modules: gate probability → S&H → LFO (sine/tri/saw/random-walk/smooth-random) →
  distribution (spread/bias) → quantizer (scales from `presets/scales.json`).
- **Touch-first UI** (sliders sized for fingers), not the desktop wireframe.
- MIDI out: Note On + velocity + Note Off (gate-length handling).

**Done when:** turning gate %, spread, bias, scale, and LFO waveform produces musical
changes in real time on the FM-1.

## Phase 3 — Buffer + Deja Vu (the memory)

Goal: the Marbles "slip" between random and locked loop.

- Circular buffer (8/16/32/64), probability-based write-vs-replay, visual slot row.

**Done when:** Deja Vu 0%→100% glides from full random to a locked loop; 50% sounds
familiar-but-evolving.

## Phase 4 — FM-1-specific layer (the moat)

Goal: the part no free tool has.

- FX CC automation: CC 0–23 table from the official spec (filter/reverb/delay/
  distortion/chorus/phaser), each CC settable fixed or LFO-linked, on **FX ch2**.
- Program Change (patch switch).
- The **ModWheel-on-FX-channel gotcha** (CC 1 = Filter Type on ch2) handled explicitly.
- Channel selectors (note + FX) + a "Test note" button.

**Done when:** FX params (cutoff, reverb mix, etc.) sweep in sync with the sequence
from the phone.

## Phase 5 — State + PWA + polish

- Save/recall (5 slots) + export/import JSON (localStorage + file).
- Service worker offline cache (versioned, per GOTCHAS #11).
- Touch-optimized layout, collapsible modules, buffer visualization.

**Done when:** usable end-to-end on the phone and survives offline reload.

## Phase 6 — BLE + mobile hardening (later)

- BLE MIDI latency measurement vs USB.
- Tab-throttling verification on the real phone (Worker timer must survive tab switch).
- Battery / screen-off behavior. Only after USB-OTG workflow is solid.

---

## Deliberately out of scope (v1)

- Writing patterns into the FM-1's internal sequencer (proven impossible via MIDI).
- SysEx bank/patch dumps (no readback; risky from a phone).
- Microtonal, external clock input, polyrhythmic multi-LFO, MIDI learn (v2+).
- Native Android/Kotlin app — Web MIDI avoids APK/build/Java and still works on desktop.
  Revisit only if Web MIDI on the phone proves unusable.

## Note on existing tools

A paid native option exists — **SunVox** (`phone-sequencer.md` recommends it as a
*manual tracker*). It is NOT generative, so it does not replace this project's
Marbles-style goal, but it's the fallback if a *hand-written* tracker workflow is
ever wanted. Free web generative tools (sqncd, modularriffs, Chromatrack, Vekte) are
desktop-oriented; the FM-1-specific FX/CC layer (Phase 4) is the actual differentiator.
