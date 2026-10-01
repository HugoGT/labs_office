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
 */

import { ART_IMAGE_SPECS, facingColumn, type ArtDeskPiece, type ArtFloorPiece } from './artContract';
import { parseArtPackManifest, type ArtAppearance } from './artPack';

/** The role of the one sheet a desk or floor piece ships, as `mapBuilder.ts` reads it. */
const SHEET_ROLE = 'sheet';

export interface MaterialOption {
  readonly id: string;
  readonly kind: 'desk' | 'floor';
  /** Spanish name from the manifest. */
  readonly name: string;
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  /** The exported sheet, the one the office loads for this piece. */
  readonly sheetUrl: string;
  /** The manifest entry, so the preview decides recolors with `recolorFor` like the office. */
  readonly piece: ArtDeskPiece | ArtFloorPiece;
}

export interface MaterialCatalog {
  readonly desk: readonly MaterialOption[];
  readonly floor: readonly MaterialOption[];
  /** Pack defaults, or the first offered option when the default is not offered. */
  readonly defaults: { readonly desk: string; readonly floor: string };
}

function manifestFolder(manifestUrl: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
}

function optionOf(piece: ArtDeskPiece | ArtFloorPiece, folder: string): MaterialOption | null {
  const sheet = piece.files.find((file) => file.role === SHEET_ROLE && file.imageKind === piece.kind);
  if (sheet === undefined) return null;
  return {
    id: piece.id,
    kind: piece.kind,
    name: piece.name,
    colorable: piece.colorable,
    defaultColor: piece.defaultColor,
    sheetUrl: `${folder}${sheet.path}`,
    piece,
  };
}

function defaultOf(options: readonly MaterialOption[], wanted: string): string | null {
  if (options.some((option) => option.id === wanted)) return wanted;
  return options[0]?.id ?? null;
}

/** The catalog of a raw manifest, or `null` when it cannot be read or offers no desk or no floor. */
export function materialCatalogFrom(raw: unknown, manifestUrl: string): MaterialCatalog | null {
  const manifest = parseArtPackManifest(raw);
  if (manifest === null) return null;
  const folder = manifestFolder(manifestUrl);
  const desk: MaterialOption[] = [];
  const floor: MaterialOption[] = [];
  for (const piece of manifest.pieces) {
    if (piece.kind !== 'desk' && piece.kind !== 'floor') continue;
    const option = optionOf(piece, folder);
    if (option !== null) (piece.kind === 'desk' ? desk : floor).push(option);
  }
  const deskDefault = defaultOf(desk, manifest.defaults.desk);
  const floorDefault = defaultOf(floor, manifest.defaults.floor);
  if (deskDefault === null || floorDefault === null) return null;
  return { desk, floor, defaults: { desk: deskDefault, floor: floorDefault } };
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
 * reads facing the viewer), or the whole floor motif, which is what tiles.
 */
export function previewFrame(option: MaterialOption): PreviewFrame {
  if (option.kind === 'floor') {
    const { frame, columns, rows } = ART_IMAGE_SPECS.floor;
    return { x: 0, y: 0, width: frame.width * columns, height: frame.height * rows };
  }
  const { frame } = ART_IMAGE_SPECS.desk;
  return { x: frame.width * facingColumn('down'), y: 0, width: frame.width, height: frame.height };
}

export interface LoadMaterialCatalogOptions {
  manifestUrl: string;
  fetchImpl?: typeof fetch;
}

/** Never throws: without a readable manifest the forms create with the pack default. */
export async function loadMaterialCatalog({
  manifestUrl,
  fetchImpl = fetch,
}: LoadMaterialCatalogOptions): Promise<MaterialCatalog | null> {
  try {
    const response = await fetchImpl(manifestUrl);
    if (!response.ok) return null;
    return materialCatalogFrom(await response.json(), manifestUrl);
  } catch {
    return null;
  }
}
