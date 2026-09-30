/**
 * `POST /recordings/start`, `POST /recordings/stop` (#5) and
 * `POST /recordings/url` (#58) as pure handlers returning `{ status, body }`,
 * same contract as `handleLivekitToken`.
 *
 * Body: `{ token?, sessionId, spaceId }`. The session guards are the ones of
 * `/livekit/token` (`sessionGuard.ts`); on top of them the space is mandatory
 * and must be the one the server tracks for that session. Without a spaces
 * store there is nothing to check that against, and the LiveKit room of the
 * space does not even exist (everyone shares the corridor), so recording is
 * simply not configured there.
 */

import { randomUUID } from 'node:crypto';
import { livekitRoomFor, recordingAvailableUntil } from '../../../src/game/officeProtocol.ts';
import type { LiveSessionRegistry, SessionPosition } from '../liveSessions.ts';
import { guardSessionRequest, sessionIsInSpace } from '../sessionGuard.ts';
import { spaceIdAt } from '../spaces/spaceMembership.ts';
import type { Space, SpacesDirectory } from '../spaces/spacesPort.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { EgressPort } from './egressPort.ts';
import {
  participantKeyOf,
  type FinishedRecording,
  type FinishedRecordingStore,
} from './finishedRecordings.ts';
import type { ActiveRecording, RecordingRegistry } from './recordingRegistry.ts';
import type { RecordingStoragePort } from './recordingStorage.ts';
import type { RecordingGeometry } from './recordingSpaceSnapshot.ts';

/** How long a presigned URL lives (#58). */
export const RECORDING_URL_TTL_SECONDS = 600;

export interface RecordingDeps {
  sessions: LiveSessionRegistry;
  recordings: RecordingRegistry;
  /** `null` when the environment lacks the LiveKit settings or the bucket. */
  egress: EgressPort | null;
  finished: FinishedRecordingStore;
  /** `null` when the environment lacks the recordings bucket (#58). */
  storage: RecordingStoragePort | null;
  auth?: IdTokenVerifier;
  spaces?: SpacesDirectory;
  /** Current committed geometry, observed by the server's space/desk adapters. */
  geometry?: RecordingGeometry;
  now?: () => number;
  /** Upload polling after a stop (#58); injectable so tests do not wait a minute. */
  readiness?: { intervalMs: number; timeoutMs: number };
}

export interface RecordingResult {
  status: 200 | 400 | 401 | 403 | 404 | 409 | 410 | 502 | 503;
  body: Record<string, unknown>;
}

const FORBIDDEN_SPACE: RecordingResult = { status: 403, body: { error: 'forbidden-space' } };
const NOT_CONFIGURED: RecordingResult = { status: 503, body: { error: 'recording-not-configured' } };
const EGRESS_FAILED: RecordingResult = { status: 502, body: { error: 'egress-failed' } };
const EXPIRED: RecordingResult = { status: 410, body: { error: 'recording-expired' } };
const DEFAULT_READINESS = { intervalMs: 2_000, timeoutMs: 60_000 };

type Authorized =
  | { ok: true; sessionId: string; spaceId: string; egress: EgressPort; spaces: SpacesDirectory }
  | { ok: false; result: RecordingResult };

/** Guards shared by start and stop; the space check itself differs between them. */
async function authorize(body: unknown, deps: RecordingDeps): Promise<Authorized> {
  const guard = await guardSessionRequest(body, deps.sessions, deps.auth);
  if (!guard.ok) return { ok: false, result: { status: guard.status, body: guard.body } };

  if (!deps.egress || !deps.spaces) return { ok: false, result: NOT_CONFIGURED };
  if (guard.spaceId === null) return { ok: false, result: FORBIDDEN_SPACE };

  return {
    ok: true,
    sessionId: guard.sessionId,
    spaceId: guard.spaceId,
    egress: deps.egress,
    spaces: deps.spaces,
  };
}

/** `participantKeyOf` of every live session the server places inside `spaceId`. */
async function presentIn(
  spaceId: string,
  sessions: LiveSessionRegistry,
  spaces: SpacesDirectory,
  geometry?: RecordingGeometry,
): Promise<string[]> {
  // Capture positions/identities at the boundary, not after a database await:
  // someone entering after stop is not a participant in the finished file.
  const present = sessions.ids().map((id) => ({
    pos: sessions.positionOf(id), key: participantKeyOf(sessions, id),
  }));
  const atBoundary = geometry?.getSpace(spaceId);
  const known = await spaces.listSpaces();
  const membership = geometry ? (atBoundary ? [atBoundary] : []) : known;
  return present.filter(({ pos }) => pos !== undefined && spaceIdAt(pos, membership) === spaceId)
    .map(({ key }) => key);
}

