/**
 * `POST /recordings/start` and `POST /recordings/stop` (#5) as pure handlers,
 * without Express, like `desksRoutes.test.ts`. What this file pins down:
 *
 *   1. Same authorization chain as `/livekit/token`: 400, 401, unknown and
 *      forbidden session, then the server-tracked space.
 *   2. One recording per space: a second start is 409, even mid-flight.
 *   3. Anyone recorded can stop it; the starter can stop it after walking out.
 *   4. The registry only reflects what Egress accepted.
 *   5. (#58) A stopped recording is only reachable by the people the server
 *      placed in the space, and only once the file is uploaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { livekitRoomFor, recordingAvailableUntil } from '../../../src/game/officeProtocol.ts';
import { createLiveSessionRegistry, type LiveSessionRegistry } from '../liveSessions.ts';
import { createMemorySpaces } from '../spaces/memorySpaces.ts';
import type { SpacesDirectory } from '../spaces/spacesPort.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { EgressPort } from './egressPort.ts';
import { createFinishedRecordingStore, type FinishedRecordingStore } from './finishedRecordings.ts';
import { createRecordingRegistry, type RecordingRegistry } from './recordingRegistry.ts';
import {
  handleRecordingUrl,
  handleStartRecording,
  handleStopRecording,
  type RecordingDeps,
} from './recordingRoutes.ts';
import type { PresignOptions, RecordingStoragePort } from './recordingStorage.ts';

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valid-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: null, name: null };
  },
};

interface FakeEgress extends EgressPort {
  started: string[];
  filepaths: string[];
  stopped: string[];
  failStart: boolean;
  failStop: boolean;
  /** When set, `start` waits for it: lets a test overlap two starts. */
  gate: Promise<void> | null;
}

function fakeEgress(): FakeEgress {
  const egress: FakeEgress = {
    started: [],
    filepaths: [],
    stopped: [],
    failStart: false,
    failStop: false,
    gate: null,
    async start(roomName, filepath) {
      if (egress.gate) await egress.gate;
      if (egress.failStart) throw new Error('egress down');
      egress.started.push(roomName);
      egress.filepaths.push(filepath);
      return { egressId: `EG_${egress.started.length}` };
    },
    async stop(egressId) {
      if (egress.failStop) throw new Error('egress down');
      egress.stopped.push(egressId);
    },
  };
  return egress;
}

interface FakeStorage extends RecordingStoragePort {
  uploaded: Set<string>;
  presigned: { key: string; options: PresignOptions }[];
}

function fakeStorage(): FakeStorage {
  const storage: FakeStorage = {
    uploaded: new Set(),
    presigned: [],
    async exists(key) {
      return storage.uploaded.has(key);
    },
    async presign(key, options) {
      storage.presigned.push({ key, options });
      return `http://localhost:9000/recordings/${key}?signed`;
    },
  };
  return storage;
}

let sessions: LiveSessionRegistry;
let finished: FinishedRecordingStore;
let storage: FakeStorage;
let spaces: SpacesDirectory;
let recordings: RecordingRegistry;
let egress: FakeEgress;
let spaceId: string;
let deps: RecordingDeps;

// Space in tiles (10,10)-(13,13) -> pixels (320,320)-(416,416).
const INSIDE = [330, 330] as const;
const OUTSIDE = [0, 0] as const;

beforeEach(async () => {
  sessions = createLiveSessionRegistry();
  spaces = createMemorySpaces();
  recordings = createRecordingRegistry();
  egress = fakeEgress();
  finished = createFinishedRecordingStore();
  storage = fakeStorage();
  const created = await spaces.createSpace({ name: 'Sala', x: 10, y: 10, w: 3, h: 3, capacity: null });
  spaceId = created.id;
  deps = {
    sessions,
    spaces,
    recordings,
    egress,
    finished,
    storage,
    now: () => 5000,
    readiness: { intervalMs: 5, timeoutMs: 200 },
  };

  sessions.add('ses-ana');
  sessions.moveTo('ses-ana', ...INSIDE);
  sessions.add('ses-bruno');
  sessions.moveTo('ses-bruno', ...INSIDE);
  sessions.add('ses-fuera');
  sessions.moveTo('ses-fuera', ...OUTSIDE);
});

