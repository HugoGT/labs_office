/**
 * Routes of the character chosen at the office entrance (art migration, step
 * 5), tested as pure functions without Express, like
 * `displayNameRoutes.test.ts`. The catalog is the real pack registered into
 * the memory adapter, so "exists, is a character, is not retired" is checked
 * against the same rows the server would read.
 */

import { describe, expect, it } from 'vitest';
import type { ArtPackManifest } from '../../../src/game/artContract.ts';
import { ART_PACK_DEFAULTS } from '../decor/artCatalogRules.ts';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import { SESSION_EXPIRED, type IdTokenVerifier } from '../verifyIdToken.ts';
import { handleGetAvatar, handleSetAvatar, type AvatarDeps } from './avatarRoutes.ts';
import type { DirectoryUser } from './directoryPort.ts';
import { createMemoryDirectory } from './memoryDirectory.ts';

const PACK = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));
const RETIRED = 'character-p18-yellow-coat';

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: ART_PACK_DEFAULTS.character,
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ANA = user({ id: 'id-ana', uid: 'uid-ana' });
const BEA = user({
  id: 'id-bea',
  uid: 'uid-bea',
  avatarId: 'character-p02-beige-blazer',
  avatarChosenAt: new Date('2026-09-01T00:00:00.000Z'),
});

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    if (token === 'sesion-de-hace-meses') return SESSION_EXPIRED;
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ANA = 'Bearer valido-uid-ana';
const BEARER_BEA = 'Bearer valido-uid-bea';

/** The pack, then a newer pack without `RETIRED`: retired, not deleted. */
async function harness(): Promise<AvatarDeps> {
  const decor = createMemoryDecor();
  await decor.registerArtPack(PACK);
  const newer: ArtPackManifest = { ...PACK, pieces: PACK.pieces.filter((piece) => piece.id !== RETIRED) };
  await decor.registerArtPack(newer);
  return { directory: createMemoryDirectory({ seed: [ANA, BEA] }), auth: verifier, decor };
}

describe('handleGetAvatar', () => {
  it.each(['expired', 'revoked', 'not-provisioned'] as const)('both avatar operations explain %s without saving', async (reason) => {
    const visitor = user({ id: 'id-visitor', uid: 'uid-visitor', role: 'guest',
      status: reason === 'revoked' ? 'revoked' : 'active', expiresAt: new Date('2026-01-01T00:00:00Z') });
    const deps = { ...await harness(),
      directory: createMemoryDirectory({ seed: reason === 'not-provisioned' ? [] : [visitor] }),
      now: () => new Date('2026-02-01T00:00:00Z'), log: () => undefined };
    const expected = { status: 401, body: { error: 'unauthorized', reason } };
    expect(await handleGetAvatar('Bearer valido-uid-visitor', deps)).toEqual(expected);
    expect(await handleSetAvatar('Bearer valido-uid-visitor', { avatarId: 'character-p03-forest-suit' }, deps)).toEqual(expected);
    expect((await deps.directory.findByUid('uid-visitor'))?.avatarChosenAt ?? null).toBeNull();
  });
  it('without credentials answers 401', async () => {
    expect((await handleGetAvatar(undefined, await harness())).status).toBe(401);
  });

  it('a login older than the maximum session age answers 401 session-expired (#128)', async () => {
    expect(await handleGetAvatar('Bearer sesion-de-hace-meses', await harness())).toEqual({
      status: 401,
      body: { error: 'unauthorized', reason: 'session-expired' },
    });
  });

  it('a user who never chose gets the stored default and chosen false', async () => {
    const result = await handleGetAvatar(BEARER_ANA, await harness());

    expect(result).toEqual({ status: 200, body: { avatarId: ART_PACK_DEFAULTS.character, chosen: false } });
  });

  it('a user who already chose gets that character and chosen true', async () => {
    const result = await handleGetAvatar(BEARER_BEA, await harness());

    expect(result).toEqual({ status: 200, body: { avatarId: 'character-p02-beige-blazer', chosen: true } });
  });
});

describe('handleSetAvatar', () => {
  it('without credentials answers 401 and stores nothing', async () => {
    const deps = await harness();

    const result = await handleSetAvatar(undefined, { avatarId: 'character-p03-forest-suit' }, deps);

    expect(result.status).toBe(401);
    expect((await deps.directory.findById(ANA.id))?.avatarChosenAt).toBeNull();
  });

  it('stores an active character for the caller and marks it chosen', async () => {
    const deps = await harness();

    const result = await handleSetAvatar(BEARER_ANA, { avatarId: 'character-p03-forest-suit' }, deps);

    expect(result).toEqual({ status: 200, body: { avatarId: 'character-p03-forest-suit', chosen: true } });
    const stored = await deps.directory.findById(ANA.id);
    expect(stored?.avatarId).toBe('character-p03-forest-suit');
    expect(stored?.avatarChosenAt).not.toBeNull();
  });

  it('confirming the character one already has still marks it chosen', async () => {
    const deps = await harness();

    const result = await handleSetAvatar(BEARER_ANA, { avatarId: ART_PACK_DEFAULTS.character }, deps);

    expect(result.status).toBe(200);
    expect((await deps.directory.findById(ANA.id))?.avatarChosenAt).not.toBeNull();
  });

  it('writes the caller row only: an id in the body is ignored', async () => {
    const deps = await harness();

    await handleSetAvatar(BEARER_ANA, { avatarId: 'character-p03-forest-suit', id: BEA.id }, deps);

    expect((await deps.directory.findById(BEA.id))?.avatarId).toBe('character-p02-beige-blazer');
  });

  it.each([
    ['an unknown piece', 'character-p99-nobody', 'unknown-piece'],
    ['a piece of another kind', 'desk-wood', 'unknown-piece'],
    ['a retired character', RETIRED, 'retired-piece'],
  ])('rejects %s with 400 and its reason, storing nothing', async (_label, avatarId, reason) => {
    const deps = await harness();

    const result = await handleSetAvatar(BEARER_ANA, { avatarId }, deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-character', reason } });
    expect((await deps.directory.findById(ANA.id))?.avatarChosenAt).toBeNull();
  });

  it.each([[undefined], [null], ['character-p03-forest-suit'], [{}], [{ avatarId: 7 }], [{ avatarId: '' }], [[]]])(
    'a body without an avatarId string (%j) is a 400 unknown-piece, never the default',
    async (body) => {
      const deps = await harness();

      const result = await handleSetAvatar(BEARER_ANA, body, deps);

      expect(result).toEqual({ status: 400, body: { error: 'invalid-character', reason: 'unknown-piece' } });
      expect((await deps.directory.findById(ANA.id))?.avatarChosenAt).toBeNull();
    },
  );
});
