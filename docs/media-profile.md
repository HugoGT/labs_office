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
