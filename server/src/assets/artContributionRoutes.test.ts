/**
 * Contribution and review routes (#122) as pure functions, without Express,
 * like `assetUploadRoutes.test.ts`. What this file pins: anyone signed in
 * contributes a character or a plant only with the rights accepted; it waits
 * as pending, visible to its uploader and reviewers only, files included;
 * the limits hold under parallel uploads; a reviewer approves it into
 * everyone's catalog or rejects it with a reason the uploader reads; retiring
 * a character sends its wearers back to the pack default, live; and every
 * transition lands in the audit trail.
 */

import { describe, expect, it } from 'vitest';
import { ART_IMAGE_SPECS, artSheetKey, sheetSize, type ArtImageKind, type ArtPackManifest } from '../../../src/game/artContract.ts';
import { parseArtPackManifest } from '../../../src/game/artPack.ts';
import { ART_PACK_DEFAULTS } from '../decor/artCatalogRules.ts';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import { createMemoryDecor, type MemoryDecor } from '../decor/memoryDecor.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import { handleListOfficeAssets } from '../decor/decorRoutes.ts';
import { handleGetAvatar, handleSetAvatar } from '../directory/avatarRoutes.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import {
  handleApproveContribution,
  handleGetPrivateArtFile,
  handleListMyContributions,
  handleListReviewQueue,
  handleRejectContribution,
  handleRetireArtPiece,
  handleSubmitContribution,
  type ArtContributionDeps,
} from './artContributionRoutes.ts';
import type { AssetStoragePort } from './assetStoragePort.ts';
import { handleGetAssetFile, handleUploadedArtManifest } from './assetUploadRoutes.ts';
import { createMemoryAssetStorage } from './memoryAssetStorage.ts';
import { encodePng } from './pngCodec.ts';

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

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin', displayName: 'Admin' });
const ANA = user({ id: 'id-ana', uid: 'uid-ana', displayName: 'Ana' });
const BETO = user({ id: 'id-beto', uid: 'uid-beto', displayName: 'Beto' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const AS_ADMIN = 'Bearer valido-uid-admin';
const AS_ANA = 'Bearer valido-uid-ana';
const AS_BETO = 'Bearer valido-uid-beto';
/** Leaves out the pack chairs, desk decor from the pack registration on. */
const notPackChair = (asset: { textureKey: string }) => !asset.textureKey.startsWith('art:chair-');
const PACK: ArtPackManifest = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));

/** A valid sheet; `shade` changes its pixels, so each shade is another piece. */
function sheet(kind: ArtImageKind, shade = 0): string {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = spec.frame.height >> 1; y < height; y += spec.frame.height) {
    for (let x = spec.frame.width >> 1; x < width; x += spec.frame.width) data.set([30 + shade, 90, 160, 255], (y * width + x) * 4);
  }
  return encodePng({ width, height, data }).toString('base64');
}

function characterBody(shade = 0, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'character',
    name: `Lucía ${shade}`,
    author: 'Ana',
    rightsAccepted: true,
    files: { walk: sheet('character-walk', shade), seated: sheet('character-seated', shade) },
    ...overrides,
  };
}

function plantBody(shade = 0): Record<string, unknown> {
  return { kind: 'plant', name: `Helecho ${shade}`, author: 'Ana', material: 'helecho', rightsAccepted: true, files: { sheet: sheet('plant', shade) } };
}

interface Harness extends ArtContributionDeps {
  decor: MemoryDecor;
  retiredLive: [string, string][];
}

async function deps(overrides: { storage?: AssetStoragePort; now?: () => Date } = {}): Promise<Harness> {
  const decor = createMemoryDecor({ now: overrides.now });
  await decor.registerArtPack(PACK);
  const retiredLive: [string, string][] = [];
  return {
    directory: createMemoryDirectory({ seed: [ADMIN, ANA, BETO] }),
    auth: verifier,
    identityAdmin: null,
    decor,
    storage: overrides.storage ?? createMemoryAssetStorage(),
    characters: { retireCharacter: (pieceId, fallbackId) => void retiredLive.push([pieceId, fallbackId]) },
    retiredLive,
  };
}

