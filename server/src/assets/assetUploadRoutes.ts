/**
 * HTTP side of the Admin upload (#121): pure handlers returning
 * `{ status, body }`, like `decorRoutes.ts`, so wiring has nothing to decide.
 *
 *   - `POST /admin/assets/upload` (Admin, `authorize`): validates, re-encodes,
 *     stores each file under its hash and registers the piece. The body
 *     format is `assetUploadRules.ts`'s.
 *   - `GET /assets/files/manifest.json` (public, like the pack's own
 *     manifest): the active uploads, as a manifest the office, the character
 *     selector and the material forms parse with the pack parser. Their file
 *     paths are relative to it, so the same `/assets/files/` prefix serves both.
 *   - `GET /assets/files/<sha256>.png` (public): one stored file, immutable.
 *
 * Order of an upload: credential, then the body, then storage, then the
 * catalog. Files go first so a registered piece never points at a missing
 * file; a refusal after that leaves only content-addressed objects behind,
 * which a retry reuses.
 */

import {
  ART_CONTRACT_VERSION,
  ART_FILE_FORMAT,
  ART_PACK_FORMAT,
  ART_TILE,
  artSheetKey,
  type ArtDeskPiece,
} from '../../../src/game/artContract.ts';
import { authorize, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { ART_PACK_DEFAULTS, ArtPieceExistsError } from '../decor/artCatalogRules.ts';
import type { CreateAssetInput, DecorCatalog } from '../decor/decorPort.ts';
import { toAssetBody } from '../decor/decorRoutes.ts';
import { AssetNameTakenError, InvalidAssetError } from '../decor/decorRules.ts';
import { AssetUploadError } from './assetImageRules.ts';
import { isAssetHash, type AssetStoragePort } from './assetStoragePort.ts';
import { prepareAssetUpload } from './assetUploadRules.ts';

export interface AssetUploadDeps extends AdminDeps {
  decor: DecorCatalog;
  storage: AssetStoragePort;
}

/** Served files never change under their name, so any cache may keep them forever. */
export const ASSET_FILE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=31536000, immutable',
  // An image and nothing else: no sniffing it into HTML, nothing it could run.
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

export type AssetFileResult =
  | { status: 200; headers: Readonly<Record<string, string>>; png: Uint8Array }
  | { status: 404; body: Record<string, unknown> };

const NOT_FOUND = { status: 404, body: { error: 'not-found' } } as const;

/** The desk facings every pack desk shares, from the pack default desk. */
async function defaultDeskFacings(decor: DecorCatalog): Promise<ArtDeskPiece['facings'] | undefined> {
  const pieces = await decor.listArtPieces({ includeRetired: true });
  const desk = pieces.find((piece) => piece.id === ART_PACK_DEFAULTS.desk)?.spec;
  return desk?.kind === 'desk' ? desk.facings : undefined;
}

function wantsDefaultFacings(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as Record<string, unknown>).kind === 'desk' && (body as Record<string, unknown>).facings === undefined;
}

export async function handleUploadAsset(authorization: unknown, body: unknown, deps: AssetUploadDeps): Promise<AdminResult> {
  // The credential before the body, as everywhere under /admin: a 400 here
  // would tell a prober that its request reached the logic.
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  try {
    const facings = wantsDefaultFacings(body) ? await defaultDeskFacings(deps.decor) : undefined;
    const { piece, files } = prepareAssetUpload(body, { defaultDeskFacings: facings });
    for (const file of files) await deps.storage.put(file.sha256, file.png);

    // A plant is desk decor: its catalog asset draws the uploaded sheet, so
    // the existing decor flow (`/me/desk`) can place it with no change.
    const decorAsset: CreateAssetInput | undefined =
      piece.kind === 'plant'
        ? { name: piece.name, kind: 'plant', textureKey: artSheetKey(piece.id, 'sheet'), w: piece.footprint.w, h: piece.footprint.h, placeableOnDesk: true }
        : undefined;
    const registered = await deps.decor.registerUploadedArtPiece({ piece, uploadedBy: authorized.user.id, decorAsset });
    return {
      status: 201,
      body: { piece: registered.piece.spec, asset: registered.asset === null ? null : toAssetBody(registered.asset) },
    };
  } catch (error) {
    if (error instanceof AssetUploadError) return { status: 400, body: { error: error.code, field: error.field } };
    // The decor name rules (a name with no letter or digit has no slug).
    if (error instanceof InvalidAssetError) return { status: 400, body: { error: 'invalid-metadata', field: 'name' } };
    if (error instanceof ArtPieceExistsError) return { status: 409, body: { error: 'asset-already-uploaded' } };
    if (error instanceof AssetNameTakenError) return { status: 409, body: { error: 'asset-name-taken' } };
    throw error;
  }
}

/**
 * The uploads as a manifest of their own, next to their files. Only active
 * ones: like the pack's manifest, it is what can be chosen and loaded today.
 */
export async function handleUploadedArtManifest(decor: DecorCatalog): Promise<AdminResult> {
  const pieces = await decor.listArtPieces();
  return {
    status: 200,
    body: {
      format: ART_PACK_FORMAT,
      contractVersion: ART_CONTRACT_VERSION,
      fileFormat: ART_FILE_FORMAT,
      tile: ART_TILE,
      // Each upload carries its own author and license.
      author: 'per-piece',
      license: 'per-piece',
      defaults: ART_PACK_DEFAULTS,
      pieces: pieces.filter((piece) => piece.source === 'upload').map((piece) => piece.spec),
    },
  };
}

/** `file` is the last path segment: `<sha256>.png` and nothing else reaches storage. */
export async function handleGetAssetFile(file: unknown, storage: AssetStoragePort): Promise<AssetFileResult> {
  if (typeof file !== 'string' || !file.endsWith('.png')) return NOT_FOUND;
  const sha256 = file.slice(0, -'.png'.length);
  if (!isAssetHash(sha256)) return NOT_FOUND;
  const png = await storage.get(sha256);
  if (png === null) return NOT_FOUND;
  return { status: 200, headers: ASSET_FILE_HEADERS, png };
}
