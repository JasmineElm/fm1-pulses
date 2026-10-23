# Agent Directives: FM-1 Pulses

## 1. Git & Workflow
- **Model Branches**: Always create and checkout a new branch for each new sequencer model (`feat/<model-id>`).
- **No Browser Snapshots**: Retaining browser session recordings or screenshots is not required. Do not invoke headless browser subagents (user validates live at `http://localhost:8080`).
- **Documentation Lifecycle**: Upon completing a model, mark it complete in `docs/plan.md`.

## 2. DRY & Core Primitive Reuse
Always reuse existing engine primitives before inventing new helpers:
- **Pitch & Quantization**: Use `getRootMidi()`, `getActiveScaleIntervals()`, and `quantize()` from `js/scale.js`.
- **Audio Dispatch**: Route note triggers through `liveNoteOn()`, `liveNoteOff()`, and CC via `midi.sendControlChange()` in `js/player.js`.
- **Lifecycle & Navigation**: Wire into `js/modes.js` (`showModel`, `onEnterModel`, `onExitModel`), `js/state.js`, and `js/rack.js`.
- **Zero Runtime Dependencies**: Plain ES modules only (`import`/`export`). No npm runtime packages or build steps.

## 3. Hardware Constraints & Performance
- **8-Voice Polyphony Ceiling**: M-VAVE FM-1 hardware is strictly limited to 8 voices. All generative engines must maintain a voice allocation map / FIFO ring buffer to steal or terminate the oldest note (`liveNoteOff`) when voice count exceeds 8.
- **Zero GC Churn**: Pre-allocate simulation buffers using TypedArrays (`Float32Array`, `Uint8Array`, `Int16Array`). Avoid object instantiation in animation or step loops.

## 4. State, Serialization & Generator Contracts
- **Import/Export Mandatory**: Every model must register with `js/snapshot.js` via `registerModel({ id, version, capture, restore })` and register its storage key in `PREFIX`.
- **Initial Parameter Capture**: For non-grid / continuous models, snapshots must serialize initial parameters, seeds, and control vectors so state can be deterministically restored.
- **Generator Function Contract**: `generate<Model>Bank(state)` must **always return a valid bank array** (`[{ length: seqLen, steps: [...], rate }]`). Never return `undefined` (prevents crashing `syncRhythmGrid()` in `js/rhythm.js`).
- **Global Length & Gate Adherence**: In SYNC mode, sequences must strictly obey `state.length` (`p.length = seqLen`) and respect gate mute states from the Rhythm grid.

## 5. UI & Styling Rules
- **Flat Workbench Aesthetic**: Strict zero-gradient rule. Never use `linear-gradient` in CSS or `createLinearGradient` in `<canvas>`/SVG.
- **Dynamic Semantic Tokens**: Resolve canvas colors dynamically via `getComputedStyle(document.documentElement)` (`--panel`, `--panel2`, `--line`, `--accent`, `--ok`, `--err`).
- **Direct Manipulation**: Prefer scrubbable, draggable, toggleable elements over dense text or static numeric inputs. Keep labels to concise 1–3 character abbreviations.