async function submit(d: Harness, authorization: string, body: Record<string, unknown>) {
  const result = await handleSubmitContribution(authorization, body, d);
  return result as { status: number; body: { contribution: { id: string; status: string; piece: { files: { sha256: string; path: string }[] } } } & Record<string, unknown> };
}

describe('handleSubmitContribution', () => {
  it('needs a signed-in account, but no admin role', async () => {
    const d = await deps();
    expect((await handleSubmitContribution(undefined, characterBody(), d)).status).toBe(401);
    expect((await submit(d, AS_ANA, characterBody())).status).toBe(201);
  });

  it('an employee uploads a valid character: it is pending, stamped and audited, and out of the catalog', async () => {
    const d = await deps();

    const result = await submit(d, AS_ANA, characterBody());

    expect(result.status).toBe(201);
    expect(result.body.contribution).toMatchObject({ kind: 'character', status: 'pending', author: 'Ana', reviewNote: null });
    expect((result.body.contribution as unknown as { licenseAcceptedAt: string }).licenseAcceptedAt).toEqual(expect.any(String));
    const id = result.body.contribution.id;
    expect((await d.decor.listArtPieces()).some((piece) => piece.id === id)).toBe(false);
    expect(d.decor.artAuditLog().map(({ action, actorId, pieceId }) => [action, actorId, pieceId])).toEqual([['submit-art', ANA.id, id]]);
  });

  it('without the rights statement accepted, the upload is refused and nothing is stored', async () => {
    const d = await deps();

    expect(await handleSubmitContribution(AS_ANA, characterBody(0, { rightsAccepted: false }), d)).toEqual({
      status: 400,
      body: { error: 'rights-not-accepted', field: 'rightsAccepted' },
    });
    expect(await handleSubmitContribution(AS_ANA, characterBody(0, { rightsAccepted: undefined }), d)).toMatchObject({ status: 400 });
    expect(await d.decor.listUploadedArtPieces()).toEqual([]);
    expect(d.decor.artAuditLog()).toEqual([]);
  });

  it('refuses a desk or a floor: those stay the Admin upload', async () => {
    const d = await deps();
    const desk = { kind: 'desk', name: 'Roble', author: 'Ana', material: 'roble', rightsAccepted: true, files: { sheet: sheet('desk') } };

    expect(await handleSubmitContribution(AS_ANA, desk, d)).toEqual({ status: 400, body: { error: 'invalid-metadata', field: 'kind' } });
  });

  it('the sixth pending piece of a user is refused with too-many-pending, before any file is stored', async () => {
    const stored: string[] = [];
    const inner = createMemoryAssetStorage();
    const d = await deps({ storage: { put: async (sha, png) => void (stored.push(sha), await inner.put(sha, png)), get: inner.get } });
    for (let n = 1; n <= 5; n += 1) expect((await submit(d, AS_ANA, characterBody(n))).status).toBe(201);
    const before = stored.length;

    expect(await handleSubmitContribution(AS_ANA, characterBody(6), d)).toEqual({ status: 429, body: { error: 'too-many-pending' } });
    expect(stored).toHaveLength(before);
    // Somebody else still can.
    expect((await submit(d, AS_BETO, characterBody(7))).status).toBe(201);
  });

  it('the eleventh upload within an hour is refused with hourly-limit, rejected ones included', async () => {
    const d = await deps();
    for (let n = 1; n <= 10; n += 1) {
      const created = await submit(d, AS_ANA, characterBody(n));
      expect(created.status).toBe(201);
      await handleRejectContribution(AS_ADMIN, created.body.contribution.id, { reason: 'No' }, d);
    }

    expect(await handleSubmitContribution(AS_ANA, characterBody(11), d)).toEqual({ status: 429, body: { error: 'hourly-limit' } });
  });

  it('parallel uploads never exceed the pending cap', async () => {
    const d = await deps();
    for (let n = 1; n <= 4; n += 1) await submit(d, AS_ANA, characterBody(n));

    const results = await Promise.all([5, 6, 7].map((n) => handleSubmitContribution(AS_ANA, characterBody(n), d)));

    expect(results.map((result) => result.status).sort()).toEqual([201, 429, 429]);
    expect((await d.decor.artContributionUsage(ANA.id)).pending).toBe(5);
  });

  it('refuses the same pixels twice', async () => {
    const d = await deps();
    await submit(d, AS_ANA, characterBody(1));
    expect(await handleSubmitContribution(AS_BETO, characterBody(1), d)).toEqual({ status: 409, body: { error: 'asset-already-uploaded' } });
  });
});

