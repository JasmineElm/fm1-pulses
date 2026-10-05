# FM-1 Pulses — Launch Showcase Video

Two variants of the same 5:00 video. **Variant A** (narrated: knob tour, demo,
freeze). **Variant B** (no narration, music plus on-screen captions). Production
notes at the bottom.

---

## VARIANT A — narrated (5:00)

### 0:00–0:20 · COLD OPEN
**Shot:** FM-1 close-up, LEDs running a frozen pattern. No words. Cut to the app
screen, playhead sweeping. Title card over both:
**FM-1 PULSES — generative sequences for the M-VAVE FM-1.**

**VO:** "You're hearing a pattern the FM-1 stored a minute ago. The machine that
wrote it is a page in a browser, closed since."

### 0:20–0:50 · WHAT IT IS
**Shot:** phone in hand, the rack visible, slow pan across the panel.

**VO:** "FM-1 Pulses is a generative sequencer for the M-VAVE FM-1. It runs in
Chrome, nothing to install, and it writes all sixteen pattern slots from a
handful of knobs. The signal chain matches a modular rig: clock, gate, LFO,
quantizer, then a buffer with loop memory. Turn the knobs and the bank fills."

### 0:50–2:30 · THE KNOBS (caption each knob name as it's touched, ~6s each)
**Shot:** screen recording, each section in turn. Browser preview audio low under VO.

**VO:** "Five sections. Rhythm first. Tempo sets the browser clock. The FM-1's
own BPM takes over on the device and the app reads it back, so the knob matches
what the unit plays. Swing bends the offbeats, fifty straight to seventy-five
triplet. Gate is the density: how many of the steps fire. Euclid is a gradient.
At zero the gate is a coin flip per step. At one hundred the hits sit at the
evenest positions of the cycle, which is where clave and tresillo come from.
Rotate shifts that pattern. Grid snap drops any note that falls between grid
lines.

Global. Drift spreads the sixteen slots apart: slot one sits closest to your
settings, slot sixteen furthest. Seed is one number; everything else derives
from it. Note value and Length define the bar. Quantize pulls notes to the
scale; low settings let accidentals through. Unipolar makes the Offset note a
floor instead of a centre.

Pitch. Wave picks the contour: sine, triangle, saw, square, perlin, and four
random shapes. Shape morphs it: folds the sine, bends the ramps, narrows the
square down to a thin pulse. Cycles repeats the contour across the phrase.
Amplitude widens the range around the Offset note. Scale and Root keep the
melody in key.

Shape. Spread chooses how the randomness is distributed, from constant through
bell to extremes. Bias tilts it toward the high or low register. Humanize
jitters the velocity per note. Octave up and Root gravity nudge notes up an
octave or back to the nearest root.

Memory. The loop region is the tinted band in the grid; the phrase inside it
tiles across the pattern. Deja Vu sets how often a step repeats the loop
instead of generating a new note."

### 2:30–4:00 · THE DEMO — a melody from nothing
**Shot:** screen, hands on the knobs, browser preview at full volume. The bank
strip fills as the patch evolves. Caption: "one seed, sixteen patterns".

**VO:** "New seed. Scale: minor pentatonic. Gate to 37, Loop at 8, Euclid all
the way up: that's a tresillo, three hits across eight steps. Back Euclid off to
40 and the rhythm loosens but keeps the same hits. Wave to perlin, one cycle
across the phrase, a little Shape for the octave shimmer. Deja Vu to 40, so the
eight-step loop half-repeats itself. Everything you're hearing derives from the
seed, which means this exact bank comes back any time you type the same number.
[music only, 10–15s: morph Bias, Euclid, Wave while it plays] The loop keeps
running while you turn, so Bias, Euclid, the Wave: each change lands on the next
step."

### 4:00–4:40 · FREEZE TO THE FM-1
**Shot:** two cameras: the FM-1 on the desk, USB cable visible, and the screen.
Caption: "stop the FM-1's sequencer before freezing".

**VO:** "Plug in the FM-1. Stop its sequencer first; the firmware refuses
pattern writes while it's playing. Freeze. The app sends the pattern and reads
back what the device stored, so the status line shows what's actually on it.
Unplug the cable. The unit plays the pattern on its own."

### 4:40–5:00 · OUTRO
**Shot:** app title screen, then the URL as a title card.

**VO:** "FM-1 Pulses runs in Chrome on the phone or the desktop. Source and
live app linked below the video."

---

## VARIANT B — showcase only, no narration (5:00)

Same timeline, no VO. Music is the app's own output throughout: browser preview
for the first four minutes, the frozen FM-1 for the finale. On-screen captions
carry the knob one-liners from Variant A.

| Time | Shot | Caption |
|---|---|---|
| 0:00–0:20 | FM-1 LEDs playing, then app playhead | FM-1 PULSES |
| 0:20–0:50 | Pan across the rack | runs in Chrome · nothing to install |
| 0:50–1:10 | Rhythm section, tweak each knob | Tempo · Swing · Gate · Euclid · Rotate · Grid snap |
| 1:10–1:30 | Global section | Drift · Seed · Note · Length · Quantize |
| 1:30–1:55 | Pitch section, morph the Shape knob | Wave · Shape · Cycles · Amp · Offset · Scale · Root |
| 1:55–2:30 | Shape and Memory sections | Spread · Bias · Humanize · Octave · Gravity · Loop · Deja Vu |
| 2:30–4:00 | Build the patch from scratch, morph live | one seed, sixteen patterns |
| 4:00–4:10 | Plug USB, stop SEQ on the unit | stop the FM-1's sequencer before freezing |
| 4:10–4:40 | Freeze, read-back, unplug, standalone play | the unit plays it on its own |
| 4:40–5:00 | URL title card | mene311.github.io/fm1-pulses |

---

## Production notes

- **Screen capture:** Chrome on desktop is easiest for audio routing; the phone
  works via scrcpy or OBS. The app is a PWA, so a 1080p window fills the frame.
- **Audio:** two sources. Browser preview for the tour and demo; the FM-1's own
  line-out for the freeze finale. Record the line-out, not the phone mic.
- **The freeze moment needs the hardware on camera.** One handheld or secondary
  angle on the FM-1 during 4:00–4:40 sells the whole thing.
- **Filming order:** shoot the freeze last. The device ends the session in a
  known state: frozen, sequencer stopped.
- **Tempo:** set the unit's BPM beforehand and let the "device holds N BPM"
  status line appear on camera. Filming an in-app tempo change that the unit
  ignores would show the opposite of what the app claims.
- **The status-3 refusal makes a good beat if you want one:** attempt the freeze
  with SEQ playing, let the refusal appear, stop SEQ, freeze again. It fits
  inside the freeze section's 40 seconds.
