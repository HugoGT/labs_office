/**
 * Desk and floor materials a creation form can offer (art migration, step 7),
 * read from the same pack manifest the office draws from. Pure apart from the
 * one `fetch` in `loadMaterialCatalog`, which is injected.
 *
 * The manifest is the list of active pieces: a piece that a newer pack stops
 * shipping is retired in the server catalog and is simply not in the file, so
 * nothing retired is ever offered. The server still checks the choice against
 * its catalog (`resolveDeskAppearance`), so a stale manifest can at worst
 * offer something the creation then refuses with a readable reason.
 *
 * Materials an Admin uploaded (#121) come from the office server's uploads
 * manifest and are offered after the pack's, each sheet next to its manifest.
 *
 * The wall pieces ride along for the terrain editor's wall palette, which
 * cuts its thumbnails the same way; no creation form offers them.
 */

import { ART_IMAGE_SPECS, facingColumn, wallFrameIndex, type ArtDeskPiece, type ArtFloorPiece, type ArtWallPiece } from './artContract';
import { combineArtManifests, parseArtPackManifest, type ArtAppearance } from './artPack';

/** The role of the one sheet a desk, floor or wall piece ships, as `mapBuilder.ts` reads it. */
const SHEET_ROLE = 'sheet';

export interface MaterialOption {
  readonly id: string;
  readonly kind: 'desk' | 'floor' | 'wall';
  /** Spanish name from the manifest. */
  readonly name: string;
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  /** The exported sheet, the one the office loads for this piece. */
  readonly sheetUrl: string;
  /** The manifest entry, so the preview decides recolors with `recolorFor` like the office. */
  readonly piece: ArtDeskPiece | ArtFloorPiece | ArtWallPiece;
}

type CatalogPiece = ArtDeskPiece | ArtFloorPiece | ArtWallPiece;

export interface MaterialCatalog {
  readonly desk: readonly MaterialOption[];
  readonly floor: readonly MaterialOption[];
  /** The wall pieces, for the terrain editor (never colorable). */
  readonly wall: readonly MaterialOption[];
  /** Pack defaults, or the first offered option when the default is not offered. */
  readonly defaults: { readonly desk: string; readonly floor: string };
}

function manifestFolder(manifestUrl: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
}

function optionOf(piece: CatalogPiece, folder: string): MaterialOption | null {
  const sheet = piece.files.find((file) => file.role === SHEET_ROLE && file.imageKind === piece.kind);
  if (sheet === undefined) return null;
  return {
    id: piece.id,
    kind: piece.kind,
    name: piece.name,
    colorable: piece.kind === 'wall' ? false : piece.colorable,
    defaultColor: piece.kind === 'wall' ? null : piece.defaultColor,
    sheetUrl: `${folder}${sheet.path}`,
    piece,
  };
}

function defaultOf(options: readonly MaterialOption[], wanted: string): string | null {
  if (options.some((option) => option.id === wanted)) return wanted;
  return options[0]?.id ?? null;
}

/** A second manifest, read raw, and where its file paths are relative to. */
export interface RawManifestSource {
  readonly raw: unknown;
  readonly url: string;
}

/**
 * The catalog of a raw manifest (plus the uploads, when given), or `null`
 * when the pack cannot be read or offers no desk or no floor.
 */
export function materialCatalogFrom(raw: unknown, manifestUrl: string, uploads?: RawManifestSource): MaterialCatalog | null {
  const manifest = parseArtPackManifest(raw);
  if (manifest === null) return null;
  const joined = combineArtManifests([
    { manifest, url: manifestUrl },
    { manifest: uploads === undefined ? null : parseArtPackManifest(uploads.raw), url: uploads?.url ?? manifestUrl },
  ]);
  if (joined === null) return null;
  const options: Record<MaterialOption['kind'], MaterialOption[]> = { desk: [], floor: [], wall: [] };
  for (const piece of joined.manifest.pieces) {
    if (piece.kind !== 'desk' && piece.kind !== 'floor' && piece.kind !== 'wall') continue;
    const option = optionOf(piece, manifestFolder(joined.sourceOf(piece.id) ?? manifestUrl));
    if (option !== null) options[piece.kind].push(option);
  }
  const { desk, floor, wall } = options;
  const deskDefault = defaultOf(desk, manifest.defaults.desk);
  const floorDefault = defaultOf(floor, manifest.defaults.floor);
  if (deskDefault === null || floorDefault === null) return null;
  return { desk, floor, wall, defaults: { desk: deskDefault, floor: floorDefault } };
}

/** What a form holds right after picking `option`: a colorable material starts in its default color. */
export function defaultAppearance(option: MaterialOption): ArtAppearance {
  return { materialId: option.id, color: option.colorable ? option.defaultColor : null };
}

/** What a creation form starts on: the pack default of that kind, in its default color. */
export function defaultChoice(catalog: MaterialCatalog, kind: 'desk' | 'floor'): ArtAppearance {
  const options = catalog[kind];
  const option = options.find((candidate) => candidate.id === catalog.defaults[kind]) ?? options[0];
  // `materialCatalogFrom` never builds a catalog without both kinds.
  return defaultAppearance(option as MaterialOption);
}

export interface PreviewFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of the sheet a preview shows: a desk's front-facing cell (how it
 * reads facing the viewer), the whole floor motif, which is what tiles, or a
 * wall's east-west joint, the middle of a straight painted wall.
 */
export function previewFrame(option: MaterialOption): PreviewFrame {
  if (option.kind === 'wall') {
    const { frame } = ART_IMAGE_SPECS.wall;
    return { x: frame.width * wallFrameIndex({ piece: 'joint', mask: 2 | 8 }), y: 0, width: frame.width, height: frame.height };
  }
  if (option.kind === 'floor') {
    const { frame, columns, rows } = ART_IMAGE_SPECS.floor;
    return { x: 0, y: 0, width: frame.width * columns, height: frame.height * rows };
  }
  const { frame } = ART_IMAGE_SPECS.desk;
  return { x: frame.width * facingColumn('down'), y: 0, width: frame.width, height: frame.height };
}

export interface LoadMaterialCatalogOptions {
  manifestUrl: string;
  /** Manifest of the Admin uploads (`artUploadsManifestUrl`); absent: the pack only. */
  uploadsUrl?: string | null;
  fetchImpl?: typeof fetch;
}

/** The JSON at `url`, or `undefined` when it cannot be read: the caller decides what that means. */
async function readJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    const response = await fetchImpl(url);
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Never throws: without a readable manifest the forms create with the pack default. */
export async function loadMaterialCatalog({
  manifestUrl,
  uploadsUrl = null,
  fetchImpl = fetch,
}: LoadMaterialCatalogOptions): Promise<MaterialCatalog | null> {
  const [pack, uploads] = await Promise.all([
    readJson(manifestUrl, fetchImpl),
    uploadsUrl === null ? Promise.resolve(undefined) : readJson(uploadsUrl, fetchImpl),
  ]);
  if (pack === undefined) return null;
  return materialCatalogFrom(pack, manifestUrl, uploadsUrl === null || uploads === undefined ? undefined : { raw: uploads, url: uploadsUrl });
}
