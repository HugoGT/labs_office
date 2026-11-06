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
 * The wall pieces ride along for the terrain editor's wall palette, and the
 * chairs, sofas, desks, plants, room tables and doors (#223) for the decor palette
 * (#208), which cut their thumbnails the same way; no creation form offers
 * those.
 */

import {
  ART_IMAGE_SPECS,
  ART_TILE,
  DOOR,
  SOFA,
  facingColumn,
  WALL_FRAMES,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtDoorPiece,
  type ArtRugPiece,
  type ArtFloorPiece,
  type ArtPlantPiece,
  type ArtSofaPiece,
  type ArtTablePiece,
  type ArtTreePiece,
  type ArtWallPiece,
} from './artContract';
import { combineArtManifests, isRetiredArtPiece, parseArtPackManifest, type ArtAppearance } from './artPack';

/** The role of the one sheet a desk, floor, wall, chair, plant or table piece ships, as `mapBuilder.ts` reads it. */
const SHEET_ROLE = 'sheet';

export interface MaterialOption {
  readonly id: string;
  readonly kind: 'desk' | 'floor' | 'wall' | 'chair' | 'sofa' | 'plant' | 'tree' | 'table' | 'door' | 'rug';
  /** Spanish name from the manifest. */
  readonly name: string;
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  /** The exported sheet, the one the office loads for this piece. */
  readonly sheetUrl: string;
  /** The manifest entry, so the preview decides recolors with `recolorFor` like the office. */
  readonly piece: CatalogPiece;
  /** A retired upload (#264): still drawn where it was placed, never offered by a palette. */
  readonly retired: boolean;
}

type CatalogPiece = ArtDeskPiece | ArtFloorPiece | ArtWallPiece | ArtChairPiece | ArtSofaPiece | ArtPlantPiece | ArtTreePiece | ArtTablePiece | ArtDoorPiece | ArtRugPiece;

export interface MaterialCatalog {
  readonly desk: readonly MaterialOption[];
  readonly floor: readonly MaterialOption[];
  /** The wall pieces, for the terrain editor (never colorable). */
  readonly wall: readonly MaterialOption[];
  /** The chair pieces, for the decor palette (colorable only for the gamer chair's accent). */
  readonly chair: readonly MaterialOption[];
  /** The sofas, for the decor palette (colorable only for the fabric ones). */
  readonly sofa: readonly MaterialOption[];
  /** The plants (pack and uploads), for the decor palette (never colorable). */
  readonly plant: readonly MaterialOption[];
  /** The trees, for the office's decor palette (colorable only for the broadleaf one's leaves). */
  readonly tree: readonly MaterialOption[];
  /** The room tables, for the decor palette (never colorable). */
  readonly table: readonly MaterialOption[];
  /** The doors (#223), for the admin's decor palette (never colorable). */
  readonly door: readonly MaterialOption[];
  /** The desk rugs, for the decor palette (colorable only for the woven one). */
  readonly rug: readonly MaterialOption[];
  /** Pack defaults, or the first offered option when the default is not offered. */
  readonly defaults: { readonly desk: string; readonly floor: string };
}

function manifestFolder(manifestUrl: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
}

/** The kinds that may take a color of their own (`recolorFor`). */
function tinted(piece: CatalogPiece): piece is ArtDeskPiece | ArtFloorPiece | ArtChairPiece | ArtSofaPiece | ArtTreePiece | ArtWallPiece | ArtRugPiece {
  return piece.kind === 'desk' || piece.kind === 'floor' || piece.kind === 'chair' || piece.kind === 'sofa' || piece.kind === 'tree' || piece.kind === 'wall' || piece.kind === 'rug';
}

function optionOf(piece: CatalogPiece, folder: string): MaterialOption | null {
  const sheet = piece.files.find((file) => file.role === SHEET_ROLE && file.imageKind === piece.kind);
  if (sheet === undefined) return null;
  return {
    id: piece.id,
    kind: piece.kind,
    name: piece.name,
    colorable: tinted(piece) ? piece.colorable === true : false,
    defaultColor: tinted(piece) ? (piece.defaultColor ?? null) : null,
    sheetUrl: `${folder}${sheet.path}`,
    piece,
    retired: isRetiredArtPiece(piece),
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
  const options: Record<MaterialOption['kind'], MaterialOption[]> = { desk: [], floor: [], wall: [], chair: [], sofa: [], plant: [], tree: [], table: [], door: [], rug: [] };
  for (const piece of joined.manifest.pieces) {
    if (!(piece.kind in options)) continue;
    const option = optionOf(piece as CatalogPiece, manifestFolder(joined.sourceOf(piece.id) ?? manifestUrl));
    if (option !== null) options[option.kind].push(option);
  }
  const { desk, floor, wall, chair, sofa, plant, tree, table, door, rug } = options;
  const deskDefault = defaultOf(desk, manifest.defaults.desk);
  const floorDefault = defaultOf(floor, manifest.defaults.floor);
  if (deskDefault === null || floorDefault === null) return null;
  return { desk, floor, wall, chair, sofa, plant, tree, table, door, rug, defaults: { desk: deskDefault, floor: floorDefault } };
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
 * reads facing the viewer), the whole floor motif, which is what tiles, a
 * wall's east-west joint, the middle of a straight painted wall, the one
 * frame of a plant, or of a room table the part its horizontal drawing
 * covers (its footprint and the top lifted over it), so a small table is not
 * lost in the frame that fits the largest.
 */
/** Pixels around a room table's footprint its preview keeps: the outline, and above it the lifted top. */
const TABLE_PREVIEW_MARGIN = 2;
const TABLE_PREVIEW_LIFT = 18;

/** What a door's preview keeps across its edge: the closed leaf with its jambs, hinge and handle, over the whole span. */
const DOOR_PREVIEW_HEIGHT = 24;

export function previewFrame(option: MaterialOption): PreviewFrame {
  if (option.kind === 'chair') return chairPreviewFrames()[0];
  if (option.kind === 'sofa') return sofaPreviewFrames()[0];
  // Frame 0: turned 0, hinged at its start, closed (`doorFrameIndex`).
  if (option.kind === 'door' && option.piece.kind === 'door') {
    const width = DOOR.variants[option.piece.variant].span * ART_TILE;
    return { x: DOOR.anchor.x - width / 2, y: DOOR.anchor.y - DOOR_PREVIEW_HEIGHT / 2, width, height: DOOR_PREVIEW_HEIGHT };
  }
  if (option.kind === 'table' && option.piece.kind === 'table') {
    const { frame } = ART_IMAGE_SPECS.table;
    const { anchor, footprint } = option.piece;
    const halfWidth = (footprint.w * ART_TILE) / 2 + TABLE_PREVIEW_MARGIN;
    const x = Math.max(0, anchor.x - halfWidth);
    const y = Math.max(0, anchor.y - footprint.h * ART_TILE - TABLE_PREVIEW_LIFT);
    const right = Math.min(frame.width, anchor.x + halfWidth);
    const bottom = Math.min(frame.height, anchor.y + TABLE_PREVIEW_MARGIN * 2);
    return { x, y, width: right - x, height: bottom - y };
  }
  // A rug shows its horizontal frame's footprint, without the rows under it.
  if (option.kind === 'rug') {
    const { anchor, footprint } = ART_IMAGE_SPECS.rug;
    const width = footprint.w * ART_TILE;
    const height = footprint.h * ART_TILE;
    return { x: anchor.x - width / 2, y: anchor.y - height, width, height };
  }
  if (option.kind === 'plant' || option.kind === 'tree' || option.kind === 'table') {
    const { frame } = ART_IMAGE_SPECS[option.kind];
    return { x: 0, y: 0, width: frame.width, height: frame.height };
  }
  if (option.kind === 'wall') {
    const { frame } = ART_IMAGE_SPECS.wall;
    return { x: frame.width * WALL_FRAMES.face, y: 0, width: frame.width, height: frame.height };
  }
  if (option.kind === 'floor') {
    const { frame, columns, rows } = ART_IMAGE_SPECS.floor;
    return { x: 0, y: 0, width: frame.width * columns, height: frame.height * rows };
  }
  // A desk is shown from its sitter's side (drawer and open knee space, the cell facing up), not from the closed panel the map shows.
  const { frame } = ART_IMAGE_SPECS.desk;
  return { x: frame.width * facingColumn('up'), y: 0, width: frame.width, height: frame.height };
}

/**
 * The two layers of a chair facing down (the sheet's `back` row, then its
 * `front` row), drawn one over the other: a chair reads whole only with both.
 */
export function chairPreviewFrames(): readonly [PreviewFrame, PreviewFrame] {
  const { frame } = ART_IMAGE_SPECS.chair;
  const x = frame.width * facingColumn('down');
  return [
    { x, y: 0, width: frame.width, height: frame.height },
    { x, y: frame.height, width: frame.width, height: frame.height },
  ];
}

/** Rows of a sofa's down-facing cell its preview keeps: the backrest above the floor under its middle, its feet below it. */
const SOFA_PREVIEW_ABOVE = 30;
const SOFA_PREVIEW_BELOW = 8;

/**
 * The two layers of a sofa facing down, like a chair's: the part of the cell
 * a sofa covers, full width so a three-seat one fits, back row then front row.
 */
export function sofaPreviewFrames(): readonly [PreviewFrame, PreviewFrame] {
  const { frame, anchor } = SOFA;
  const x = frame.width * facingColumn('down');
  const y = anchor.y - SOFA_PREVIEW_ABOVE;
  const height = SOFA_PREVIEW_ABOVE + SOFA_PREVIEW_BELOW;
  return [
    { x, y, width: frame.width, height },
    { x, y: frame.height + y, width: frame.width, height },
  ];
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
