/**
 * The production art pack: every sheet of `sheets.ts` as a PNG under PACK_DIR, plus
 * `manifest.json`, plus the review previews under PREVIEW_DIR. Rendering is pure and
 * deterministic, so `pack.test.ts` can check that the committed pack is exactly what the
 * generators produce today.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ART_CONTRACT_VERSION,
  ART_FILE_FORMAT,
  ART_PACK_FORMAT,
  ART_TILE,
  CHAIR,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  FLOOR,
  PACK_FACINGS,
  WALL,
  type ArtImageKind,
  type ArtPackManifest,
  type ArtPiece,
  type ArtPieceFile,
} from '../../src/game/artContract.ts';
import type { ChairMaterial } from './domain/chairs.ts';
import type { PixelBuffer } from './domain/pixelBuffer.ts';
import { DEFAULT_TABLE_COLOR, type TableMaterial } from './domain/tables.ts';
import { DEFAULT_PLAIN_COLOR, type Terrain } from './domain/tiles.ts';
import type { WallMaterial } from './domain/wallMap.ts';
import { encodePng } from './png.ts';
import { renderPreviews } from './preview.ts';
import { buildPackSheets } from './sheets.ts';

/** Served as-is by Vite and nginx: the office loads `/assets/pack/manifest.json`. */
export const PACK_DIR = 'public/assets/pack';
/** Outside public/ on purpose: previews are for review and never ship with the office. */
export const PREVIEW_DIR = 'docs/art/preview';

// The art project states no author or license; the pack is internal work of the company.
export const PACK_AUTHOR = 'HugoGT';
export const PACK_LICENSE = 'proprietary-internal';

const CHAIR_NAMES: Readonly<Record<ChairMaterial, string>> = {
  wood: 'Silla de madera',
  metal: 'Silla de metal',
  leather: 'Silla de cuero',
  gamer: 'Silla gamer',
};
const DESK_NAMES: Readonly<Record<TableMaterial, string>> = {
  glass: 'Escritorio de vidrio',
  metal: 'Escritorio de metal',
  wood: 'Escritorio de madera',
  painted: 'Escritorio pintado',
};
const FLOOR_NAMES: Readonly<Record<Terrain, string>> = { wood: 'Madera', grass: 'Césped', water: 'Agua', plain: 'Liso' };
const WALL_NAMES: Readonly<Record<WallMaterial, string>> = { brick: 'Ladrillo', stone: 'Piedra', plaster: 'Yeso', glass: 'Vidrio' };

const DEFAULTS = { character: 'character-p01-burgundy-suit', desk: 'desk-wood', floor: 'floor-wood' } as const;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Renders the pack and its previews. Keys are paths relative to the repository root, sorted, so
 * two renders compare entry by entry.
 */
export function renderPackFiles(): Map<string, Uint8Array> {
  const sheets = buildPackSheets();
  const files = new Map<string, Uint8Array>();
  const png = (path: string, role: string, imageKind: ArtImageKind, image: PixelBuffer): ArtPieceFile => {
    const bytes = new Uint8Array(encodePng(image));
    files.set(`${PACK_DIR}/${path}`, bytes);
    return { role, path, imageKind, width: image.width, height: image.height, sha256: sha256(bytes) };
  };
  const common = { author: PACK_AUTHOR, license: PACK_LICENSE };

  const pieces: ArtPiece[] = [
    ...sheets.characters.map(
      ({ spec, walk, seated }): ArtPiece => ({
        id: `character-${spec.id}`,
        kind: 'character',
        name: spec.name,
        ...common,
        anchors: { walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor },
        footprint: CHARACTER_WALK.footprint,
        files: [
          png(`character/${spec.id}-walk.png`, 'walk', 'character-walk', walk),
          png(`character/${spec.id}-seated.png`, 'seated', 'character-seated', seated),
        ],
      }),
    ),
    ...sheets.chairs.map(
      ({ material, image }): ArtPiece => ({
        id: `chair-${material}`,
        kind: 'chair',
        name: CHAIR_NAMES[material],
        ...common,
        material,
        facings: PACK_FACINGS,
        layers: CHAIR_LAYERS,
        anchors: { seat: CHAIR.anchor, ground: CHAIR.ground },
        footprint: CHAIR.footprint,
        files: [png(`chair/${material}.png`, 'sheet', 'chair', image)],
      }),
    ),
    ...sheets.desks.map(
      ({ material, sheet }): ArtPiece => ({
        id: `desk-${material}`,
        kind: 'desk',
        name: DESK_NAMES[material],
        ...common,
        material,
        colorable: material === 'painted',
        defaultColor: material === 'painted' ? DEFAULT_TABLE_COLOR : null,
        anchor: DESK.anchor,
        facings: sheet.facings,
        files: [png(`desk/${material}.png`, 'sheet', 'desk', sheet.image)],
      }),
    ),
    ...sheets.floors.map(
      ({ terrain, image }): ArtPiece => ({
        id: `floor-${terrain}`,
        kind: 'floor',
        name: FLOOR_NAMES[terrain],
        ...common,
        material: terrain,
        colorable: terrain === 'plain',
        defaultColor: terrain === 'plain' ? DEFAULT_PLAIN_COLOR : null,
        motifTiles: FLOOR.motifTiles,
        files: [png(`floor/${terrain}.png`, 'sheet', 'floor', image)],
      }),
    ),
    ...sheets.walls.map(
      ({ material, image }): ArtPiece => ({
        id: `wall-${material}`,
        kind: 'wall',
        name: WALL_NAMES[material],
        ...common,
        material,
        segmentLength: WALL.segmentLength,
        thickness: WALL.thickness,
        translucent: material === 'glass',
        files: [png(`wall/${material}.png`, 'sheet', 'wall', image)],
      }),
    ),
  ];

  const manifest: ArtPackManifest = {
    format: ART_PACK_FORMAT,
    contractVersion: ART_CONTRACT_VERSION,
    fileFormat: ART_FILE_FORMAT,
    tile: ART_TILE,
    ...common,
    defaults: DEFAULTS,
    pieces,
  };
  files.set(`${PACK_DIR}/manifest.json`, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
  for (const [name, image] of renderPreviews(sheets)) files.set(`${PREVIEW_DIR}/${name}`, new Uint8Array(encodePng(image)));
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Replaces PACK_DIR and PREVIEW_DIR under `root` with `files`, so a piece that stops being
 * generated also stops being committed.
 */
export function writePackFiles(root: string, files: ReadonlyMap<string, Uint8Array>): void {
  for (const dir of [PACK_DIR, PREVIEW_DIR]) rmSync(join(root, dir), { recursive: true, force: true });
  for (const [path, bytes] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}
