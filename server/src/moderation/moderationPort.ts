/**
 * Port over the LiveKit room API for meeting moderation (#282). The route
 * only sees this interface, so its branches are testable without a LiveKit
 * stack; the adapter is `livekitModeration.ts`.
 *
 * The mute happens in the SFU (`mutePublishedTrack`), not as a message the
 * client may choose to obey. `room.enable_remote_unmute` stays at its default
 * `false`, so a moderator can silence a microphone but never open one: only
 * its owner can, with a click.
 */

export interface PublishedMicrophone {
  /** LiveKit identity, which is the Colyseus sessionId (`livekitToken.ts`). */
  identity: string;
  trackSid: string;
}

export interface RoomModerationPort {
  /** Microphones published and not muted right now in `room`. */
  listMicrophones(room: string): Promise<PublishedMicrophone[]>;
  muteMicrophone(room: string, microphone: PublishedMicrophone): Promise<void>;
}
