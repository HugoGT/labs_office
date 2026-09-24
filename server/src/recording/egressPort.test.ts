import { describe, expect, it } from 'vitest';
import { RECORDING_LAYOUT, egressFromEnv, gcsFileOutput, livekitApiUrlFrom } from './egressPort.ts';

const COMPLETE = {
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'secret',
  RECORDING_GCS_BUCKET: 'labs-office-test-recordings',
};

describe('livekitApiUrlFrom', () => {
  it('prefers LIVEKIT_API_URL when set', () => {
    expect(
      livekitApiUrlFrom({ LIVEKIT_API_URL: 'http://livekit:7880', LIVEKIT_URL: 'wss://x.example.com' }),
    ).toBe('http://livekit:7880');
  });

  it('derives the HTTP URL from LIVEKIT_URL (ws -> http, wss -> https)', () => {
    expect(livekitApiUrlFrom({ LIVEKIT_URL: 'ws://localhost:7880' })).toBe('http://localhost:7880');
    expect(livekitApiUrlFrom({ LIVEKIT_URL: 'wss://av.example.com' })).toBe('https://av.example.com');
  });

  it('falls back to the local stack, same default as the token route', () => {
    expect(livekitApiUrlFrom({})).toBe('http://localhost:7880');
  });
});

describe('egressFromEnv', () => {
  it('builds an adapter when every required variable is present', () => {
    expect(egressFromEnv(COMPLETE)).not.toBeNull();
  });

  it.each(Object.keys(COMPLETE))('returns null without %s', (missing) => {
    const env: Record<string, string> = { ...COMPLETE };
    delete env[missing];
    expect(egressFromEnv(env)).toBeNull();
  });
});

describe('gcsFileOutput', () => {
  it('uploads the MP4 to that GCS bucket under the server-chosen key', () => {
    const file = gcsFileOutput('labs-office-test-recordings', 'recordings/sala/1-abc.mp4');

    expect(file.filepath).toBe('recordings/sala/1-abc.mp4');
    expect(file.output.case).toBe('gcp');
    expect(file.output.value).toMatchObject({ bucket: 'labs-office-test-recordings' });
  });

  it('sends no credentials: Egress falls back to its own Application Default Credentials', () => {
    const file = gcsFileOutput('b', 'k.mp4');

    expect(file.output.case === 'gcp' && file.output.value.credentials).toBe('');
  });
});

describe('RECORDING_LAYOUT (#20)', () => {
  it('stays grid: the Egress template itself turns grid into speaker while a screen share is up', () => {
    // livekit/egress v1.14.1 template-default/src/Room.tsx swaps `grid` for
    // `speaker` whenever a screen share is subscribed, and `speaker` puts the
    // share in the focus area with the cameras in a side carousel. `speaker`
    // here would also make every recording WITHOUT a share speaker-focused.
    expect(RECORDING_LAYOUT).toBe('grid');
  });
});
