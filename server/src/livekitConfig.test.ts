/**
 * The deployed LiveKit publication and congestion profile (#281), pinned by
 * source text like `observability/metricsExposure.test.ts`: the template is
 * only read by LiveKit on the VM, so nothing else would notice a key dropped.
 * Values and their reasons live in `docs/media-profile.md`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = () => readFileSync(new URL('../../infra/gcp/livekit.yaml.tpl', import.meta.url), 'utf8');

describe('deployed LiveKit congestion profile (#281)', () => {
  it('lets the SFU pause a video before the audio of a subscriber without bandwidth', () => {
    expect(template()).toMatch(/\nrtc:\n(?: .*\n|\n)*? {2}congestion_control:\n {4}enabled: true\n {4}allow_pause: true\n/);
  });

  it('caps each room above the expected peak as a safety brake', () => {
    expect(template()).toMatch(/\nroom:\n {2}max_participants: 80\n/);
  });
});
