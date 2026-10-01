/**
 * Pure rules of an Admin upload (#121): the body shape, the metadata each
 * kind needs and the manifest entry the catalog stores, built here so the
 * route only moves bytes. The entry is the same shape as a pack piece, so the
 * office, the character selector and the material forms read uploads with the
 * parser they already use for the pack (`parseArtPackManifest`).
 *
 * ## Body
 *
 * JSON, not multipart: `{ kind, name, author, license, material?, colorable?,
 * defaultColor?, facings?, files: { <role>: <base64 PNG> } }`. A piece can
 * need two files (a character's walk and seated sheets), JSON keeps the
 * route a pure `{ status, body }` handler like every other one, and it needs
 * no multipart dependency. Base64 costs a third more on at most 256 KB.
 *
 * ## Kinds
 *
 * Only what the office can use without a map edit: characters (the entrance
 * selector), desk and floor materials (the creation forms) and plants (desk
 * decor). Walls, the tileset, bridges, hedges and tables are placed by the
 * Tiled layout and keep coming from the pack.
 *
 * ## Identity
 *
 * `<kind>-upload-<16 hex>`, derived from the hashes of the re-encoded files:
 * the same pixels are the same piece, and the `upload` marker is reserved
 * (`normalizeArtPack` refuses it), so an upload can never collide with a
 * pack id. The kind prefix keeps the rule every stored choice relies on.
 */

import { createHash } from 'node:crypto';
import {
  artSheetKey,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  FLOOR,
  PACK_FACINGS,
  PLANT,
  type ArtDeskPiece,
  type ArtImageKind,
  type ArtPiece,
  type ArtPieceFile,
  type Point,
} from '../../../src/game/artContract.ts';
import { uploadedPieceIdPrefix } from '../decor/artCatalogRules.ts';
import { CONTRIBUTION_LICENSE, isContributionKind } from '../decor/artReviewRules.ts';
import type { CreateAssetInput } from '../decor/decorPort.ts';
import { AssetUploadError, MAX_UPLOAD_FILE_BYTES, prepareAssetImage, type PreparedAssetImage } from './assetImageRules.ts';

export const UPLOAD_FILE_ROLES = {
  character: [
    { role: 'walk', imageKind: 'character-walk' },
    { role: 'seated', imageKind: 'character-seated' },
  ],
  desk: [{ role: 'sheet', imageKind: 'desk' }],
  floor: [{ role: 'sheet', imageKind: 'floor' }],
  plant: [{ role: 'sheet', imageKind: 'plant' }],
} as const satisfies Readonly<Record<string, readonly { role: string; imageKind: ArtImageKind }[]>>;

export type UploadableKind = keyof typeof UPLOAD_FILE_ROLES;
export const UPLOADABLE_KINDS = Object.keys(UPLOAD_FILE_ROLES) as UploadableKind[];

export const MAX_NAME_LENGTH = 60;
export const MAX_CREDIT_LENGTH = 80;
/** Same vocabulary as the pack materials (`wood`, `glass`, `ficus`). */
const MATERIAL = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Generous for any desk cell: a facing point lives inside the 64x64 frame around the anchor. */
const MAX_FACING_OFFSET = 64;

export interface PreparedUpload {
  readonly piece: ArtPiece;
  /** In the order of `piece.files`. */
  readonly files: readonly PreparedAssetImage[];
}

export interface PrepareUploadOptions {
  /**
   * Facing geometry for a desk whose body carries none. Every pack desk
   * shares one, so the route passes the pack default desk's.
   */
  defaultDeskFacings?: ArtDeskPiece['facings'];
}

export function isUploadedPieceId(id: string): boolean {
  return /^[a-z]+-upload-[0-9a-f]{16}$/.test(id);
}

/** Where a stored file is served, relative to the uploads manifest (`/assets/files/`). */
export function uploadedFilePath(sha256: string): string {
  return `${sha256}.png`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(field: string | null, message: string): AssetUploadError {
  return new AssetUploadError('invalid-metadata', field, message);
}

function text(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0 || trimmed.length > max) throw invalid(field, `${field} must be 1 to ${max} characters`);
  return trimmed;
}

function material(body: Record<string, unknown>): string {
  const value = body.material;
  if (typeof value !== 'string' || !MATERIAL.test(value)) throw invalid('material', 'material must be lowercase letters, digits and dashes');
  return value;
}

function colorModel(body: Record<string, unknown>): { colorable: boolean; defaultColor: string | null } {
  const colorable = body.colorable ?? false;
  if (typeof colorable !== 'boolean') throw invalid('colorable', 'colorable must be a boolean');
  const color = body.defaultColor ?? null;
  if (colorable) {
    if (typeof color !== 'string' || !COLOR.test(color)) throw invalid('defaultColor', 'a colorable piece needs a #rrggbb default color');
    return { colorable, defaultColor: color.toLowerCase() };
  }
  // Same rule as the catalog: a material without a color to choose stores NULL.
  if (color !== null) throw invalid('defaultColor', 'only a colorable piece has a default color');
  return { colorable, defaultColor: null };
}

function isOffset(value: unknown): value is Point {
  return (
    isRecord(value) &&
    [value.x, value.y].every((n) => Number.isInteger(n) && Math.abs(n as number) <= MAX_FACING_OFFSET)
  );
}

