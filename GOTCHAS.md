# FM-1 Pulses — Known Gotchas & Mitigations

Technical pitfalls discovered during research. Read before coding.

---

## 🔴 CRITICAL

### 1. JavaScript Timer Jitter

**Problem**: `setTimeout`/`setInterval` can deviate by **tens of milliseconds** due to garbage collection, layout, rendering, or any main-thread work. Worse on mobile (Android).

**Impact**: Notes fire late or with uneven spacing. Audible as rhythmic "wobble" or outright missed steps at high BPM/rates.

**Mitigation**: Lookahead scheduler pattern.
- Use `setInterval(tick, 25)` as a "revision tick" — not to send notes, but to check what needs scheduling.
- Schedule MIDI events with **future timestamps** using `MIDIOutput.send(data, timestamp)` where `timestamp` is `performance.now() + offset`.
- Lookahead window: ~100ms. Tick interval: 25ms. This means we're always scheduling notes 75-100ms ahead.
- The MIDI output buffer in Chrome handles precise delivery from timestamps; we don't need JS to be precise, just to schedule on time.

**Source**: Chris Wilson's "A Tale of Two Clocks" (web.dev), Web Audio scheduling tutorials, Tone.js timing issues.

```
Reference:
- https://web.dev/articles/audio-scheduling
- https://github.com/cwilso/metronome (canonical lookahead example)
- https://github.com/Tonejs/Tone.js/issues/805
```

### 2. MIDI send() is Async and Silently Drops Messages

**Problem**: `MIDIOutput.send()` uses internal Chrome buffers (~256KB per SysEx, ~10MB in-flight total). If you flood it, messages are **silently dropped** with no error, no callback, no event.

**Impact**: Missing notes in dense sequences. No way to detect the loss.

**Mitigation**: Never send bursts. Each note gets its own `send(data, timestamp)` call with a proper future timestamp. Chrome's internal buffer queues and delivers in order. For our use case (Note On/Off + occasional CC), we're sending ~3-6 bytes per step at max rate — nowhere near the buffer limit.

**Source**: WebAudio/web-midi-api issue #158 (backpressure discussion).

### 3. BLE MIDI Latency & Jitter (USB Preferred)

**Problem**: BLE MIDI has **10-30ms base latency** plus jitter. At 120 BPM, rate 1/32, each step is ~156ms — BLE jitter becomes a noticeable percentage. At 200 BPM, 1/32 = 94ms steps — BLE jitter can cause steps to overlap or miss.

**Impact**: Loose timing, especially at fast rates. Not suitable for tight rhythmic patterns.

**Mitigation**:
- **USB MIDI is the default and recommended transport.** The UI should indicate USB as preferred.
- BLE is available as a "wireless" option with a disclaimer about latency.
- If BLE is the only option, recommend slower rates (1/8, 1/16) and lower BPM for acceptable timing.
- Future: if we add MIDI Clock output, BLE will struggle even more — USB only for clock sync.

**Decision**: The FM-1 supports USB, BLE, and TRS MIDI simultaneously. From Android, USB OTG is the reliable path. BLE is a convenience fallback.

```
Reference:
- M-VAVE manual: "Three MIDI interfaces are active simultaneously"
- Our android-capabilities.md: "BLE jitter is worse than wired for tight patterns"
```

---

## 🟡 IMPORTANT

### 4. Tab Throttling (Chrome Background Timer Kill)

**Problem**: When a Chrome tab loses focus, `setInterval` is throttled to **max 1Hz** (1 tick per second). The sequencer silently stops or stutters.

**Impact**: Sequencer dies when user switches tabs. No warning.

**Mitigation**:
- Run the timer in a **Web Worker**. Workers are NOT throttled by tab focus.
- Main thread handles UI + MIDI send. Worker handles the clock tick.
- Communication via `postMessage` (adds ~1ms overhead, acceptable).
- Alternative: use `document.onvisibilitychange` to detect tab switch and compensate by scheduling a burst of future events. Less reliable than Workers.

```
Architecture:
  Worker (timer tick, 25ms) ──postMessage──▶ Main (MIDI send with timestamps)
```

```
Reference:
- Chris Wilson metronome: https://github.com/cwilso/metronome
  (uses Worker setTimeout to avoid throttling)
```

### 5. HTTPS Required for Web MIDI

**Problem**: `navigator.requestMIDIAccess()` only works in secure contexts. `file://` URLs do NOT work.

**Impact**: Can't test by double-clicking index.html. Must serve over HTTP(S).

**Mitigation**:
- GitHub Pages provides HTTPS automatically.
- Local development: `python3 -m http.server 8080` or any local server.
- `localhost` is treated as secure by Chrome, so local testing works.
- Document this in README: "Do not open as file:// — use a local server."

### 6. Web MIDI Permission Prompt

**Problem**: Chrome shows a one-time permission dialog for MIDI access. If denied, `requestMIDIAccess` returns an empty `MIDIAccess` object — no outputs, no error. Can't re-prompt without page reload.

