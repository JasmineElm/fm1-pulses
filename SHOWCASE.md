# FM-1 Pulses — Launch Showcase Video (5:00)

**One split take, no cuts.** OBS records two halves side by side for the whole
five minutes. Nothing moves: the only thing that develops is what happens in
each half.

---

## THE FRAME (set once, never touched)

**Left — 960x1080. Window capture of Chrome on the desktop.**
Chrome window at **960x960**: the app fits whole in 940x823 px, 1:1, no scaling
and no scrolling — the knob rack and the 8x8 grid in the same frame. The ~250 px
left under it are the caption strip (one OBS text source, always in the same
place).

**Right — 960x1080. The phone locked off on the FM-1.** Same framing the entire
take: the device's screen and LEDs, with the USB port inside the frame. The cable
going in and out is a gesture of the video, not a detail — it has to be visible.

**Audio — one path that survives both cable-out moments.** The FM-1's line or
headphone out into the **Scarlett 2i2**, and from there into OBS. That is the
source for all five minutes: its own sequencer first, then the notes the app
sends it, then its own sequencer again. One continuous source, nothing to mix
between sections.

> The FM-1 also shows up as a USB audio device (`usb-4c4a_FM-1…`), which is
tempting for keeping the audio digital. It doesn't work here: that path dies in
exactly the two sections you need it — the cold open and the outro, when the
cable is out. The analog path never drops.

The browser preview stays **muted** from start to finish (otherwise everything
doubles). If the 2i2 isn't around, the phone's mic is the fallback.

**Nothing else.** No cuts, no pans, no second camera, no handheld, no filming
the phone's screen. The only thing that changes between sections is **which knob
moves** on the left and **what the device does** on the right.

---

## THE ARC — four states of the device

The video hangs on this, and it only works because the shot is fixed:

1. **0:00–0:20 · alone.** USB cable out. The FM-1 plays a pattern frozen in an
   earlier session with its own sequencer.
2. **0:20–4:00 · live.** The cable goes in, the device's SEQ is stopped, and
   from there everything you hear is notes the app sends over USB. SEQ stops
   here because the firmware refuses a pattern write while it's running.
3. **4:00–4:10 · frozen.** Freeze in the app: the pattern is written into the
   device.
4. **4:10–5:00 · alone again.** Cable out, SEQ on, and the device plays what it
   just received on its own.

---

## TIMELINE

### 0:00–0:20 · COLD OPEN

**Left:** the bank with the active slot selected, playhead sweeping the grid in
time with the device.
**Right:** the FM-1 playing alone, cable out, LEDs running the pattern.
**Caption:** FM-1 PULSES — generative sequences for the M-VAVE FM-1

**VO:** "You're hearing a pattern the FM-1 stored a minute ago. The machine that
wrote it is a page in a browser, closed since."

### 0:20–0:50 · WHAT IT IS

**Left:** the cursor travelling the rack top to bottom — transport, the five
knob sections, the grid, the bank strip. Nothing is touched yet.
**Right:** the USB cable goes in and SEQ stops. From here the LEDs answer the
notes arriving over USB.
**Caption:** runs in Chrome · nothing to install

**VO:** "FM-1 Pulses is a generative sequencer for the M-VAVE FM-1. It runs in
Chrome, nothing to install, and it writes all sixteen pattern slots from a
handful of knobs. The signal chain matches a modular rig: clock, gate, LFO,
quantizer, then a buffer with loop memory. Turn the knobs and the bank fills."

### 0:50–2:30 · THE KNOBS

**Left:** one section per turn — Rhythm, Global, Pitch, Shape, Memory — moving
each knob for ~6 s, with the name of the knob being touched in the caption
strip.
**Right:** nothing to direct. The device plays what it's given; this section
exists so that the knobs on the left are visibly the ones doing it.

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

**Left:** the cursor building the patch from scratch. The bank strip fills as
the patch evolves and the grid redraws live.
**Right:** the device following every change one step later. This is the moment
to notice that what you're hearing is the synth, not a plugin.
**Caption:** one seed, sixteen patterns

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

**Left:** **Freeze** is clicked. The status line shows what the device stored —
the app reads it back rather than assuming.
**Right:** hands come into frame: SEQ is already stopped (if it isn't, you get
the firmware's refusal and the caption explains it), the write lands, and then
the USB cable is pulled. From that point the device plays on its own.
**Caption:** stop the FM-1's sequencer before freezing

**VO:** "The sequencer is already stopped: the firmware refuses a pattern write
while the unit is playing, so it gets stopped up front. Freeze. The app sends
the pattern and reads back what the device stored, so the status line shows what
is actually on it. Now I pull the cable. The unit plays the pattern on its
own."

### 4:40–5:00 · OUTRO

**Left:** the rack still, with the whole bank in view. The URL caption over it.
**Right:** the FM-1 playing alone, cable out, no hands in frame. Let it run three
seconds past the last line of VO.
**Caption:** mene311.github.io/fm1-pulses

**VO:** "FM-1 Pulses runs in Chrome on the phone or the desktop. Source and
live app linked below the video."

---

## WITHOUT NARRATION

Same frame, same take, same timings: drop the VO track and keep the captions.
Each section already carries its own line, and the knob names appear in the
strip as they're moved. Without a voice you gain about 40 seconds in the demo —
let it run on music and morph Bias, Euclid and Wave.

---

## PRODUCTION NOTES

- **Freeze a bank before you roll.** The cold open plays from the device's own
  sequencer, so a frozen pattern has to exist beforehand. After that the take is
  a single continuous 5:00 pass — that's the point of the fixed shot.
- **Chrome window at 960x960, not maximised.** At 1920x1080 the app is fine on
  its own, but cropped into half the canvas it falls into its vertical layout:
  rack on top, grid below, 1405 px tall, and it gets cut. Square, it uses the
  rack layout (knobs left, grid right) and fits in 823 px.
- **Capture:** OBS *Window Capture* on Chrome, browser zoom at 100%, bookmarks
  bar hidden. If the title bar lands in the crop, trim it with the *Crop* filter:
  the useful frame is the 960x960 viewport.
- **The status-3 refusal makes a good beat if you want one:** attempt the freeze
  with SEQ playing, let the refusal appear, stop SEQ, freeze again. It fits
  inside the freeze section's 40 seconds — but then don't also put it in the
  caption, or it says the same thing twice.
- **Tempo:** set the unit's BPM beforehand and let the "device holds N BPM"
  status line appear on camera. Filming an in-app tempo change that the unit
  ignores would show the opposite of what the app claims.
- **Re-shooting one section is cheap:** the shot is fixed, so a second pass of
  the same section splices in invisibly — as long as the pattern playing is the
  same one. If the pattern changed, it shows.
