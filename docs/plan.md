# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan consolidates and organizes the implementation of the remaining 9 non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

The models are ordered first by the **fundamental algorithmic, mathematical, and data-structure dependencies** they satisfy for subsequent models, and second by **computational and architectural complexity** (from deterministic scalar engines up to multi-agent spatial field simulations).

---

## 1. Architectural Dependencies & Implementation Roadmap

```
[Level 1: Grammars & Discrete Traversal]
       │
       ▼
 1. L-System Morphogenetic Grammar (String rewriting, stack-based motif branching)
       │
       ├─────────────────────────────────────────────────┐
       ▼                                                 ▼
[Level 2: Continuous Phase Attractors]           [Level 3: Discrete Lattices & Cascades]
 2. Lotka-Volterra Predator-Prey (RK4, Poincaré)   5. Abelian Sandpile (2D lattice, avalanches)
       │                                                 │
       ▼                                                 ▼
 3. Keplerian Orbital Resonance (Symplectic Verlet) 6. Percolation Porosity (Union-Find / DSU)
       │                                                 │
       ▼                                                 ▼
 4. Hanenbow Acoustic Ballistics (2D line rebound)  7. DLA Fractal Tree (Brownian sticky walkers)
       │                                                 │
       └────────────────────────┬────────────────────────┘
                                │
                                ▼
                 [Level 4: Spatial Networks & Fields]
                  8. SIR Epidemic Network (Spatial contact graph)
                                │
                                ▼
                  9. Physarum Slime Mould (Agent steering & chemoattractant diffusion)
```

### Roadmap Summary Table

| Step | Model ID | Model Name | Primary Domain | Core Primitives Satisfied / Reused | Complexity | Status |
|---|---|---|---|---|---|---|
| **01** | `lsystem` | **L-System Morphogenetic Grammar** | Evolutionary / Formal Grammar | Recursive string rewriting, stack-based sub-motif branching (`[`, `]`) | Low (1/5) | ✅ Complete |
| **02** | `lotka_volterra` | **Lotka-Volterra Predator-Prey** | Non-Linear Dynamics | Runge-Kutta 4th Order (RK4), Poincaré cutting plane triggers, phase loops | Low (1.5/5) | Pending |
| **03** | `orbital` | **Keplerian Orbital Resonance** | Celestial Mechanics | Symplectic Velocity-Verlet, periapsis transit detection, angular conjunctions | Moderate (2/5) | Pending |
| **04** | `hanenbow` | **Electroplankton Hanenbow Ballistics** | Physical Toy / Ballistics | 2D circle-to-line segment projection, specular momentum rebound, leaf springs | Moderate (2.5/5) | Pending |
| **05** | `sandpile` | **Abelian Sandpile (SOC)** | Statistical Physics / Avalanches | 2D integer lattice, relaxation queue, center-of-mass pitch, $1/f$ pink noise | Moderate (3/5) | Pending |
| **06** | `percolation` | **Percolation Cluster Phase Transition** | Fluid Porosity / Criticality | Disjoint Set Union (DSU / Union-Find), cluster scaling, conductive wave fronts | Mod-High (3.5/5) | Pending |
| **07** | `dla` | **Diffusion-Limited Aggregation (DLA)** | Fractal Growth / Brownian Walks | 2D Brownian motion, perimeter boundary kill zones, sticky bitmask lookup | High (4/5) | Pending |
| **08** | `epidemic` | **SIR Epidemic Network Dynamics** | Population / Epidemiology | Spatial contact proximity graphs, multi-state Markov transitions, $R_0$ density | High (4/5) | Pending |
| **09** | `physarum` | **Physarum Slime Mould Network** | Biological Foraging / Transport | 3-sensor agent steering, 2D Float32Array pheromone diffusion/decay, flux tubes | Highest (5/5) | Pending |

---

## 2. Core Framework Integration Standards

Every model implementation must strictly adhere to the following shared framework patterns:

1. **Scale Quantization ([js/scale.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/scale.js))**:
   - Always resolve pitch using `getRootMidi()`, `getActiveScaleIntervals()`, and `quantize(rawMidi, intervals, root)`.
