import { ParticipantInfo, TrackInfo, TrackSource } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { moderationFromEnv, unmutedMicrophones } from './livekitModeration.ts';

describe('moderationFromEnv (#282)', () => {
  it('builds an adapter with the LiveKit API credentials', () => {
    expect(moderationFromEnv({ LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' })).not.toBeNull();
  });

  it('is null without either credential: the route answers 503', () => {
    expect(moderationFromEnv({ LIVEKIT_API_KEY: 'devkey' })).toBeNull();
    expect(moderationFromEnv({ LIVEKIT_API_SECRET: 'secret' })).toBeNull();
  });
});

describe('unmutedMicrophones (#282)', () => {
  it('lists each open microphone with its owner, skipping muted ones, cameras and screen audio', () => {
    const participants = [
      new ParticipantInfo({
        identity: 'ana',
        tracks: [
          new TrackInfo({ sid: 'TR_mic', source: TrackSource.MICROPHONE, muted: false }),
          new TrackInfo({ sid: 'TR_cam', source: TrackSource.CAMERA, muted: false }),
          new TrackInfo({ sid: 'TR_screen_audio', source: TrackSource.SCREEN_SHARE_AUDIO, muted: false }),
        ],
      }),
      new ParticipantInfo({
        identity: 'bea',
        tracks: [new TrackInfo({ sid: 'TR_muted', source: TrackSource.MICROPHONE, muted: true })],
      }),
    ];

    expect(unmutedMicrophones(participants)).toEqual([{ identity: 'ana', trackSid: 'TR_mic' }]);
  });
});
