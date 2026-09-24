/**
 * Pure screen share rules (#20): who wins the single share slot of a space,
 * and what goes on the big stage. No Phaser, no `livekit-client`, same split
 * as `proximityAudio.ts`: `livekitRoom.ts` only gathers the claims and acts.
 *
 * One share per space. Every space is its own LiveKit room
 * (`livekitRoomFor`), so "the sharers of a space" is simply every
 * participant of that room with a `screen_share` publication.
 *
 * Arbitration is a Lamport clock carried in the track NAME. A new share
 * publishes with a claim one above every claim it can see in the room, so a
 * takeover always outranks the share it replaces, with no clock shared
 * between browsers. The name travels inside the publication itself: every
 * client sees a share and its claim at the same instant, never one without
 * the other. Two shares started at nearly the same time can carry the same
 * claim; the identity breaks the tie. Every client ranks the same set the
 * same way, so exactly one sharer keeps going: they can never both stop, and
 * they can only both share until each one has seen the other's publication.
 */

import type { AttachableTrack } from './attachableTrack';

const TRACK_NAME_PREFIX = 'screen_share#';

export interface ScreenShareClaim {
  /** LiveKit identity, which is the Colyseus sessionId. */
  identity: string;
  claim: number;
}

export function screenShareTrackName(claim: number): string {
  return `${TRACK_NAME_PREFIX}${claim}`;
}

/**
 * Claim carried by a published track name. Anything that is not our own
 * format (another client version, a hand-made publish) is 0, so it never
 * outranks a share started from this app.
 */
export function screenShareClaimOf(trackName: string | undefined): number {
  if (!trackName?.startsWith(TRACK_NAME_PREFIX)) return 0;
  const digits = trackName.slice(TRACK_NAME_PREFIX.length);
  return /^\d+$/.test(digits) ? Number(digits) : 0;
}

export function nextScreenShareClaim(claims: readonly ScreenShareClaim[]): number {
  return claims.reduce((max, { claim }) => Math.max(max, claim), 0) + 1;
}

/** `a` ranks above `b`: higher claim, then higher identity (plain code unit order, locale free). */
function outranks(a: ScreenShareClaim, b: ScreenShareClaim): boolean {
  if (a.claim !== b.claim) return a.claim > b.claim;
  return a.identity > b.identity;
}

/** The one share of the space that stays, or `null` when nobody shares. */
export function screenShareWinner(claims: readonly ScreenShareClaim[]): string | null {
  let winner: ScreenShareClaim | null = null;
  for (const claim of claims) {
    if (winner === null || outranks(claim, winner)) winner = claim;
  }
  return winner?.identity ?? null;
}

/** `true` when `identity` is sharing and someone else holds the slot. */
export function shouldYieldScreenShare(
  identity: string,
  claims: readonly ScreenShareClaim[],
): boolean {
  if (!claims.some((claim) => claim.identity === identity)) return false;
  return screenShareWinner(claims) !== identity;
}

export interface ScreenShareStageInput {
  /** Winner of the space, as reported by `livekitRoom.ts`. */
  activeSharer: string | null;
  selfSessionId: string | null;
  /** Own share, never a subscription: the sharer sees it like their own camera. */
  localTrack: AttachableTrack | null;
  /** Subscribed peer shares, keyed by sessionId. */
  remoteTracks: ReadonlyMap<string, AttachableTrack>;
}

export interface ScreenShareStage {
  sessionId: string;
  track: AttachableTrack;
}

/**
 * The share that takes the stage, or `null` to keep the plain tile row.
 * Only the winner: a share being displaced can still be subscribed for a
 * moment, and it must not flash on the stage. A winner whose track has not
 * arrived yet is `null` too, so the stage never opens empty.
 */
export function selectScreenShareStage(input: ScreenShareStageInput): ScreenShareStage | null {
  const { activeSharer, selfSessionId, localTrack, remoteTracks } = input;
  if (activeSharer === null) return null;
  const track = activeSharer === selfSessionId ? localTrack : (remoteTracks.get(activeSharer) ?? null);
  return track ? { sessionId: activeSharer, track } : null;
}
