---
trigger: always_on
---

# Web UI & Styling Rules

All web tools and interfaces in this repository must follow a unified, hardware-inspired workbench aesthetic.

## 1. Interactivity Over Labelling
- **Direct Manipulation First**: Prefer interactive controls (draggable canvases, scrubbable values, clickable topology nodes, toggleable pills/cells) over static readouts or separate form fields.
- **Self-Describing Controls**: Let the control's state communicate its function (e.g., an active toggle button reading `ON`/`OFF` or `MUTE`, or a dropdown whose selected option is self-evident) rather than pairing every control with a text label.
- **Minimal Text Clutter**:
  - Do not add explanatory paragraphs, sub-headers, or helper text inside panels.
  - Use concise 1–3 character abbreviations (`R1`–`R4`, `L1`–`L4`, `ALG`, `FB`, `VEL`) in dense parameter grids.
  - Put secondary explanations, full parameter names, and keyboard shortcuts in native `title` tooltips or the single-line footer status bar.
- **Interactive Visualizers**: Canvases and SVGs (e.g., envelopes, algorithms, waveforms) should respond to hover/click/drag wherever possible rather than acting as passive diagrams.

## 2. Strictly Flat Surfaces (No Gradients)
- **Zero CSS Gradients**: Never use `linear-gradient()`, `radial-gradient()`, or `conic-gradient()` in CSS backgrounds, buttons, badges, or keys.
- **Zero Canvas/SVG Gradients**: Never use `createLinearGradient()` or `createRadialGradient()` in `<canvas>` or SVG rendering. Use solid fills (`fillStyle`) or semi-transparent solid overlays (`rgba(...)` matching the token palette).
- **Depth via Borders & Contrast**: Establish hierarchy strictly through flat background steps (`--bg` → `--panel` → `--panel2`) and crisp `1px solid` borders (`--line` / `--line-focus`).

## 3. Strict Colour Consistency & Semantic Tokens
- **Shared Token Sheet Only**: All tools and sequencers must use the shared `:root` design tokens from `style.css` and `rack.css`. Never invent arbitrary token names or hardcode non-semantic hex colors in component CSS rules.
- **Canvas Colour Resolution**: JavaScript `<canvas>` renderers must dynamically read colors from the DOM using `getComputedStyle(document.documentElement)` (e.g., `--panel2`, `--fg`, `--dim`, `--line`, `--accent`) rather than hardcoding static hex strings.
- **Core Theme Tokens (`css/style.css`)**:
  - **Surfaces**:
    - `--bg`: Outer case & page backdrop (Dark `#111215`, Light `#f3f4f6`)
    - `--panel`: Primary cards, module enclosures, inputs, bank cells (Dark `#18191f`, Light `#ffffff`)
    - `--panel2`: Secondary nested cards, module headers, step cell base (Dark `#22252e`, Light `#e5e7eb`)
  - **Borders & Dividers**:
    - `--line`: Structural borders, step cell outlines, grid dividers (Dark `#333846`, Light `#d1d5db`)
    - `--line-focus`: Active borders, stepper edges, secondary focus rings (Dark `#4b5264`, Light `#9ca3af`)
  - **Typography & High-Contrast**:
    - `--fg`: Main text, active playhead indicators, high-contrast values (Dark `#f3f4f6`, Light `#111827`)
    - `--dim`: Secondary text, step numbers, inactive hints (Dark `#9ca3af`, Light `#4b5563`)
  - **Primary Accents**:
    - `--accent`: Active gate/note steps, primary buttons, scope contour (Dark `#3b82f6` Blue, Light `#2563eb`)
    - `--accent2`: Lock highlights, secondary focus, DAC contour (Dark `#60a5fa`, Light `#1d4ed8`)
  - **Status Indicators**:
    - `--ok`: Connected MIDI state, valid states (Dark `#22c55e` Green, Light `#16a34a`)
    - `--err`: Transport stop/playing, disconnected state, errors (Dark `#ef4444` Red, Light `#dc2626`)

## 4. Sequencer State & Model Colour Mapping
- **Step Grid & Pattern States**:
  - **Active Step / Bit 1 (`.cell.on`, `.is-one`)**: `background: var(--accent)` with `#ffffff` text (opacity modulated by `--vel-alpha` for note velocity).
  - **Inactive Step / Bit 0 (`.cell.off`, `.is-zero`)**: `var(--panel2)` or `var(--panel)` with `var(--line)` border and `opacity: .45` / `var(--dim)`.
  - **Playhead Position (`.now`)**: `outline: 2px solid var(--fg)` (high-contrast white/dark ring indicator).
  - **Locked Step (`.locked`)**: `border: 1px dashed var(--fg)` or `border-color: var(--accent2)`.
  - **Step Under Edit (`.edit`)**: `outline: 2px solid var(--accent)`.
  - **Loop Region Backdrop**: `color-mix(in srgb, var(--accent) 35%, transparent)` (loop start anchor: `60%`).
  - **Turing DAC Window (`.in-dac`)**: `box-shadow: inset 0 0 0 2px var(--accent2, #f59e0b)`.
- **Multi-Head Particle Sequencer Palette (`js/particles.js`)**:
  - Heads 1–8: `#00f0ff` (Cyan), `#ff007f` (Pink), `#ffb700` (Amber), `#39ff14` (Lime), `#a855f7` (Violet), `#38bdf8` (Sky), `#f43f5e` (Rose), `#eab308` (Gold).
  - Collision triggers & deflection sparks: `#ffffff` / `#ff007f`.
- **FM Synthesis & Operator Roles (DX Patch Tool)**:
  - **Carriers**: Green `#22c55e` / `#86efac` (`rgba(34, 197, 94, 0.2)` fill, crisp green border & envelope curve).
  - **Modulators**: Amber `#f59e0b` / `#fde68a` (`rgba(245, 158, 11, 0.2)` fill, crisp amber border & envelope curve).
  - **Feedback Loops**: Purple `#a855f7` / `#d8b4fe` (`rgba(168, 85, 247, 0.2)` fill, feedback loop paths).
- **FM-1 Firmware Color Themes (`BGTHEME` table)**:
  - The 7 hardware themes: Purple (`#ff5da4`), Black (`#f6f2f6`), Grey (`#f6e6d5`), Orange (`#ff7939`), Green (`#6ae2cd`), Blue (`#8bb2e6`), Brown (`#e69962`).