describe('handleStartRecording', () => {
  it('starts a room composite of the space LiveKit room and records who started it', async () => {
    const result = await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);

    expect(result).toEqual({
      status: 200,
      body: { spaceId, startedBy: 'ses-ana', startedAt: 5000 },
    });
    expect(egress.started).toEqual([livekitRoomFor(spaceId)]);
    expect(recordings.get(spaceId)).toMatchObject({
      spaceId,
      egressId: 'EG_1',
      startedBy: 'ses-ana',
      startedAt: 5000,
    });
  });

  it('(#58) chooses the object key itself and hands it to Egress, instead of a {time} template', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);

    const key = recordings.get(spaceId)!.key;
    expect(key).toMatch(new RegExp(`^recordings/${spaceId}/5000-[a-z0-9]+\\.mp4$`));
    expect(egress.filepaths).toEqual([key]);
  });

  it('(#58) participants at start are the starter and everyone the server places inside', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);

    expect(recordings.get(spaceId)!.participants.sort()).toEqual(['ses-ana', 'ses-bruno']);
  });

  it('400 when sessionId is missing or spaceId has the wrong type', async () => {
    expect((await handleStartRecording({ spaceId }, deps)).status).toBe(400);
    expect((await handleStartRecording({ sessionId: 'ses-ana', spaceId: 42 }, deps)).status).toBe(400);
  });

  it('403 unknown-session for a session that is not connected', async () => {
    const result = await handleStartRecording({ sessionId: 'ses-invented', spaceId }, deps);
    expect(result).toEqual({ status: 403, body: { error: 'unknown-session' } });
  });

  it('403 forbidden-space when the tracked position is outside, the space is unknown or missing', async () => {
    for (const body of [
      { sessionId: 'ses-fuera', spaceId },
      { sessionId: 'ses-ana', spaceId: 'never-existed' },
      { sessionId: 'ses-ana', spaceId: null },
      { sessionId: 'ses-ana' },
    ]) {
      expect(await handleStartRecording(body, deps)).toEqual({
        status: 403,
        body: { error: 'forbidden-space' },
      });
    }
    expect(egress.started).toEqual([]);
  });

  it('with auth: 401 without a valid token, 403 forbidden-session for someone else session', async () => {
    sessions.add('ses-owned', 'uid-ana');
    sessions.moveTo('ses-owned', ...INSIDE);
    const authDeps = { ...deps, auth: verifier };

    expect(await handleStartRecording({ sessionId: 'ses-owned', spaceId }, authDeps)).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(
      await handleStartRecording({ sessionId: 'ses-owned', spaceId, token: 'valid-uid-bruno' }, authDeps),
    ).toEqual({ status: 403, body: { error: 'forbidden-session' } });
    expect(
      (await handleStartRecording({ sessionId: 'ses-owned', spaceId, token: 'valid-uid-ana' }, authDeps))
        .status,
    ).toBe(200);
  });

  it('503 recording-not-configured without Egress or without a spaces store', async () => {
    expect(await handleStartRecording({ sessionId: 'ses-ana', spaceId }, { ...deps, egress: null })).toEqual({
      status: 503,
      body: { error: 'recording-not-configured' },
    });
    expect(
      await handleStartRecording({ sessionId: 'ses-ana', spaceId }, { ...deps, spaces: undefined }),
    ).toEqual({ status: 503, body: { error: 'recording-not-configured' } });
  });

  it('409 already-recording when the space already has a recording', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);

    const second = await handleStartRecording({ sessionId: 'ses-bruno', spaceId }, deps);

    expect(second).toEqual({ status: 409, body: { error: 'already-recording' } });
    expect(egress.started).toHaveLength(1);
  });

  it('409 for a second start that arrives while the first one waits on Egress', async () => {
    let open!: () => void;
    egress.gate = new Promise((resolve) => (open = resolve));

    const first = handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const second = await handleStartRecording({ sessionId: 'ses-bruno', spaceId }, deps);
    open();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    expect(egress.started).toHaveLength(1);
  });

  it('502 egress-failed leaves no recording behind and frees the space', async () => {
    egress.failStart = true;

    const result = await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);

    expect(result).toEqual({ status: 502, body: { error: 'egress-failed' } });
    expect(recordings.get(spaceId)).toBeUndefined();
    egress.failStart = false;
    expect((await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps)).status).toBe(200);
  });
});

