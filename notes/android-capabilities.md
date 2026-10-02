# FM-1 on Android — capabilities & limits (2026-09-30)

Researched while the FM-1 was plugged into the phone (Xiaomi 14t, Android 14, SDK 34).
Device confirmed present: `termux-usb -l` -> `/dev/bus/usb/001/003`,
VID:PID `4c4a:c755`, Product `FM-1`, Serial `415035443333360F`.

## Verdict: YES, Android works — with caveats

The FM-1 is **USB class-compliant** (no drivers). M-VAVE states Windows/Mac/iOS/Android
support. Our phone reports the required platform features:

```
pm list features | grep -i midi
  feature:android.software.midi       <- platform MIDI stack present
  feature:android.hardware.usb.host   <- can act as USB host (OTG)
  feature:android.hardware.usb.accessory
```

Android ships a native MIDI stack since 6.0 (Marshmallow), MIDI 2.0 over USB since 13.
Chrome for Android has Web MIDI (Chrome 43+); current Chromium removed the legacy
USB-API Android backend now that the native MIDI API is universal.

## Three transports, all usable from Android

| Transport | Android? | Notes |
|---|---|---|
| **USB-C** | Yes, via OTG | Class-compliant. Also carries audio + firmware update (SysEx). |
| **BTLE MIDI** | Yes | Android has BLE-MIDI in the native stack. |
| **3.5mm TRS MIDI IN** | Not directly | Phone has no TRS jack; would need an OTG MIDI interface. |

All three are active simultaneously per M-VAVE.

## What works on Android

1. **Play it / drive it as a sound module** — any Android MIDI app (MIDI Commander,
   Syx-Lib, etc.) or a Web MIDI page. Note on/off + velocity, pitch bend, program change.
2. **Send DX7 banks to it** — `fm1-editor.com` in **Chrome for Android** over USB OTG.
   The editor explicitly says "Connect the FM1 over USB or MIDI, switch MIDI online on,
   select its input and output in Settings." Requires the **SysEx permission prompt**
   (see below).
3. **Firmware flashing via MIDI SysEx** — in principle the same SysEx channel works
   (`0x01` verify -> `0x02` upgrade mode -> `0x03` chunks). Baud Girl install page is
   Chrome/WebMIDI; M-VAVE uses M-UPGRADE desktop. Not proven from Android; treat as
   experimental. **Do not risk a flash from a phone** — a dropped USB link mid-flash
   has no recovery path (no DFU, no buttons, no JTAG).

## SysEx is the critical caveat

- Web MIDI access is **gated behind a permission prompt** since Chrome 124, and
  `sysex: true` is part of that bundled prompt.
- Access is **HTTPS-only** (or localhost). `fm1-editor.com` is HTTPS, so it qualifies.
- On Android Chrome the SysEx prompt works (confirmed in the wild: Yamaha Reface DX
  users send `.syx` from Android Chrome / Syx-Lib). Grant it when prompted.
- If it fails: disconnect, reconnect, re-allow. The editor shows
  "SysEx access unavailable" when denied.

## The real blocker: Android is not a reliable host for this

- **Termux and Chrome fight over the device.** Once the Termux:API USB permission is
  granted, the device is claimed by Termux. Close/release the callback before opening
  Chrome, or Chrome will not enumerate it as a MIDI port.
- **Android 12+ locks USB sysfs** — `/sys/bus/usb/devices` is unreadable from Termux,
  which is why identification had to be done via the `termux-usb` fd + libusb
  `wrap_sys_device`.
- **Not every phone/OTG cable enumerates MIDI.** Reports of devices recognised by a
  native app but invisible to Chrome's MIDI port map. Cable quality matters.
- **No readback, everywhere.** The FM-1 cannot dump firmware, presets, or patterns
  over any transport. Android changes nothing here.

## Practical phone workflow (recommended)

1. FM-1 -> USB-C -> OTG -> phone. Accept the Android USB permission dialog.
2. For **playing**: any MIDI app or BLE-MIDI. Easiest path, zero setup.
3. For **banks**: close Termux's USB claim first, open `fm1-editor.com` in Chrome
   (not WebView), grant MIDI + SysEx when prompted, pick FM-1 in/out, send bank,
   then **hold SAVE** on the device to write.
4. For **firmware**: use the laptop, Chrome, wired. Not the phone.

## Android MIDI apps worth having

- **Syx-Lib** — send/receive SysEx files to class-compliant USB MIDI devices (Android 6+).
- **MIDI Commander** — broader MIDI util, has a "send MIDI file" path.
- Anything speaking standard MIDI for note/CC program changes.

## Sources

- M-VAVE downloads (firmware + MIDI CONTROL docs): m-vave.com/download
- FM-1 manual (SysEx bank save, three MIDI interfaces): manuals.plus/m-vave/sk15-fm-1
- Browser librarian: fm1-editor.com
- Android MIDI platform docs: source.android.com/docs/core/audio/midi
- Chromium: Web MIDI USB-API Android backend removed; permission gating since Chrome 124
- RE/protocol: github.com/aroum/fm1-custom-fw (SysEx commands 0x01-0x04, 0x58 ACK)
