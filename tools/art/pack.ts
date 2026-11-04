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
  BRIDGE,
  BRIDGE_ORIENTATIONS,
  CHAIR,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  DOOR,
  FLOOR,
  HEDGE,
  PACK_FACINGS,
  PLANT,
  SOFA,
  TABLE,
  TABLE_FACINGS,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  TERRAIN_TILESET,
  TERRAIN_WALKABLE,
  TREE,
  WALL,
  terrainDecalIndex,
  terrainFloorPieceId,
  terrainTileIndex,
  type ArtImageKind,
  type ArtPackManifest,
  type ArtPiece,
  type ArtPieceFile,
  type DoorVariant,
} from '../../src/game/artContract.ts';
import { CHAIR_DEFAULT_COLORS, type ChairMaterial } from './domain/chairs.ts';
import { SOFA_DEFAULT_COLORS, type SofaMaterial } from './domain/sofas.ts';
import type { PixelBuffer } from '../../src/art/pixelBuffer.ts';
import { DEFAULT_TREE_COLOR, type PlantKind, type TreeKind } from './domain/props.ts';
import { DESK_DEFAULT_COLORS, ROOM_TABLE_FOOTPRINTS, type RoomTable, type TableMaterial } from './domain/tables.ts';
import { DEFAULT_CARPET_COLOR, DEFAULT_PLAIN_COLOR, type Terrain } from './domain/tiles.ts';
import type { WallMaterial } from './domain/wallMap.ts';
import { encodePng } from '../../server/src/assets/pngCodec.ts';
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
  office: 'Silla de oficina',
  task: 'Silla giratoria',
  fabric: 'Sillón tapizado',
  dining: 'Silla de comedor',
  pouf: 'Puff',
};
const SOFA_NAMES: Readonly<Record<SofaMaterial, string>> = {
  leather: 'Sofá de cuero',
  fabric: 'Sofá tapizado',
};
const DESK_NAMES: Readonly<Record<TableMaterial, string>> = {
  glass: 'Escritorio de vidrio',
  metal: 'Escritorio de metal',
  wood: 'Escritorio de madera',
  painted: 'Escritorio pintado',
  gamer: 'Escritorio gamer',
  curved: 'Escritorio curvo',
};
const FLOOR_NAMES: Readonly<Record<Terrain, string>> = {
  wood: 'Madera',
  grass: 'Césped',
  water: 'Agua',
  plain: 'Liso',
  dirt: 'Tierra',
  sand: 'Arena',
  cobblestone: 'Empedrado',
  tile: 'Baldosa',
  carpet: 'Moqueta',
};
/** The colorable floors and the color each is exported in; the rest have a fixed texture. */
const FLOOR_DEFAULT_COLORS: Readonly<Partial<Record<Terrain, string>>> = { plain: DEFAULT_PLAIN_COLOR, carpet: DEFAULT_CARPET_COLOR };

const WALL_NAMES: Readonly<Record<WallMaterial, string>> = { brick: 'Ladrillo', stone: 'Piedra', plaster: 'Yeso' };

