# Reddit launch post — FM-1 Pulses

## Primary: r/synthesizers (then crosspost r/FMsynthesis, r/synthdiy)

### Title

I built a free generative sequencer for the M-VAVE FM-1 (Baud Girl / FM-1+VA
firmware): it generates 16 patterns and freezes them straight into the synth's
own sequencer

### Body

Link: https://mene311.github.io/fm1-pulses/. It runs in Chrome on a phone or
desktop, installs nothing, and needs no account. Source:
https://github.com/mene311/fm1-pulses

The freeze path targets the **Baud Girl / FM-1+VA** firmware. The 0x20 pattern
write exists only there; stock firmware has no pattern-write SysEx. On other
firmware the app still works as a live MIDI broadcaster (play and morph in real
time), just not the freeze.

I've used VCV Rack and Cardinal for years. Writing sequences by hand was always
my weak spot: give me a 64-step grid and I'll tap something flat into it. The
FM-1's sequencer was no different until I flashed the Baud Girl firmware, which
unlocked the pattern write and made the box programmable. This tool is where
the two meet. The generative side does the writing; I just shape it.

The FM-1's pattern format was undocumented, so I mapped the SysEx write
(command 0x20, 8 steps per message, 177 bytes with a checksum) against the
Virtual-FM-1 emulator's source.

One seed generates a bank of 16 patterns. Same seed, same bank, every time.
The rhythm side is Gate density plus a Euclidean gradient: at 0% each step is
a coin flip, at 100% the hits sit at the evenest positions, and between the
two each step rolls which law it follows. Turn Gate to 37 with the loop at 8
steps and you get a tresillo; 62 gives a cinquillo, and a 16-step loop at 31
lands on son clave. A rotate knob shifts the pattern. Pitch has 9 LFO shapes,
including a Perlin contour. A Shape knob morphs each wave: folds the sine,
bends the ramps, narrows the square into a pulse. The quantizer covers 19
scales. The loop region is highlighted in the grid, and Deja Vu sets how often
the loop repeats itself instead of generating new notes.


Freeze writes the pattern into the FM-1's sequencer over Web MIDI. Every write
gets a read-back, so the app reports what the device actually stored. If the
sequencer is playing, the firmware refuses the write and the app says so.

The tempo knob on the unit is device-global. The firmware acknowledges tempo
bytes in a pattern write and then ignores them, so the app reads the real BPM
back and shows that instead. Bluetooth MIDI carries notes only on this
firmware: SysEx reads get no reply over BLE, writes do not land, and the app
plays over Bluetooth while Freeze stays on USB.

Banks export and import as JSON, the whole bank downloads as .syx for other
tools, there are five preview timbres in the browser, and the UI themes were
sampled from photos of the actual hardware.

Drop a comment if you try it, good or bad. I'll stick around for questions.

---

## Posting notes

- **Image rule:** r/synthesizers posts land better with media. Use a screenshot
  of the rack on a dark theme (purple reads best) or the video walkthrough as
  the post media, then put this text as the first comment.
- **Firmware is the first comment question.** The freeze needs Baud Girl /
  FM-1+VA; the title and first line already say it. Stock firmware users still
  get the live broadcaster.
- **Crossposts:** r/FMsynthesis (the FM angle), r/synthdiy (the
  reverse-engineering angle), r/wearethemusicmakers (Friday feedback thread
  only).
- Post from the phone's Reddit app, or wait for the laptop. Posting from here
  needs the laptop's Firefox session (cookie auth).
- Offer the from-zero demo as a follow-up comment, not in the body, so the post
  stays tight.

## Shorter version (for r/synthdiy crosspost lead)

Title: I mapped the M-VAVE FM-1's undocumented pattern format (Baud Girl /
FM-1+VA firmware) and built a free generative sequencer on it

Lead paragraph: command 0x20 writes 8 steps per 177-byte SysEx message; the
firmware acks each part and refuses while its sequencer plays; tempo bytes are
acked and discarded (device-global BPM lives at gset[66+2*pattern]); BLE routes
notes only, never the proprietary SysEx.