function trackParticipants(spaceId: string, initial: Space, sessions: LiveSessionRegistry, geometry?: RecordingGeometry) {
  const participants: string[] = [];
  const seen = new Set<string>();
  let current = geometry ? geometry.getSpace(spaceId) : initial;
  function collect(id: string, pos: SessionPosition, uid: string | undefined): void {
    const key = uid ?? id;
    if (!seen.has(key) && current && spaceIdAt(pos, [current]) === spaceId) {
      seen.add(key);
      participants.push(key);
    }
  }
  function collectPresent(): void {
    for (const id of sessions.ids()) {
      const pos = sessions.positionOf(id);
      if (pos) collect(id, pos, sessions.uidOf(id));
    }
  }
  collectPresent();
  // Capture verified identity and position synchronously: no queries, tasks or
  // position history grow with movement, and session-ID reuse cannot rewrite UID.
  const offMove = sessions.onMove(collect);
  const offGeometry = geometry?.subscribe(() => {
    current = geometry.getSpace(spaceId);
    collectPresent(); // Geometry can move over an otherwise stationary occupant.
  });
  let stopped = false;
  return {
    participants,
    collectFinal(known: readonly Space[]) {
      current = geometry ? geometry.getSpace(spaceId) : known.find((space) => space.id === spaceId);
      collectPresent();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      offMove();
      offGeometry?.();
    },
  };
}

export async function handleStartRecording(body: unknown, deps: RecordingDeps): Promise<RecordingResult> {
  const auth = await authorize(body, deps);
  if (!auth.ok) return auth.result;
  const { sessionId, spaceId, egress, spaces } = auth;
  const ownerUid = deps.sessions.uidOf(sessionId);

  const initial = await spaces.listSpaces();
  const initialSpace = deps.geometry ? deps.geometry.getSpace(spaceId) : initial.find((space) => space.id === spaceId);
  const initialPos = deps.sessions.positionOf(sessionId);
  if (!initialSpace || !initialPos || spaceIdAt(initialPos, [initialSpace]) !== spaceId) return FORBIDDEN_SPACE;

  // The single-recording-per-room guarantee. `reserve` and not `get`: the
  // registry is only written once Egress answers, and a second start in that
  // window must not reach Egress too.
  if (!deps.recordings.reserve(spaceId)) {
    return { status: 409, body: { error: 'already-recording' } };
  }

  const startedAt = (deps.now ?? Date.now)();
  // Chosen here and not by an Egress `{time}` template (#58): the server has to
  // know where the file lands to check it was uploaded and to sign a URL.
  const key = `recordings/${spaceId}/${startedAt}-${randomUUID().slice(0, 8)}.mp4`;

  // The participation boundary is the validated, reserved start request, not
  // the HTTP response. Egress may already be recording while its RPC or the
  // final membership read is pending. Failed starts discard this collection.
  const tracking = trackParticipants(spaceId, initialSpace, deps.sessions, deps.geometry);
  let published = false;
  let egressId: string | undefined;
  try {
    ({ egressId } = await egress.start(livekitRoomFor(spaceId), key));
    const known = await spaces.listSpaces();
    const currentSpace = deps.geometry ? deps.geometry.getSpace(spaceId) : known.find((space) => space.id === spaceId);
    const pos = deps.sessions.positionOf(sessionId);
    // The last await is above this check. Validate ownership and membership
    // together, then collect participants and publish without yielding.
    if (!deps.sessions.has(sessionId) || deps.sessions.uidOf(sessionId) !== ownerUid ||
        !currentSpace || !pos || spaceIdAt(pos, [currentSpace]) !== spaceId) {
      const stopped = await egress.stop(egressId).then(() => true, () => {
        console.error('[recording] failed to stop an abandoned recording');
        return false;
      });
      return stopped ? FORBIDDEN_SPACE : EGRESS_FAILED;
    }
    tracking.collectFinal(known);
    const entry: ActiveRecording = { spaceId, egressId, startedBy: sessionId, startedAt, key, participants: tracking.participants };
    entry.stopTracking = tracking.stop;
    deps.recordings.set(entry);
    published = true;
    return { status: 200, body: { spaceId, startedBy: sessionId, startedAt } };
  } catch {
    // The raw error is never logged nor returned: it could carry credentials.
    if (egressId !== undefined) {
      await egress.stop(egressId).catch(() => {
        console.error('[recording] failed to stop an abandoned recording');
      });
    }
    console.error('[recording] Egress failed to start a recording');
    return EGRESS_FAILED;
  } finally {
    if (!published) tracking.stop();
    deps.recordings.unreserve(spaceId);
  }
}

/**
 * Takes a recording out of the registry, stops it in Egress and files it as
 * finished (#58). Shared by the stop route and by `OfficeRoom` when the
 * starter leaves the office. Cleared before Egress answers and regardless of
 * the answer: a recording Egress failed to stop is still one nobody asked to
 * keep, and leaving it in the registry would block the space with a badge
 * nobody can clear. `stopped` is false when Egress failed or is not configured.
 */
