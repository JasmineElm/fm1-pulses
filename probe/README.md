# probe/ — BLE-MIDI verification ladder

Throwaway page for **R1/R2** of [`../notes/BLUETOOTH-PLAN.md`](../notes/BLUETOOTH-PLAN.md).
It does not touch the app.

**Open on the phone (Chrome):** https://mene311.github.io/fm1-pulses/probe/ble.html

## What it answers

| Step | Button | Question |
|---|---|---|
| 2 | 1 · Connect Bluetooth | Does the FM-1 expose the BLE-MIDI GATT service? |
| — | 2 · Note on/off | Does the pipe carry MIDI at all? |
| 4 | 3 · Read SysEx `0x11` | **R1** — does BLE route the *proprietary* parser, not just voice dumps? |
| 5 | 4 / 5 · `0x20` write | **R2** — does a 177-byte message survive BLE (10 packets @ MTU 23)? |

Key point: **any** reply to step 3 answers R1, even `status 1` (out of range) or
`status 3` (sequencer playing) — it proves the firmware's proprietary SysEx
handler saw our bytes. Step 5 additionally needs `status 0`.

Before connecting: make sure nothing else holds the FM-1 (Android MIDI service,
another app). Toggle the FM-1's BT off/on so it advertises, then allow the
chooser. If the name filter finds nothing, use **Connect (show all devices)**.

## encode.js

`encode.js` is DOM-free and Bluetooth-free on purpose: it is the byte-level half
of the eventual `BleTransport` (plan §"A transport seam"), and it can be run
under node for testing.

Verified (2026-10-03):
- `encodeWrite()` / `testPattern()` output is **byte-identical** to the verified
  Python encoder `mvave-fm1/fm1pat.py` (`encode_write`), 2 × 177 bytes.
- `packetize()` → 10 packets, all ≤ 20 bytes (MTU-23 safe).
- `createSysexReassembler()` + `decodeReply()` round-trip byte-exact for reply
  lengths 0/20/127/128/179/**180**, at **all 217** possible packet split points.

### Latent bug found while testing

`decodeReply()` reads the reply length as `buf[7] | (buf[8] << 7)` — **not**
`<< 8` as `js/midi.js` and `mvp/fm1tool.c` both do. With `<< 8` a length ≥ 128 is
unrepresentable (180 would need a `0xB4` group, illegal in a 7-bit field).
Harmless in both — neither actually uses the value — but it is wrong, and every
other field in this protocol is 7-bit LSB-first groups.