describe('pending privacy', () => {
  it('a pending piece is listed only for its uploader and in the review queue', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const id = body.contribution.id;

    const mine = await handleListMyContributions(AS_ANA, d);
    expect((mine.body.contributions as { id: string }[]).map((entry) => entry.id)).toEqual([id]);
    expect(mine.body.usage).toEqual({ pending: 1, lastHour: 1, maxPending: 5, maxPerHour: 10 });
    expect((await handleListMyContributions(AS_BETO, d)).body.contributions).toEqual([]);

    expect((await handleListReviewQueue(AS_BETO, 'pending', d)).status).toBe(403);
    const queue = await handleListReviewQueue(AS_ADMIN, undefined, d);
    expect(queue.status).toBe(200);
    expect(queue.body.contributions).toEqual([expect.objectContaining({ id, status: 'pending', uploadedBy: { id: ANA.id, name: 'Ana', email: ANA.email } })]);
  });

  it('a pending piece is in no public read: not the uploads manifest, not the selector, not the decor catalog', async () => {
    const d = await deps();
    const character = await submit(d, AS_ANA, characterBody());
    const plant = await submit(d, AS_ANA, plantBody());

    const manifest = parseArtPackManifest((await handleUploadedArtManifest(d.decor)).body);
    expect(manifest?.pieces).toEqual([]);
    expect(await handleSetAvatar(AS_ANA, { avatarId: character.body.contribution.id }, d)).toMatchObject({ status: 400, body: { reason: 'unknown-piece' } });
    const assets = await handleListOfficeAssets(AS_ANA, d);
    expect((assets.body.assets as { textureKey: string }[]).some((asset) => asset.textureKey === artSheetKey(plant.body.contribution.id, 'sheet'))).toBe(false);
  });

  it('its files are not public, and the private route serves them to the uploader and reviewers only', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const file = body.contribution.piece.files[0]!;

    expect((await handleGetAssetFile(file.path, d)).status).toBe(404);
    expect((await handleGetPrivateArtFile(undefined, file.path, d)).status).toBe(401);
    expect((await handleGetPrivateArtFile(AS_BETO, file.path, d)).status).toBe(404);
    const own = await handleGetPrivateArtFile(AS_ANA, file.path, d);
    expect(own.status).toBe(200);
    if ('png' in own) {
      expect(own.headers['Cache-Control']).toBe('private, no-store');
      expect(own.headers['Content-Type']).toBe('image/png');
    }
    expect((await handleGetPrivateArtFile(AS_ADMIN, file.path, d)).status).toBe(200);
    expect((await handleGetPrivateArtFile(AS_ANA, `${'e'.repeat(64)}.png`, d)).status).toBe(404);
    expect((await handleGetPrivateArtFile(AS_ANA, '../x.png', d)).status).toBe(404);
  });
});