export async function finishRecording(
  entry: ActiveRecording,
  egress: EgressPort | null,
  deps: RecordingDeps,
): Promise<{ recordingId: string; stopped: boolean }> {
  const atStop = deps.spaces ? presentIn(entry.spaceId, deps.sessions, deps.spaces, deps.geometry).catch(() => {
    console.error('[recording] failed to resolve stop-boundary participants');
    return [];
  }) : Promise.resolve([]);
  deps.recordings.delete(entry.spaceId);

  let stopped = egress !== null;
  try {
    await egress?.stop(entry.egressId);
  } catch {
    console.error('[recording] Egress failed to stop a recording');
    stopped = false;
  }

  entry.stopTracking?.();
  const participants = new Set([...entry.participants, ...await atStop]);

  const recording: FinishedRecording = {
    recordingId: randomUUID(),
    spaceId: entry.spaceId,
    key: entry.key,
    startedAt: entry.startedAt,
    stoppedAt: (deps.now ?? Date.now)(),
    participants: [...participants],
    ready: false,
  };
  deps.finished.add(recording);
  void pollUntilReady(recording, deps);
  return { recordingId: recording.recordingId, stopped };
}

/**
 * Egress uploads the file AFTER the stop, and how long that takes depends on
 * the length of the recording. HEAD it until it shows up; a lookup that fails
 * counts as "not yet". Past the timeout nobody is told: the file may still
 * arrive, but a notice that may never come is better than one that lies.
 */
async function pollUntilReady(recording: FinishedRecording, deps: RecordingDeps): Promise<void> {
  const { storage } = deps;
  if (!storage) return;
  const { intervalMs, timeoutMs } = deps.readiness ?? DEFAULT_READINESS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const uploaded = await storage.exists(recording.key).catch(() => false);
    if (uploaded) {
      deps.finished.markReady(recording.recordingId);
      return;
    }
  }
  console.warn(`[recording] ${recording.recordingId} was not uploaded within ${timeoutMs} ms`);
}

/**
 * Anyone currently in the space may stop it: everyone there is being
 * recorded. The starter may also stop it from outside, which is what the
 * client does when they walk out.
 */
export async function handleStopRecording(body: unknown, deps: RecordingDeps): Promise<RecordingResult> {
  const auth = await authorize(body, deps);
  if (!auth.ok) return auth.result;
  const { sessionId, spaceId, egress, spaces } = auth;

  const entry = deps.recordings.get(spaceId);
  if (
    entry?.startedBy !== sessionId &&
    !(await sessionIsInSpace(sessionId, spaceId, deps.sessions, spaces))
  ) {
    return FORBIDDEN_SPACE;
  }
  if (!entry) return { status: 404, body: { error: 'not-recording' } };

  const { recordingId, stopped } = await finishRecording(entry, egress, deps);
  if (!stopped) return EGRESS_FAILED;
  return { status: 200, body: { spaceId, recordingId } };
}

/**
 * Short-lived URL to watch or download a finished recording (#58). Body:
 * `{ token?, sessionId, recordingId, download? }`. Only the people the server
 * placed in the space may get one; being in the space NOW does not count.
 * 410 `recording-expired` once the retention (`RECORDING_RETENTION_DAYS`) is
 * over or the object left the bucket.
 */
export async function handleRecordingUrl(body: unknown, deps: RecordingDeps): Promise<RecordingResult> {
  const guard = await guardSessionRequest(body, deps.sessions, deps.auth);
  if (!guard.ok) return { status: guard.status, body: guard.body };

  const { recordingId, download } = (body ?? {}) as { recordingId?: unknown; download?: unknown };
  if (typeof recordingId !== 'string' || recordingId.length === 0) {
    return { status: 400, body: { error: 'invalid-request' } };
  }
  if (!deps.storage) return NOT_CONFIGURED;

  const recording = deps.finished.get(recordingId);
  if (!recording) return { status: 404, body: { error: 'unknown-recording' } };
  if (!recording.participants.includes(participantKeyOf(deps.sessions, guard.sessionId))) {
    return { status: 403, body: { error: 'forbidden-recording' } };
  }
  if (!recording.ready) return { status: 409, body: { error: 'not-ready' } };

  // The bucket lifecycle deletes the object at the retention age. Past it, or
  // once the object is gone (it existed: `ready` says so), a signed URL would
  // only lead to a 404 from the bucket, so the answer is an honest 410.
  const now = (deps.now ?? Date.now)();
  if (now >= recordingAvailableUntil(recording.stoppedAt)) return EXPIRED;
  if (!(await deps.storage.exists(recording.key))) return EXPIRED;

  const url = await deps.storage.presign(
    recording.key,
    download === true
      ? { expiresInSeconds: RECORDING_URL_TTL_SECONDS, downloadFilename: await downloadName(recording, deps) }
      : { expiresInSeconds: RECORDING_URL_TTL_SECONDS },
  );
  return { status: 200, body: { url, expiresAt: now + RECORDING_URL_TTL_SECONDS * 1000 } };
}

/** `grabacion-<space slug>-<YYYY-MM-DD>.mp4`; the id stands in if the space is gone. */
async function downloadName(recording: FinishedRecording, deps: RecordingDeps): Promise<string> {
  const space = (await deps.spaces?.listSpaces())?.find((candidate) => candidate.id === recording.spaceId);
  const date = new Date(recording.startedAt).toISOString().slice(0, 10);
  return `grabacion-${space?.slug ?? recording.spaceId}-${date}.mp4`;
}