const TREE_NAMES: Readonly<Record<TreeKind, string>> = { oak: 'Árbol', large: 'Árbol grande', ficus: 'Ficus' };
const PLANT_NAMES: Readonly<Record<PlantKind, string>> = { bonsai: 'Bonsái' };
const TABLES: Readonly<Record<RoomTable, { readonly name: string; readonly material: string }>> = {
  meeting: { name: 'Mesa de reuniones', material: 'walnut' },
  cafeteria: { name: 'Mesa de cafetería', material: 'beech' },
  oval: { name: 'Mesa ovalada', material: 'oak' },
  round: { name: 'Mesa redonda', material: 'oak' },
};
/** The single and the double door are two items (#233), each with its own name and wall footprint; the window a third (tile walls). */
const DOOR_NAMES: Readonly<Record<DoorVariant, string>> = { single: 'Puerta simple', double: 'Puerta doble', window: 'Ventana' };
/** The whole 3x3 deck is walkable in both orientations; the rails are thin enough to step along. */
const FULL_DECK = { x: 0, y: 0, w: BRIDGE.footprint.w, h: BRIDGE.footprint.h } as const;

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
        // Only the gamer chair's accent and the fabric armchair take a color; the rest keep their materials.
        colorable: CHAIR_DEFAULT_COLORS[material] !== undefined,
        defaultColor: CHAIR_DEFAULT_COLORS[material] ?? null,
        files: [png(`chair/${material}.png`, 'sheet', 'chair', image)],
      }),
    ),
    ...sheets.sofas.map(
      ({ material, seats, image }): ArtPiece => ({
        id: `sofa-${material}-${seats}`,
        kind: 'sofa',
        name: `${SOFA_NAMES[material]} (${seats} plazas)`,
        ...common,
        material,
        seats,
        facings: PACK_FACINGS,
        layers: CHAIR_LAYERS,
        anchor: SOFA.anchor,
        footprint: { w: seats, h: 1 },
        // Only the fabric sofas take a color, like the fabric armchair.
        colorable: SOFA_DEFAULT_COLORS[material] !== undefined,
        defaultColor: SOFA_DEFAULT_COLORS[material] ?? null,
        files: [png(`sofa/${material}-${seats}.png`, 'sheet', 'sofa', image)],
      }),
    ),
    ...sheets.desks.map(
      ({ material, sheet }): ArtPiece => ({
        id: `desk-${material}`,
        kind: 'desk',
        name: DESK_NAMES[material],
        ...common,
        material,
        // The painted desk takes a color all over, the gamer desk only in its side lights.
        colorable: DESK_DEFAULT_COLORS[material] !== undefined,
        defaultColor: DESK_DEFAULT_COLORS[material] ?? null,
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
        colorable: FLOOR_DEFAULT_COLORS[terrain] !== undefined,
        defaultColor: FLOOR_DEFAULT_COLORS[terrain] ?? null,
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
        heightTiles: WALL.heightTiles,
        topHeight: WALL.topHeight,
        translucent: false,
        files: [png(`wall/${material}.png`, 'sheet', 'wall', image)],
      }),
    ),
    {
      id: 'tileset-terrain',
      kind: 'tileset',
      name: 'Terreno',
      ...common,
      tileSize: ART_TILE,
      columns: TERRAIN_TILESET.columns,
      masks: TERRAIN_TILESET.masks,
      phases: TERRAIN_TILESET.phases,
      variants: TERRAIN_TILESET.variants,
      materials: TERRAIN_MATERIALS.map((material) => ({
        material,
        floor: terrainFloorPieceId(material),
        walkable: TERRAIN_WALKABLE[material],
        firstTile: terrainTileIndex(material, 1, 0) - 1,
      })),
      decals: TERRAIN_DECALS.map((decal) => ({ decal, tile: terrainDecalIndex(decal) })),
      files: [png('tileset/terrain.png', 'sheet', 'terrain-tileset', sheets.tileset)],
    },
    ...sheets.trees.map(
      ({ kind, image }): ArtPiece => ({
        id: `tree-${kind}`,
        kind: 'tree',
        name: TREE_NAMES[kind],
        ...common,
        material: kind,
        // Only the broadleaf tree takes a color, its leaves; the large tree keeps its own greens.
        colorable: kind === 'oak',
        defaultColor: kind === 'oak' ? DEFAULT_TREE_COLOR : null,
        footprint: TREE.footprint,
        anchor: TREE.anchor,
        layer: TREE.layer,
        collision: TREE.collision,
        files: [png(`tree/${kind}.png`, 'sheet', 'tree', image)],
      }),
    ),
    ...sheets.plants.map(
      ({ kind, image }): ArtPiece => ({
        id: `plant-${kind}`,
        kind: 'plant',
        name: PLANT_NAMES[kind],
        ...common,
        material: kind,
        footprint: PLANT.footprint,
        anchor: PLANT.anchor,
        layer: PLANT.layer,
        collision: PLANT.collision,
        files: [png(`plant/${kind}.png`, 'sheet', 'plant', image)],
      }),
    ),
    {
      id: 'bridge-wood',
      kind: 'bridge',
      name: 'Puente de madera',
      ...common,
      material: 'wood',
      footprint: BRIDGE.footprint,
      anchor: BRIDGE.anchor,
      layer: BRIDGE.layer,
      collision: BRIDGE.collision,
      orientations: BRIDGE_ORIENTATIONS,
      deck: { 'north-south': FULL_DECK, 'east-west': FULL_DECK },
      files: [png('bridge/wood.png', 'sheet', 'bridge', sheets.bridge)],
    },
    {
      id: 'hedge-boxwood',
      kind: 'hedge',
      name: 'Seto',
      ...common,
      material: 'boxwood',
      footprint: HEDGE.footprint,
      anchor: HEDGE.anchor,
      layer: HEDGE.layer,
      collision: HEDGE.collision,
      height: HEDGE.height,
      files: [png('hedge/boxwood.png', 'sheet', 'hedge', sheets.hedge)],
    },
    ...sheets.tables.map(
      ({ kind, image }): ArtPiece => ({
        id: `table-${kind}`,
        kind: 'table',
        name: TABLES[kind].name,
        ...common,
        material: TABLES[kind].material,
        footprint: ROOM_TABLE_FOOTPRINTS[kind],
        anchor: TABLE.anchor,
        layer: TABLE.layer,
        collision: TABLE.collision,
        facings: TABLE_FACINGS,
        files: [png(`table/${kind}.png`, 'sheet', 'table', image)],
      }),
    ),
    // Doors and windows (#223, #233, tile walls) stand in a wall run: 2 wall tiles wide (single, window) or 3 (double), anchored on the middle of the span.
    ...sheets.doors.map(({ material, variant, image }): ArtPiece => {
      const suffix = variant === 'single' ? '' : `-${variant}`;
      return {
        id: `door-${material}${suffix}`,
        kind: 'door',
        name: DOOR_NAMES[variant],
        ...common,
        material,
        variant,
        anchor: DOOR.anchor,
        footprint: { w: DOOR.variants[variant].span, h: 1 },
        files: [png(`door/${material}${suffix}.png`, 'sheet', 'door', image)],
      };
    }),
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