describe('review', () => {
  it('only reviewers approve or reject', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    expect((await handleApproveContribution(AS_ANA, body.contribution.id, d)).status).toBe(403);
    expect((await handleRejectContribution(AS_BETO, body.contribution.id, { reason: 'x' }, d)).status).toBe(403);
  });

  it('an approved character reaches everyone: the manifest, its files, and the selector of another user', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const id = body.contribution.id;

    const approved = await handleApproveContribution(AS_ADMIN, id, d);

    expect(approved).toMatchObject({ status: 200, body: { contribution: { id, status: 'approved' } } });
    const manifest = parseArtPackManifest((await handleUploadedArtManifest(d.decor)).body);
    expect(manifest?.pieces.map((piece) => [piece.id, piece.author])).toEqual([[id, 'Ana']]);
    expect((await handleGetAssetFile(body.contribution.piece.files[0]!.path, d)).status).toBe(200);
    expect(await handleSetAvatar(AS_BETO, { avatarId: id }, d)).toMatchObject({ status: 200, body: { avatarId: id } });
  });

  it('an approved plant becomes desk decor, credited to its author', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, plantBody());

    await handleApproveContribution(AS_ADMIN, body.contribution.id, d);

    const assets = await handleListOfficeAssets(AS_BETO, d);
    // The pack chairs are desk decor from the registration on; only the contribution is new.
    expect((assets.body.assets as { textureKey: string }[]).filter(notPackChair)).toEqual([expect.objectContaining({ textureKey: artSheetKey(body.contribution.id, 'sheet'), author: 'Ana' })]);
  });

  it('a rejection needs a reason, and the uploader reads it', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const id = body.contribution.id;

    expect(await handleRejectContribution(AS_ADMIN, id, { reason: '   ' }, d)).toEqual({ status: 400, body: { error: 'invalid-review-note', field: 'reason' } });
    expect((await handleRejectContribution(AS_ADMIN, id, { reason: 'Tiene fondo blanco' }, d)).status).toBe(200);

    const mine = await handleListMyContributions(AS_ANA, d);
    expect(mine.body.contributions).toEqual([expect.objectContaining({ id, status: 'rejected', reviewNote: 'Tiene fondo blanco' })]);
    expect(parseArtPackManifest((await handleUploadedArtManifest(d.decor)).body)?.pieces).toEqual([]);
    // The uploader keeps the preview, to see what the reason is about.
    expect((await handleGetPrivateArtFile(AS_ANA, body.contribution.piece.files[0]!.path, d)).status).toBe(200);
  });

  it('a decision is final; an unknown id is 404', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    await handleApproveContribution(AS_ADMIN, body.contribution.id, d);

    expect(await handleRejectContribution(AS_ADMIN, body.contribution.id, { reason: 'x' }, d)).toEqual({ status: 409, body: { error: 'already-reviewed' } });
    expect((await handleApproveContribution(AS_ADMIN, 'character-upload-ffffffffffffffff', d)).status).toBe(404);
  });

  it('the queue filters by status', async () => {
    const d = await deps();
    const first = await submit(d, AS_ANA, characterBody(1));
    await submit(d, AS_ANA, characterBody(2));
    await handleApproveContribution(AS_ADMIN, first.body.contribution.id, d);

    const approved = await handleListReviewQueue(AS_ADMIN, 'approved', d);
    expect((approved.body.contributions as { id: string }[]).map((entry) => entry.id)).toEqual([first.body.contribution.id]);
    expect((await handleListReviewQueue(AS_ADMIN, 'nope', d)).status).toBe(400);
  });
});

