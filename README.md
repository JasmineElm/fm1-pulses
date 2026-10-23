# FM-1 Pulses

Browser-based generative MIDI workstation for the **M-VAVE FM-1** (6-operator FM synthesizer). Built with vanilla JavaScript, Web MIDI, Web Audio, and PWA standards. Zero dependencies, no build steps, and no server required.

**▶ Live:** https://james-lemin.com/fm1-pulses/

---

## Overview

FM-1 Pulses generates evolving 64-step musical phrases and plays them in real time to the M-VAVE FM-1 over MIDI, with a built-in browser FM synthesizer for cable-free auditioning. Sessions can be saved and restored exactly (see **Session files** below).

### Sequencer Models

FM-1 Pulses includes four distinct algorithmic sequencing engines accessible from the model selection hub:

- **Mene311 (Stochastic)**: An analog-inspired generative signal chain combining Sample & Hold, continuous LFO waveshaping, Gaussian distribution weighting, scale quantization, and a looping Deja-Vu buffer.
- **Turing Machine**: A shift-register melody generator inspired by the Music Thing Modular Turing Machine. Circulating bit registers mutate probabilistically, moving between locked repetitive loops and gradual melodic drift.
- **Cellular Automata**: An emergent step generator powered by one-dimensional elementary cellular automata (Wolfram Rules 30, 90, 110, and 150), producing organic, evolving fractal patterns across generations.
- **Particles**: A 2D kinetic collision engine inspired by Orca and Plinky. Autonomous directional playheads traverse an interactive surface, rebounding off boundaries and deflector nodes to trigger musical notes on collisions.
- **Double Pendulum**: A chaotic attractor physics engine powered by Runge-Kutta 4th-order (RK4) integration of Euler-Lagrange equations. Direct-drag bobs on canvas to set release angles, switch between reproducible loops and continuous chaos, and map kinetic vectors to scale degrees.
- **Flocking Swarm**: An autonomous boid flocking chord engine unlinked to any step clock. Boids navigate a 2D field via Separation, Alignment, and Cohesion. When the flock congregates at interactive Attractor Targets, it triggers up to 8-voice polyphonic chords across custom scales with kinetic dynamics, and scatters the swarm in a repulsion blast.

---

## Tools

- **DX Patch Generator**: Algorithmic sound designer and SysEx patch manager for Yamaha DX7 and FM-1 hardware. Generates organic FM patches across 11 sonic categories using seedable macro controls, mutates existing voices with controlled drift, renders interactive envelope and algorithm topologies, auditions via a built-in 6-operator FM Web Audio engine, and transmits voices/banks directly to hardware over USB MIDI or standard `.syx` files.
- **Preset & Pattern Librarian**: Bidirectional hardware librarian and 64-step pattern workbench for the M-VAVE FM-1. Pulls and exports all 128 presets (`SysEx 0x10` → 231B BaudGirl v4 `.syx`, 163B DX7 VCED, 4104B VMEM bank, or `.json`), pulls all 16 64-step patterns directly from hardware RAM (`SysEx 0x11` → `.syx`, `.mid`, or `.json`), edits polyphonic patterns interactively, and uploads new patterns (`SysEx 0x20`) from `.syx`, `.mid`, `.json`, or the Pulses sequencer bank.

---

## Shared Architecture

All sequencer models operate within a unified modular workstation environment:

- **64-Step Sequence Grid**: An interactive 16×4 step grid with individual step locking, micro-adjustments, active playhead tracking, and manual gate toggling.
- **Harmonics & Scale Quantizer**: 20 scale presets plus a chromatic custom scale editor, root note selection, scale snap quantization, and directional octave spread.
- **Rhythm & Euclidean Engine**: Algorithmic gate generator featuring classic world rhythm presets (Tresillo, Cinquillo, Clave, Bossa Nova, etc.), variable Euclidean density, grid snap, and rotation.
- **Groove & Dynamics**: Micro-timing humanize jitter, velocity randomization, and a swing engine with hardware-compatible presets (Straight, Light, MPC, Hard, Triplet).
- **Dual Auditioning**: Real-time MIDI transmission alongside a built-in multi-voice Web Audio synthesizer with selectable timbres (Electric Piano, Bell, Bass, Organ, Square).
- **Hardware Integration**: Bidirectional USB MIDI communication, automatic hardware BPM sync, and Bluetooth (BLE) wireless MIDI support.
- **Presets & Storage**: Five quick-recall browser slots per model, plus versioned `.fm1p.json` session export/import.
- **Skeuomorphic Interface**: Eurorack-inspired design with color themes decoded directly from the FM-1 firmware's `BGTHEME` table.

