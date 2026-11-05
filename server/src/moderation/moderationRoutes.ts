/**
 * `POST /livekit/mute` (#282) as a pure handler returning `{ status, body }`,
 * same contract as `handleLivekitToken` and the recording routes.
 *
 * Body: `{ token?, sessionId, spaceId, target }` to mute one person (their
 * sessionId, which is their LiveKit identity) or `{ ..., all: true }` to mute
 * everyone else in the room. The guards, in order:
 *
 *   1. The session guards of `/livekit/token` (`sessionGuard.ts`).
 *   2. 503 without LiveKit, spaces or a directory: there is no role to check
 *      nor a room to act on.
 *   3. 403 `forbidden` unless the account behind the session moderates
 *      (`canModerate`), read from the directory and never from the client.
 *      Without auth there is no verified account, so nobody moderates.
 *   4. 403 `forbidden-space` unless the server places the moderator inside
 *      `spaceId`, and 409 `not-a-meeting` unless that room is a meeting room.
 *
 * The mute is applied by the SFU (`RoomModerationPort`), so a modified client
 * cannot ignore it; it can only unmute itself, as its owner can with a click.
 */

import { livekitRoomFor } from '../../../src/game/officeProtocol.ts';
import { decideAccess } from '../directory/accessDecision.ts';
import type { UserDirectory } from '../directory/directoryPort.ts';
import type { LiveSessionRegistry } from '../liveSessions.ts';
import { guardSessionRequest, sessionIsInSpace } from '../sessionGuard.ts';
import type { SpacesDirectory } from '../spaces/spacesPort.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { RoomModerationPort } from './moderationPort.ts';
import { canModerate, microphonesToMute, parseMuteTarget } from './moderationRules.ts';

export interface ModerationDeps {
  sessions: LiveSessionRegistry;
  auth?: IdTokenVerifier;
  spaces?: SpacesDirectory;
  directory?: UserDirectory;
  /** `null` when the environment lacks the LiveKit API credentials. */
  moderation: RoomModerationPort | null;
  now?: () => Date;
}

export interface ModerationResult {
  status: 200 | 400 | 401 | 403 | 409 | 502 | 503;
  body: Record<string, unknown>;
}

const INVALID_REQUEST: ModerationResult = { status: 400, body: { error: 'invalid-request' } };
const FORBIDDEN: ModerationResult = { status: 403, body: { error: 'forbidden' } };
const FORBIDDEN_SPACE: ModerationResult = { status: 403, body: { error: 'forbidden-space' } };
const NOT_A_MEETING: ModerationResult = { status: 409, body: { error: 'not-a-meeting' } };
const NOT_CONFIGURED: ModerationResult = { status: 503, body: { error: 'moderation-not-configured' } };
const LIVEKIT_FAILED: ModerationResult = { status: 502, body: { error: 'livekit-failed' } };

/**
 * Whether the account bound to this live session moderates now. Shared with
 * `/livekit/token`, which tells the client whether to offer the controls; the
 * route below asks again on every request, so the hint grants nothing.
 */
export async function sessionCanModerate(
  sessionId: string,
  deps: Pick<ModerationDeps, 'sessions' | 'directory' | 'now'>,
): Promise<boolean> {
  const uid = deps.sessions.uidOf(sessionId);
  if (uid === undefined || deps.directory === undefined) return false;
  const user = await deps.directory.findByUid(uid);
  if (user === null) return false;
  // A revoked or expired admin keeps no power that outlives their access.
  if (decideAccess(user, (deps.now ?? (() => new Date()))()) !== 'allow') return false;
  return canModerate(user.role);
}

export async function handleMuteMicrophones(body: unknown, deps: ModerationDeps): Promise<ModerationResult> {
  const guard = await guardSessionRequest(body, deps.sessions, deps.auth);
  if (!guard.ok) return { status: guard.status, body: guard.body };
  const { sessionId, spaceId } = guard;

  const { moderation, spaces, directory } = deps;
  if (moderation === null || spaces === undefined || directory === undefined) return NOT_CONFIGURED;

  if (!(await sessionCanModerate(sessionId, deps))) return FORBIDDEN;

  if (spaceId === null || !(await sessionIsInSpace(sessionId, spaceId, deps.sessions, spaces))) {
    return FORBIDDEN_SPACE;
  }
  if (!(await spaces.getSpace(spaceId))?.meeting) return NOT_A_MEETING;

  const target = parseMuteTarget(body);
  if (target === null || (target.kind === 'one' && target.sessionId === sessionId)) return INVALID_REQUEST;

  const room = livekitRoomFor(spaceId);
  try {
    const microphones = microphonesToMute(await moderation.listMicrophones(room), sessionId, target);
    await Promise.all(microphones.map((microphone) => moderation.muteMicrophone(room, microphone)));
    return { status: 200, body: { muted: microphones.length } };
  } catch {
    // The raw error is never logged nor returned: it could carry credentials.
    console.error('[moderation] LiveKit failed to mute a microphone');
    return LIVEKIT_FAILED;
  }
}
