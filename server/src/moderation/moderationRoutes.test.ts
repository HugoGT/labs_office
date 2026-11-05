/**
 * `POST /livekit/mute` (#282) as a pure handler, like `recordingRoutes.test.ts`.
 * What this file pins down:
 *
 *   1. The session guards of `/livekit/token` first (400, 401, 403).
 *   2. The role is checked on the server: whoever is not an admin gets 403,
 *      whatever the client shows.
 *   3. Only from inside the meeting room the server tracks, and only there.
 *   4. The mute itself goes to LiveKit, never as a request to the client.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { livekitRoomFor } from '../../../src/game/officeProtocol.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import { createLiveSessionRegistry, type LiveSessionRegistry } from '../liveSessions.ts';
import { createMemorySpaces } from '../spaces/memorySpaces.ts';
import type { SpacesDirectory } from '../spaces/spacesPort.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { PublishedMicrophone, RoomModerationPort } from './moderationPort.ts';
import { handleMuteMicrophones, sessionCanModerate, type ModerationDeps } from './moderationRoutes.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valid-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: null, name: null };
  },
};

interface FakeModeration extends RoomModerationPort {
  microphones: Map<string, PublishedMicrophone[]>;
  muted: { room: string; microphone: PublishedMicrophone }[];
  fail: boolean;
}

function fakeModeration(): FakeModeration {
  const moderation: FakeModeration = {
    microphones: new Map(),
    muted: [],
    fail: false,
    async listMicrophones(room) {
      if (moderation.fail) throw new Error('livekit down');
      return moderation.microphones.get(room) ?? [];
    },
    async muteMicrophone(room, microphone) {
      if (moderation.fail) throw new Error('livekit down');
      moderation.muted.push({ room, microphone });
    },
  };
  return moderation;
}

// Space in tiles (10,10)-(16,16) -> pixels (320,320)-(512,512).
const INSIDE = [330, 330] as const;
const OUTSIDE = [0, 0] as const;

let sessions: LiveSessionRegistry;
let spaces: SpacesDirectory;
let moderation: FakeModeration;
let spaceId: string;
let deps: ModerationDeps;

beforeEach(async () => {
  sessions = createLiveSessionRegistry();
  spaces = createMemorySpaces();
  moderation = fakeModeration();
  const created = await spaces.createSpace({ name: 'Junta', x: 10, y: 10, w: 6, h: 6, capacity: null });
  await spaces.updateSpace(created.id, { meeting: true });
  spaceId = created.id;
  deps = {
    sessions,
    spaces,
    auth: verifier,
    directory: createMemoryDirectory({
      now: () => NOW,
      seed: [
        user({ id: 'id-admin', uid: 'uid-admin', role: 'admin' }),
        user({ id: 'id-ana', uid: 'uid-ana', role: 'employee' }),
        user({ id: 'id-old', uid: 'uid-old', role: 'admin', status: 'revoked' }),
      ],
    }),
    moderation,
    now: () => NOW,
  };

  for (const [session, uid] of [['ses-admin', 'uid-admin'], ['ses-ana', 'uid-ana'], ['ses-bea', 'uid-bea']]) {
    sessions.add(session, uid);
    sessions.moveTo(session, ...INSIDE);
  }
  moderation.microphones.set(livekitRoomFor(spaceId), [
    { identity: 'ses-admin', trackSid: 'TR_admin' },
    { identity: 'ses-ana', trackSid: 'TR_ana' },
    { identity: 'ses-bea', trackSid: 'TR_bea' },
  ]);
});

function asAdmin(extra: Record<string, unknown>): Record<string, unknown> {
  return { sessionId: 'ses-admin', token: 'valid-uid-admin', spaceId, ...extra };
}

describe('handleMuteMicrophones: who may moderate (#282)', () => {
  it('an admin inside the meeting room mutes one person in the SFU', async () => {
    const result = await handleMuteMicrophones(asAdmin({ target: 'ses-ana' }), deps);

    expect(result).toEqual({ status: 200, body: { muted: 1 } });
    expect(moderation.muted).toEqual([
      { room: livekitRoomFor(spaceId), microphone: { identity: 'ses-ana', trackSid: 'TR_ana' } },
    ]);
  });

  it('"everyone" mutes every microphone in the room but the moderator own', async () => {
    const result = await handleMuteMicrophones(asAdmin({ all: true }), deps);

    expect(result.body).toEqual({ muted: 2 });
    expect(moderation.muted.map(({ microphone }) => microphone.identity)).toEqual(['ses-ana', 'ses-bea']);
  });

  it('answers 403 to an employee, whatever the client shows, and mutes nothing', async () => {
    const result = await handleMuteMicrophones(
      { sessionId: 'ses-ana', token: 'valid-uid-ana', spaceId, all: true },
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect(moderation.muted).toEqual([]);
  });

  it('answers 403 to a revoked admin and to an account the directory does not know', async () => {
    sessions.add('ses-old', 'uid-old');
    sessions.moveTo('ses-old', ...INSIDE);

    expect((await handleMuteMicrophones({ sessionId: 'ses-old', token: 'valid-uid-old', spaceId, all: true }, deps)).status).toBe(403);
    expect((await handleMuteMicrophones({ sessionId: 'ses-bea', token: 'valid-uid-bea', spaceId, all: true }, deps)).status).toBe(403);
    expect(moderation.muted).toEqual([]);
  });

  it('answers 403 without auth: with no verified identity nobody holds a role', async () => {
    const open = { ...deps, auth: undefined };
    sessions.add('ses-anon');
    sessions.moveTo('ses-anon', ...INSIDE);

    expect((await handleMuteMicrophones({ sessionId: 'ses-anon', spaceId, all: true }, open)).status).toBe(403);
  });

  it('runs the session guards first: no token is 401, another one session is 403', async () => {
    expect((await handleMuteMicrophones({ sessionId: 'ses-admin', spaceId, all: true }, deps)).status).toBe(401);
    expect(
      await handleMuteMicrophones({ sessionId: 'ses-ana', token: 'valid-uid-admin', spaceId, all: true }, deps),
    ).toEqual({ status: 403, body: { error: 'forbidden-session' } });
  });
});

describe('handleMuteMicrophones: where (#282)', () => {
  it('answers 403 forbidden-space when the server does not place the moderator in that room', async () => {
    sessions.moveTo('ses-admin', ...OUTSIDE);

    expect(await handleMuteMicrophones(asAdmin({ all: true }), deps)).toEqual({
      status: 403,
      body: { error: 'forbidden-space' },
    });
    expect((await handleMuteMicrophones(asAdmin({ all: true, spaceId: undefined }), deps)).status).toBe(403);
    expect(moderation.muted).toEqual([]);
  });

  it('answers 409 not-a-meeting in a room that is not a meeting room', async () => {
    await spaces.updateSpace(spaceId, { meeting: false });

    expect(await handleMuteMicrophones(asAdmin({ all: true }), deps)).toEqual({
      status: 409,
      body: { error: 'not-a-meeting' },
    });
  });
});

describe('handleMuteMicrophones: the request (#282)', () => {
  it('answers 400 to a body that names neither one person nor everyone, or names oneself', async () => {
    expect((await handleMuteMicrophones(asAdmin({}), deps)).status).toBe(400);
    expect((await handleMuteMicrophones(asAdmin({ target: 'ses-ana', all: true }), deps)).status).toBe(400);
    expect((await handleMuteMicrophones(asAdmin({ target: 'ses-admin' }), deps)).status).toBe(400);
    expect(moderation.muted).toEqual([]);
  });

  it('answers 200 with nothing muted when that person has no open microphone', async () => {
    expect(await handleMuteMicrophones(asAdmin({ target: 'ses-nadie' }), deps)).toEqual({
      status: 200,
      body: { muted: 0 },
    });
  });

  it('answers 503 without LiveKit, spaces or a directory', async () => {
    for (const missing of [{ moderation: null }, { spaces: undefined }, { directory: undefined }]) {
      expect(await handleMuteMicrophones(asAdmin({ all: true }), { ...deps, ...missing })).toEqual({
        status: 503,
        body: { error: 'moderation-not-configured' },
      });
    }
  });

  it('answers 502 when LiveKit fails, without the raw error', async () => {
    moderation.fail = true;

    expect(await handleMuteMicrophones(asAdmin({ all: true }), deps)).toEqual({
      status: 502,
      body: { error: 'livekit-failed' },
    });
  });
});

describe('sessionCanModerate (#282)', () => {
  it('is true only for a live session of an active admin account', async () => {
    expect(await sessionCanModerate('ses-admin', deps)).toBe(true);
    expect(await sessionCanModerate('ses-ana', deps)).toBe(false);
    expect(await sessionCanModerate('ses-unknown', deps)).toBe(false);
    expect(await sessionCanModerate('ses-admin', { ...deps, directory: undefined })).toBe(false);
  });
});
