/**
 * Reading the art pack manifest (`public/assets/pack/manifest.json`, written by
 * `pnpm art:export`) into what the office loads. Pure: no Phaser and no
 * network, so the manifest-to-load-list rules are tested under jsdom and
 * `artPackLoader.ts` only moves bytes.
 *
 * The manifest is the catalog the office draws from: which images exist, their
 * frame grid and anchors. Nothing here hard-codes a file of the pack.
 */

import {
  ART_CONTRACT_VERSION,
  ART_IMAGE_KINDS,
  ART_IMAGE_SPECS,
  ART_PACK_FORMAT,
  ART_PIECE_KINDS,
  ART_TILE,
  BRIDGE_ORIENTATIONS,
  PACK_FACINGS,
  TERRAIN_MATERIALS,
  artSheetKey,
  sheetSize,
  type ArtImageKind,
  type ArtPackManifest,
  type ArtPiece,
  type ArtPieceFile,
  type ArtPieceKind,
} from './artContract';

/** Served next to the SPA from `public/`, relative to the page. */
export const ART_PACK_MANIFEST_URL = 'assets/pack/manifest.json';

/**
 * What a desk or a space stores about its look (art migration, step 3): a
 * piece id of the pack and, only for a colorable material, a `#rrggbb` color.
 */
export interface ArtAppearance {
  readonly materialId: string;
  readonly color: string | null;
}

/**
 * Where the office server lists the pieces an Admin uploaded (#121), in the
 * pack's manifest format with file paths relative to it. Not under the SPA
 * like the pack: the server serves both the list and the files, so it hangs
 * from the same origin as every other office API call. `null` without a
 * server, where nothing can have been uploaded.
 */
export const ART_UPLOADS_MANIFEST_PATH = '/assets/files/manifest.json';

export function artUploadsManifestUrl(officeEndpoint: string | null | undefined): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;
  const base = officeEndpoint.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
  return `${base}${ART_UPLOADS_MANIFEST_PATH}`;
}

/** The piece and role of a key `artSheetKey` made, or `null` for any other texture key. */
export function parseArtSheetKey(key: string): { pieceId: string; role: string } | null {
  const match = /^art:([^:@]+):([^:@]+)$/.exec(key);
  return match === null ? null : { pieceId: match[1] as string, role: match[2] as string };
}

/** One manifest the office reads and the URL its file paths are relative to. */
export interface ArtManifestSource {
  readonly manifest: ArtPackManifest | null;
  readonly url: string;
}

/** Every piece the office can draw, from every source, and where each one loads from. */
export interface ArtCatalog {
  readonly manifest: ArtPackManifest;
  /** URL of the manifest the piece came from, for `pieceLoadRequests`. */
  sourceOf(pieceId: string): string | undefined;
}

/**
 * Joins the pack and the uploads into one catalog. Sources are read in order
 * and the first one to list an id keeps it: the pack goes first, so an upload
 * can never replace a pack piece (the server reserves upload ids anyway). The
 * defaults come from the first readable source. `null` when none is readable.
 */
export function combineArtManifests(sources: readonly ArtManifestSource[]): ArtCatalog | null {
  const readable = sources.filter((source): source is { manifest: ArtPackManifest; url: string } => source.manifest !== null);
  const first = readable[0];
  if (first === undefined) return null;
  const origin = new Map<string, string>();
  const pieces: ArtPiece[] = [];
  for (const { manifest, url } of readable) {
    for (const piece of manifest.pieces) {
      if (origin.has(piece.id)) continue;
      origin.set(piece.id, url);
      pieces.push(piece);
    }
  }
  return { manifest: { ...first.manifest, pieces }, sourceOf: (pieceId) => origin.get(pieceId) };
}