describe('handleRetireArtPiece', () => {
  it('retiring a character in use sends its users to the pack default, persisted and live', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const id = body.contribution.id;
    await handleApproveContribution(AS_ADMIN, id, d);
    await handleSetAvatar(AS_BETO, { avatarId: id }, d);

    const result = await handleRetireArtPiece(AS_ADMIN, id, d);

    expect(result).toMatchObject({ status: 200, body: { changed: true, usersReset: 1, contribution: { id, retiredAt: expect.any(String) } } });
    expect((await handleGetAvatar(AS_BETO, d)).body).toMatchObject({ avatarId: ART_PACK_DEFAULTS.character });
    expect(d.retiredLive).toEqual([[id, ART_PACK_DEFAULTS.character]]);
    // No longer offered: out of the manifest, and a new choice of it is refused.
    expect(parseArtPackManifest((await handleUploadedArtManifest(d.decor)).body)?.pieces).toEqual([]);
    expect(await handleSetAvatar(AS_BETO, { avatarId: id }, d)).toMatchObject({ status: 400, body: { reason: 'retired-piece' } });
  });

  it('retiring a plant stops offering it but keeps it drawable for whoever placed it', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, plantBody());
    const id = body.contribution.id;
    await handleApproveContribution(AS_ADMIN, id, d);

    expect((await handleRetireArtPiece(AS_ADMIN, id, d)).status).toBe(200);

    expect(((await handleListOfficeAssets(AS_BETO, d)).body.assets as { textureKey: string }[]).filter(notPackChair)).toEqual([]);
    expect(parseArtPackManifest((await handleUploadedArtManifest(d.decor)).body)?.pieces.map((piece) => piece.id)).toEqual([id]);
    expect((await handleGetAssetFile(body.contribution.piece.files[0]!.path, d)).status).toBe(200);
    expect(d.retiredLive).toEqual([]);
  });

  it('is for reviewers, only for approved contributable pieces, and converges when repeated', async () => {
    const d = await deps();
    const { body } = await submit(d, AS_ANA, characterBody());
    const id = body.contribution.id;

    expect((await handleRetireArtPiece(AS_ANA, id, d)).status).toBe(403);
    expect(await handleRetireArtPiece(AS_ADMIN, id, d)).toEqual({ status: 409, body: { error: 'not-approved' } });
    expect((await handleRetireArtPiece(AS_ADMIN, 'character-upload-ffffffffffffffff', d)).status).toBe(404);

    await handleApproveContribution(AS_ADMIN, id, d);
    expect((await handleRetireArtPiece(AS_ADMIN, id, d)).body).toMatchObject({ changed: true });
    // A retry still resets anyone left on it, without a second audit entry.
    expect((await handleRetireArtPiece(AS_ADMIN, id, d)).body).toMatchObject({ changed: false });
    expect(d.decor.artAuditLog().filter((entry) => entry.action === 'retire-art')).toHaveLength(1);
    expect(d.retiredLive).toHaveLength(2);
  });

  it('refuses an Admin-uploaded desk: desks and floors are not withdrawn this way', async () => {
    const d = await deps();
    const desk = PACK.pieces.find((piece) => piece.id === 'desk-wood')!;
    const { piece } = await d.decor.registerUploadedArtPiece({ piece: { ...desk, id: 'desk-upload-0123456789abcdef' }, uploadedBy: ADMIN.id });

    expect(await handleRetireArtPiece(AS_ADMIN, piece.id, d)).toEqual({ status: 409, body: { error: 'not-retirable' } });
  });
});

describe('audit', () => {
  it('every transition leaves an entry: upload, approval, rejection and withdrawal', async () => {
    const d = await deps();
    const one = await submit(d, AS_ANA, characterBody(1));
    const two = await submit(d, AS_ANA, characterBody(2));
    await handleApproveContribution(AS_ADMIN, one.body.contribution.id, d);
    await handleRejectContribution(AS_ADMIN, two.body.contribution.id, { reason: 'No' }, d);
    await handleRetireArtPiece(AS_ADMIN, one.body.contribution.id, d);

    expect(d.decor.artAuditLog().map(({ action, actorId }) => [action, actorId])).toEqual([
      ['submit-art', ANA.id],
      ['submit-art', ANA.id],
      ['approve-art', ADMIN.id],
      ['reject-art', ADMIN.id],
      ['retire-art', ADMIN.id],
    ]);
  });
});
