# Reddit launch post — FM-1 Pulses

## Primary: r/synthesizers (then crosspost r/FMsynthesis, r/synthdiy)

### Title

I built a free generative sequencer for the M-VAVE FM-1 — it generates 16
patterns and freezes them straight into the synth's own sequencer

### Body

Link: https://mene311.github.io/fm1-pulses/ — runs in Chrome, phone or desktop,
no install, no accounts. Repo: https://github.com/mene311/fm1-pulses

The FM-1 is a cheap 6-op FM box with a 64-step sequencer, and its pattern format
is undocumented. I reverse-engineered the SysEx write (command 0x20, 8 steps per
message, 177 bytes, checksummed) against the Virtual-FM-1 emulator's source and
built a generative sequencer on top of it. It works like a small Eurorack chain:
clock, gate, LFO, quantizer, buffer.

What it does:

- A handful of knobs generates a bank of 16 patterns from one seed. Same seed,
  same bank, every time.
- Rhythm: Gate density plus a Euclidean gradient — 0% is a coin flip per step,
  100% is even spacing (tresillo at 3 hits over 8 steps, cinquillo, son clave),
  everything between mixes the two. A rotate knob shifts the pattern.
- Pitch: 9 LFO shapes including a Perlin contour, plus a Shape knob that morphs
  each wave — folds the sine, bends the ramps, narrows the square into a pulse.
- Quantizer with 19 scales, a loop region you can see highlighted in the grid,
  and Deja Vu (how often the loop repeats itself instead of generating new notes).
- Press Freeze and the pattern lands in the FM-1's sequencer over Web MIDI.
  Every write is confirmed with a read-back, so the app tells you what the
  device actually stored — including the "sequencer is playing" refusal instead
  of failing silently.

Stuff I found while reverse-engineering, for the other FM-1 owners:

- BPM is device-global. The firmware acknowledges the tempo bytes in a pattern
  write and then ignores them. The app reads the unit's real BPM and syncs to
  it, so the knob always shows what the box will play.
- Bluetooth MIDI is notes-only on this firmware. SysEx reads get no reply and
  writes don't land over BLE. The app plays over Bluetooth and freezes over USB.

Also: banks export/import as JSON, the whole bank downloads as .syx for other
tools, five browser preview timbres, and the UI themes are sampled from the
hardware's actual case colors.

I'll post a video walkthrough in the comments if anyone wants one. Ask me
anything about the SysEx format or the firmware quirks.

---

## Posting notes

- **Image rule:** r/synthesizers posts land better with media. Use a screenshot
  of the rack on a dark theme (e.g. the purple one) or the showcase video as the
  post media, then put this text as the first comment.
- **Crossposts:** r/FMsynthesis (the FM angle), r/synthdiy (the
  reverse-engineering angle — lead with the SysEx table and the firmware
  findings there), r/wearethemusicmakers (Friday feedback thread only).
- Post from the phone's Reddit app, or wait for the laptop — posting from here
  needs the laptop's Firefox session (cookie auth), and it is offline right now.

## Shorter version (for r/synthdiy crosspost lead)

Title: I mapped the M-VAVE FM-1's undocumented pattern format and built a free
generative sequencer on it

Lead paragraph: command 0x20 writes 8 steps per 177-byte SysEx message; the
firmware acks each part and refuses while its sequencer plays; tempo bytes are
acked and discarded (device-global BPM lives at gset[66+2*pattern]); BLE routes
notes only, never the proprietary SysEx.
