# FM-1 Pulses — final narration script (fused from both takes)

Target: 5:00. Take 2 (10:56) is the backbone: music-first opening, section
flow, locks, presets, JSON, the Bluetooth honesty. Take 1 (10:22) contributes
the charm lines. The "no way to select scales" slip from take 2 is fixed.

## 0:00–0:15 · Cold open

"The melody you're hearing is a sequence I created on a tool I developed and
published for free: FM-1 Pulses. If you know Eurorack, VCV Rack or Cardinal,
this is gonna be easy peasy, because I basically stole the whole thing from
it."

## 0:15–0:40 · What it is + tempo

"FM-1 Pulses is a generative sequencer for the FM-1. It runs in Chrome,
nothing to install, and it writes all sixteen pattern slots from a handful of
knobs. The signal chain matches a modular rig: clock, gate, LFO, quantizer, a
buffer with loop memory. Turn the knobs and the bank fills.

First: tempo. On the firmware I'm using, Baud Girl, I can't reliably send
tempo to the FM-1. So the app does the opposite: it reads the tempo from the
synth. Change it here, move any knob in the app, and it snaps. Workaround
found."

## 0:40–1:15 · How a sequence is built

"A sequence is built on two things: gate probability, whether a note plays on
that step, and the shape the notes follow. Best way to explain it: full gate,
one hundred percent, and a sine wave traveling through the notes. Raise the
cycles and it travels a lot faster; it becomes an arpeggio. Lower them and
it's whole notes. The quantize knob snaps notes into the scale: one hundred is
full snap, less introduces chromatic notes. And the Shape knob morphs the
wave. It works differently for each one, warps them, multiplies them. The
guide explains them all. There's also Perlin noise, which likes a bit of
amplitude."

## 1:15–1:50 · Rhythm

"Now the gate. Reduce the steps and it gets too random. So I added Euclid
spacing, borrowed from Eurorack modules: it shifts the notes into clave and
tresillo patterns instead of straight chaos. You can rotate the whole pattern,
and combine it with the grid snap, which erases notes that don't fall on the
grid lines. Together you get rhythms that sound organized without being
boring."

## 1:50–2:20 · Pitch, global, drift

"Pitch: amplitude sets how low and high the notes reach, offset moves the
register, root sets the scale. Unipolar: off, the melody can go below the
root; on, the root is always the lowest note. Change the seed and you get a
new sequence from the same parameters — sixteen of them at once, all with the
same vibe. Drift morphs the knobs across the bank: at zero every slot is the
twin brother of the first; raise it and they get weirder."

## 2:20–2:55 · Shaping the randomness

"Then how the notes spread. Constant just outputs the root and octaves, bell
keeps things near the center, uniform is even, extremes bounces between low
and high. Bias decides whether more high notes or low notes play. Velocity,
humanize for random velocity, a chance of jumping up an octave, and root
gravity, which moves notes back to the root. All ways to make the randomness
sound intentional."

## 2:55–3:30 · Deja Vu + locks

"The loop I called Deja Vu, same name as the Marbles module in VCV Rack. Set
the steps, raise it to one hundred, and it loops that region: the highlighted
band in the grid. The loop is taken at the start of the algorithm, so you're
not looping a loop. And if there are notes you don't want the randomness to
touch, you can lock them. Regenerate, and everything moves except those
notes."

## 3:30–4:10 · Freeze

"Once you have a bank, play it from the browser. The FM-1 plays it, or you
unmute the built-in sounds if you're on the go. Then freeze one sequence into
the slot you selected on the FM-1, or send all sixteen. The LEDs blink while
it writes, and the status tells you when it's done. Hit play on the unit:
it's written."

## 4:10–4:45 · The practical stuff

"It's built out of love, and it's free. Works from your cell phone: USB cable
and Chrome. Edge maybe, Firefox no. Save presets by double-clicking a slot,
export and import JSON with the seed and the knob values so any session is
reproducible, and export the .syx to push into the synth with any tool.
Bluetooth is in progress."

## 4:45–5:00 · Outro

"Drop a comment if something's unclear. There's a guide built in, and tooltips
on every knob. That's FM-1 Pulses. Happy sequencing."
