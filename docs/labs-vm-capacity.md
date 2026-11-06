# Labs VM capacity: Friday heavy days and stress test data

Last checked: 2026-11-06. Related issues in `HugoGT/labs_office`: #278 (recurring heavy machine), #274 (reproducible load test), #287 (umbrella).

## Summary

| Topic | Status |
|---|---|
| Friday runs on `e2-standard-8` | **Implemented** (#278): `HEAVY_WEEKDAYS = [5]` in `tools/vm/vmSchedule.ts`. `office-vm.sh status` on 2026-11-06 reported `machine type: e2-standard-8`. |
| `e2-standard-4`, 50 people, 5 cameras | **Measured** on 2026-10-13. Works with no headroom. |
| `e2-standard-8`, 60 people, 14 videos | **Measured and accepted** on 2026-11-06. Without recording: ~36% CPU. Recording: ~75% CPU sustained. Packet loss under 0.01% in both. |
| Colyseus, 60-200 moving clients | **Measured** on 2026-11-06, on a laptop only. Not a bottleneck. |

## Nightly runs and the Friday machine

Before #278, `machineTypeFor` in `tools/vm/vmSchedule.ts` only upsized the dates listed by hand in the `office-heavy-days` metadata. All 66 `vm-nightly` runs from 2026-10-13 to 2026-11-04 reported `e2-standard-4`, Fridays included. A one-off date can still be added by hand:

```sh
infra/gcp/scripts/office-vm.sh heavy add 2026-11-13
```

This only writes metadata and does not restart the VM. The machine type changes while the VM is stopped, on a nightly run. Mark the day before Thursday 20:00 Lima, when the schedule stops the VM.

### The nightly runs start hours late

The workflow is scheduled for 20:30, 23:30 and 02:30 Lima. The 30 runs from 10-26 to 11-04 started at these times instead:

| Daily run | Observed start (Lima) | Can it resize? |
|---|---|---|
| First | 01:43 to 03:27 | Yes |
| Second | 04:59 to 07:46 | Yes, unless it starts after the 07:45 VM start |
| Third | 08:29 to 12:21 | No on weekdays: the VM is already running |

On office days, only the first two runs can prepare the machine. The first has always been early enough so far, but GitHub may skip scheduled runs.

## Stress test of 2026-10-13

Run with `lk load-test` from a temporary GCE VM, since deleted. Before 2026-11-06 the results existed only in project memory and in #287.

**Setup:** `e2-standard-4` (4 vCPU), room `loadtest-presentation`, 44 subscribers, 6 video publishers (5 cameras and 1 standing in for the screen share), 5 audio publishers, speaker layout, 11 minutes. Room composite recording ran from minute 3 to minute 9.

| Metric | Without recording | While recording |
|---|---|---|
| LiveKit CPU | ~2.5 vCPU | 1.65 vCPU (squeezed) |
| Egress CPU | n/a | ~2.4 vCPU |
| Host idle | 26% | 1% |
| Load average | not recorded | 14.5 |

| Metric | Result |
|---|---|
| Audio packet loss | 0% (220 tracks) |
| Video packet loss | 0.098% average, 1.05% maximum |
| Traffic to subscribers | 120 Mbps total, 2.7 Mbps each |
| Recording | 720p30, no frame gaps, ~1.2 GB/h |

**Conclusion of that test:** it works on `e2-standard-4` with no headroom, and `e2-standard-8` is recommended for the meeting.

## Stress test of 2026-11-06 (`e2-standard-8`)

Run with `tools/loadtest/meeting-load.sh` (procedure below) from a temporary `e2-standard-8` generator in `us-central1-a`, since deleted. Office VM on `e2-standard-8`, during office hours with nobody else in the office.

**Load in one space (`office-livekit-space-b38b7f77-…`):**

| Source | Publishes |
|---|---|
| 71 `lk` bots | 11 videos at `high` with simulcast (5 with audio), 60 subscribers |
| 2 real browsers | A 1920x1080 screen share, two 720p cameras, two microphones |

That is 14 videos and a real 1080p share, against the 6-8 cameras expected at the Friday meeting. The bot standing in for the screen share stayed on, so the scenario carried one video more than planned.

| Metric | Phase 1, no recording (15 min) | Phase 2, recording (10 min) |
|---|---|---|
| Bots connected | 71/71, no errors | 71/71, no errors |
| Tracks received by the 60 subscribers | 1380 (16 bot tracks + the browsers' tracks each) | 1260 |
| Traffic to subscribers | 141 Mbps, 2.4 Mbps each | 157 Mbps, 2.6 Mbps each |
| Packet loss, total | 0.007% | 0.006% |
| Audio packet loss | 0% | 0% |
| Worst video track | 0.08% | 0.075% |
| LiveKit CPU | 2.6-3.0 vCPU, peak 3.3 on the mass join | 3.0 vCPU average, 3.5 max |
| Egress CPU | ~0 | 3.0 vCPU average, 4.1 max |
| Host idle | **64% average, 54% minimum** | **25% average, 8% minimum** |
| Load average (1 min) | 2-4 | up to 12 |
| Colyseus container | 0.4% | 0.4% |
| Generator CPU (us+sy) | 26% max | 32% max |

How to read it:

- **Without recording, the machine has ample headroom:** ~3 of 8 vCPU for 14 videos and a 1080p share.
- **Recording doubles the CPU:** Egress costs about as much as LiveKit. 51 of 54 samples had less than 30% idle, so sustained CPU (~75%) is above the < 70% proposed in #274. Quality did not suffer: loss stayed under 0.01%.
- **Accepted on 2026-11-06:** ~75% while recording is acceptable, since the real meeting is expected to carry less traffic than this test (6-8 cameras against 14 videos). This closes #274 and #287.
- **Video loss came from the publishers, not the SFU:** every lost packet on a track was lost in the same amount by all 60 subscribers, so it happened before LiveKit fanned it out, most likely on the browsers' home uplink.
- **The generator never saturated,** so the numbers measure the office VM.
- **The phase 1 `lk` summary includes 2.5 minutes of recording** (16:49:40 to 16:52:10 Lima), started from the app by mistake. The idle figures above exclude that window.

**Not covered:** TURN/TLS through Caddy (both browsers connected directly), browser-side quality between real browsers beyond what the two testers saw, and the meeting's 6-8 cameras exactly. Egress admission does not account for the CPU LiveKit is using, so a recording can start even when the host has no room for it.

## Stress test procedure

**Scenario:** 60 people in one room on `e2-standard-8`.

| Group | People | Publishes |
|---|---|---|
| Presenter | 1 | Camera, microphone, screen share |
| Speakers | 4 | Camera, microphone |
| Camera only | 5 | Camera |
| Viewers | 50 | Nothing |

### Why not only a JS load testing library

For WebRTC, k6 and Artillery both end up driving real browsers. Artillery advises planning for [1 vCPU per virtual user](https://artillery.io/docs/playwright), so 60 users need about 60 vCPU just to generate load. A saturated generator would look like a LiveKit failure. No official k6 documentation on WebRTC was found.

### Bots and real browsers

`lk perf load-test` carries the volume. [The first participants publish both audio and video](https://docs.livekit.io/reference/developer-tools/livekit-cli/perf/), which matches the groups above:

| Group | Bots |
|---|---|
| Presenter | 1 with video and audio, plus 1 with video only standing in for the screen share |
| Speakers | 4 with video and audio |
| Camera only | 5 with video only |
| All 60 people, as receivers | 60 subscribers |

There are 60 subscribers because the 10 people publishing also receive in the real meeting. Bot publishers are separate participants and subscribe to nothing (checked on 2026-11-06 against a local LiveKit with `lk` 2.19.0: 2 video publishers and 3 subscribers made 5 participants, and only the subscribers received tracks), so the room holds 71 bots.

Two or three people in real browsers add what the bots do not cover: a real 1080p screen share and real cameras. Bot subscribers receive their tracks too, so the SFU fans them out to all 60.

Limits:

- The app only subscribes to peers it knows through Colyseus, and the bots do not go through it. Browser-side quality can only be judged between real browsers.
- The bot standing in for the screen share publishes 720p, not 1080p.

### How to run it

`tools/loadtest/meeting-load.sh` runs the bots from a temporary GCE VM and samples the office VM. It needs `gcloud` logged in with access to the instance, Secret Manager and firewall rules, and `lk` locally only for `rooms`.

1. Start the office VM on `e2-standard-8`. After 20:00 Lima the schedule has stopped it: `infra/gcp/scripts/office-vm.sh start --size e2-standard-8 --for 2h`.
2. `tools/loadtest/meeting-load.sh generator up`.
3. Two or three people sign in from real browsers and walk into the meeting space. One shares a 1080p screen. Then `meeting-load.sh rooms` shows the space's room, `office-livekit-space-<id>`.
4. Phase without recording, in two terminals at the same time:

   ```sh
   tools/loadtest/meeting-load.sh run --room office-livekit-space-<id> --phase no-recording --real-share
   tools/loadtest/meeting-load.sh sample --phase no-recording
   ```

5. When phase 1 ends, start the recording from the app, then repeat step 4 with `--phase recording`. Each phase starts 71 bots at 2 per second, so each also measures a mass join. Do not record during phase 1: its `lk` summary covers the whole phase.
6. Stop the recording, then `meeting-load.sh generator down`. Results are in `~/labs-loadtest` (`LOADTEST_OUT`).

Drop `--real-share` if no browser shares the screen: a bot then stands in for it. Each phase is 15 minutes (`--duration`).

**Read the results:** the `lk` summary gives packet loss and bitrate per subscriber; the generator's `vmstat` at the end of the log must stay well below 100% CPU, or the run measured the generator. The `sample` log gives host idle, load average and CPU per container (LiveKit, Egress). In the browsers, note any audio cut or frozen video.

### Colyseus: 60 moving clients

`tools/loadtest/colyseus-load.ts` joins N clients to the office room. Each walks a small circle and sends one `move` every `--interval` ms (200 by default; the client sends every 100 ms while walking). The server exposes no event loop metric, so the script measures what a person feels: the time from sending a `move` until the room's state brings that position back. That includes the 50 ms patch rate, event loop lag and the network.

```sh
node tools/loadtest/colyseus-load.ts --local --clients 60 --duration 5m
```

`--local` starts an isolated `server/src/main.ts` with local auth and 60 generated accounts, no database and no LiveKit, and samples its CPU. It never touches the deployed office. One account cannot stand in for 60: a second join of the same uid replaces the first (`replaceOtherSessionsOf` in `OfficeRoom.ts`).

It does not measure the deployed server: that needs 60 provisioned accounts, because login there fails closed.

**Results (2026-11-06, developer laptop, not a GCE VM):** every client joined, none dropped and no `move` went unanswered.

| Clients | Move every | Echo p50 / p99 / max | Server CPU (one core) |
|---|---|---|---|
| 60 | 200 ms | 34 / 51 / 53 ms | 1-3% |
| 60 | 100 ms | 19 / 52 / 57 ms | 3-5% |
| 200 | 100 ms | 27 / 55 / 59 ms | 5-7% |

The echo stays at the 50 ms patch rate even with 200 clients, so the room adds no visible delay at this scale. During the 2026-11-06 stress test the deployed Colyseus container stayed at 0.4% CPU.

## Next steps

Optional, not blocking:

1. Watch host idle in the Cloud Monitoring dashboard during a real recorded Friday meeting.
2. Cover TURN/TLS through Caddy with one browser on a network that blocks UDP.
