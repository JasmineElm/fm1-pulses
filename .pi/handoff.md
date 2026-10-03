# FM-1 Pulses — handoff

## Mission

A **browser sequence generator for the M-VAVE FM-1** (vanilla JS, no build step,
no deps). Shape randomness with sliders → generate a **bank of 16 phrases** →
hear them in the browser → **freeze** them into the FM-1's own sequencer patterns
over Web MIDI (SysEx `0x20`). Also works as a **live MIDI broadcaster** (loop the
selected slot and morph it in real time).

- **Live:** https://mene311.github.io/fm1-pulses/
- **Repo:** `github.com/mene311/fm1-pulses` (public) — Pages deploys from `main` / root
- **Local:** `~/Projects/fm1-pulses/`
- **Device notes / tools:** `~/Projects/mvave-fm1/` (see its README)

## Progress

**Toolchain**
- [x] `js/pattern.js` — SysEx `0x20` encoder, byte-verified against Virtual-FM-1's
      `sync/Fm1Seq.cpp` (8 msgs × 177 bytes, checksum included)
- [x] `js/generator.js` — LFO → distribution → quantizer → gate → Deja Vu;
      `generateBank()` = **16 distinct slots from one seed**, `Drift` evolves the
      parameters slot 1 → 16
- [x] `js/midi.js` — finds the FM-1, sends patterns and **reads the reply**
      (surfaces `status 3 = sequencer playing` instead of failing silently)
- [x] `js/audio.js` — small 2-op FM Web Audio preview (hear it with no device)
- [x] `js/app.js` — all UI wiring

**Features**
- [x] Bank strip (16 mini step-maps), tap to select, `←`/`→`
- [x] 64-step grid, one **circle** per step (white = rest, accent = note)
- [x] **Step editing + locks** — click a step, `±` semitone, `✕` empty; edits
      **lock** the step so it survives regeneration; "clear all locks" releases
- [x] **Live loop** — ▶ Play loops the selected slot; any slider re-derives the
      bank in real time (debounced 40 ms) and the loop follows within a step;
      playhead shows the current step
- [x] **Freeze → FM-1** (selected) / **Send all 16**
- [x] **7 themes** = the FM-1's own (decoded from its firmware)
- [x] Tooltips on every control + typeable number boxes
- [x] LFO rate labelled as a duration (`/4 · 4 steps · 1/4 bar · 16 cycles`)
- [x] Amplitude/offset show the **notes** they produce; magnet snaps at
      root/3rd/5th/octave
- [x] Amplitude 0 = the scale root (unconditionally)
- [x] Defaults: note value 1/16, LFO rate /4

## Key device facts (hard-won — do not re-learn)

- **Pattern write** (FM-1+VA / baud girl firmware only): SysEx `0x20`, 8 steps per
  message, 177 bytes:
  `F0 43 00 7D 20 <pat> <part> <save> <len> <rate> <tempoLo> <tempoHi> <gate> <swing> <voice> [8 × (rate, nNotes, notes[9], vels[9])] <sum> F7`,
  `sum = Σ(b ^ 0xFF) & 0x7F` over the body. `parts = max(2, ceil(len/8))`, last carries `save`.
- **Replies:** `F0 7D <7-bit LSB-first packed> F7` = `7D <kind> <status> <arg:4LE> <len:2LE> <data> <sum8>`.
  kind `0x50` sound, `0x51` mem, `0x52` pattern. status `0` done, `1` out of range,
  `2` damaged, **`3` the sequencer is playing**.
- **⚠ The FM-1's sequencer must be STOPPED** to accept a write (status 3 otherwise).
- **⚠ USB-MIDI SysEx framing trap:** CIN `0x04` for the start **and every
  continuation** packet; only the **last** packet uses `0x05/0x06/0x07`. Using
  `0x06` for continuations truncates every SysEx at its first continuation packet
  — the write silently does nothing. (Cost hours; Web MIDI does this for you.)
- **Themes:** `BGTHEME` table in `baudgirl_092_app.bin` @ `0x8ecbc` — 7 entries of
  12-byte name + 4 × RGB565 (accent, tint, dark bg, mid).

## Remaining

- [ ] **Spread → real randomness.** Today `spread` only reshapes the LFO value; it
  doesn't inject new values, so a slow LFO rate caps the melody to ~3 pitches and
  amplitude/offset feel weak. Make it Marbles-style (stochastic source shaped by
  spread/bias), which is the change that makes the whole pitch section come alive.
- [ ] **Verify a browser freeze against the real device.** The encoder and reply
  parsing are verified, but the Web MIDI freeze has not been confirmed on hardware
  (the phone path uses `mvave-fm1/mvp/fm1tool` over libusb, which IS verified).
  Note Android Chrome may not expose USB-OTG MIDI through Web MIDI — desktop works.
- [ ] **Live loop timing is `setTimeout`** (~5–15 ms jitter). Swap for a lookahead
  scheduler using `MIDIOutput.send(data, timestamp)` if it sounds sloppy.
- [ ] Magnet interval set (root/m3/4th/5th/octave) is a guess — tune to taste.
- [ ] No persistence yet (bank + locks are lost on reload) — localStorage.
- [ ] Out of scope of the app but open on the device side: per-step
  ratchet/chance/accent/tie & slide and per-pattern Chain are **not** carried by
  `0x20` (firmware layout unpublished); ties are reachable only via real-time
  recording. See `mvave-fm1/README.md`.

## How it's deployed

```bash
cd ~/Projects/fm1-pulses
git add -A && git commit -m "..." && git push    # Pages rebuilds in ~1 min
python3 -m http.server 8099                      # local (Web MIDI needs localhost/https)
```

GitHub Pages caches assets `max-age=600`, so a stale `index.html` + new `app.js`
(or vice-versa) can briefly disagree after a push — hard-refresh if something
looks half-updated.