describe('handleStopRecording', () => {
  beforeEach(async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
  });

  it('any occupant of the space can stop it, not only the starter', async () => {
    const result = await handleStopRecording({ sessionId: 'ses-bruno', spaceId }, deps);

    expect(result).toEqual({ status: 200, body: { spaceId, recordingId: expect.any(String) } });
    expect(egress.stopped).toEqual(['EG_1']);
    expect(recordings.get(spaceId)).toBeUndefined();
  });

  it('the starter can stop it after walking out of the space', async () => {
    sessions.moveTo('ses-ana', ...OUTSIDE);

    expect((await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps)).status).toBe(200);
  });

  it('403 forbidden-space for someone outside who did not start it', async () => {
    const result = await handleStopRecording({ sessionId: 'ses-fuera', spaceId }, deps);

    expect(result).toEqual({ status: 403, body: { error: 'forbidden-space' } });
    expect(recordings.get(spaceId)).toBeDefined();
  });

  it('404 not-recording when the space has no recording', async () => {
    await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);

    const result = await handleStopRecording({ sessionId: 'ses-bruno', spaceId }, deps);

    expect(result).toEqual({ status: 404, body: { error: 'not-recording' } });
  });

  it('(#58) moves the recording to the finished store with everyone present at start or stop', async () => {
    sessions.add('ses-late');
    sessions.moveTo('ses-late', ...INSIDE);
    sessions.moveTo('ses-bruno', ...OUTSIDE); // was there at start, left before the stop

    const result = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);

    const recordingId = result.body.recordingId as string;
    const done = finished.get(recordingId)!;
    expect(done).toMatchObject({ spaceId, startedAt: 5000, stoppedAt: 5000, ready: false });
    expect(done.key).toMatch(/^recordings\//);
    expect(done.participants.sort()).toEqual(['ses-ana', 'ses-bruno', 'ses-late']);
    expect(done.participants).not.toContain('ses-fuera');
  });

  it('(#58) polls the bucket and marks it ready once the object is there', async () => {
    const result = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const recordingId = result.body.recordingId as string;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished.get(recordingId)!.ready).toBe(false);

    storage.uploaded.add(finished.get(recordingId)!.key);

    await vi.waitFor(() => expect(finished.get(recordingId)!.ready).toBe(true));
  });

  it('(#58) gives up after the timeout with a warning and never marks it ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);

      await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 1000 });
      expect(finished.get(result.body.recordingId as string)!.ready).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('502 egress-failed still clears the registry: nobody can be left with a stale badge', async () => {
    egress.failStop = true;

    const result = await handleStopRecording({ sessionId: 'ses-bruno', spaceId }, deps);

    expect(result).toEqual({ status: 502, body: { error: 'egress-failed' } });
    expect(recordings.get(spaceId)).toBeUndefined();
  });

  it('shares the session guards of start', async () => {
    expect((await handleStopRecording({ spaceId }, deps)).status).toBe(400);
    expect(await handleStopRecording({ sessionId: 'ses-invented', spaceId }, deps)).toEqual({
      status: 403,
      body: { error: 'unknown-session' },
    });
    expect(await handleStopRecording({ sessionId: 'ses-ana', spaceId }, { ...deps, egress: null })).toEqual({
      status: 503,
      body: { error: 'recording-not-configured' },
    });
  });
});