---

## Quick Start

Web MIDI requires a secure origin (`https://` or `localhost`):

```bash
python3 -m http.server 8080
```

1. Open `http://localhost:8080` in Chrome, Edge, or any Web MIDI-enabled browser.
2. Connect the FM-1 via USB and grant MIDI access when prompted.
3. Select an engine from the **Sequencing Models** hub or open **DX Patch Generator** or **Preset & Pattern Librarian** under **Tools**.
4. Tweak parameters or press **Randomise** (or `R` / `G`) to roll a new pattern.
5. Click **▶ Play** (or `Space`) to play live through the browser synth and FM-1.
6. Click **export** to download the session, or use a preset slot to keep it in the browser.

> ### ⚠ Hardware Notes
>
> - **Bluetooth MIDI**: BLE supports wireless live playback. Device reads (tempo sync) require a wired USB connection.

---

## Session files

A session is a JSON envelope that records the *recipe* for the exact browser state, not the generated notes:

```jsonc
{
  "format": "fm1-pulses.session", "formatVersion": 1,
  "model": { "id": "turing", "version": 1 },
  "state": { "params": {…}, "locks": {…}, "selected": 0, "hidden": { "bits": […] } },
  "ui": { "theme": "dark" }, "output": { "sound": "…", "volume": 0.8 }
}
```

- Each sequencer model has its own `version` and an ordered chain of migrations (`js/snapshot.js`). Older files are upgraded on import; files from a **newer** version are refused rather than truncated.
- Unknown parameters are preserved through an import/export round trip.
- Models register hidden state (Turing shift register and gates, Cellular grids, Particle seeds and obstacles) from their own module.
- Files from before this format load as Mene311 v1.
- Run `node --test tests/` for the format tests.

---

## Project Structure

```
├── AGENTS.md           # Engineering guidelines, hardware constraints & contracts
├── index.html          # Main application markup & hub
├── guide.html          # Comprehensive interactive user guide
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for offline use
├── css/
│   ├── style.css       # Core layout & base styling
│   ├── rack.css        # Skeuomorphic Eurorack styling & themes
│   ├── dxpatch.css     # DX Patch Generator modular panel styling
│   └── librarian.css   # Preset & Pattern Librarian workbench styling
├── docs/
│   └── plan.md         # Master roadmap & specs for generative sequencer models
├── js/
│   ├── rack.js         # Master UI coordinator & lifecycle wiring
│   ├── modes.js        # Sequencer model & tools manager, landing view
│   ├── dx7.js          # DX7 domain model, 32 algorithms & SysEx codecs
│   ├── dxgenerator.js  # FM patch generator & mutator algorithms
│   ├── dxaudio.js      # 6-operator FM Web Audio synthesis engine
│   ├── dxpatch.js      # DX Patch Generator UI & interactive matrix
│   ├── va.js           # BaudGirl FM-1+VA domain model & 231B SysEx codec (for Librarian)
│   ├── librarian.js    # Preset & Pattern Librarian UI, hardware sync & editor
│   ├── generator.js    # Mene311 stochastic generation engine
│   ├── turing.js       # Turing Machine shift-register model
│   ├── cellular.js     # Cellular Automata Wolfram rule engine
│   ├── particles.js    # 2D kinetic particle collision engine
│   ├── pendulum.js     # Chaotic Double Pendulum attractor engine
│   ├── flock.js        # Autonomous Flocking Swarm chord engine
│   ├── rungler.js      # Rob Hordijk Rungler / chaotic stepped shift register model
│   ├── krell.js        # Buchla 266 Krell Patch autonomous generative engine
│   ├── rhythm.js       # 64-step grid & Euclidean rhythm generator
│   ├── scale.js        # Scale quantizer & pitch controls
│   ├── humanise.js     # Micro-timing jitter & swing engine
│   ├── velocity.js     # Velocity dynamics & range controls
│   ├── pattern.js      # FM-1 SysEx 0x20 / RAM 0x11 / .mid pattern codecs (used by the Librarian)
│   ├── device.js       # Device status & tempo sync
│   ├── snapshot.js     # Versioned session format, model registry & migrations
│   ├── midi.js         # Web MIDI & Web Bluetooth BLE interface
│   ├── audio.js        # Internal Web Audio audition synthesizer
│   └── storage.js      # Session export/import & per-model preset slots
├── tests/              # node --test (snapshot format & migrations)
└── presets/
    └── scales.json     # Scale interval definitions
```

---

## Documentation

For a full breakdown of every parameter, knob behavior, and shortcut, consult the in-app **[User Guide](guide.html)** (`guide.html`) or access it directly via the top navigation bar.
