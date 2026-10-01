/**
 * The upload routes (#121) as pure functions, without Express, like
 * `decorRoutes.test.ts`. What this file pins: the Admin guard runs before the
 * body is read, what is stored is the re-encoded file, a valid upload shows up
 * in the uploads manifest the office reads, and files are served immutable.
 */

import { describe, expect, it } from 'vitest';
import {
  ART_CONTRACT_VERSION,
  ART_IMAGE_SPECS,
  artSheetKey,
  sheetSize,
  type ArtImageKind,
  type ArtPackManifest,
} from '../../../src/game/artContract.ts';
import { parseArtPackManifest } from '../../../src/game/artPack.ts';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import type { DecorCatalog } from '../decor/decorPort.ts';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { AssetStoragePort } from './assetStoragePort.ts';
import { handleGetAssetFile, handleUploadAsset, handleUploadedArtManifest, type AssetUploadDeps } from './assetUploadRoutes.ts';
import { createMemoryAssetStorage } from './memoryAssetStorage.ts';
import { decodePng, encodePng } from './pngCodec.ts';

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

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin' });
const EMPLEADO = user({ id: 'id-empleado', uid: 'uid-empleado' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_EMPLEADO = 'Bearer valido-uid-empleado';
const PACK: ArtPackManifest = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));

function sheet(kind: ArtImageKind): Buffer {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = x % spec.frame.width === spec.frame.width >> 1 && y % spec.frame.height === spec.frame.height >> 1;
      if (spec.alpha === 'opaque' || center) data.set([120, 80, 40, 255], (y * width + x) * 4);
    }
  }
  return encodePng({ width, height, data });
}