describe('handleRecordingUrl (#58)', () => {
  async function stoppedRecording(): Promise<string> {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const stopped = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    return stopped.body.recordingId as string;
  }

  async function readyRecording(): Promise<string> {
    const recordingId = await stoppedRecording();
    storage.uploaded.add(finished.get(recordingId)!.key);
    await vi.waitFor(() => expect(finished.get(recordingId)!.ready).toBe(true));
    return recordingId;
  }

  it('a participant gets a presigned URL valid for ten minutes', async () => {
    const recordingId = await readyRecording();

    const result = await handleRecordingUrl({ sessionId: 'ses-bruno', recordingId }, deps);

    const key = finished.get(recordingId)!.key;
    expect(result).toEqual({
      status: 200,
      body: { url: `http://localhost:9000/recordings/${key}?signed`, expiresAt: 5000 + 600_000 },
    });
    expect(storage.presigned).toEqual([{ key, options: { expiresInSeconds: 600 } }]);
  });

  it('a download asks for an attachment named after the space slug and the date', async () => {
    const recordingId = await readyRecording();
    const slug = (await spaces.listSpaces()).find((space) => space.id === spaceId)!.slug;

    await handleRecordingUrl({ sessionId: 'ses-ana', recordingId, download: true }, deps);

    expect(storage.presigned[0].options).toEqual({
      expiresInSeconds: 600,
      downloadFilename: `grabacion-${slug}-1970-01-01.mp4`,
    });
  });

  it('403 forbidden-recording for someone the server never placed in the space', async () => {
    const recordingId = await readyRecording();

    const result = await handleRecordingUrl({ sessionId: 'ses-fuera', recordingId }, deps);

    expect(result).toEqual({ status: 403, body: { error: 'forbidden-recording' } });
    expect(storage.presigned).toEqual([]);
  });

  it('with auth, access follows the uid: the same person after a reload still gets in', async () => {
    const authDeps = { ...deps, auth: verifier };
    sessions.add('ses-auth', 'uid-ana');
    sessions.moveTo('ses-auth', ...INSIDE);
    await handleStartRecording({ sessionId: 'ses-auth', spaceId, token: 'valid-uid-ana' }, authDeps);
    const stopped = await handleStopRecording({ sessionId: 'ses-auth', spaceId, token: 'valid-uid-ana' }, authDeps);
    const recordingId = stopped.body.recordingId as string;
    storage.uploaded.add(finished.get(recordingId)!.key);
    await vi.waitFor(() => expect(finished.get(recordingId)!.ready).toBe(true));
    sessions.remove('ses-auth');
    sessions.add('ses-reloaded', 'uid-ana');
    sessions.add('ses-other', 'uid-bruno');

    const again = await handleRecordingUrl(
      { sessionId: 'ses-reloaded', recordingId, token: 'valid-uid-ana' },
      authDeps,
    );
    const stranger = await handleRecordingUrl(
      { sessionId: 'ses-other', recordingId, token: 'valid-uid-bruno' },
      authDeps,
    );

    expect(again.status).toBe(200);
    expect(stranger).toEqual({ status: 403, body: { error: 'forbidden-recording' } });
  });

  it('409 not-ready while the file is not uploaded yet', async () => {
    const recordingId = await stoppedRecording();

    const result = await handleRecordingUrl({ sessionId: 'ses-ana', recordingId }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'not-ready' } });
  });

  it('410 recording-expired once the retention is over, without signing anything', async () => {
    const recordingId = await readyRecording();
    const { stoppedAt } = finished.get(recordingId)!;

    const lastMoment = await handleRecordingUrl(
      { sessionId: 'ses-ana', recordingId },
      { ...deps, now: () => recordingAvailableUntil(stoppedAt) - 1 },
    );
    const expired = await handleRecordingUrl(
      { sessionId: 'ses-ana', recordingId },
      { ...deps, now: () => recordingAvailableUntil(stoppedAt) },
    );

    expect(lastMoment.status).toBe(200);
    expect(expired).toEqual({ status: 410, body: { error: 'recording-expired' } });
    expect(storage.presigned).toHaveLength(1);
  });

  it('410 recording-expired when the uploaded object is gone from the bucket', async () => {
    const recordingId = await readyRecording();
    storage.uploaded.delete(finished.get(recordingId)!.key);

    const result = await handleRecordingUrl({ sessionId: 'ses-ana', recordingId, download: true }, deps);

    expect(result).toEqual({ status: 410, body: { error: 'recording-expired' } });
    expect(storage.presigned).toEqual([]);
  });

  it('404 unknown-recording for an id that does not exist, 400 without an id', async () => {
    expect(await handleRecordingUrl({ sessionId: 'ses-ana', recordingId: 'nope' }, deps)).toEqual({
      status: 404,
      body: { error: 'unknown-recording' },
    });
    expect((await handleRecordingUrl({ sessionId: 'ses-ana' }, deps)).status).toBe(400);
  });

  it('shares the session guards and answers 503 without storage', async () => {
    const recordingId = await readyRecording();

    expect(await handleRecordingUrl({ sessionId: 'ses-invented', recordingId }, deps)).toEqual({
      status: 403,
      body: { error: 'unknown-session' },
    });
    expect(await handleRecordingUrl({ sessionId: 'ses-ana', recordingId }, { ...deps, storage: null })).toEqual({
      status: 503,
      body: { error: 'recording-not-configured' },
    });
  });
});
