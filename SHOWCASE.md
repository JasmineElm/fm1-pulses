# FM-1 Pulses — Launch Showcase Video

Two variants of the same 5:00 video. **Variant A** (narrated, what each knob
does + demo + freeze). **Variant B** (no narration — music + on-screen captions
only). Production notes at the bottom.

---

## VARIANT A — narrated (5:00)

### 0:00–0:20 · COLD OPEN
**Shot:** FM-1 close-up, its LEDs running a frozen pattern. No words, just audio.
Cut to the app screen, playhead sweeping. Title card over both:
**FM-1 PULSES — generative sequences for the M-VAVE FM-1.**

**VO:** "This box writes its own songs. Well — this browser does. The FM-1 just plays them."

### 0:20–0:50 · WHAT IT IS
**Shot:** phone in hand, the rack visible, a slow pan across the panel.

**VO:** "FM-1 Pulses is a generative sequencer that lives in your browser. Turn a few
knobs and it writes sixteen complete patterns for the FM-1. No install, no server, free.
It thinks like a Eurorack rig: a clock, a gate, an LFO, a quantizer, and a buffer with
a memory. You shape the randomness — it writes the songs."

### 0:50–2:30 · THE KNOBS (caption each knob name as it's touched, ~6s each)
**Shot:** screen recording, each section in turn. Browser preview audio faint under VO.

**VO:** "Five sections. Rhythm first. **Tempo** — the clock; the FM-1's own BPM is king
and the app syncs to it. **Swing** — fifty straight, seventy-five triplet. **Gate** — the
density, how many steps fire. And this one — **Euclid**. A gradient from pure random
placement to perfectly even spacing: the maths behind clave and tresillo. **Rotate**
turns the pattern. **Grid snap** keeps only notes that land on grid lines.

**Global.** **Drift** — how far the sixteen slots evolve from each other. **Seed** — one
number, everything derives from it. **Note value**, **Length**, **Quantize** — how hard
notes snap to the scale — and **Unipolar**.

**Pitch.** **Wave** — nine shapes, from sine to perlin to sample-and-hold. **Shape** — the
morph knob: it folds the sine, bends the ramps, narrows the pulse. **Cycles** — how many
times the contour repeats. **Amp** and **Offset** — where the melody lives. **Scale**,
**Root**.

**Shape.** **Spread** — the randomness distribution, constant to extremes. **Bias** tilts
it up or down. **Humanize**, **Velocity**, **Octave up**, **Root gravity**.

**Memory.** The **loop region** — highlighted right here. **Deja Vu** — how much the
pattern remembers itself instead of generating new."

### 2:30–4:00 · THE DEMO — writing a melody live
**Shot:** screen, hands visible on the knobs, browser preview full volume. The bank strip
fills as the patch evolves. Caption: "one seed → sixteen songs".

**VO:** "Watch it write a song. New seed. Minor pentatonic. Pull the Euclid knob to sixty —
hear the rhythm grow bones? Now perlin for the contour, slow cycles, a little shape for
the shimmer. Loop eight steps — you can see the region light up — and slide Deja Vu to
forty. It's half memory, half invention. Everything comes from one seed, so it's all
reproducible — same seed, same song. [live morph, 10–15s of music only] And because the
loop plays while you turn, you can grab Bias, Euclid, the Wave — and play the thing like
an instrument."

### 4:00–4:40 · FREEZE TO THE FM-1
**Shot:** two cameras — the FM-1 on the desk (real hardware in frame) and the screen.
USB cable visible. Caption: "the FM-1's sequencer must be stopped".

**VO:** "Now the point of it all. USB in. One rule: the FM-1's sequencer must be stopped —
the firmware refuses the write while it's playing. Freeze. The app reads back what the
device actually stored. Unplug. It plays alone — the browser is already closed. Sixteen
patterns, one button each: Send 16."

### 4:40–5:00 · OUTRO
**Shot:** app title screen, then the URL as a title card.

**VO:** "FM-1 Pulses. Free, open source, runs in Chrome on anything — even your phone.
The link is below. Go write something."

---

## VARIANT B — showcase only, no narration (5:00)

Same timeline, no VO. Music = the app's own output throughout (browser preview for the
first 4 minutes, the frozen FM-1 for the finale). On-screen captions carry the one-liners
from Variant A, one knob at a time.

| Time | Shot | Caption |
|---|---|---|
| 0:00–0:20 | FM-1 LEDs playing, then app playhead | FM-1 PULSES |
| 0:20–0:50 | Pan across the rack | no install · no server · free |
| 0:50–1:10 | Rhythm section, tweak each knob | Tempo · Swing · Gate · Euclid · Rotate · Grid snap |
| 1:10–1:30 | Global section | Drift · Seed · Note · Length · Quantize |
| 1:30–1:55 | Pitch section, morph the Shape knob | Wave · Shape · Cycles · Amp · Offset · Scale · Root |
| 1:55–2:30 | Shape + Memory sections | Spread · Bias · Humanize · Octave · Gravity · Loop · Deja Vu |
| 2:30–4:00 | Build the patch from scratch, morph live | "one seed → sixteen songs" |
| 4:00–4:10 | Plug USB, stop SEQ on the unit | "the FM-1's sequencer must be stopped" |
| 4:10–4:40 | Freeze, read-back, unplug, standalone play | "the browser is already closed" |
| 4:40–5:00 | URL title card | mene311.github.io/fm1-pulses |

---

## Production notes

- **Screen capture:** Chrome on desktop (easiest audio routing) or phone via scrcpy/OBS.
  The app is a PWA — a 1080p window fills the frame.
- **Audio:** two sources. Browser preview (the 🔊 synth) for the tour/demo; the FM-1's
  own output for the freeze finale. Record the FM-1 line-out; do NOT rely on the phone
  mic.
- **The freeze moment needs the hardware on camera.** One handheld/secondary angle on
  the FM-1 during 4:00–4:40 sells the whole thing.
- **Filming order tip:** shoot the freeze section last — the device ends the session in
  a known state (frozen, SEQ stopped).
- **The tempo caveat:** don't film yourself setting BPM in the app expecting the unit to
  follow — set the unit's tempo beforehand, then let the app's "device holds N BPM"
  status line appear on camera. It's the honest feature, and it reads as WYSIWYG.
- **The status-3 refusal is scriptable gold:** if you want a "gotcha" beat, attempt the
  freeze with SEQ playing, let the refusal message appear, stop SEQ, freeze again.
  Variant A can fit it inside the freeze section's 40s.
