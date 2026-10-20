# FM-1 Pulses

Browser-based generative MIDI workstation for the **M-VAVE FM-1** (6-operator FM synthesizer). Built with vanilla JavaScript, Web MIDI, Web Audio, and PWA standards. Zero dependencies, no build steps, and no server required.

**▶ Live App:** https://mene311.github.io/fm1-pulses/

---

## Overview

FM-1 Pulses generates evolving 64-step musical phrases and freezes them directly into the hardware sequencer memory of the M-VAVE FM-1 via MIDI SysEx. Once frozen, the FM-1 plays standalone without a computer. The workstation also functions as a live generative MIDI performance broadcaster, complete with a built-in browser FM synthesizer for cable-free auditioning.

### Sequencer Models

FM-1 Pulses includes four distinct algorithmic sequencing engines accessible from the model selection hub:

- **Mene311 (Stochastic)**: An analog-inspired generative signal chain combining Sample & Hold, continuous LFO waveshaping, Gaussian distribution weighting, scale quantization, and a looping Deja-Vu buffer.
- **Turing Machine**: A shift-register melody generator inspired by the Music Thing Modular Turing Machine. Circulating bit registers mutate probabilistically, moving between locked repetitive loops and gradual melodic drift.
- **Cellular Automata**: An emergent step generator powered by one-dimensional elementary cellular automata (Wolfram Rules 30, 90, 110, and 150), producing organic, evolving fractal patterns across generations.
- **Particles**: A 2D kinetic collision engine inspired by Orca and Plinky. Autonomous directional playheads traverse an interactive surface, rebounding off boundaries and deflector nodes to trigger musical notes on collisions.

---

## Shared Architecture

All sequencer models operate within a unified modular workstation environment:

- **64-Step Sequence Grid**: An interactive 16×4 step grid with individual step locking, micro-adjustments, active playhead tracking, and manual gate toggling.
- **Harmonics & Scale Quantizer**: 20 scale presets plus a chromatic custom scale editor, root note selection, scale snap quantization, and directional octave spread.
- **Rhythm & Euclidean Engine**: Algorithmic gate generator featuring classic world rhythm presets (Tresillo, Cinquillo, Clave, Bossa Nova, etc.), variable Euclidean density, grid snap, and rotation.
- **Groove & Dynamics**: Micro-timing humanize jitter, velocity randomization, and a swing engine with hardware-compatible presets (Straight, Light, MPC, Hard, Triplet).
- **Dual Auditioning**: Real-time MIDI transmission alongside a built-in multi-voice Web Audio synthesizer with selectable timbres (Electric Piano, Bell, Bass, Organ, Square).
- **Hardware Integration**: Bidirectional USB MIDI communication, automatic hardware BPM sync, and Bluetooth (BLE) wireless MIDI support.
- **Presets & Storage**: Five quick-recall browser storage slots, reproducible JSON state export/import, and raw `.syx` SysEx file export.
- **Skeuomorphic Interface**: Eurorack-inspired design with color themes decoded directly from the FM-1 firmware's `BGTHEME` table.

---

## Quick Start

Web MIDI requires a secure origin (`https://` or `localhost`):

```bash
python3 -m http.server 8080
```

1. Open `http://localhost:8080` in Chrome, Edge, or any Web MIDI-enabled browser.
2. Connect the FM-1 via USB and grant MIDI access when prompted.
3. Select an engine from the **Sequencing Models** hub.
4. Tweak parameters or press **Randomise** (or `R` / `G`) to roll a new pattern.
5. Click **▶ Play** (or `Space`) to audition live through the browser synth and FM-1.
6. Click **Freeze** (or `F`) to write the active 64-step pattern into the FM-1's sequencer.

> ### ⚠ Firmware & Hardware Caveats
>
> - **Firmware Requirement**: Pattern write (`SysEx 0x20`) is implemented in the **FM-1+VA / Baud Girl** custom firmware. Stock firmware does not support pattern writes over SysEx, but functions with live MIDI auditioning.
> - **Sequencer Must Be Stopped**: The FM-1 refuses SysEx writes while its internal sequencer is actively running. Turn **SEQ off** on the device before freezing.
> - **Bluetooth MIDI**: BLE supports wireless live performance playback. Device reads and pattern freezing require a wired USB connection.

---

## Project Structure

```
├── index.html          # Main application markup & model hub
├── guide.html          # Comprehensive interactive user guide
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for offline use
├── css/
│   ├── style.css       # Core layout & base styling
│   └── rack.css        # Skeuomorphic Eurorack styling & themes
├── js/
│   ├── rack.js         # Master UI coordinator & lifecycle wiring
│   ├── modes.js        # Sequencer model manager & landing view
│   ├── generator.js    # Mene311 stochastic generation engine
│   ├── turing.js       # Turing Machine shift-register model
│   ├── cellular.js     # Cellular Automata Wolfram rule engine
│   ├── particles.js    # 2D kinetic particle collision engine
│   ├── rhythm.js       # 64-step grid & Euclidean rhythm generator
│   ├── scale.js        # Scale quantizer & pitch controls
│   ├── humanise.js     # Micro-timing jitter & swing engine
│   ├── velocity.js     # Velocity dynamics & range controls
│   ├── pattern.js      # FM-1 SysEx 0x20 pattern encoder/decoder
│   ├── device.js       # Hardware communication & tempo sync
│   ├── midi.js         # Web MIDI & Web Bluetooth BLE interface
│   ├── audio.js        # Internal Web Audio audition synthesizer
│   └── storage.js      # Preset slots, JSON & SysEx file export
└── presets/
    └── scales.json     # Scale interval definitions
```

---

## Documentation

For a full breakdown of every parameter, knob behavior, and shortcut, consult the in-app **[User Guide](guide.html)** (`guide.html`) or access it directly via the top navigation bar.