function deskFacings(body: Record<string, unknown>, fallback: ArtDeskPiece['facings'] | undefined): ArtDeskPiece['facings'] {
  const raw = body.facings ?? fallback;
  if (!isRecord(raw)) throw invalid('facings', 'a desk needs the ground and chair point of each facing');
  const entries = PACK_FACINGS.map((facing) => {
    const entry = raw[facing];
    if (!isRecord(entry) || !isOffset(entry.ground) || !isOffset(entry.chairGround)) {
      throw invalid('facings', `facing ${facing} needs integer ground and chairGround offsets`);
    }
    // The footprint is the contract's (`DESK.footprintByFacing`), whatever the body says.
    const value = { footprint: DESK.footprintByFacing[facing], ground: { x: entry.ground.x, y: entry.ground.y }, chairGround: { x: entry.chairGround.x, y: entry.chairGround.y } };
    return [facing, value] as const;
  });
  return Object.fromEntries(entries) as unknown as ArtDeskPiece['facings'];
}

function decodeFile(value: unknown, role: string): Buffer {
  if (typeof value !== 'string') throw new AssetUploadError('missing-file', role, `the ${role} file is missing`);
  // Checked on the encoded length, so an oversized body is never decoded.
  if (value.length > Math.ceil((MAX_UPLOAD_FILE_BYTES * 4) / 3) + 4) {
    throw new AssetUploadError('too-large', role, `${role} is over ${MAX_UPLOAD_FILE_BYTES} bytes`);
  }
  if (!BASE64.test(value)) throw new AssetUploadError('not-png', role, `${role} is not base64`);
  return Buffer.from(value, 'base64');
}

/** Hash of the kind and the role/hash pairs: the same pixels give the same id. */
function pieceId(kind: UploadableKind, files: readonly { role: string; sha256: string }[]): string {
  const canonical = [kind, ...files.map((file) => `${file.role}:${file.sha256}`).sort()].join('\n');
  return `${uploadedPieceIdPrefix(kind)}${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
}

/** Validates the whole body and every file, then builds the manifest entry. Throws `AssetUploadError`. */
export function prepareAssetUpload(body: unknown, options: PrepareUploadOptions = {}): PreparedUpload {
  if (!isRecord(body)) throw invalid(null, 'the upload is not an object');
  const kind = body.kind;
  if (typeof kind !== 'string' || !(UPLOADABLE_KINDS as readonly string[]).includes(kind)) {
    throw invalid('kind', `kind must be one of ${UPLOADABLE_KINDS.join(', ')}`);
  }
  const uploadKind = kind as UploadableKind;
  const credits = {
    name: text(body, 'name', MAX_NAME_LENGTH),
    author: text(body, 'author', MAX_CREDIT_LENGTH),
    license: text(body, 'license', MAX_CREDIT_LENGTH),
  };
  // Metadata before files: decoding is the expensive part, and a typo should not cost it.
  const extra = (() => {
    switch (uploadKind) {
      case 'character':
        return { anchors: { walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor }, footprint: CHARACTER_WALK.footprint };
      case 'desk':
        return { material: material(body), ...colorModel(body), anchor: DESK.anchor, facings: deskFacings(body, options.defaultDeskFacings) };
      case 'floor':
        return { material: material(body), ...colorModel(body), motifTiles: FLOOR.motifTiles };
      case 'plant':
        return { material: material(body), footprint: PLANT.footprint, anchor: PLANT.anchor, layer: PLANT.layer, collision: PLANT.collision };
    }
  })();

  const roles = UPLOAD_FILE_ROLES[uploadKind];
  const sent = body.files;
  if (!isRecord(sent)) throw invalid('files', 'files must map each role to a base64 PNG');
  const known = new Set<string>(roles.map((entry) => entry.role));
  if (Object.keys(sent).some((role) => !known.has(role))) throw invalid('files', `${kind} takes only ${[...known].join(', ')}`);
  const files = roles.map(({ role, imageKind }) => prepareAssetImage(imageKind, decodeFile(sent[role], role), role));

  const pieceFiles: ArtPieceFile[] = files.map((file, i) => ({
    role: roles[i]!.role,
    path: uploadedFilePath(file.sha256),
    imageKind: file.imageKind,
    width: file.width,
    height: file.height,
    sha256: file.sha256,
  }));
  const id = pieceId(uploadKind, pieceFiles);
  const piece = { id, kind: uploadKind, ...credits, ...extra, files: pieceFiles } as unknown as ArtPiece;
  return { piece, files };
}

/**
 * A contribution (#122): the same body, checks and piece as an Admin upload,
 * minus what only an Admin decides. Only characters and decor plants, and
 * only with `rightsAccepted: true`, the checkbox of the form; the license is
 * that grant (`CONTRIBUTION_LICENSE`), whatever the body says. Both checks run
 * before any file is decoded.
 */
export function prepareContribution(body: unknown): PreparedUpload {
  if (!isRecord(body)) throw invalid(null, 'the upload is not an object');
  if (body.rightsAccepted !== true) {
    throw new AssetUploadError('rights-not-accepted', 'rightsAccepted', 'the rights statement must be accepted');
  }
  if (!isContributionKind(body.kind)) throw invalid('kind', 'only characters and decor plants can be contributed');
  return prepareAssetUpload({ ...body, license: CONTRIBUTION_LICENSE });
}

/**
 * The desk decor asset that draws an uploaded plant, so the existing decor
 * flow (`/me/desk`) can place it with no change. Any other kind has none.
 */
export function decorAssetForPiece(piece: ArtPiece): CreateAssetInput | undefined {
  if (piece.kind !== 'plant') return undefined;
  return { name: piece.name, kind: 'plant', textureKey: artSheetKey(piece.id, 'sheet'), w: piece.footprint.w, h: piece.footprint.h, placeableOnDesk: true };
}