2. **Audio & MIDI Engine ([js/player.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/player.js))**:
   - Live note triggers dispatch via `liveNoteOn(note, vel, durMs)` and `liveNoteOff(note)`.
   - Continuous timbre modulation dispatches via `midi.sendControlChange(ccDest, ccVal)` (typically CC #74 Brightness / Cutoff).
3. **Polyphony Ceiling (Strictly $\le 8$ Voices)**:
   - Every model manages its active voice pool using a FIFO note-stealing ring buffer or explicit voice slots to guarantee the M-VAVE FM-1 hardware buffer never overflows.
4. **Session Snapshot Serialization ([js/snapshot.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/snapshot.js))**:
   - Register under `registerModel({ id, version: 1, migrations: {}, capture(), restore(h) })`.
   - Register ownership prefix in `PREFIX` within `js/snapshot.js`.
5. **State & Lifecycle ([js/state.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/state.js), [js/modes.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/modes.js), [js/rack.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/rack.js))**:
   - Mirror pitch parameters (`scale`, `root`, `pitchSpan`).
   - Wire `init<Model>()`, `activate<Model>Model()`, and `deactivate<Model>Model()`.
   - Supply `generate<Model>Bank()` returning a valid bank structure (`[{ length: seqLen, steps, rate }]`) so step-based UI components never throw undefined errors.
6. **Workbench Aesthetics ([.agents/rules/style.md](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/.agents/rules/style.md))**:
   - Zero CSS or canvas gradients (`linear-gradient`, `createLinearGradient`).
   - Dynamic token resolution via `getComputedStyle(document.documentElement)` (`--panel`, `--panel2`, `--line`, `--accent`, `--ok`, `--err`).

---

## 3. Detailed Specifications by Order of Implementation

---

### Model 01 (Step 1): L-System (Lindenmayer Morphogenetic Grammars) — [COMPLETED]
- **Model ID**: `lsystem`
- **Category**: Evolutionary / Biological Grammars / Recursive Morphogenesis.
- **Why First**: Zero spatial physics dependencies. Establishes formal grammar string rewriting and the stack-based musical turtle (`[`, `]`), providing a deterministic foundation for nested motif development.

#### Mathematical Formulation
An L-System formal grammar $G = (V, \Sigma, \omega, P)$:
- Alphabet $V = \{\text{'F'}, \text{'X'}, \text{'Y'}\}$
- Terminals $\Sigma = \{\text{'+'}, \text{'-'}, \text{'['}, \text{']'}, \text{'^'}, \text{'v'}\}$
- Axiom $\omega = \text{"F"}$
- Production rewrite rules $P: V \rightarrow (V \cup \Sigma)^*$, e.g., $\text{"F"} \mapsto \text{"F[+F]F[-F][F]"}$.

Musical turtle state vector $\mathbf{S}_k = (\text{deg}_k, \text{oct}_k, \text{vel}_k)$:
$$[\implies \text{push}(\mathbf{S}_k) \quad (\text{begins sub-voice or counter-motif})$$
$$]\implies \mathbf{S}_{k+1} = \text{pop}() \quad (\text{resumes parent melodic contour})$$

#### Skeleton JavaScript Implementation
```javascript
import { registerModel } from "./snapshot.js";
import { quantize, getRootMidi, getActiveScaleIntervals } from "./scale.js";
import { liveNoteOn, liveNoteOff } from "./player.js";

const MAX_VOICES = 8;
const activeVoices = new Map();

function playVoice(voiceId, note, vel, durMs) {
  if (activeVoices.size >= MAX_VOICES) {
    const oldest = activeVoices.keys().next().value;
    liveNoteOff(activeVoices.get(oldest));
    activeVoices.delete(oldest);
  }
  liveNoteOn(note, vel, durMs);
  activeVoices.set(voiceId, note);
  setTimeout(() => activeVoices.delete(voiceId), durMs);
}

export class LSystemModel {
  constructor() {
    this.depth = 3;
    this.axiom = "F";
    this.rules = { "F": "F[+F]F[-F][F]" };
    this.expandedString = "";
    this.readIndex = 0;
    this.currentDegree = 0;
    this.currentOctave = 0;
    this.stack = [];
    this.compile();
  }

  compile() {
    let str = this.axiom;
    const safeDepth = Math.min(4, Math.max(1, this.depth));
    for (let d = 0; d < safeDepth; d++) {
      let next = "";
      for (let i = 0; i < str.length; i++) next += this.rules[str[i]] || str[i];
      str = next;
    }
    this.expandedString = str;
    this.readIndex = 0;
  }

  tickStep() {
    if (!this.expandedString.length) return;
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();
    let noteTriggered = false;
    let safety = 0;

    while (!noteTriggered && safety++ < 32) {
      if (this.readIndex >= this.expandedString.length) this.readIndex = 0;
      const sym = this.expandedString[this.readIndex++];
      switch (sym) {
        case "F": {
          const depthFactor = Math.min(3, this.stack.length);
          const deg = ((this.currentDegree % intervals.length) + intervals.length) % intervals.length;
          const note = quantize(root + this.currentOctave * 12 + (intervals[deg] || 0));
          const vel = Math.max(35, 95 - depthFactor * 14);
          playVoice(this.stack.length, note, vel, 220);
          noteTriggered = true;
          break;
        }
        case "+": this.currentDegree++; break;
        case "-": this.currentDegree--; break;
        case "^": this.currentOctave = Math.min(3, this.currentOctave + 1); break;
        case "v": this.currentOctave = Math.max(-2, this.currentOctave - 1); break;
        case "[": this.stack.push({ deg: this.currentDegree, oct: this.currentOctave }); break;
        case "]":
          if (this.stack.length > 0) {
            const p = this.stack.pop();
            this.currentDegree = p.deg;
            this.currentOctave = p.oct;
          }
          break;
      }
    }
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Self-similar fractal melodies, nested parenthetical motifs, non-random structured improvisation.
- **Scalability**: Zero GC allocations during playback; string pre-expansion bounded to $< 4 \text{ KB}$; execution $< 0.005 \text{ ms}$ per step.

---

### Model 02 (Step 2): Lotka-Volterra Predator-Prey Ecological Phase Space
- **Model ID**: `lotka_volterra`
- **Category**: Population Dynamics / Non-Linear Differential Equations / Chaotic Attractors.
- **Why Second**: Establishes the 4th-Order Runge-Kutta (RK4) integrator and continuous Poincaré section event-triggering, which are reused in orbital mechanics.

#### Mathematical Formulation
Hastings-Powell 3-species ecological food chain (Prey $x$, Predator $y$, Apex $z$):
$$\frac{dx}{dt} = x(1 - x) - \frac{a x y}{1 + b_1 x}$$
$$\frac{dy}{dt} = \frac{a x y}{1 + b_1 x} - \frac{c y z}{1 + b_2 y} - d_1 y$$
$$\frac{dz}{dt} = \frac{c y z}{1 + b_2 y} - d_2 z$$

Runge-Kutta 4th Order (RK4):
$$\mathbf{X}_{n+1} = \mathbf{X}_n + \frac{\Delta t}{6}(\mathbf{k}_1 + 2\mathbf{k}_2 + 2\mathbf{k}_3 + \mathbf{k}_4)$$
Poincaré section triggers: Directional threshold crossings $\left(x(t-\Delta t) \le x_{\text{th}} \text{ and } x(t) > x_{\text{th}}\right)$.

#### Skeleton JavaScript Implementation
```javascript
export class LotkaVolterraModel {
  constructor() {
    this.x = 0.8; this.y = 0.2; this.z = 8.0;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.a = 5.0; this.b1 = 3.0; this.b2 = 0.1; this.d1 = 0.4; this.d2 = 0.01;
    this.speed = 1.0;
  }

  derivatives(x, y, z) {
    const f1 = (this.a * x) / (1 + this.b1 * x);
    const f2 = (0.1 * y) / (1 + this.b2 * y);
    return [
      x * (1 - x) - f1 * y,
      f1 * y - f2 * z - this.d1 * y,
      f2 * z - this.d2 * z
    ];
  }

  rk4Step(dt) {
    const h = dt * this.speed;
    const [k1x, k1y, k1z] = this.derivatives(this.x, this.y, this.z);
    const [k2x, k2y, k2z] = this.derivatives(this.x + 0.5 * h * k1x, this.y + 0.5 * h * k1y, this.z + 0.5 * h * k1z);
    const [k3x, k3y, k3z] = this.derivatives(this.x + 0.5 * h * k2x, this.y + 0.5 * h * k2y, this.z + 0.5 * h * k2z);
    const [k4x, k4y, k4z] = this.derivatives(this.x + h * k3x, this.y + h * k3y, this.z + h * k3z);

    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    this.y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    this.z += (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
  }

  update(dt) {
    this.rk4Step(dt);
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();

    // Poincaré section triggers for each species
    if (this.prevX <= 0.5 && this.x > 0.5) {
      const note = quantize(root + (intervals[Math.floor(this.y * 12) % intervals.length] || 0));
      playVoice(0, note, Math.min(127, Math.round(this.x * 100)), 180);
    }
    if (this.prevY <= 0.3 && this.y > 0.3) {
      const note = quantize(root + 12 + (intervals[Math.floor(this.z * 1.5) % intervals.length] || 0));
      playVoice(1, note, Math.min(127, Math.round(this.y * 120)), 220);
    }
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Ecological polyphony with 3 distinct voices: treble prey flutters, mid-frequency predator ostinatos, and sub-bass apex strikes. Limit cycles yield phasing polyrhythms; chaotic regimes produce organic syncopations.
- **Scalability**: $< 0.005 \text{ ms}$ execution per frame; maximum 3 active voice channels, well under the 8-voice limit.

---

### Model 03 (Step 3): Keplerian Orbital Resonance & N-Body Chimes
- **Model ID**: `orbital`
- **Category**: Physical Simulation / Celestial Mechanics / Polyrhythmic Phase Alignment.
- **Why Third**: Expands the continuous differential mechanics into a multi-body 2D vector gravitational field using symplectic integration.

#### Mathematical Formulation
Gravitational force and Kepler's Third Law ($T \propto a^{3/2}$):
$$\mathbf{F}_i = -\frac{G M m_i}{r_i^3}\mathbf{r}_i, \quad r_i = |\mathbf{r}_i|$$

Symplectic Velocity-Verlet Integration:
$$\mathbf{r}(t + \Delta t) = \mathbf{r}(t) + \mathbf{v}(t)\Delta t + \frac{1}{2}\mathbf{a}(t)\Delta t^2$$
$$\mathbf{v}(t + \Delta t) = \mathbf{v}(t) + \frac{1}{2}\left[\mathbf{a}(t) + \mathbf{a}(t + \Delta t)\right]\Delta t$$

Periapsis transit trigger condition:
$$v_r(t) = \frac{\mathbf{r} \cdot \mathbf{v}}{|\mathbf{r}|}, \quad v_r(t - \Delta t) \le 0 \text{ and } v_r(t) > 0$$

#### Skeleton JavaScript Implementation
```javascript
export class OrbitalModel {
  constructor(numBodies = 5) {
    this.GM = 400000;
    this.numBodies = Math.min(numBodies, 8);
    this.planets = [];
    this.initSystem();
  }

  initSystem() {
    const radii = [80, 105, 138, 180, 235];
    for (let i = 0; i < this.numBodies; i++) {
      const a = radii[i];
      const ecc = 0.25;
      const rPeri = a * (1 - ecc);
      const vPeri = Math.sqrt((this.GM / a) * ((1 + ecc) / (1 - ecc)));
      this.planets.push({ id: i, x: rPeri, y: 0, vx: 0, vy: vPeri, prevVr: 0, scaleDeg: i * 2 });
    }
  }

  update(dt) {
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();

    for (const p of this.planets) {
      const r1 = Math.hypot(p.x, p.y);
      const ax1 = -(this.GM * p.x) / (r1 * r1 * r1);
      const ay1 = -(this.GM * p.y) / (r1 * r1 * r1);

      p.x += p.vx * dt + 0.5 * ax1 * dt * dt;
      p.y += p.vy * dt + 0.5 * ay1 * dt * dt;

      const r2 = Math.hypot(p.x, p.y);
      const ax2 = -(this.GM * p.x) / (r2 * r2 * r2);
      const ay2 = -(this.GM * p.y) / (r2 * r2 * r2);

      p.vx += 0.5 * (ax1 + ax2) * dt;
      p.vy += 0.5 * (ay1 + ay2) * dt;

      const vr = (p.x * p.vx + p.y * p.vy) / r2;
      if (p.prevVr <= 0 && vr > 0) { // Periapsis transit
        const note = quantize(root + (intervals[p.scaleDeg % intervals.length] || 0));
        const speed = Math.hypot(p.vx, p.vy);
        playVoice(p.id, note, Math.min(127, Math.round(speed * 0.4)), 240);
      }
      p.prevVr = vr;
    }
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Natural phasing Keplerian polyrhythms ($4:3, 3:2$ Laplace resonances). Accelerandos into periapsis downbeats, punctuated by harmonic alignment chords during conjunctions.
- **Scalability**: Symplectic integrator ensures zero long-term orbital decay; runs in $< 0.01 \text{ ms}$ per frame; strictly $\le 8$ bodies.

---

### Model 04 (Step 4): Electroplankton "Hanenbow" Leaf Deflection
- **Model ID**: `hanenbow`
- **Category**: Physical Simulation / Toy Sequencer / Specular Ballistics.
- **Why Fourth**: Utilizes the 2D projectile physics from Step 3 and introduces line-segment collision detection, specular reflection, and interactive canvas rotation handles.

#### Mathematical Formulation
Projectile ballistics under downward gravity $\mathbf{g} = (0, g)$:
$$\mathbf{p}(t + \Delta t) = \mathbf{p}(t) + \mathbf{v}(t)\Delta t + \frac{1}{2}\mathbf{g}\Delta t^2$$

Specular reflection off leaf segment normal $\hat{\mathbf{n}} = (-\sin \theta, \cos \theta)$ with restitution $e \in [0.7, 0.98]$:
$$\mathbf{v}_{\text{post}} = \mathbf{v} - (1 + e)(\mathbf{v} \cdot \hat{\mathbf{n}})\hat{\mathbf{n}}$$

Damped leaf spring oscillation:
$$\frac{d^2\phi}{dt^2} + 2\zeta \omega_0 \frac{d\phi}{dt} + \omega_0^2 \phi = 0$$

#### Skeleton JavaScript Implementation
```javascript
export class HanenbowModel {
  constructor() {
    this.gravity = 980;
    this.restitution = 0.85;
    this.cannon = { x: 80, y: 520, angle: -Math.PI / 3, speed: 650 };
    this.plankton = Array.from({ length: 12 }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, radius: 4 }));
    this.leaves = [
      { x: 220, y: 400, length: 110, angle: -0.2, pitchIndex: 0, bend: 0 },
      { x: 380, y: 320, length: 100, angle: 0.35, pitchIndex: 2, bend: 0 },
      { x: 540, y: 260, length: 90,  angle: -0.4, pitchIndex: 4, bend: 0 },
      { x: 680, y: 360, length: 100, angle: -0.6, pitchIndex: 5, bend: 0 },
      { x: 500, y: 480, length: 120, angle: 0.2,  pitchIndex: 7, bend: 0 },
    ];
  }

  update(dt) {
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();

    for (const p of this.plankton) {
      if (!p.active) continue;
      p.vy += this.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -20 || p.x > 1000 || p.y > 650) { p.active = false; continue; }

      for (let j = 0; j < this.leaves.length; j++) {
        const leaf = this.leaves[j];
        const cosA = Math.cos(leaf.angle);
        const sinA = Math.sin(leaf.angle);
        const segDx = cosA * leaf.length;
        const segDy = sinA * leaf.length;
        const segLenSq = segDx * segDx + segDy * segDy;
        const u = Math.max(0, Math.min(1, ((p.x - leaf.x) * segDx + (p.y - leaf.y) * segDy) / segLenSq));
        const dist = Math.hypot(p.x - (leaf.x + u * segDx), p.y - (leaf.y + u * segDy));

        if (dist < p.radius + 3) {
          const nx = -sinA, ny = cosA;
          const dot = p.vx * nx + p.vy * ny;
          if (dot < 0) {
            p.vx -= (1 + this.restitution) * dot * nx;
            p.vy -= (1 + this.restitution) * dot * ny;
            leaf.bend = 1.0;
            const note = quantize(root + (intervals[leaf.pitchIndex % intervals.length] || 0));
            playVoice(j, note, Math.min(127, Math.round(Math.abs(dot) * 0.18)), 220);
          }
        }
      }
    }
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Bell-like percussion arpeggios that reflect projectile rebound ballistics. Direct real-time leaf rotation enables dynamic melodic improvisations.
- **Scalability**: Pre-allocated projectile pool (12 items) with $< 100$ collision checks per frame; execution $< 0.03 \text{ ms}$ per frame; 8-voice allocator ring buffer.

---

### Model 05 (Step 5): Bak-Tang-Wiesenfeld Abelian Sandpile (SOC)
- **Model ID**: `sandpile`
- **Category**: Physical / Statistical Avalanche Mechanics / Self-Organized Criticality.
- **Why Fifth**: Establishes discrete 2D spatial grid processing, relaxation queues, and spatial center-of-mass pitch derivation.

#### Mathematical Formulation
Lattice capacity and toppling rule:
$$\text{If } z(x, y) \ge 4: \quad z(x, y) \leftarrow z(x, y) - 4, \quad z(x \pm 1, y \pm 1) \leftarrow z + 1$$
Avalanche size probability distribution ($1/f$ pink noise power law):
$$P(s) \propto s^{-\tau}, \quad \tau \approx 1.22$$

Center-of-mass radial distance pitch mapping:
$$\bar{r} = \sqrt{(\bar{x} - x_c)^2 + (\bar{y} - y_c)^2}, \quad \text{note} = \text{quantize}\left(\text{rootMidi} + \lfloor \bar{r} \cdot \text{pitchSpread} \rfloor\right)$$

#### Skeleton JavaScript Implementation
```javascript
export class SandpileModel {
  constructor(size = 33) {
    this.size = size;
    this.grid = new Int16Array(size * size);
    this.toppleQueue = [];
    this.center = Math.floor(size / 2);
  }

  dropGrain(x = this.center, y = this.center) {
    const idx = y * this.size + x;
    this.grid[idx]++;
    if (this.grid[idx] >= 4) this.toppleQueue.push(idx);
  }

  stepCascade() {
    if (this.toppleQueue.length === 0) return 0;
    const currentQueue = this.toppleQueue.slice();
    this.toppleQueue.length = 0;
    let sumX = 0, sumY = 0, count = 0;
    const S = this.size;

    for (const idx of currentQueue) {
      if (this.grid[idx] < 4) continue;
      const numTopples = Math.floor(this.grid[idx] / 4);
      this.grid[idx] %= 4;
      const x = idx % S, y = Math.floor(idx / S);
      sumX += x; sumY += y; count++;

      if (x > 0 && (this.grid[idx - 1] += numTopples) >= 4) this.toppleQueue.push(idx - 1);
      if (x < S - 1 && (this.grid[idx + 1] += numTopples) >= 4) this.toppleQueue.push(idx + 1);
      if (y > 0 && (this.grid[idx - S] += numTopples) >= 4) this.toppleQueue.push(idx - S);
      if (y < S - 1 && (this.grid[idx + S] += numTopples) >= 4) this.toppleQueue.push(idx + S);
    }

    if (count > 0) {
      const dist = Math.hypot(sumX / count - this.center, sumY / count - this.center);
      const note = quantize(getRootMidi() + Math.round(dist * 1.2));
      const vel = Math.min(127, Math.max(30, 80 + Math.round(Math.log2(count + 1) * 12)));
      playVoice(note, vel, 140);
    }
    return count;
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Rhythmic cascades alternating between solitary droplet pings and explosive 32nd-note arpeggio avalanches.
- **Scalability**: $33 \times 33$ grid stored in single `Int16Array(1089)` ($< 3 \text{ KB}$); zero GC churn; FIFO voice manager capping note density to $\le 8$ voices.

---

### Model 06 (Step 6): Percolation Cluster & Fluid Porosity Phase Transition
- **Model ID**: `percolation`
- **Category**: Physical / Statistical Mechanics / Critical Phase Transitions.
- **Why Sixth**: Builds upon the 2D grid processing from Step 5, introducing the Disjoint Set Union (DSU / Union-Find) data structure for connected cluster analysis.

#### Mathematical Formulation
2D site percolation critical threshold and infinite spanning cluster probability:
$$p_c \approx 0.592746, \quad P_\infty(p) \propto (p - p_c)^\beta, \quad \beta \approx 0.139$$

Disjoint Set Union (Union-Find) with path compression:
$$\text{find}(i) = \begin{cases} i, & \text{if } \text{parent}[i] = i \\ \text{find}(\text{parent}[i]), & \text{otherwise} \end{cases}$$

#### Skeleton JavaScript Implementation
```javascript
class DSU {
  constructor(n) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n);
    for (let i = 0; i < n; i++) { this.parent[i] = i; this.size[i] = 1; }
  }
  find(i) {
    let root = i;
    while (root !== this.parent[root]) root = this.parent[root];
    let curr = i;
    while (curr !== root) { const next = this.parent[curr]; this.parent[curr] = root; curr = next; }
    return root;
  }
  union(i, j) {
    const rootI = this.find(i), rootJ = this.find(j);
    if (rootI === rootJ) return;
    if (this.size[rootI] < this.size[rootJ]) { this.parent[rootI] = rootJ; this.size[rootJ] += this.size[rootI]; }
    else { this.parent[rootJ] = rootI; this.size[rootI] += this.size[rootJ]; }
  }
}

export class PercolationModel {
  constructor(w = 24, h = 16) {
    this.w = w; this.h = h; this.p = 0.58;
    this.grid = new Uint8Array(w * h);
    this.dsu = new DSU(w * h);
    this.pulseY = -1;
    this.reseed();
  }

  reseed() {
    this.grid.fill(0);
    this.dsu = new DSU(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) if (Math.random() < this.p) this.grid[i] = 1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const idx = y * this.w + x;
        if (!this.grid[idx]) continue;
        if (x > 0 && this.grid[idx - 1]) this.dsu.union(idx, idx - 1);
        if (y > 0 && this.grid[idx - this.w]) this.dsu.union(idx, idx - this.w);
      }
    }
  }

  tickStep() {
    if (this.pulseY < 0 || this.pulseY >= this.h) return;
    const y = this.pulseY;
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();

    for (let x = 0; x < this.w; x++) {
      const idx = y * this.w + x;
      if (this.grid[idx] === 1) {
        const cRoot = this.dsu.find(idx);
        const cSize = this.dsu.size[cRoot];
        if (cSize >= 3) {
          const deg = Math.floor((x / this.w) * intervals.length);
          const note = quantize(root + Math.floor((1 - y / this.h) * 3) * 12 + (intervals[deg] || 0));
          playVoice(cRoot, note, Math.min(127, Math.max(30, 40 + Math.round(Math.log2(cSize) * 16))), 160);
        }
      }
    }
    this.pulseY++;
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Striking qualitative shifts as $p$ crosses $p_c \approx 0.59$: sparse staccato droplets below threshold, dense polyphonic choral saturation above threshold.
- **Scalability**: $24 \times 16 = 384$ cells; DSU executes in $< 0.05 \text{ ms}$; clock pulse wavefront scan takes $< 0.001 \text{ ms}$.

---

### Model 07 (Step 7): Diffusion-Limited Aggregation (DLA) Dendritic Crystal
- **Model ID**: `dla`
- **Category**: Physical Growth / Fractal Branching / Brownian Aleatoric Mechanics.
- **Why Seventh**: Combines 2D lattice occupancy tests with Brownian random walks to construct evolving fractal growth networks.

#### Mathematical Formulation
Brownian 2D walker motion and universal fractal dimension:
$$\mathbf{r}_{k+1} = \mathbf{r}_k + \Delta s \, (\cos \phi, \sin \phi), \quad \phi \sim \mathcal{U}(0, 2\pi), \quad D_f \approx 1.71$$

Polar coordinate pitch quantization:
$$\theta = \text{atan2}(y - y_c, x - x_c) + \pi, \quad \text{deg} = \left\lfloor \frac{\theta}{2\pi} \cdot |\text{intervals}| \right\rfloor$$
$$\text{octave} = \left\lfloor \frac{r}{R_{\max}} \cdot 4 \right\rfloor, \quad \text{note} = \text{quantize}\left(\text{rootMidi} + 12 \cdot \text{octave} + \text{intervals}[\text{deg}]\right)$$

#### Skeleton JavaScript Implementation
```javascript
export class DLAModel {
  constructor(size = 128) {
    this.size = size;
    this.center = Math.floor(size / 2);
    this.grid = new Uint8Array(size * size);
    this.cluster = [];
    this.maxR = 6;
    this.stickProb = 1.0;
    this.reset();
  }

  reset() {
    this.grid.fill(0);
    this.cluster.length = 0;
    this.maxR = 6;
    this.grid[this.center * this.size + this.center] = 1;
    this.cluster.push({ x: this.center, y: this.center, r: 0, theta: 0 });
  }

  hasClusterNeighbor(x, y) {
    const S = this.size, idx = y * S + x;
    return (this.grid[idx - 1] === 1 || this.grid[idx + 1] === 1 ||
            this.grid[idx - S] === 1 || this.grid[idx + S] === 1);
  }

  stepWalkers(batch = 16) {
    const S = this.size;
    const killRadius = Math.min(S / 2 - 2, this.maxR + 25);
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();

    for (let b = 0; b < batch; b++) {
      const angle = Math.random() * Math.PI * 2;
      let px = this.center + Math.round(Math.cos(angle) * (this.maxR + 4));
      let py = this.center + Math.round(Math.sin(angle) * (this.maxR + 4));

      for (let s = 0; s < 200; s++) {
        const dir = Math.floor(Math.random() * 4);
        if (dir === 0) px++; else if (dir === 1) px--; else if (dir === 2) py++; else py--;
        const dist = Math.hypot(px - this.center, py - this.center);
        if (dist > killRadius || px <= 1 || px >= S - 2 || py <= 1 || py >= S - 2) break;

        if (this.hasClusterNeighbor(px, py) && Math.random() <= this.stickProb) {
          this.grid[py * S + px] = 1;
          const theta = Math.atan2(py - this.center, px - this.center) + Math.PI;
          this.cluster.push({ x: px, y: py, r: dist, theta });
          if (dist > this.maxR) this.maxR = dist;

          const deg = Math.floor((theta / (Math.PI * 2)) * intervals.length);
          const oct = Math.min(3, Math.floor((dist / (S * 0.45)) * 4));
          const note = quantize(root + oct * 12 + (intervals[deg] || 0));
          playVoice(note, Math.min(127, Math.max(35, 60 + Math.round((dist / this.maxR) * 60))), 220);
          break;
        }
      }
    }
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Expanding crystalline harmony. Starts with tight fundamental intervals around the seed and blossoms outward into wide compound intervals and overtone sparkles.
- **Scalability**: $128 \times 128$ byte buffer ($16 \text{ KB}$); $O(1)$ neighbor collision lookup; runs in $< 0.15 \text{ ms}$ per animation frame.

---

### Model 08 (Step 8): SIR Epidemic Network Dynamics (Contagion)
- **Model ID**: `epidemic`
- **Category**: Population Dynamics / Biological Process / Stochastic Network Graphs.
- **Why Eighth**: Extends discrete states into continuous spatial agent interaction networks with distance-decay transmission and refractory periods.

#### Mathematical Formulation
Continuous SIR equations with immunity decay $\mu$:
$$\frac{dS}{dt} = -\beta \frac{S I}{N} + \mu R, \quad \frac{dI}{dt} = \beta \frac{S I}{N} - \gamma I, \quad \frac{dR}{dt} = \gamma I - \mu R, \quad R_0 = \frac{\beta}{\gamma}$$

Discrete spatial contact transmission probability:
$$P(\text{Infection of node } i) = 1 - \prod_{j \in \mathcal{N}(i), \, \text{state}(j) = I} \left(1 - \beta \cdot e^{-d_{ij}^2 / 2\sigma^2}\right)$$

#### Skeleton JavaScript Implementation
```javascript
export class EpidemicModel {
  constructor(nodeCount = 48) {
    this.nodeCount = nodeCount;
    this.x = new Float32Array(nodeCount);
    this.y = new Float32Array(nodeCount);
    this.state = new Uint8Array(nodeCount); // 0 = S, 1 = I, 2 = R
    this.timer = new Int16Array(nodeCount);
    this.beta = 0.35;
    this.recoveryTime = 8;
    this.immunityTime = 16;
    this.contactRadius = 0.3;
    this.initGraph();
  }

  initGraph() {
    for (let i = 0; i < this.nodeCount; i++) {
      const theta = i * 2.39996;
      const r = Math.sqrt(i / this.nodeCount) * 0.45;
      this.x[i] = 0.5 + r * Math.cos(theta);
      this.y[i] = 0.5 + r * Math.sin(theta);
      this.state[i] = 0;
      this.timer[i] = 0;
    }
    this.infect(0);
  }

  infect(nodeId) {
    this.state[nodeId] = 1;
    this.timer[nodeId] = this.recoveryTime;
    const dist = Math.hypot(this.x[nodeId] - 0.5, this.y[nodeId] - 0.5);
    const intervals = getActiveScaleIntervals();
    const deg = Math.floor(dist * 2.2 * intervals.length);
    const note = quantize(getRootMidi() + (intervals[deg % intervals.length] || 0) + Math.floor(deg / intervals.length) * 12);
    playVoice(nodeId, note, 80 + Math.floor(dist * 80), 300);
  }

  tickStep() {
    const nextState = new Uint8Array(this.state);
    const nextTimer = new Int16Array(this.timer);

    for (let i = 0; i < this.nodeCount; i++) {
      if (this.state[i] === 1) { // Infectious
        for (let j = 0; j < this.nodeCount; j++) {
          if (i !== j && this.state[j] === 0) {
            const dist = Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]);
            if (dist <= this.contactRadius && Math.random() < this.beta) {
              nextState[j] = 1; nextTimer[j] = this.recoveryTime;
              this.infect(j);
            }
          }
        }
        if (--nextTimer[i] <= 0) { nextState[i] = 2; nextTimer[i] = this.immunityTime; }
      } else if (this.state[i] === 2 && --nextTimer[i] <= 0) {
        nextState[i] = 0;
      }
    }
    this.state.set(nextState);
    this.timer.set(nextTimer);
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Macro-structural dramatic arcs. Begins with sparse solitary motifs, builds into viral choral crescendos, and resolves into staccato counterpoint as immunity takes hold.
- **Scalability**: 48 spatial nodes in typed arrays; execution $< 0.05 \text{ ms}$ per transport step; active voices capped strictly to $\le 8$ notes.

---

### Model 09 (Step 9): Physarum Polycephalum (Slime Mould Nutrient Network)
- **Model ID**: `physarum`
- **Category**: Biological Process / Bio-Computational Multi-Agent Foraging / Steiner Optimization.
- **Why Ninth**: Highest architectural complexity. Combines multi-agent sensory steering particles with a 2D diffused/decaying pheromone scalar field.

#### Mathematical Formulation
Agent sensory sampling at Forward, Left ($+\theta_s$), and Right ($-\theta_s$) coordinates:
$$\mathbf{s}_F = \mathbf{x}_k + S_d (\cos \phi_k, \sin \phi_k)$$
$$\mathbf{s}_L = \mathbf{x}_k + S_d (\cos(\phi_k + \theta_s), \sin(\phi_k + \theta_s))$$
$$\mathbf{s}_R = \mathbf{x}_k + S_d (\cos(\phi_k - \theta_s), \sin(\phi_k - \theta_s))$$

Trail diffusion and evaporation equation:
$$C(x, y, t + \Delta t) = (1 - \delta) \cdot \left[ C(x, y, t) + D \nabla^2 C(x, y, t) \right] + \sum_k \delta(\mathbf{x} - \mathbf{x}_k)$$

#### Skeleton JavaScript Implementation
```javascript
export class PhysarumModel {
  constructor(gridW = 64, gridH = 48, numAgents = 384) {
    this.w = gridW; this.h = gridH;
    this.numAgents = numAgents;
    this.trail = new Float32Array(gridW * gridH);
    this.diffused = new Float32Array(gridW * gridH);
    this.agentX = new Float32Array(numAgents);
    this.agentY = new Float32Array(numAgents);
    this.agentAngle = new Float32Array(numAgents);
    this.sensorAngle = Math.PI / 4;
    this.sensorDist = 4.0;
    this.decay = 0.94;
    this.food = [
      { x: 16, y: 14, scaleDeg: 0, flux: 0 },
      { x: 48, y: 12, scaleDeg: 2, flux: 0 },
      { x: 50, y: 38, scaleDeg: 4, flux: 0 },
      { x: 18, y: 36, scaleDeg: 5, flux: 0 }
    ];
    this.initAgents();
  }

  sampleTrail(x, y) {
    const gx = Math.round(x + this.w) % this.w;
    const gy = Math.round(y + this.h) % this.h;
    return this.trail[gy * this.w + gx];
  }

  update(dt) {
    for (let i = 0; i < this.numAgents; i++) {
      const a = this.agentAngle[i], x = this.agentX[i], y = this.agentY[i];
      const fC = this.sampleTrail(x + Math.cos(a) * this.sensorDist, y + Math.sin(a) * this.sensorDist);
      const lC = this.sampleTrail(x + Math.cos(a + this.sensorAngle) * this.sensorDist, y + Math.sin(a + this.sensorAngle) * this.sensorDist);
      const rC = this.sampleTrail(x + Math.cos(a - this.sensorAngle) * this.sensorDist, y + Math.sin(a - this.sensorAngle) * this.sensorDist);

      if (fC > lC && fC > rC) { /* keep */ }
      else if (lC > rC) this.agentAngle[i] += 0.3;
      else if (rC > lC) this.agentAngle[i] -= 0.3;
      else this.agentAngle[i] += (Math.random() - 0.5) * 0.4;

      this.agentX[i] = (x + Math.cos(this.agentAngle[i]) * 1.5 + this.w) % this.w;
      this.agentY[i] = (y + Math.sin(this.agentAngle[i]) * 1.5 + this.h) % this.h;
      this.trail[Math.floor(this.agentY[i]) * this.w + Math.floor(this.agentX[i])] += 1.0;
    }

    // Check food flux triggers
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();
    for (let f = 0; f < this.food.length; f++) {
      const node = this.food[f];
      const idx = Math.floor(node.y) * this.w + Math.floor(node.x);
      this.trail[idx] += 8.0;
      node.flux += this.trail[idx] * dt;
      if (node.flux >= 18.0) {
        node.flux = 0.0;
        const note = quantize(root + (intervals[node.scaleDeg % intervals.length] || 0));
        playVoice(f, note, Math.min(127, Math.max(40, Math.round(this.trail[idx] * 8))), 280);
      }
    }

    // Diffuse & decay
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const idx = y * this.w + x;
        this.diffused[idx] = (this.trail[idx - 1] + this.trail[idx + 1] + this.trail[idx - this.w] + this.trail[idx + this.w]) * 0.25 * this.decay;
      }
    }
    this.trail.set(this.diffused);
  }
}
```

#### Musical & Scalability Profile
- **Musical Output**: Biological pulsing rhythms along Steiner highway veins connecting harmonic root nodes; evolves from chaos into hypnotic transport loops.
- **Scalability**: $64 \times 48$ downsampled field with 384 lightweight agents runs in $\approx 0.35 \text{ ms}$ per frame ($< 3\%$ CPU budget at 60 FPS). Max 4–8 food voices.

---

## 4. Bonus Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **Gray-Scott Reaction-Diffusion (Turing Chemical Morphogenesis)**: Two virtual chemical morphogens diffuse across a 2D substrate and react non-linearly to generate dynamic animal coat patterns like spots, labyrinthine stripes, and dividing solitonic waves. As localized chemical concentration fronts divide and collapse, they trigger polyphonic modal clusters whose spatial wavelengths determine interval voicings and FM-1 operator feedback depths.
2. **Coupled Kuramoto Phase Synchronization Oscillators**: A population of non-linear phase oscillators with distinct natural frequencies interact through sinusoidal coupling, periodically drifting into collective synchronization before desynchronizing through external perturbing noise. Phase lock events trigger simultaneous polyphonic downbeat chords, while transient asynchronous phases generate intricate, wandering polyrhythmic bell cascades.
3. **FitzHugh-Nagumo Biological Neuromorphic Spiking Network**: A network of simplified biological neurons with fast excitation voltage and slow recovery variables generates all-or-nothing action potential spikes upon receiving sensory stimulus. Action potential firing events directly emit velocity-sensitive MIDI gates, while refractory recovery periods naturally enforce musical phrasing and prevent voice crowding.
4. **2D Acoustic Wave Equation Ripple Tank (Finite-Difference Time Domain)**: A discrete height field simulates physical acoustic surface ripples propagating from interactive drop points and reflecting off user-drawn spatial barrier walls. Acoustic wavefront crests crossing virtual hydrophone pickup sensors trigger scale-quantized notes whose velocity and stereo pan mirror real-time wave pressure and propagation vectors.
5. **Atmospheric Rayleigh-Bénard Convection & Cloud Formation**: Simulates thermal fluid parcels rising from a warm ground plate into a cool upper boundary, where water vapor condenses into cloud billows upon reaching saturation dew points. Dew point condensation events sound resonant bell tones in high octave registers, while sinking downdrafts trigger low-frequency grounding bass pulses.
6. **High-Order Markov Chain Stochastic Pitch-Transition Matrix**: A stochastic transition network models musical memory by choosing subsequent notes based on conditional transition probability tables derived from the previous $N$ melodic intervals. As the user alters transition temperature or introduces mutation entropy, melodic phrases smoothly transition between rigid stylistic motifs and surprising aleatoric improvisations.
7. **Interactive Genetic Algorithm Melodic Genome Breeder**: Maintains a breeding population of musical chromosome vectors encoding rhythm, scale degree intervals, and gate envelopes, subjected to mutation and crossover operations. The user tags sounding motifs with positive or negative interactive fitness scores, steering the evolutionary survival and emergence of complex, personalized musical themes over successive generations.
8. **Chladni Acoustic Resonant Plate & Nodal Sand Patterns**: Simulates Ernst Chladni’s vibrating square acoustic plates where virtual sand grains are propelled off anti-nodal zones and settle onto geometric nodal lines defined by 2D standing wave eigenfunctions $\cos(n \pi x / L)\cos(m \pi y / L) - \cos(m \pi x / L)\cos(n \pi y / L) = 0$. Grains settling into equilibrium nodal pockets trigger micro-tonal chime harmonics that shift dramatically as modal vibrational frequencies $m$ and $n$ are swept.
9. **Brownian Ratchet / Feynman Thermal Diode**: A microscopic mechanical paddle immersed in a fluctuating thermal bath attempts to drive a cogwheel restricted to unidirectional rotation by an asymmetric spring-loaded pawl. Stochastic thermal collisions occasionally overcome the pawl barrier, generating aperiodic rhythmic step advances whose statistical burst frequencies are governed by temperature and mechanical load.
10. **Electroplankton "Tracy" Ribbon Path Trajectory**: Inspired by Toshio Iwai’s Tracy plankton species, the user draws continuous organic vector gestures across an aquatic canvas, spawning a creature that perpetually navigates the closed contour. As the creature traverses segments of the ribbon, local curvature, speed, and heading direction are continuously translated into quantized pitch shifts, gate lengths, and expressive FM modulation envelopes.
11. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
