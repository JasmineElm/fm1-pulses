# FM-1 Pulses — Design Document

**Project**: Web-based generative MIDI sequencer for the M-VAVE FM-1
**Platform**: Static web app (GitHub Pages) — vanilla JS, Web MIDI API, PWA
**Target device**: M-VAVE FM-1 (6-op FM synth, monotimbral, BLE/USB MIDI)
**Inspiration**: Mutable Instruments Marbles, Music Thing Turing Machine, Make Noise Maths
**Date**: 2026-10-02

---

## Overview

A browser-based generative sequencer that produces semi-random melodies and sends
them to the FM-1 over Web MIDI. The signal flow follows Eurorack conventions:
Clock → Gate Probability → S&H → LFO → Quantizer → [FM-1 output tap] → Buffer →
Feedback Switch. The user shapes randomness through distribution controls, scale
quantization, and a looping buffer with variable "slip" between fully random and
locked.

Name: "Pulses" — the clock pulses that drive the system, the rhythmic heartbeat
of generative sequences. Not a trademark, just what it does.

No server, no build step, no dependencies. Runs entirely in the browser.

---

## Modules

Each module in the signal chain is described as a component with inputs, controls,
outputs, and behavior. The chain is linear (left to right) with one branch point
at the Buffer.

---

### 1. CLOCK

**Purpose**: Master timing source. Drives the entire system.

**Controls**:
- **BPM** — tempo, 20–300 BPM. Default: 120.
- **Rate** — clock subdivision per step. Values: 1/1, 1/2, 1/4, 1/8, 1/16, 1/32.
  Default: 1/8. A rate of 1/4 means one step per beat; 1/32 means eight steps per beat.
- **Swing** — timing offset on even steps, 0–100%. 0 = straight, 100 = fully swung.
  Applied as a percentage of the step interval.
- **Jitter** — timing randomness, 0–100%. 0 = metronomic, 100 = wildly off-grid.
  Each step's timing is offset by `±(jitter × step_interval × random())`.
  At high values, feels like a human playing loose. At low values, tight groove.

**Outputs**:
- Clock pulse (internal event, triggers next module in chain)

**Behavior**:
- Internal clock only. No external clock input for v1.
- Rate changes take effect on the next beat boundary (not mid-step).
- Jitter preserves average tempo (positive and negative offsets balance over time),
  same philosophy as Marbles.

**FM-1 mapping**:
- FM-1 accepts MIDI Clock (F8) and Start/Stop (FA/FC). If we want FM-1's internal
  sequencer to follow, we can send clock. But since we're driving it as a sound
  module (note on/off), clock output is optional — only needed if the user wants
  the FM-1's arpeggiator to run in sync.

---

### 2. GATE PROBABILITY

**Purpose**: Decides whether each clock pulse produces a note or is silent.

**Controls**:
- **Gate %** — probability that a given step opens the gate. 0–100%. Default: 70%.
  At 100%, every step plays. At 0%, silence. At 50%, roughly half the steps are silent.

**Inputs**:
- Clock pulse from CLOCK

**Outputs**:
- Gate open (triggers S&H)
- Gate closed (step is silent, no note, buffer still advances)

**Behavior**:
- Each clock pulse rolls a random number. If `random() < gate%`, gate opens.
- Gate open triggers S&H to sample the LFO value.
- Gate closed means the step is skipped — no MIDI note sent, but the buffer
  position still advances (the step is a rest, not an absence).
- This is the rhythmic DNA of the sequence. Low gate% = sparse, ambient.
  High gate% = dense, melodic.

**FM-1 mapping**:
- Gate closed = no Note On. Gate open = Note On with velocity from a separate
  velocity control (or fixed at 100).

---

### 3. SAMPLE & HOLD

**Purpose**: Captures a snapshot of the LFO value when the gate opens. Prevents
audible pitch sliding between steps.

**Controls**:
- None (implicit behavior)

**Inputs**:
- Gate open signal from GATE PROBABILITY
- Continuous LFO value

**Outputs**:
- Held voltage (discrete value, constant until next gate open)

**Behavior**:
- When gate opens, reads current LFO value and holds it.
- The held value persists until the next gate open, at which point it updates.
- If gate is closed, the held value does NOT change — it keeps the last captured value.
  (This means consecutive rests hold the previous pitch, which is musically useful.)

