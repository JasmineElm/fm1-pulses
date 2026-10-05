# FM-1 Pulses — narration script (condensed from the 10-22-15 take)

Target: 5:00. Voice: yours, improvised-tight — keep the phrases you actually
said; this only removes the false starts and the doubling back. Timings assume
a re-shoot; the content order matches your take.

## 0:00–0:15 · Cold open

"If you know Eurorack, VCV Rack or Cardinal, this is gonna be easy peasy,
because I basically stole the whole thing from it. This is FM-1 Pulses, a
generative sequencer for the M-VAVE FM-1."

## 0:15–0:35 · Tempo, and the one workaround

"First thing: tempo. On the firmware I'm running, Baud Girl 093, I can't
reliably send tempo to the FM-1. So the app does the opposite: it syncs to the
synth. I change the tempo here, and the app snaps to it. Workaround found."

## 0:35–1:10 · How the sequence is built

"A sequence is built on two things: gate probability, whether a note plays on
that step, and the shape the notes follow. Watch: full gate, one hundred
percent, and a sine wave traveling through the notes. Raise the cycles and it
becomes an arpeggio; lower them and it's whole notes. Right now it's chromatic.
The quantize knob snaps notes into the scale: one hundred percent is full snap,
less starts introducing chromatic notes. And the Shape knob morphs the wave.
It works differently for each one; the guide explains them all. There's also
Perlin noise in there, which likes a bit of amplitude."

## 1:10–1:50 · Rhythm: gate and Euclid

"Now the gate. Reduce the steps and it gets too random. So I added Euclid
spacing, borrowed from Eurorack modules. It shifts the notes into patterns —
clave, tresillo stuff — so you get rhythm instead of straight chaos, and you
can rotate the whole pattern. If you don't want Euclid, the snap grid erases
notes that fall between the lines. You can combine both."

## 1:50–2:20 · Pitch and global

"Pitch: amplitude sets the span from low notes to high notes, offset moves the
register, and root sets the scale. Global: note value is your resolution,
eighths, sixteenths. Unipolar: off, the melody can go below the root; on, the
root is the lowest note you'll get. Change the seed and you get a new sequence
from the same parameters — sixteen of them at once, all with the same vibe.
Drift morphs the knobs across the bank: at zero every slot is the twin brother
of the first, and as you raise it they get weirder."

## 2:20–2:55 · Shaping the randomness

"Then how the notes spread. Constant just outputs the root and octaves, bell
keeps things near the center, uniform is even, extremes bounces between low
and high. Bias shifts the selection toward higher or lower notes. Then
velocity, humanize for random velocity, a chance of jumping up an octave, and
root gravity, which pulls notes back to the root of the scale. All ways to
make the randomness sound intentional."

## 2:55–3:25 · Deja Vu

"Last, the loop. I called it Deja Vu because that's the name the Marbles
module uses in VCV Rack. Set how many steps you loop, and this is the chance
each step loops back. The loop is taken at the start of the algorithm, so
you're not looping a loop. It grounds the beat into something predictable."

## 3:25–4:10 · Freeze

"Once you have a bank, click any parameter and it plays. Then you either
freeze one sequence into the slot you selected on the FM-1, or send all
sixteen. The LEDs blink while it writes, and the tooltip counts them. Done.
Now the sequencer has it. Hit play."

## 4:10–4:45 · The practical stuff

"It's built out of love, and it's free. It works from your cell phone: plug it
into the FM-1 with a USB cable and use Chrome. Edge maybe, Firefox no. Save
presets by double-clicking a slot, export and import them as files, and export
the .syx to push into the synth with any tool."

## 4:45–5:00 · Outro

"Hit me on Reddit if something's unclear. There's a guide built in, and
tooltips on every knob. That's FM-1 Pulses. Thank you."

---

## Cut notes for editing the existing take instead of re-shooting

The 16-minute take can be cut down rather than re-shot. Rough section map of
`2026-10-05 10-22-15.mp4` (from the transcript):

- opening / Eurorack bit · tempo workaround · sine demo · cycles · quantize
- Shape / Perlin · gate reduce + Euclid + rotate + snap grid · gate length
- amplitude / offset / root · note value / unipolar · seed / drift
- spread modes / bias / velocity / humanize / octave / gravity · Deja Vu loop
- freeze / send 16 · playback on the unit · phone + Chrome caveat · presets /
  export / syx · outro

If you want exact in/out timestamps per section for the edit, ask and I'll run
the transcription again with per-segment timestamps (srt output).