/** A valid sheet carrying a text chunk, so storing the original would be visible. */
function withMetadata(png: Buffer): Buffer {
  const text = Buffer.from('Comment\0made in some editor', 'latin1');
  const chunk = Buffer.alloc(12 + text.length);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write('tEXt', 4, 'ascii');
  text.copy(chunk, 8);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

const CREDITS = { name: 'Helecho', author: 'Equipo de arte', license: 'proprietary-internal' };

function plantBody(png: Buffer = sheet('plant')): Record<string, unknown> {
  return { kind: 'plant', ...CREDITS, material: 'helecho', files: { sheet: png.toString('base64') } };
}

async function deps(overrides: { decor?: DecorCatalog; storage?: AssetStoragePort } = {}): Promise<AssetUploadDeps> {
  const decor = overrides.decor ?? createMemoryDecor();
  await decor.registerArtPack(PACK);
  return {
    directory: createMemoryDirectory({ seed: [ADMIN, EMPLEADO] }),
    auth: verifier,
    identityAdmin: null,
    decor,
    storage: overrides.storage ?? createMemoryAssetStorage(),
  };
}

describe('handleUploadAsset', () => {
  it('checks the credential and the role before reading the body', async () => {
    const d = await deps();
    expect((await handleUploadAsset(undefined, null, d)).status).toBe(401);
    expect((await handleUploadAsset(BEARER_EMPLEADO, plantBody(), d)).status).toBe(403);
  });

  it('stores the re-encoded file under its hash and registers the piece as an upload by the Admin', async () => {
    const d = await deps();
    const original = withMetadata(sheet('plant'));

    const result = await handleUploadAsset(BEARER_ADMIN, plantBody(original), d);

    expect(result.status).toBe(201);
    const piece = result.body.piece as { id: string; files: { sha256: string; path: string }[] };
    expect(piece.id).toMatch(/^plant-upload-[0-9a-f]{16}$/);
    const stored = await d.storage.get(piece.files[0]!.sha256);
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!).equals(original)).toBe(false);
    expect(Buffer.from(stored!).equals(sheet('plant'))).toBe(true);
    expect(piece.files[0]!.path).toBe(`${piece.files[0]!.sha256}.png`);
    const listed = (await d.decor.listArtPieces()).find((entry) => entry.id === piece.id);
    expect(listed).toMatchObject({ source: 'upload', uploadedBy: ADMIN.id, name: 'Helecho' });
  });

  it('gives an uploaded plant its desk decor asset, drawn from the art texture', async () => {
    const d = await deps();
    const result = await handleUploadAsset(BEARER_ADMIN, plantBody(), d);
    const id = (result.body.piece as { id: string }).id;

    expect(result.body.asset).toMatchObject({ name: 'Helecho', kind: 'plant', textureKey: artSheetKey(id, 'sheet'), w: 1, h: 1, placeableOnDesk: true });
    expect((await d.decor.listAssets()).map((asset) => asset.textureKey)).toEqual([artSheetKey(id, 'sheet')]);
  });

  it('gives a desk without facings the geometry of the pack default desk', async () => {
    const d = await deps();
    const body = { kind: 'desk', ...CREDITS, material: 'roble', files: { sheet: sheet('desk').toString('base64') } };

    const result = await handleUploadAsset(BEARER_ADMIN, body, d);

    expect(result.status).toBe(201);
    const wood = PACK.pieces.find((piece) => piece.id === 'desk-wood');
    expect((result.body.piece as { facings: unknown }).facings).toEqual(wood?.kind === 'desk' ? wood.facings : null);
    expect(result.body.asset).toBeNull();
  });

  it('answers a readable code and the file or field it is about', async () => {
    const d = await deps();
    const wrong = encodePng({ width: 10, height: 10, data: new Uint8ClampedArray(400) });

    expect(await handleUploadAsset(BEARER_ADMIN, plantBody(wrong), d)).toEqual({ status: 400, body: { error: 'invalid-dimensions', field: 'sheet' } });
    expect(await handleUploadAsset(BEARER_ADMIN, { ...plantBody(), files: { sheet: Buffer.from('hola').toString('base64') } }, d)).toEqual({
      status: 400,
      body: { error: 'not-png', field: 'sheet' },
    });
    expect(await handleUploadAsset(BEARER_ADMIN, { ...plantBody(), kind: 'wall' }, d)).toEqual({ status: 400, body: { error: 'invalid-metadata', field: 'kind' } });
    // A name the decor catalog cannot turn into a slug.
    expect(await handleUploadAsset(BEARER_ADMIN, { ...plantBody(), name: '!!!' }, d)).toEqual({ status: 400, body: { error: 'invalid-metadata', field: 'name' } });
    expect(await d.decor.listAssets()).toEqual([]);
  });

  it('refuses the same pixels twice, and a decor name already taken', async () => {
    const d = await deps();
    expect((await handleUploadAsset(BEARER_ADMIN, plantBody(), d)).status).toBe(201);

    expect(await handleUploadAsset(BEARER_ADMIN, { ...plantBody(), name: 'Otro' }, d)).toEqual({ status: 409, body: { error: 'asset-already-uploaded' } });

    // Other pixels are another piece, but its decor asset would take the same name.
    const image = decodePng(sheet('plant'));
    const data = new Uint8ClampedArray(image.data);
    data.set([1, 2, 3, 255], (10 * 32 + 16) * 4);
    const different = encodePng({ ...image, data });
    expect(await handleUploadAsset(BEARER_ADMIN, plantBody(different), d)).toEqual({ status: 409, body: { error: 'asset-name-taken' } });
  });
});

describe('handleUploadedArtManifest', () => {
  it('lists the active uploads as a manifest the office parses with the pack parser', async () => {
    const d = await deps();
    const uploaded = await handleUploadAsset(BEARER_ADMIN, plantBody(), d);

    const result = await handleUploadedArtManifest(d.decor);

    expect(result.status).toBe(200);
    const manifest = parseArtPackManifest(result.body);
    expect(manifest?.contractVersion).toBe(ART_CONTRACT_VERSION);
    expect(manifest?.pieces).toEqual([uploaded.body.piece]);
    // The pack itself stays in its own static manifest.
    expect(manifest?.pieces.some((piece) => piece.id === 'plant-ficus')).toBe(false);
  });
});

describe('handleGetAssetFile', () => {
  it('serves a stored file as an immutable PNG', async () => {
    const storage = createMemoryAssetStorage();
    const png = sheet('plant');
    const sha = 'c'.repeat(64);
    await storage.put(sha, png);

    const result = await handleGetAssetFile(`${sha}.png`, storage);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(Buffer.from(result.png).equals(png)).toBe(true);
    expect(result.headers).toMatchObject({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('answers 404 for an unknown hash or a name that is not one', async () => {
    const storage = createMemoryAssetStorage();
    expect((await handleGetAssetFile(`${'d'.repeat(64)}.png`, storage)).status).toBe(404);
    for (const name of ['manifest.png', `${'d'.repeat(64)}.gif`, '../x.png', undefined]) {
      expect((await handleGetAssetFile(name, storage)).status).toBe(404);
    }
  });
});
