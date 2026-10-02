# FM-1 Pulses

Browser-based generative MIDI sequencer for the **M-VAVE FM-1** (6-op FM synth).
Vanilla JS + Web MIDI API + PWA. No server, no build step, no dependencies.

**Signal chain:** Clock → Gate Probability → S&H → LFO → Distribution → Quantizer → MIDI out → Buffer (Deja Vu feedback).

## Quick start

```bash
# Web MIDI requires a secure context — file:// will NOT work
python3 -m http.server 8080
# then open http://localhost:8080
```

1. Connect the FM-1 via USB (recommended; BLE works but has more latency).
2. Allow the MIDI permission prompt in Chrome.
3. Select **FM-1** from the device dropdown.
4. Press **▶** or the Spacebar.

## Docs

- `DESIGN.md` — full design: modules, signal chain, defaults, UI layout.
- `GOTCHAS.md` — known pitfalls (MIDI timing, BLE latency, tab throttling) and mitigations.

## Scale presets

`presets/scales.json` holds the 20 scale presets. Schema:

```json
{ "id": "dorian", "name": "Dorian", "intervals": [0, 2, 3, 5, 7, 9, 10] }
```

`intervals` are semitone offsets from the root note (C = 0). The `custom` entry has
empty `intervals` — the user fills it via the chromatic toggle grid (persisted to localStorage).

## Structure

```
index.html, manifest.json, sw.js, css/style.css
js/{app,clock,gate,lfo,distribution,quantizer,buffer,midi,state,ui}.js
presets/scales.json
```

## Status

Scaffold + design docs only. No implementation yet — see `DESIGN.md` for the plan.
