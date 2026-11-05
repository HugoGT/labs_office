# Media publication and congestion profile (issue #281)

What the office publishes over LiveKit and how the SFU behaves under
congestion, with the reason for each value. The client side lives in
`src/game/livekitRoom.ts` (`createOfficeRoom`, `setScreenShareEnabled`), the
server side in `infra/gcp/livekit.yaml.tpl`. Tests pin both:
`src/game/livekitRoom.test.ts` and `server/src/livekitConfig.test.ts`.

Reference scenario: the Friday meeting, about 50 people in one space. Every
kbps a publisher sends is multiplied by up to 49 subscribers on the SFU's
outgoing side.

## Parameters

| Parameter | Value | Before | Why | Measured |
|---|---|---|---|---|
| `adaptiveStream` | on (`pixelDensity` SDK default) | same | Each tile pulls the simulcast layer its size needs and nothing while hidden. | No (kept from before) |
| `dynacast` | on | same | The publisher stops encoding layers nobody receives. | No (kept from before) |
| Microphone `audioPreset` | `AudioPresets.speech`, 24 kbps | `music`, 48 kbps | Voice loses nothing audible at 24 kbps Opus; half the bitrate leaves headroom on a bad network. DTX and RED stay at SDK defaults (on). | Pending |
| Microphone capture processing | browser `echoCancellation`, `noiseSuppression`, `autoGainControl`, `voiceIsolation` on, pinned in `OFFICE_AUDIO_CAPTURE` | same values, inherited from livekit-client defaults | Decision of #285, see "Noise suppression" below: no custom processor until a measurement asks for one. | No |
| Shared screen audio `audioPreset` | `AudioPresets.music`, 48 kbps | same | A shared video's soundtrack is not speech; it is rare, so its cost is small. | No |
| Screen share `contentHint` | `detail` | unset | The usual share is a document. `detail` tells the browser encoder to keep resolution and drop frame rate under pressure, so text stays legible. | Pending |
| Camera | 720p, VP8, simulcast 180p/360p/720p (SDK defaults) | same | No measurement yet justifies changing it. | No |
| Screen share video | 1080p, 15 fps, 2.5 Mbps plus a half-resolution layer (SDK defaults) | same | Same: `contentHint` first, the bitrate cap only if the measurement asks for it. | No |
| `rtc.congestion_control.enabled` | `true` | `true` (LiveKit default, now explicit) | Required for `allow_pause` to act. | No |
| `rtc.congestion_control.allow_pause` | `true` | `false` | When even a video's lowest layer does not fit a subscriber's estimated bandwidth, the SFU pauses that video instead of letting it starve the audio. Voice is worth more than video. | Pending |
| `room.max_participants` | `80` | unlimited | Safety brake above the expected office peak of 60 people (#287), so it stops a runaway and never a real meeting. An 81st join is refused by LiveKit. | No (not a cost lever) |

Discarded for now:

- VP9 with a VP8 backup: more encoding CPU on every publisher and an extra
  path to verify with Egress. Only worth it if the measurement below shows
  cameras, not shares, dominate the egress.
- Lower `adaptiveStream.pixelDensity`: the tiles of #280 are already small,
  so the 180p layer is what they pull; revisit only with a measurement.
- Lower screen share bitrate: it is about 125 Mbps of the estimated egress,
  but cutting it trades away legibility, the first acceptance criterion.

## Switching devices mid call (issue #288)

A microphone or camera picked during a call keeps its publication: every
switch goes through `switchDevice` in `src/game/livekitRoom.ts`, which calls
`room.switchActiveDevice`. livekit-client restarts the capture and hands the
new track to the same sender (`replaceTrack`), so subscribers keep receiving
without resubscribing. Never unpublish and publish again to change a device:
each subscriber would drop the track and subscribe to a new one.

- Muted track: the pick waits for the next unmute; no capture opens.
- Failed switch: livekit-client stops the old capture before opening the new
  one, so `switchDevice` switches back to the previous device and reports the
  failure. `useProximityAudio` then undoes the pick (shown, remembered and
  carried to the next room).
- Blurred camera: livekit-client restarts the processor on the new capture.
- The pick lives in `useProximityAudio`, not in the room, so a door or a room
  rebuild applies it again on connect.

Tests: `src/game/livekitRoom.browser.test.ts` (real LiveKit: same sid, muted,
failure, blur), `src/game/livekitRoom.test.ts`,
`src/hooks/useProximityAudio.test.ts` and the microphone switch scenario of
`e2e/two-client-audio.e2e.test.mjs`.

## Crossing a door (issue #286)

Each space is its own LiveKit room (recording and the single share per space
depend on it, #287), so a door still changes room. What it no longer does is
capture the microphone again:

- `useProximityAudio` owns one `SharedMicrophone` per visit
  (`src/game/livekitRoom.ts`). The room left lets go of the track without
  stopping it (`room.disconnect(false)`, every other track stopped by hand) and
  the next room publishes the same track, then unmutes it. Only one room
  publishes it at a time: a sender belongs to one peer connection.
- Muting stops the capture (`stopMicTrackOnMute`), so the system microphone
  indicator goes off, and unmuting captures again in the same publication. The
  cost is the time of that capture on each unmute and, on Bluetooth headsets,
  a switch of profile (HFP to A2DP and back) with an audible difference. A door
  crossed while muted carries no capture: the next room captures on unmute.
- Leaving the office and entering "No molestar" stop the capture too
  (`releaseMicrophone`, `releaseSharedMicrophone`).
- A capture LiveKit already stopped (a room lost for good) is captured again
  instead of being published dead. A microphone picked while the capture is
  published nowhere is applied to it before the next room publishes it.
- The server still decides which room a token is for; nothing changed there.

Measurement: each door reports `{ event: 'switched', durationMs }` (from
leaving the old room until the new one is connected and the microphone that
was on publishes again). The server keeps it in the
`office_media_switch_seconds` histogram and the dashboard panel "Corte de
audio al cruzar una puerta" shows its p50 and p95. Locally, with Chromium's
fake microphone (a capture that costs nothing), both versions measured about
150 ms p50 and 160 to 240 ms p95 over 30 doors each, so the gain on real
hardware, where a capture costs more, has to be read on the deployed VM.

Tests: `src/game/livekitRoom.browser.test.ts` (real LiveKit: same live track
published and heard in the next room, nothing captured again, released on
leaving and in "No molestar"), `src/game/livekitRoom.test.ts` and
`src/hooks/useProximityAudio.test.ts` (fast doors leave one live room and one
publishing room).

## Noise suppression (issue #285)

Decision: keep the browser's own voice processing and add no custom noise
processor for now. The office asks for it explicitly instead of inheriting it:
`OFFICE_AUDIO_CAPTURE` in `src/game/livekitRoom.ts` sets `echoCancellation`,
`noiseSuppression`, `autoGainControl` and `voiceIsolation` to `true` as the
room's `audioCaptureDefaults`. These equal livekit-client 2.22's defaults
(`src/room/defaults.ts`), so nobody hears a change today; the point is that a
livekit-client upgrade cannot silently change what every microphone sounds
like. There is no per-person control yet: nothing measured says anyone needs
one.

The values reach every capture the office makes, including the shared
microphone of #286: livekit-client restarts a capture (a device switch, for one)
with the constraints it was first captured with, and a
door publishes that same capture. A real-LiveKit browser test checks the
applied `getSettings()` at capture, after a switch and behind a door.

What each browser does with these flags differs, and is the reason this is
still open. They are hints (`ideal`), not requirements: a browser that does
not know `voiceIsolation` ignores it and keeps the call going.

### Options evaluated (from code and documentation, nothing measured)

| Option | Cost to add | Self-hosted LiveKit | Verdict |
|---|---|---|---|
| Browser processing (WebRTC APM in Chromium, the OS or browser pipeline elsewhere) | None: already on, now pinned | Yes, it runs before LiveKit | Kept |
| `@livekit/krisp-noise-filter` | One lazy dependency, `track.setProcessor` | Doubtful: its license is "SEE LICENSE IN https://livekit.io/legal/terms-of-service" and the 0.4.5 bundle is obfuscated (about 6 MB), so it cannot be reviewed; LiveKit's documentation presents its Krisp noise cancellation as a LiveKit Cloud feature (not re-checked for this decision). Confirm in writing with LiveKit before considering it | Discarded |
| Open models in an AudioWorklet (RNNoise, DTLN, DeepFilterNet), as `adventure` does | A WASM model (order of hundreds of KB to a few MB, not measured), a worklet and an audio `TrackProcessor`; `@livekit/track-processors` only ships a gain processor for audio | Yes, all client side | Discarded for now: unknown CPU on the office laptops, more latency, and a second path to keep alive on every capture restart and door |

Not reviewed: the internals, real cost and license of `adventure`'s
`NoiseSuppressionController`; any code or model taken from it needs its
license checked first.

### What would reopen it

A custom processor is worth adding only if a measurement shows both a problem
and a fix that fits a normal laptop. Run on two laptops the office actually
uses (one Windows with Chrome or Edge, one macOS with Chrome and Safari):

1. Problem: record 30 s of a real office scene (keyboard, a nearby
   conversation, a fan) as heard by a second participant, once per browser
   with the current profile. Reopen only if the noise is still clearly
   audible or speech is cut by the suppression.
2. Alternative: the same scene with one open model (DeepFilterNet or RNNoise)
   applied as a processor on the same capture, compared blind by two people.
3. CPU: Chrome's task manager or `chrome://tracing` for the tab, with and
   without the processor, over 5 minutes in a call. The bar: less than 5 % of
   one core more on the slower laptop.
4. Latency: the processor's frame size plus its lookahead, read from its
   documentation, confirmed by a clap recorded on both sides. The bar: under
   40 ms added.

If it passes, the issue's last criterion applies: load it lazily like
`backgroundBlur.ts`, offer it as an option in `MediaMenu`, and on any failure
remove the processor and keep publishing the browser-processed capture,
without unpublishing.

## Expected effect (estimate, not measured)

- Audio: with about 3 people talking at once, `speech` saves
  3 x 49 x 24 kbps, about 3.5 Mbps of SFU egress. Small next to the
  210-325 Mbps estimate of #287; the gain is robustness, not cost.
- `contentHint` does not change the cap: same bitrate, sharper text.
- `allow_pause` only changes what a congested subscriber loses (video before
  voice). It does not lower the egress of a healthy meeting.

## How to measure (manual, needs the deployed `test` VM)

Run each step once before and once after deploying this profile, and fill the
"Measured" column with the result.

1. Egress Mbps of the Friday scenario: in the Cloud Monitoring dashboard
   (`infra/gcp/terraform/dashboard.json.tftpl`), the rate of
   `livekit_packet_bytes` with `direction="outgoing"` during the meeting.
   Compare it with the October figure (120 Mbps with 6 cameras, #287).
2. Legible shared text: share a document with 11 to 12 px text and read it in
   another browser on a normal tile and in the enlarged view.
3. Audio with a 1 Mbps subscriber: on one subscriber, cap the link at 1 Mbps
   (for example `tc qdisc add dev <iface> root tbf rate 1mbit burst 32kbit
   latency 400ms` on a Linux client) inside a space with several cameras and
   a share. Speech must stay continuous while videos pause. Note: Chrome
   DevTools throttling does not apply to WebRTC.
4. Recordings: start and stop a recording of a space with a share and audio
   from the dashboard and play the file from the bucket. Egress subscribes like
   any client, so `speech` and `contentHint` reach it unchanged.
5. Door cut (#286): read p50 and p95 of the "Corte de audio al cruzar una
   puerta" panel over a working day with only the measurement deployed
   (commit `feat(audio): report the audio cut of each door crossed`), then
   over a day with the shared microphone.