**Implementation note**:
- In Eurorack, S&H is between the trigger and the LFO input. In our case, the
  LFO runs freely and S&H captures its value at gate-open time. Same result.

---

### 4. LFO

**Purpose**: Generates a continuous, repeating control signal that becomes the
pitch source after quantization.

**Controls**:
- **Amplitude** — range of the LFO swing, 0–100%. Default: 50%.
  At 100%, covers the full MIDI note range (0–127). At 25%, covers ~32 notes.
  This is the melodic range of the output.
- **Offset** — shifts the LFO center point, -100% to +100%. Default: 0%.
  Moves the pitch range up or down. At +50%, the LFO oscillates in the upper register.
- **Rate** — LFO speed relative to the clock. Values: /1, /2, /4, /8, /16, /32, /64.
  Default: /4. At /1, the LFO completes one cycle per clock step. At /8, one cycle
  every 8 steps. Slower rates = longer melodic arcs.
- **Waveform** — shape of the LFO:
  - **Sine** — smooth, predictable arcs
  - **Triangle** — linear ramps, good for stepwise motion
  - **Saw** — ascending or descending sweeps
  - **Random Walk** — each step moves ±1 from the previous value (drunk walk)
  - **Smooth Random** — interpolated random values (like Marbles' Y output)

**Inputs**:
- Clock pulse (advances the LFO phase)

**Outputs**:
- Continuous value (0–127 range, before amplitude/offset applied)

**Behavior**:
- LFO runs continuously, independently of the gate. It advances phase on every
  clock tick regardless of whether the gate is open or closed.
- The S&H module captures the LFO value only when the gate opens.
- Random Walk: each step adds -1, 0, or +1 to the current value. Bounces at
  the amplitude boundaries. Creates stepwise melodic motion without jumps.
- Smooth Random: generates a random target value and interpolates toward it
  over N steps, then picks a new target. Creates slow, evolving curves.

**FM-1 mapping**:
- LFO output (after S&H) is a floating-point value in the range 0–127 (MIDI notes).
  Amplitude and offset are applied as: `note = offset + (lfo_value × amplitude / 100)`.

---

### 5. DISTRIBUTION (SPREAD + BIAS)

**Purpose**: Shapes *how* random values are distributed before they reach the
quantizer. Controls the character of the randomness.

**Controls**:
- **Spread** — probability distribution width. Multi-position knob:
  - **Constant** (fully CCW): no randomness, always the same note
  - **Bell curve** (9 o'clock): most values near center, occasional extremes
  - **Uniform** (12 o'clock): equal probability across the full range
  - **Extremes** (fully CW): only min and max values, like random gates
  Default: Uniform.
- **Bias** — skews the distribution toward low or high values. -100% to +100%.
  Default: 0% (centered). At +50%, notes cluster in the upper register.
  This is NOT a pitch shift — it changes the *probability*, so occasional
  low notes still appear, they're just less likely.

**Inputs**:
- Raw random value (from LFO or internal random source)

**Outputs**:
- Shaped random value (same range, different distribution)

**Behavior**:
- Spread controls the shape of the probability density function:
  - Constant: delta function (zero variance)
  - Bell: Gaussian with σ proportional to spread
  - Uniform: rectangular distribution
  - Extremes: bimodal (peaks at min and max)
- Bias applies a weight function: `P(note) = P(note) × (1 + bias × (note - center) / range)`
- These controls apply AFTER the LFO/S&H and BEFORE the quantizer.
  They reshape the pitch distribution without changing the LFO waveform.

**Implementation note**:
- In Marbles, SPREAD and BIAS are the two most-played knobs. They're the
  "steering wheel" for the randomness character. Put them front and center in the UI.

---

### 6. QUANTIZER

**Purpose**: Snaps continuous pitch values to musical scales. Makes randomness
sound musical.

**Controls**:
- **Scale** — selectable from presets:
  - Chromatic (12 notes)
  - Major
  - Minor (natural)
  - Minor (harmonic)
  - Pentatonic (major)
  - Pentatonic (minor)
  - Dorian
  - Mixolydian
  - Custom (user-defined, up to 12 notes)
  Default: Minor pentatonic.
- **Root** — root note of the scale, C–B. Default: C.
- **Steps** — progressive quantization strength, 0–100%. Default: 100%.
  - 0%: no quantization (chromatic pass-through)
  - 25%: accidentals become less likely
  - 50%: only scale notes, with weight toward root and fifth
  - 75%: strong root/fifth bias
  - 100%: only root note and octaves
  This is Marbles' most elegant control — one knob goes from chaos to drone.

**Inputs**:
- Pitch value from DISTRIBUTION

**Outputs**:
- Quantized MIDI note number (integer, 0–127)

**Behavior**:
- Finds the nearest note in the active scale. Ties go to the higher note.
- Steps control: instead of hard quantization, applies a probability weight.
  At 50%, out-of-scale notes have 50% chance of being snapped to the nearest
  scale note, 50% chance of passing through. At 100%, all notes are snapped.
  At 0%, everything passes through (chromatic).
- Scale changes take effect immediately on the next step (no need to wait for
  the buffer to cycle).
- Custom scale: user toggles notes on/off in a chromatic grid (12 buttons).
  Saved to localStorage.

**FM-1 mapping**:
- Output is a MIDI note number. Sent as Note On on the FM-1's Note Channel.
- FM-1 is 6-op FM, so all notes sound "good" in any scale — no filter to worry about.

---

### 7. FM-1 OUTPUT TAP

**Purpose**: Sends MIDI to the FM-1. This is where the sound comes out.
Located BETWEEN the quantizer and the buffer — no delay.

**Controls**:
- **MIDI Channel** — 1–16. Default: 1 (per MVP findings, FM-1 accepts on ch1).
- **Velocity** — fixed velocity 1–127, or "random" (randomized per step).
  Default: 100.
- **Note Duration** — how long the MIDI note stays on. Values: 10ms–2000ms, or
  "gate" (stays on until next step). Default: "gate".
- **FX Channel** — MIDI channel for FM-1 effect CCs. Default: 2.
- **FX CCs** — optional: send CC values on the FX channel to modulate effects
  in sync with the sequence. Mapped to FM-1's CC 0–23 (filter, reverb, delay,
  distortion, chorus, phaser). Each CC can be set to a fixed value or linked
  to the LFO/s&H output.

**Inputs**:
- Quantized MIDI note from QUANTIZER
- Gate open/closed from GATE PROBABILITY

**Outputs**:
- MIDI Note On/Off to FM-1 (via Web MIDI API)
- Optional: MIDI CC on FX channel

**Behavior**:
- On gate open: sends Note Off for previous note (if note duration = gate),
  then Note On with the quantized note and velocity.
- On gate closed: sends Note Off for previous note.
- MIDI connection: user selects FM-1 from the Web MIDI device list. Supports
  both USB and BLE MIDI (both appear as MIDI outputs in Chrome).
- FX CC automation: if enabled, sends CC values on the FX channel synchronized
  to the clock. Can modulate filter cutoff (CC 2), reverb mix (CC 7), delay
  mix (CC 11), etc. in sync with the generative sequence.

**FM-1 specific**:
- Default note channel: 1 (verified in MVP)
- Default FX channel: 2 (per FM-1 manual)
- SysEx: not used in v1 (no patch dump, no pattern write)
- Program Change: can send to change FM-1 patch (0–127)

---

### 8. BUFFER

**Purpose**: Records incoming notes into a circular buffer. Can loop them back.
This is the "memory" of the system — the bridge between random and structured.

**Controls**:
- **Length** — buffer size in steps. Values: 8, 16, 32, 64. Default: 16.
- **Deja Vu** — the master control. Continuous knob, 0–100%:
  - **0%** (fully CCW): buffer is transparent. Every step writes a new random
    value. No repetition. Fully generative.
  - **1–49%**: buffer records, but each step has a `deja_vu%` chance of
    *not* writing — instead replaying the value from the same position in a
    previous cycle. The sequence "slips": mostly new material, occasional echoes
    of the past.
  - **50%**: sweet spot. Half new, half recycled. Sequences that feel familiar
    but keep evolving. This is where the magic happens.
  - **51–99%**: mostly recycling. New values sneak in occasionally. The sequence
    is mostly a loop with small mutations.
  - **100%** (fully CW): fully locked. Buffer loops without any new input.
    The pattern is frozen.
  Default: 0%.

**Inputs**:
- Quantized note from QUANTIZER (via FM-1 OUTPUT TAP)
- Gate open/closed from GATE PROBABILITY

**Outputs**:
- Note to FM-1 OUTPUT TAP (direct path, no delay)
- Looping note (fed back to buffer input when Deja Vu > 0%)

**Behavior**:
- Buffer is a circular array of `length` slots. Each slot stores:
  - MIDI note number (0–127)
  - Velocity (0–127)
  - Gate open/closed (boolean)
- On each step:
  1. Buffer position advances (wraps at `length`)
  2. If `random() > deja_vu%`: write new value from quantizer into current slot
  3. If `random() <= deja_vu%`: read existing value from current slot (loop it)
  4. The value (new or recycled) is sent to FM-1 OUTPUT TAP
- When Deja Vu = 100%: buffer never writes, only reads. Pattern is locked.
- When Deja Vu = 0%: buffer always writes. Every step is fresh random.
- Buffer contents persist until overwritten. Changing Deja Vu from 100% to 50%
  starts mutating the locked pattern, not erasing it.

**Key design decision**:
- FM-1 output tap is BEFORE the buffer (between quantizer and buffer).
  This means:
  - You hear changes IMMEDIATELY when you flip Deja Vu
  - No delay of N steps waiting for the buffer to cycle
  - The buffer is a "shadow" that records what you're already hearing
  - When locked, the buffer loops what was already played

**Visual feedback**:
- Show the buffer contents as a row of note labels (C4, D#3, etc.)
- Highlight current step position
- Color-code: green = new value written this cycle, gray = recycled from previous
- When locked (100%), all slots gray = loop confirmed

---

### 9. CLOCK DIVISION (secondary)

**Purpose**: Independent clock division for the buffer, creating polyrhythmic
relationships between the "new note" rate and the "buffer advance" rate.

**Controls**:
- **Buffer Clock Division** — how often the buffer advances relative to the main
  clock. Values: /1, /2, /4, /8. Default: /1.
  At /2, the buffer advances every other main clock tick. At /4, every fourth.
  This means the buffer holds notes longer, creating longer melodic phrases
  from a faster clock.

**Behavior**:
- Main clock drives Gate Probability → LFO → Quantizer at the base rate.
- Buffer advances at a divided rate. If main clock is 1/16 and buffer division
  is /4, the buffer advances at 1/4 note rate while notes are generated at
  1/16 rate. The buffer "samples" every 4th note.
- This creates the effect of a fast generative source filling a slower-moving
  buffer. Like recording at high speed, playing back at normal speed.

---

### 10. STATE MANAGEMENT

**Purpose**: Save and recall the entire module state.

**Controls**:
- **Save** — stores current state to one of 5 slots.
- **Recall** — loads state from a slot.
- **Export** — downloads state as JSON.
- **Import** — loads state from JSON file.

**Stored state**:
- All module parameters (BPM, rate, swing, jitter, gate%, LFO settings,
  spread, bias, scale, root, steps, buffer length, deja vu, etc.)
- Buffer contents (the actual note sequence)
- Custom scales

**Storage**:
- localStorage for quick save/recall
- JSON file for sharing/backup

---

## Signal Chain Summary

```
CLOCK (BPM, rate, swing, jitter)
  │
  ▼
GATE PROBABILITY (gate %)
  │
  ├── gate open ──▶ S&H ──▶ LFO (amp, offset, rate, waveform)
  │                           │
  │                           ▼
  │                    DISTRIBUTION (spread, bias)
  │                           │
  │                           ▼
  │                    QUANTIZER (scale, root, steps)
  │                           │
  │                           ▼
  │                    FM-1 OUTPUT TAP (MIDI out, velocity, FX CCs)
  │                           │
  │                           ▼
  │                    BUFFER (length, deja vu, clock div)
  │                           │
  │                           ├── deja vu < 100%: write new value
  │                           └── deja vu >= value: read old value (loop)
  │
  └── gate closed ──▶ rest (no note, buffer still advances)
```

---

## FM-1 MIDI Reference (from project notes)

### Note Channel (default: ch1)
| Message | Data | Effect |
|---|---|---|
| Note On | note, vel 1–127 | Triggers sound |
| Note Off | note | Key release |
| Program Change | 0–127 | Changes patch (001–128) |
| Pitch Bend | 14-bit | Pitch bend |
| Aftertouch | 0–127 | Channel pressure |
| Mod Wheel | CC 1 | Modulation |
| Sustain | CC 64 | Sustain pedal |

### FX Channel (default: ch2) — CC 0–23
| CC | Effect | Range |
|---|---|---|
| 0 | Filter Switch | 0=off / ≥1=on |
| 1 | Filter Type | 0–2 (LPF/BPF/HPF) |
| 2 | Filter Cutoff | 0–107 |
| 3 | Filter Q | 0–10 |
| 4 | Reverb Switch | 0=off / ≥1=on |
| 5 | Reverb Type | 0–2 (Room/Hall/Plate) |
| 6 | Reverb Decay | 0–100 |
| 7 | Reverb Mix | 0–100 |
| 8 | Delay Switch | 0=off / ≥1=on |
| 9 | Delay Decay | 0–100 |
| 10 | Delay Rate | 0–100 |
| 11 | Delay Mix | 0–100 |
| 12 | Distortion Switch | 0=off / ≥1=on |
| 13 | Distortion Gain | 0–100 |
| 14 | Distortion Tone | 0–100 |
| 15 | Distortion Level | 0–100 |
| 16 | Chorus Switch | 0=off / ≥1=on |
| 17 | Chorus Freq | 0–100 |
| 18 | Chorus Depth | 0–100 |
| 19 | Chorus Mix | 0–100 |
| 20 | Phaser Switch | 0=off / ≥1=on |
| 21 | Phaser Freq | 0–100 |
| 22 | Phaser Depth | 0–100 |
| 23 | Phaser Mix | 0–100 |

---

## Technical Decisions

### Why vanilla JS, no framework?
- GitHub Pages serves static files. No build step.
- Web MIDI API is a browser native API — no library needed.
- The app is a single page with ~10 JS files. React/Svelte adds complexity
  without benefit.
- Easy for community contributors to read and modify.

### Why Web MIDI over native Android?
- Works on desktop too (Chrome, Edge) — not locked to Android.
- No APK compilation, no Android Studio, no Java.
- HTTPS required for Web MIDI — GitHub Pages provides this.
- BLE MIDI and USB MIDI both appear as Web MIDI outputs.
- Community can use it from any device with Chrome.

### Why client-side only?
- No server to maintain, no hosting costs.
- The entire logic is <500 lines of JS.
- Works offline after first load (PWA service worker).
- State is in localStorage. No accounts, no cloud.

### Buffer design: why circular array?
- Simple, O(1) read/write per step.
- Fixed memory footprint (64 slots max × 3 bytes = 192 bytes).
- Visual representation is intuitive: row of slots, current position highlighted.
- No linked lists, no dynamic allocation.

### Deja Vu: why probability-based?
- Same as Marbles' approach. The alternative (hard switch) creates jarring
  transitions. Probability gives smooth gradient between random and locked.
- The "slipping" behavior (50% area) is where the most musical material emerges.
- Changing Deja Vu in real-time is a performance gesture.

---

## Target Platform: Desktop Chrome First

**Phase 1** (current): Desktop Chrome — USB MIDI reliable, full screen real estate,
mouse + keyboard input, low GC jitter.

**Phase 2** (after desktop works): Mobile Chrome on Android — BLE MIDI, touch UI,
responsive layout, Web Worker timer for tab throttling.

Rationale:
- USB MIDI enumeration works 100% on desktop (native drivers).
- Mobile Chrome has quirks with USB OTG MIDI device detection.
- Desktop allows faster iteration and testing.
- Mobile-specific concerns (BLE jitter, tab throttling, touch UI) deferred.

---

## UI Layout (Desktop Wireframe)

Simple, module-based layout. Each module is a bordered section with:
- Parameter label on the left
- Slider (range input) in the middle
- Numeric/text input box on the right

All parameters visible at once. No tabs, no menus, no hidden sections.

```
┌─────────────────────────────────────────────────────────────────────┐
│  FM-1 PULSES                           [MIDI Device: ▼ FM-1] [▶/■] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ CLOCK ────────────────────────────────────────────────────────┐ │
│  │ BPM        [====|===============] [120]                        │ │
│  │ Rate       [========|==========] [1/16]                       │ │
│  │ Swing      [==|================] [0%]                         │ │
│  │ Jitter     [==|================] [0%]                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ GATE ─────────────────────────────────────────────────────────┐ │
│  │ Gate %     [==============|====] [70%]                         │ │
│  │ Velocity   [===========|======] [100]                          │ │
│  │ Duration   [========|=========] [gate]                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ LFO ──────────────────────────────────────────────────────────┐ │
│  │ Waveform   [========|=========] [sine]                         │ │
│  │ Amplitude  [=========|========] [50%]                          │ │
│  │ Offset     [===|==============] [0]                            │ │
│  │ Rate       [======|===========] [/4]                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ DISTRIBUTION ─────────────────────────────────────────────────┐ │
│  │ Spread     [==========|======] [uniform]                       │ │
│  │ Bias       [===|==============] [0]                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ QUANTIZER ────────────────────────────────────────────────────┐ │
│  │ Scale      [========|=========] [minor penta]                  │ │
│  │ Root       [====|==============] [C]                           │ │
│  │ Steps      [=================|] [100%]                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ BUFFER ───────────────────────────────────────────────────────┐ │
│  │ Length     [========|=========] [16]                           │ │
│  │ Deja Vu    [==|================] [0%]                          │ │
│  │                                                             │ │
│  │  [ C4 ][ · ][D#4][ · ][ F4 ][ G4 ][ · ][A#4][ C5 ][D#5]..  │ │
│  │   ▲ current step                                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ FM-1 OUTPUT ──────────────────────────────────────────────────┐ │
│  │ Channel    [====|==============] [1]                           │ │
│  │ FX Channel [====|==============] [2]                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [Save 1] [Save 2] [Save 3] [Save 4] [Save 5]  [Export] [Import]  │
└─────────────────────────────────────────────────────────────────────┘
```

UI details:
- Dark theme (dark gray background, light text, colored accents)
- Sliders are `<input type="range">` — native browser control, styled with CSS
- Input boxes allow direct numeric entry (click, type value, Enter)
- Slider and input box are synced — changing one updates the other
- Module sections are collapsible (click header to collapse/expand)
- Buffer visualization: row of note slots, current step highlighted
- Start/Stop button: ▶ when stopped, ■ when running
- MIDI device dropdown: populated from Web MIDI API on page load

---

## Default Values (Initial State)

All parameters load with these values on first visit. Users can Save/Export
to persist custom states.

| Parameter | Default | Rationale |
|---|---|---|
| BPM | 120 | Standard tempo |
| Rate | 1/16 | Sweet spot — not too slow, not too fast |
| Swing | 0% | Straight timing |
| Jitter | 0% | Metronomic (humanize later) |
| Gate % | 70% | Sparse but not empty |
| Velocity | 100 | Consistent |
| Duration | gate | Note on until next step |
| Waveform | sine | Smooth, musical arcs |
| Amplitude | 50% | ~64 notes range |
| Offset | 0 | Centered |
| LFO Rate | /4 | 1 LFO cycle per 4 steps |
| Spread | uniform | Equal probability across range |
| Bias | 0 | Centered distribution |
| Scale | Pentatonic Minor | Sounds good with everything, hard to make sound bad |
| Root | C | Neutral |
| Steps | 100% | Full quantization |
| Buffer Length | 16 | Standard loop size |
| Deja Vu | 0% | Fully random (no memory) |
| MIDI Channel | 1 | Verified on Baud Girl firmware |
| FX Channel | 2 | FM-1 default |

---

## Scale Presets

20 presets covering common Western, exotic, and symmetric scales.
Custom scale option for user-defined note sets.

| # | Scale Name | Notes | Intervals |
|---|---|---|---|
| 1 | Chromatic | 12 | all semitones |
| 2 | Major (Ionian) | 7 | 1 2 3 4 5 6 7 |
| 3 | Minor (Natural/Aeolian) | 7 | 1 2 b3 4 5 b6 b7 |
| 4 | Minor Harmonic | 7 | 1 2 b3 4 5 b6 7 |
| 5 | Minor Melodic (ascending) | 7 | 1 2 b3 4 5 6 7 |
| 6 | Pentatonic Major | 5 | 1 2 3 5 6 |
| 7 | Pentatonic Minor | 5 | 1 b3 4 5 b7 |
| 8 | Blues | 6 | 1 b3 4 b5 5 b7 |
| 9 | Dorian | 7 | 1 2 b3 4 5 6 b7 |
| 10 | Mixolydian | 7 | 1 2 3 4 5 6 b7 |
| 11 | Phrygian | 7 | 1 b2 b3 4 5 b6 b7 |
| 12 | Lydian | 7 | 1 2 3 #4 5 6 7 |
| 13 | Locrian | 7 | 1 b2 b3 4 b5 b6 b7 |
| 14 | Whole Tone | 6 | 1 2 3 #4 #5 #6 |
| 15 | Diminished (Half-Whole) | 8 | 1 b2 b3 3 #4 5 6 b7 |
| 16 | Diminished (Whole-Half) | 8 | 1 2 b3 4 b5 b6 6 7 |
| 17 | Augmented | 6 | 1 3 b3 5 #5 7 |
| 18 | Japanese (In Sen) | 5 | 1 b2 4 5 b7 |
| 19 | Arabic (Hijaz) | 7 | 1 b2 3 4 5 b6 b7 |
| 20 | Custom | — | User-defined via toggle grid |

**Microtonalities**: deferred to v2. The FM-1 accepts MIDI notes (semitones only).
Microtonal would require per-note pitch bend — possible but complex.

---

## Language

**English for v1.** Musical terms (BPM, swing, spread, bias, gate, LFO, quantizer)
are universal. All reference documentation (FM-1 manual, Marbles, Maths) is English.
i18n can be added later — UI labels are simple strings, easy to replace.

---

## User Flow

1. Open app in Chrome (localhost:8080 for dev, GitHub Pages for production)
2. See full UI with all defaults loaded — app is immediately playable
3. Connect FM-1 via USB cable
4. Select "FM-1" from MIDI device dropdown (auto-populated by Web MIDI API)
5. Press **Start** button (or Spacebar)
6. Hear semi-random melodies playing on the FM-1
7. Adjust sliders to shape the sound:
   - Gate % to control density
   - Spread/Bias to control note distribution
   - Scale to snap to musical scales
   - Deja Vu to introduce repetition/looping
8. When a pattern sounds good → set Deja Vu to 100% to lock it
9. Save to a slot (1-5) via Save buttons
10. Export as JSON to share or back up

No MIDI device selected → Start button disabled, show hint: "Connect a MIDI device".

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Start / Stop |
| 1-5 | Load save slot |
| Shift+1-5 | Save to slot |
| R | Randomize all parameters |
| 0 | Reset all to defaults |
| M | Mute / unmute MIDI output |

Keyboard shortcuts work globally (no need to focus a specific element).
`event.preventDefault()` on Space to avoid page scroll.

---

## File Structure

```
fm1-pulses/
├── index.html              ← single page, loads all modules
├── manifest.json           ← PWA manifest
├── sw.js                   ← service worker (offline cache)
├── GOTCHAS.md              ← known issues and mitigations
├── DESIGN.md               ← this document (symlink or copy)
├── css/
│   └── style.css           ← dark theme, hardware-style UI
├── js/
│   ├── app.js              ← main, initialization, event wiring
│   ├── clock.js            ← CLOCK module
│   ├── gate.js             ← GATE PROBABILITY module
│   ├── lfo.js              ← LFO + S&H module
│   ├── distribution.js     ← SPREAD + BIAS module
│   ├── quantizer.js        ← QUANTIZER module
│   ├── buffer.js           ← BUFFER + DEJA VU module
│   ├── midi.js             ← Web MIDI API wrapper, FM-1 output
│   ├── state.js            ← save/recall/export/import
│   └── ui.js               ← knob/slider components, buffer visualization
├── presets/
│   └── scales.json         ← scale definitions (20 presets)
└── README.md               ← project description, how to use
```

---

## Future (v2+)

- Mobile Chrome support (responsive UI, touch, Web Worker timer, BLE MIDI)
- Microtonal support (per-note pitch bend)
- External clock input (sync to hardware via MIDI Clock)
- Multiple LFO outputs (polyrhythmic, like Marbles X1/X2/X3)
- Y modulation (slow random → spread/bias/offset)
- Slew/portamento (post-quantizer, configurable rise/fall)
- Baud Girl integration (load/save patches when repo goes public)
- Pattern sharing (export/import buffer contents as files)
- FX CC automation (modulate FM-1 effects in sync with sequence)
- i18n (Spanish, Portuguese)
- MIDI learn (map hardware knobs to parameters)
- Scale learning (play notes on FM-1 keyboard, app learns scale)
