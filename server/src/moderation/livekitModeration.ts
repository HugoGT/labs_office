/**
 * `RoomModerationPort` over LiveKit's RoomService (#282). Deliberately thin
 * and untested against a real server, like `recording/egressPort.ts`; the
 * only logic, which tracks count as an open microphone, is
 * `unmutedMicrophones`.
 */

import { RoomServiceClient, TrackSource, type ParticipantInfo } from 'livekit-server-sdk';
import { livekitApiUrlFrom, type RecordingEnv } from '../recording/egressPort.ts';
import type { PublishedMicrophone, RoomModerationPort } from './moderationPort.ts';

export function unmutedMicrophones(participants: readonly ParticipantInfo[]): PublishedMicrophone[] {
  return participants.flatMap((participant) =>
    participant.tracks
      .filter((track) => track.source === TrackSource.MICROPHONE && !track.muted)
      .map((track) => ({ identity: participant.identity, trackSid: track.sid })),
  );
}

/**
 * `null` without the API credentials (the route answers 503). Read per
 * request, like the LiveKit credentials of `/livekit/token`.
 */
export function moderationFromEnv(
  env: Pick<RecordingEnv, 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET' | 'LIVEKIT_API_URL' | 'LIVEKIT_URL'>,
): RoomModerationPort | null {
  const { LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (!apiKey || !apiSecret) return null;

  const client = new RoomServiceClient(livekitApiUrlFrom(env), apiKey, apiSecret);
  return {
    async listMicrophones(room) {
      return unmutedMicrophones(await client.listParticipants(room));
    },
    async muteMicrophone(room, { identity, trackSid }) {
      await client.mutePublishedTrack(room, identity, trackSid, true);
    },
  };
}