/** One spritesheet for Phaser's loader. */
export interface ArtLoadRequest {
  readonly key: string;
  readonly url: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/**
 * Kinds the map draws as soon as the office opens. They load in `preload`, so
 * the first frame shows the pack and not the fallback: the terrain tileset
 * and every piece of the Tiled layout (art step 8). The default character
 * also boots with the office; other characters load once somebody wears them.
 */
export const BOOT_PIECE_KINDS: readonly ArtPieceKind[] = ['floor', 'desk', 'chair', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table'];

const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export { artSheetKey };

/** One texture per material and color, shared by every placement that uses it. */
export function recoloredSheetKey(pieceId: string, role: string, color: string): string {
  return `${artSheetKey(pieceId, role)}@${color}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isFootprint(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.w) && Number.isInteger(value.h);
}

/**
 * A path the office may request: relative to the manifest and inside its
 * folder. The manifest is ours, but it is also re-read during a session, and a
 * `..` or an absolute URL would point the loader somewhere else entirely.
 */
function isPackPath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.startsWith('/') || value.includes(':') || value.includes('\\')) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const PROP_LAYERS: readonly unknown[] = ['ground', 'sorted'];
const PROP_COLLISIONS: readonly unknown[] = ['solid', 'deck'];

/** Placement every map prop needs: where it stands, what it covers, how it sorts and blocks. */
function isPlacedProp(piece: Record<string, unknown>): boolean {
  return isFootprint(piece.footprint) && isPoint(piece.anchor) && PROP_LAYERS.includes(piece.layer) && PROP_COLLISIONS.includes(piece.collision);
}

function isTilesetMaterial(value: unknown): boolean {
  return (
    isRecord(value) &&
    (TERRAIN_MATERIALS as readonly unknown[]).includes(value.material) &&
    isNonEmptyString(value.floor) &&
    typeof value.walkable === 'boolean' &&
    Number.isInteger(value.firstTile)
  );
}

function isPieceFile(value: unknown): value is ArtPieceFile {
  if (!isRecord(value) || !isNonEmptyString(value.role) || !isPackPath(value.path)) return false;
  if (!ART_IMAGE_KINDS.includes(value.imageKind as ArtImageKind)) return false;
  // Frames are cut by the contract grid, so a sheet of another size would slice wrong.
  const expected = sheetSize(ART_IMAGE_SPECS[value.imageKind as ArtImageKind]);
  return value.width === expected.width && value.height === expected.height;
}

function isColorModel(piece: Record<string, unknown>): boolean {
  if (piece.colorable === true) return typeof piece.defaultColor === 'string' && COLOR_PATTERN.test(piece.defaultColor);
  return piece.colorable === false && piece.defaultColor === null;
}

/** The fields the office reads to draw each kind; anything else is the exporter's business. */
function hasDrawingFields(piece: Record<string, unknown>, kind: ArtPieceKind): boolean {
  switch (kind) {
    case 'character':
      return isRecord(piece.anchors) && isPoint(piece.anchors.walk) && isPoint(piece.anchors.seated);
    case 'chair':
      return isRecord(piece.anchors) && isPoint(piece.anchors.seat) && isPoint(piece.anchors.ground);
    case 'desk': {
      const facings = piece.facings;
      if (!isPoint(piece.anchor) || !isRecord(facings) || !isColorModel(piece)) return false;
      return PACK_FACINGS.every((facing) => {
        const entry = facings[facing];
        return isRecord(entry) && isFootprint(entry.footprint) && isPoint(entry.ground) && isPoint(entry.chairGround);
      });
    }
    case 'floor':
      return isColorModel(piece);
    case 'wall':
      return Number.isFinite(piece.segmentLength) && Number.isFinite(piece.thickness);
    case 'tileset':
      return piece.tileSize === ART_TILE && Array.isArray(piece.materials) && piece.materials.length > 0 && piece.materials.every(isTilesetMaterial);
    case 'tree':
    case 'plant':
    case 'table':
      return isPlacedProp(piece);
    case 'hedge':
      return isPlacedProp(piece) && Number.isFinite(piece.height);
    case 'bridge': {
      const deck = piece.deck;
      return isPlacedProp(piece) && isRecord(deck) && BRIDGE_ORIENTATIONS.every((orientation) => isRecord(deck[orientation]) && isFootprint(deck[orientation]));
    }
  }
}

function toPiece(raw: unknown): ArtPiece | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) return null;
  const kind = raw.kind as ArtPieceKind;
  if (!ART_PIECE_KINDS.includes(kind) || !raw.id.startsWith(`${kind}-`)) return null;
  if (!Array.isArray(raw.files) || raw.files.length === 0 || !raw.files.every(isPieceFile)) return null;
  if (!hasDrawingFields(raw, kind)) return null;
  return raw as unknown as ArtPiece;
}

/**
 * The manifest, or `null` when it is not one this office can read.
 *
 * Another format or contract version is rejected whole: its frame grid might
 * not be the one `artContract.ts` describes, and slicing with the wrong grid
 * draws garbage. A malformed piece is dropped alone, so one bad entry never
 * takes the rest of the pack down with it.
 */
export function parseArtPackManifest(raw: unknown): ArtPackManifest | null {
  if (!isRecord(raw) || raw.format !== ART_PACK_FORMAT) return null;
  if (raw.contractVersion !== ART_CONTRACT_VERSION || raw.tile !== ART_TILE) return null;
  if (!Array.isArray(raw.pieces) || !isRecord(raw.defaults)) return null;
  const pieces = raw.pieces.flatMap((entry) => {
    const piece = toPiece(entry);
    return piece === null ? [] : [piece];
  });
  return { ...(raw as unknown as ArtPackManifest), pieces };
}

export function findPiece(manifest: ArtPackManifest, id: string): ArtPiece | undefined {
  return manifest.pieces.find((piece) => piece.id === id);
}

function manifestFolder(manifestUrl: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
}

export function pieceLoadRequests(piece: ArtPiece, manifestUrl: string): ArtLoadRequest[] {
  const folder = manifestFolder(manifestUrl);
  return piece.files.map((file) => {
    const { frame } = ART_IMAGE_SPECS[file.imageKind];
    return {
      key: artSheetKey(piece.id, file.role),
      url: `${folder}${file.path}`,
      frameWidth: frame.width,
      frameHeight: frame.height,
    };
  });
}

export function bootLoadRequests(manifest: ArtPackManifest, manifestUrl: string): ArtLoadRequest[] {
  return manifest.pieces
    .filter((piece) => BOOT_PIECE_KINDS.includes(piece.kind) || piece.id === manifest.defaults.character)
    .flatMap((piece) => pieceLoadRequests(piece, manifestUrl));
}

export interface Recolor {
  readonly from: string;
  readonly to: string;
}

/**
 * The recolor a placement needs, or `null` to draw the exported sheet as is.
 *
 * Only a colorable piece has a color to change, and it is exported in its
 * `defaultColor` only, so any other color is painted from that one. A color on
 * a non-colorable piece is ignored rather than trusted: step 3 stores NULL
 * there, and anything else is a row this client should not tint.
 */
export function recolorFor(piece: ArtPiece, color: string | null): Recolor | null {
  if ((piece.kind !== 'desk' && piece.kind !== 'floor') || !piece.colorable || piece.defaultColor === null) return null;
  if (color === null) return null;
  const to = color.toLowerCase();
  if (!COLOR_PATTERN.test(to) || to === piece.defaultColor.toLowerCase()) return null;
  return { from: piece.defaultColor, to };
}

/**
 * An appearance read from a network row, or `null` when it carries no usable
 * material. `null` is not an error: an older server sends none, and the caller
 * draws the pack default. A malformed color is dropped on its own.
 */
export function parseArtAppearance(materialId: unknown, color: unknown): ArtAppearance | null {
  if (!isNonEmptyString(materialId)) return null;
  const normalized = typeof color === 'string' ? color.toLowerCase() : null;
  return { materialId, color: normalized !== null && COLOR_PATTERN.test(normalized) ? normalized : null };
}
