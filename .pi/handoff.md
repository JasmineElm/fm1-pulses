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
- **Bluetooth:** the FM-1 has native **BLE MIDI** (documented + the standard BLE-MIDI
  GATT UUIDs are in its firmware). Plan, evidence, risks and the verification ladder live
  in **`notes/BLUETOOTH-PLAN.md`** — planned, not implemented.

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
- [x] **LFO rate is a continuous slider** (1–64, 0.5 step, no snapping). Fractional
      and non-dividing rates are the point: rate 4 gives 1/4 distinct bars (it repeats),
      rate 4.5 gives 4/4 distinct bars, i.e. the phrase never lands the same way twice.
      The random source uses a floor-based draw interval so fractional rates work there
      too. (The old duration readout was dropped.)
- [x] **`random` wave** — a Marbles-style stochastic source. It draws a fresh value
      every LFO-rate steps and holds it; `spread` picks the distribution
      (uniform / bell / extremes / constant) and `bias` is a real monotonic skew.
      The deterministic waves are unchanged as contours. Verified: `random` gives
      30 pitches at /1 and 4 at /16 (a sine at /4 is stuck at 3); 16/16 distinct
      slots even at Gate 100%; DejaVu 0/50/100% → 4/55/100% reuse.
- [x] **Bias fixed** — it was a second amplitude (positive values were clamped to a
      no-op). Now `skew(v,bias) = v^(3^-bias)`: measured mean note 53→69 as bias
      goes −100→+100, range unchanged.
- [x] Amplitude/offset show the **notes** they produce; magnet snaps at
      root/3rd/5th/octave
- [x] **Offset is the centre (median) of the pitch range; Amplitude is its
      half-width** — notes span `centre ± 18·amp` semitones, so Amplitude 0 sits
      exactly on the Offset note. The Amplitude readout shows that offset-centred
      range, and `generator.js` no longer has the old "Amplitude 0 = scale root"
      special case (it made 0% ignore Offset).
- [x] **Swing is audible in the browser** — `swingFrac()` delays every offbeat,
      50% straight → 75% triplet (2:1). Before this the slider only wrote the
      header byte for the FM-1 and the browser audition ignored it.
- [x] **Clear all 16** button — writes a full 64-step empty pattern over every slot.
      ⚠ Unresolved on hardware: a single **Freeze** works (Android Chrome) but
      Clear fails with SysEx status 3 even with the FM-1's sequencer stopped, so
      the FM-1 may refuse an all-empty pattern. Probe files made for the verified
      path: `~/probe-empty64.syx`, `~/probe-empty1.syx`; test with
      `~/fm1tool.sh write ~/probe-empty64.syx` (a non-empty `~/fm1-mvp/*.syx` is
      the control). If empty patterns are refused, either find the real erase or
      drop the button.
- [x] Defaults: note value 1/16, LFO rate /4

**BLE probe (2026-10-03) — `probe/`**
- [x] `probe/encode.js` — DOM/Bluetooth-free byte layer: BLE-MIDI `packetize`,
      `0x11` read, `0x20` write, `createSysexReassembler`, `decodeReply`.
      This is the byte half of the future `BleTransport`.
- [x] `probe/ble.html` — throwaway Web Bluetooth page on Pages:
      connect → service/char dump → note on/off → `0x11` (R1) → `0x20` (R2).
      **https://mene311.github.io/fm1-pulses/probe/ble.html** (deployed, HTTP 200)
- [x] Byte-verified **before hardware**: `0x20` output is byte-identical to
      `fm1pat.py encode_write`; 177 B → 10 packets, all ≤ 20 B (MTU 23);
      reassembler round-trips byte-exact for reply lengths 0/20/127/128/179/180
      at **all 217** split points.
- [x] **Bug found:** the reply length field is 2× 7-bit groups ⇒ shift is **7**,
      not 8. `js/midi.js` and `fm1tool.c` both use `<< 8`, which cannot represent
      a length ≥ 128. Unused in both, so harmless — but wrong.
- [ ] **Run the ladder on the phone (Chrome, FM-1 paired to the phone).**
      Hardware is the last gate; nothing else stays blocked on it.

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

- [ ] **Bluetooth / wireless.** Probe built and byte-verified — see `probe/`.
  Remaining: run the hardware ladder, then implement `BleTransport` behind the
  transport seam. The FM-1 is a
  standard **BLE-MIDI peripheral** (`03B80E5A-…` service + `7772E5DB-…` data I/O
  characteristic, both found in `baudgirl_092_flash.bin`), so the browser can drive it via
  **Web Bluetooth** — no cable, no OS pairing, and unlike Web MIDI it also works on
  Android Chrome. Blocked on one binary unknown: **does the FM-1's BLE side accept the
  proprietary `0x20` pattern write, or only SysEx voice dumps?** Run the verification
  ladder (power on → BT scan → small SysEx → the 177-byte write) before writing any code.
- [ ] **The periodic waves can't use Spread/Bias as distributions.** They are
      deterministic contours on purpose (kept), so Spread only warps the wave and
      Bias skews it — the full distribution control only exists in the `random`
      wave. `shape()`'s `bell` is still the old centre-pushing formula (misnamed);
      the `random` wave's bell is proper. Decide whether to fix the deterministic
      `bell` too. Default wave is still `sine` — consider defaulting to `random` so
      Spread/Bias are live on load.
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