**Impact**: User might deny permission, then wonder why no sound comes out.

**Mitigation**:
- Detect `midiAccess.outputs.size === 0` after permission.
- Show clear UI: "No MIDI devices found. Check Chrome permissions: Settings → Site Settings → MIDI."
- Add a "Retry" button that reloads the page.
- On first visit, show a brief explainer before requesting permission.

### 7. MIDI Message Ordering with Same Timestamp

**Problem**: If two messages are sent with the **exact same timestamp**, their delivery order is not guaranteed by the spec. Chrome may reorder them.

**Impact**: Note On arriving after CC = wrong patch state at note start. Or Note Off before Note On = stuck notes.

**Mitigation**: When sending multiple messages for the same step, offset timestamps by 0.1ms:
```
send(noteOn,  t)       // 0.0ms
send(cc,      t + 0.1) // 0.1ms later
```
For our simple case (Note On + maybe 1 CC per step), this is sufficient.

```
Reference:
- WebAudio/web-midi-api issue #212 (ordering of same-timestamp messages)
```

### 8. FM-1 MIDI Channel Discrepancy

**Problem**: Official manual says Note Channel default is ch2 (Omni). Our MVP testing (2026-09-30) found FM-1 accepts notes on **ch1 only** under Baud Girl firmware. Stock firmware may behave differently.

**Impact**: Wrong channel = no sound. Silent failure.

**Mitigation**:
- Default to **ch1** (verified by MVP).
- Make channel selection prominent in UI (not buried in settings).
- Include a "Test" button that sends a single note to verify connection.
- Document: "If no sound, try switching MIDI channel. Baud Girl fw = ch1, stock fw may be ch2."

---

## 🟢 MINOR (Good to Know)

### 9. AudioContext for Precision Clock (No Audio Needed)

**Problem**: We don't generate audio (FM-1 does that), but `performance.now()` alone isn't enough for stable scheduling.

**Mitigation**: Create a bare `AudioContext` (no nodes connected). Use `audioContext.currentTime` as the precision reference for the lookahead scheduler. It runs on a separate thread tied to the audio hardware clock — immune to main-thread jitter. Don't connect any nodes; just use the clock.

### 10. localStorage Limits

5MB per origin. Our state (all parameters + 64-step buffer) is ~1KB. No concern. 5 save slots = ~5KB total.

### 11. PWA Service Worker Cache Staleness

**Problem**: SW caches assets. After update, users see old code until SW refreshes.

**Mitigation**: Version the cache name. On `activate`, delete old caches:
```js
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
});
```

### 12. Mobile Chrome USB MIDI Enumeration Quirks

**Problem**: Some Android devices + USB OTG cables enumerate MIDI devices in native apps but NOT in Chrome. Documented with specific phone/cable combinations. The FM-1's VID:PID `4c4a:c755` is class-compliant, but Chrome's Web MIDI implementation has had issues with certain USB chipsets.

**Impact**: User connects FM-1 via USB OTG, Chrome sees nothing. Native apps (MIDI Commander, etc.) work fine.

**Mitigation**:
- This is the **primary risk** for USB-first approach.
- Test early on the Xiaomi 14t (our target device).
- Fallback chain: USB OTG → BLE MIDI → "Connect via desktop Chrome"
- Show troubleshooting flowchart in UI if no device detected:
  1. Is the FM-1 powered on?
  2. Is the OTG cable working? (test with another device)
  3. Try disconnecting and reconnecting
  4. Try BLE MIDI instead
  5. Try desktop Chrome (USB usually works on desktop)
- Document known working OTG cables/adapters if we find compatibility issues.

```
Reference:
- Our android-capabilities.md: "Not every phone/OTG cable enumerates MIDI"
- Stack Overflow: Android Chrome MIDI device detection varies by hardware
```

---

## Decision Log

| Decision | Rationale |
|---|---|
| USB MIDI default, BLE fallback | BLE jitter too high for tight rhythms. USB is reliable on the FM-1. |
| Lookahead scheduler with Web Worker timer | Avoids JS timer jitter AND tab throttling. |
| AudioContext as clock reference | Hardware-precision clock, separate thread, no audio output needed. |
| Channel default = ch1 | Verified by MVP on Baud Girl firmware. |
| No SysEx in v1 | Complex, device-specific, can be added later. |
| GitHub Pages deployment | Free HTTPS, static hosting, no build step. |

---

## Testing Priority

1. **USB MIDI enumeration on Xiaomi 14t** — do this FIRST. If Chrome can't see the FM-1 via USB OTG, we need to pivot to BLE or desktop-first.
2. **Lookahead scheduler accuracy** — record MIDI output, measure timing jitter.
3. **BLE latency measurement** — compare USB vs BLE timing on the same sequence.
4. **Tab throttling** — verify Worker timer survives tab switch.
5. **Permission flow** — test deny → retry UX.