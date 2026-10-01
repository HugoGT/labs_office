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
import { SESSION_EXPIRED, type IdTokenVerifier } from '../verifyIdToken.ts';
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
import { createRecordingSpaceSnapshot } from './recordingSpaceSnapshot.ts';

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    if (token === 'months-old-session') return SESSION_EXPIRED;
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
  const snapshot = createRecordingSpaceSnapshot(createMemorySpaces());
  spaces = snapshot.spaces;
  recordings = createRecordingRegistry();
  egress = fakeEgress();
  finished = createFinishedRecordingStore();
  storage = fakeStorage();
  const created = await spaces.createSpace({ name: 'Sala', x: 10, y: 10, w: 3, h: 3, capacity: null });
  spaceId = created.id;
  deps = {
    sessions,
    spaces,
    geometry: snapshot.geometry,
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
  it.each(['Egress acquisition', 'final geometry read'])('retains a verified in-and-out visitor during %s', async (window) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const list = spaces.listSpaces.bind(spaces);
    let finalRead = false;
    if (window === 'Egress acquisition') egress.gate = gate;
    else {
      let reads = 0;
      spaces.listSpaces = async () => {
        if (++reads === 2) { finalRead = true; await gate; }
        return list();
      };
    }
    sessions.add('owner', 'uid-owner');
    sessions.moveTo('owner', ...INSIDE);
    sessions.add('visitor', 'uid-original');
    sessions.moveTo('visitor', ...OUTSIDE);
    const start = vi.spyOn(egress, 'start');
    const request = { sessionId: 'owner', spaceId, token: 'valid-uid-owner' };
    const authDeps = { ...deps, auth: verifier };
    const pending = handleStartRecording(request, authDeps);
    try {
      await vi.waitFor(() => expect(window === 'Egress acquisition' ? start.mock.calls.length > 0 : finalRead).toBe(true));
      sessions.moveTo('visitor', ...INSIDE);
      sessions.moveTo('visitor', ...OUTSIDE);
      sessions.remove('visitor');
      sessions.add('visitor', 'uid-replacement');
      sessions.moveTo('visitor', ...OUTSIDE);
      release();
      expect((await pending).status).toBe(200);
      const stopped = await handleStopRecording(request, authDeps);
      const recordingId = stopped.body.recordingId as string;
      storage.uploaded.add(finished.get(recordingId)!.key);
      await vi.waitFor(() => expect(finished.get(recordingId)!.ready).toBe(true));
      sessions.add('original-reloaded', 'uid-original');
      expect((await handleRecordingUrl({ sessionId: 'original-reloaded', recordingId, token: 'valid-uid-original' }, authDeps)).status).toBe(200);
      expect((await handleRecordingUrl({ sessionId: 'visitor', recordingId, token: 'valid-uid-replacement' }, authDeps)).status).toBe(403);
    } finally {
      release();
      await pending;
    }
  });

  it.each(['start failure', 'abandonment', 'lookup failure', 'compensation failure'])('cleans the early movement listener on %s', async (failure) => {
    const onMove = sessions.onMove.bind(sessions);
    let listeners = 0;
    const geometry = deps.geometry!;
    const subscribe = geometry.subscribe.bind(geometry);
    let geometryListeners = 0;
    vi.spyOn(geometry, 'subscribe').mockImplementation((listener) => {
      geometryListeners++;
      const off = subscribe(listener);
      return () => { geometryListeners--; off(); };
    });
    vi.spyOn(sessions, 'onMove').mockImplementation((listener) => {
      listeners++;
      const off = onMove(listener);
      return () => { listeners--; off(); };
    });
    let release!: () => void;
    egress.gate = new Promise<void>((resolve) => { release = resolve; });
    const start = vi.spyOn(egress, 'start');
    const pending = handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    try {
      await vi.waitFor(() => expect(start).toHaveBeenCalled());
      expect(listeners).toBe(1);
      expect(geometryListeners).toBe(1);
      if (failure === 'start failure') egress.failStart = true;
      if (failure === 'abandonment' || failure === 'compensation failure') sessions.remove('ses-ana');
      if (failure === 'compensation failure') egress.failStop = true;
      if (failure === 'lookup failure') spaces.listSpaces = async () => { throw new Error('lookup failed'); };
      release();
      expect((await pending).status).toBe(failure === 'abandonment' ? 403 : 502);
      expect(listeners).toBe(0);
      expect(geometryListeners).toBe(0);
      expect(recordings.list()).toEqual([]);
      expect(recordings.reserve(spaceId)).toBe(true);
    } finally {
      release();
      await pending;
    }
  });

  it.each(['departure', 'movement', 'owner replacement'])('compensates a delayed start after %s without publishing it', async (change) => {
    let open!: () => void;
    egress.gate = new Promise((resolve) => { open = resolve; });
    const start = vi.spyOn(egress, 'start');
    const published = vi.fn();
    recordings.subscribe(published);
    const pending = handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    if (change === 'departure') sessions.remove('ses-ana');
    if (change === 'movement') sessions.moveTo('ses-ana', ...OUTSIDE);
    if (change === 'owner replacement') {
      sessions.add('ses-ana', 'another-uid');
      sessions.moveTo('ses-ana', ...INSIDE);
    }
    open();
    expect((await pending).status).toBe(403);
    expect(egress.stopped).toEqual(['EG_1']);
    expect(recordings.list()).toEqual([]);
    expect(published).not.toHaveBeenCalled();
    expect(recordings.reserve(spaceId)).toBe(true);
  });

  it('rechecks the owner after the final participant query, with no await before publication', async () => {
    const list = spaces.listSpaces.bind(spaces);
    let reads = 0;
    spaces.listSpaces = async () => {
      const known = await list();
      if (++reads === 2) sessions.remove('ses-ana');
      return known;
    };
    expect((await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps)).status).toBe(403);
    expect(egress.stopped).toEqual(['EG_1']);
    expect(recordings.list()).toEqual([]);
  });

  it.each(['participant lookup', 'compensation stop'])('frees the reservation when %s fails after acquisition', async (failure) => {
    const list = spaces.listSpaces.bind(spaces);
    let reads = 0;
    const stop = vi.spyOn(egress, 'stop');
    spaces.listSpaces = async () => {
      if (++reads === 2) {
        if (failure === 'participant lookup') throw new Error('database unavailable');
        sessions.remove('ses-ana');
        egress.failStop = true;
      }
      return list();
    };
    expect((await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps)).status).toBe(502);
    expect(stop).toHaveBeenCalledWith('EG_1');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recordings.list()).toEqual([]);
    expect(recordings.reserve(spaceId)).toBe(true);
  });

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
      await handleStartRecording({ sessionId: 'ses-owned', spaceId, token: 'months-old-session' }, authDeps),
    ).toEqual({ status: 401, body: { error: 'unauthorized', reason: 'session-expired' } });
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

  it('200 outside moves create no membership queries or pending movement work', async () => {
    const read = vi.spyOn(spaces, 'listSpaces');
    for (let i = 0; i < 200; i++) sessions.moveTo('ses-fuera', i, 0);
    expect(read).not.toHaveBeenCalled();
    expect(recordings.get(spaceId)!.participants).not.toContain('ses-fuera');
  });

  it('stop never waits for movement-originated reads after its boundary read resolves', async () => {
    const known = await spaces.listSpaces();
    const releases: (() => void)[] = [];
    vi.spyOn(spaces, 'listSpaces').mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve(known));
    }));
    for (let i = 0; i < 200; i++) sessions.moveTo('ses-fuera', i, 0);
    let result: Awaited<ReturnType<typeof handleStopRecording>> | undefined;
    const stopping = handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps).then((value) => { result = value; });
    try {
      await vi.waitFor(() => expect(recordings.list()).toEqual([]));
      releases.at(-1)!(); // The stop-boundary read, not movement reads.
      await vi.waitFor(() => expect(result?.status).toBe(200));
      expect(releases).toHaveLength(1);
      expect(finished.get(result!.body.recordingId as string)!.participants).not.toContain('ses-fuera');
    } finally {
      for (const release of releases) release();
      await stopping;
    }
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
  it('retains a middle-only verified participant across reload, but denies an outsider', async () => {
    const authDeps = { ...deps, auth: verifier };
    sessions.add('owner', 'uid-owner');
    sessions.moveTo('owner', ...INSIDE);
    await handleStartRecording({ sessionId: 'owner', spaceId, token: 'valid-uid-owner' }, authDeps);
    sessions.add('visitor', 'uid-visitor');
    sessions.moveTo('visitor', ...INSIDE);
    sessions.moveTo('visitor', ...OUTSIDE);
    sessions.remove('visitor');
    sessions.add('reloaded', 'uid-visitor');
    const stopped = await handleStopRecording({ sessionId: 'owner', spaceId, token: 'valid-uid-owner' }, authDeps);
    const recordingId = stopped.body.recordingId as string;
    storage.uploaded.add(finished.get(recordingId)!.key);
    await vi.waitFor(() => expect(finished.get(recordingId)!.ready).toBe(true));
    expect(finished.get(recordingId)!.participants).toContain('uid-visitor');
    expect((await handleRecordingUrl({ sessionId: 'reloaded', recordingId, token: 'valid-uid-visitor' }, authDeps)).status).toBe(200);
    sessions.add('outsider', 'uid-outsider');
    expect((await handleRecordingUrl({ sessionId: 'outsider', recordingId, token: 'valid-uid-outsider' }, authDeps)).status).toBe(403);
  });

  it('preserves synchronous visits while the stop-boundary read is slow and excludes post-stop visitors', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const list = spaces.listSpaces.bind(spaces);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    spaces.listSpaces = async () => { await gate; return list(); };
    sessions.moveTo('ses-fuera', ...INSIDE);
    sessions.moveTo('ses-fuera', ...OUTSIDE);
    const stopped = handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    await vi.waitFor(() => expect(recordings.list()).toEqual([]));
    sessions.add('after-stop');
    sessions.moveTo('after-stop', ...INSIDE);
    release();
    const result = await stopped;
    const participants = finished.get(result.body.recordingId as string)!.participants;
    expect(participants).toContain('ses-fuera');
    expect(participants).not.toContain('after-stop');
  });

  it('files already verified participants if the stop-boundary lookup fails', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    spaces.listSpaces = async () => { throw new Error('database unavailable'); };
    const result = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    expect(result.status).toBe(200);
    expect(finished.get(result.body.recordingId as string)!.participants.sort()).toEqual(['ses-ana', 'ses-bruno']);
    expect(recordings.list()).toEqual([]);
  });

  it('does not grant a stationary outsider when geometry moves over them after stop', async () => {
    sessions.moveTo('ses-fuera', 650, 330);
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const list = spaces.listSpaces.bind(spaces);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    spaces.listSpaces = async () => { await gate; return list(); };
    const stopping = handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    await vi.waitFor(() => expect(recordings.list()).toEqual([]));
    await spaces.updateSpace(spaceId, { x: 20, y: 10, w: 3, h: 3 });
    release();
    const result = await stopping;
    expect(finished.get(result.body.recordingId as string)!.participants).not.toContain('ses-fuera');
  });

  it('tracks moved geometry immediately and never grants visitors from its old footprint', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    await spaces.updateSpace(spaceId, { x: 20, y: 10, w: 3, h: 3 });
    sessions.add('old-footprint', 'uid-outside');
    sessions.moveTo('old-footprint', ...INSIDE);
    sessions.moveTo('old-footprint', ...OUTSIDE);
    sessions.add('new-footprint', 'uid-recorded');
    sessions.moveTo('new-footprint', 650, 330);
    sessions.moveTo('new-footprint', ...OUTSIDE);
    const stopped = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    const participants = finished.get(stopped.body.recordingId as string)!.participants;
    expect(participants).toContain('uid-recorded');
    expect(participants).not.toContain('uid-outside');
  });

  it('stops granting new participants as soon as the recorded geometry is deleted', async () => {
    await handleStartRecording({ sessionId: 'ses-ana', spaceId }, deps);
    await spaces.deleteSpace(spaceId);
    sessions.add('deleted-footprint', 'uid-outside');
    sessions.moveTo('deleted-footprint', ...INSIDE);
    const stopped = await handleStopRecording({ sessionId: 'ses-ana', spaceId }, deps);
    expect(finished.get(stopped.body.recordingId as string)!.participants).not.toContain('uid-outside');
  });

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
