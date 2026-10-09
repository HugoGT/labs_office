/**
 * Lays the generators' sprites out as the production sheets of the art contract
 * (src/game/artContract.ts): fixed grids, 1x, no backdrop. Every sprite is copied with `place`,
 * never blended, so a sheet holds exactly the pixels the generator drew.
 */
import {
  ART_TILE,
  BRIDGE,
  BRIDGE_ORIENTATIONS,
  CHAIR,
  CHARACTER_WALK,
  DESK,
  HEDGE,
  PACK_FACINGS,
  TERRAIN_DECALS,
  TERRAIN_LAYER_ORIGIN,
  TERRAIN_MASKS,
  TERRAIN_MATERIALS,
  TERRAIN_PHASES,
  TERRAIN_TILESET,
  WALL,
  bridgeFrameIndex,
  facingColumn,
  hedgeFrameIndex,
  sheetSize,
  terrainBankIndex,
  terrainDecalIndex,
  terrainLayerData,
  terrainTileIndex,
  wallBodyRect,
  wallFrameIndex,
  wallJointRect,
  type ArtDeskFacing,
  type ArtFacing,
  type TerrainMaterial,
  type WallPiece,
} from '../../src/game/artContract.ts';
import { CHAIR_MATERIALS, chairSprite, type ChairMaterial } from './domain/chairs.ts';
import { BASE_CHARACTERS, type CharacterSpec } from './domain/characters.ts';
import { PixelBuffer } from './domain/pixelBuffer.ts';
import { bridgeSprite, hedgeSprite, PLANT_KINDS, plantSprite, TREE_KINDS, treeSprite, type PlantKind, type TreeKind } from './domain/props.ts';
import { buildCharacterSprites, type CharacterSprites } from './domain/spriteSheet.ts';
import { ROOM_TABLES, roomTableSprite, TABLE_MATERIALS, tableSprite, type RoomTable, type TableMaterial } from './domain/tables.ts';
import { decalTile, terrainBankTile, terrainEdgeTile } from './domain/terrainTiles.ts';
import { TERRAINS, terrainTile, type Terrain } from './domain/tiles.ts';
import type { WallGroup } from './domain/wallGeometry.ts';
import { WALL_MATERIALS, type WallMaterial } from './domain/wallMap.ts';
import { bodySprite, jointSprite } from './domain/walls.ts';
import { crop, place } from './imageOps.ts';

function blankSheet(spec: Parameters<typeof sheetSize>[0]): PixelBuffer {
  const { width, height } = sheetSize(spec);
  return new PixelBuffer(width, height);
}

/** The ten walk steps, then the idle pose in the last column. */
export function characterWalkSheet(sprites: CharacterSprites): PixelBuffer {
  const sheet = blankSheet(CHARACTER_WALK);
  place(sheet, sprites.walk, 0, 0);
  place(sheet, sprites.idle, CHARACTER_WALK.idleColumn * CHARACTER_WALK.frame.width, 0);
  return sheet;
}

/** The generator already draws the seated sheet in the contract layout. */
export function characterSeatedSheet(sprites: CharacterSprites): PixelBuffer {
  return new PixelBuffer(sprites.sit.width, sprites.sit.height, sprites.sit.data.slice());
}

/**
 * One column per facing, `back` layer on row 0 and `front` on row 1, kept apart so the office can
 * draw the sitter between them. The seat lands on CHAIR.anchor in every cell.
 */
export function chairSheet(material: ChairMaterial): PixelBuffer {
  const sheet = blankSheet(CHAIR);
  for (const facing of PACK_FACINGS) {
    const sprite = chairSprite(material, facing);
    const x = facingColumn(facing) * CHAIR.frame.width + CHAIR.anchor.x - sprite.seat.x;
    const y = CHAIR.anchor.y - sprite.seat.y;
    place(sheet, sprite.back, x, y);
    place(sheet, sprite.front, x, CHAIR.frame.height + y);
  }
  return sheet;
}

export interface DeskSheet {
  readonly image: PixelBuffer;
  readonly facings: Readonly<Record<ArtFacing, ArtDeskFacing>>;
}

/** One column per facing, the floor under the middle of the desk on DESK.anchor in every cell. */
export function deskSheet(material: TableMaterial): DeskSheet {
  const image = blankSheet(DESK);
  const facings = {} as Record<ArtFacing, ArtDeskFacing>;
  for (const facing of PACK_FACINGS) {
    const sprite = tableSprite(material, facing);
    place(image, sprite.image, facingColumn(facing) * DESK.frame.width + DESK.anchor.x - sprite.center.x, DESK.anchor.y - sprite.center.y);
    facings[facing] = {
      footprint: DESK.footprintByFacing[facing],
      ground: { x: sprite.ground.x - sprite.center.x, y: sprite.ground.y - sprite.center.y },
      chairGround: { x: sprite.chairGround.x - sprite.center.x, y: sprite.chairGround.y - sprite.center.y },
    };
  }
  return { image, facings };
}

/** The whole motif: frame `row * 3 + col` is already its sub-tile (col, row). */
export function floorSheet(terrain: Terrain): PixelBuffer {
  return terrainTile(terrain);
}

export function wallSheet(material: WallMaterial): PixelBuffer {
  const sheet = blankSheet(WALL);
  const at = (piece: WallPiece): number => wallFrameIndex(piece) * WALL.frame.width;
  place(sheet, bodySprite(material, 'horizontal').image, at({ piece: 'body', axis: 'horizontal' }), 0);
  place(sheet, bodySprite(material, 'vertical').image, at({ piece: 'body', axis: 'vertical' }), 0);
  for (let mask = 1; mask <= 15; mask += 1) place(sheet, jointSprite(material, mask).image, at({ piece: 'joint', mask }), 0);
  return sheet;
}

function sheetFrame(sheet: PixelBuffer, piece: WallPiece): PixelBuffer {
  return crop(sheet, wallFrameIndex(piece) * WALL.frame.width, 0, WALL.frame.width, WALL.frame.height);
}

/**
 * Draws a wall group from its sheet the way the office will: each piece at its contract rect.
 * Pieces never overlap, so writing them unblended keeps glass from being composited twice.
 */
export function wallLayer(sheet: PixelBuffer, group: WallGroup): { readonly image: PixelBuffer; readonly left: number; readonly top: number } {
  const pieces = [
    ...group.joints.map((joint) => ({ rect: wallJointRect(joint.vertex), frame: sheetFrame(sheet, { piece: 'joint', mask: joint.mask }) })),
    ...group.bodies.map((body) => ({ rect: wallBodyRect(body.edge), frame: sheetFrame(sheet, { piece: 'body', axis: body.edge.axis }) })),
  ];
  const left = Math.min(...pieces.map(({ rect }) => rect.x));
  const top = Math.min(...pieces.map(({ rect }) => rect.y));
  const right = Math.max(...pieces.map(({ rect }) => rect.x + rect.width));
  const bottom = Math.max(...pieces.map(({ rect }) => rect.y + rect.height));
  const image = new PixelBuffer(right - left, bottom - top);
  for (const { rect, frame } of pieces) place(image, frame, rect.x - left, rect.y - top);
  return { image, left, top };
}

// --- Terrain -----------------------------------------------------------------------------------

/** Every terrain edge tile, decal and water bank at its `terrainTileIndex` / `terrainDecalIndex` / `terrainBankIndex`; mask 0 stays empty. */
export function terrainTilesetSheet(): PixelBuffer {
  const sheet = blankSheet(TERRAIN_TILESET);
  const at = (index: number): [number, number] => [(index % TERRAIN_TILESET.columns) * ART_TILE, Math.floor(index / TERRAIN_TILESET.columns) * ART_TILE];
  for (const material of TERRAIN_MATERIALS) {
    for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
      for (let mask = 1; mask < TERRAIN_MASKS; mask += 1) place(sheet, terrainEdgeTile(material, mask, phase), ...at(terrainTileIndex(material, mask, phase)));
    }
  }
  for (const decal of TERRAIN_DECALS) place(sheet, decalTile(decal), ...at(terrainDecalIndex(decal)));
  for (let mask = 1; mask < TERRAIN_MASKS; mask += 1) place(sheet, terrainBankTile(mask), ...at(terrainBankIndex(mask)));
  return sheet;
}

/**
 * Draws a width x height map from the tileset the way the office's tilemap will: the layers of
 * `terrainLayerData` bottom first, each cell at TERRAIN_LAYER_ORIGIN plus its position, composited
 * over the one below and cropped to the map.
 */
export function terrainLayerImage(tileset: PixelBuffer, width: number, height: number, terrainAt: (tx: number, ty: number) => TerrainMaterial): PixelBuffer {
  const image = new PixelBuffer(width * ART_TILE, height * ART_TILE);
  for (const layer of terrainLayerData(width, height, terrainAt)) {
    layer.forEach((row, cy) =>
      row.forEach((index, cx) => {
        if (index < 0) return;
        const tile = crop(tileset, (index % TERRAIN_TILESET.columns) * ART_TILE, Math.floor(index / TERRAIN_TILESET.columns) * ART_TILE, ART_TILE, ART_TILE);
        image.blit(tile, cx * ART_TILE + TERRAIN_LAYER_ORIGIN, cy * ART_TILE + TERRAIN_LAYER_ORIGIN);
      }),
    );
  }
  return image;
}

// --- Map props ---------------------------------------------------------------------------------

export function treeSheet(kind: TreeKind): PixelBuffer {
  return treeSprite(kind);
}

export function plantSheet(kind: PlantKind): PixelBuffer {
  return plantSprite(kind);
}

export function tableSheet(kind: RoomTable): PixelBuffer {
  return roomTableSprite(kind);
}

/** One column per orientation, in BRIDGE_ORIENTATIONS order. */
export function bridgeSheet(): PixelBuffer {
  const sheet = blankSheet(BRIDGE);
  for (const orientation of BRIDGE_ORIENTATIONS) place(sheet, bridgeSprite(orientation), bridgeFrameIndex(orientation) * BRIDGE.frame.width, 0);
  return sheet;
}

/** One frame per connection mask, 0 to 15. */
export function hedgeSheet(): PixelBuffer {
  const sheet = blankSheet(HEDGE);
  for (let mask = 0; mask < 16; mask += 1) place(sheet, hedgeSprite(mask), hedgeFrameIndex(mask) * HEDGE.frame.width, 0);
  return sheet;
}

/** Every production sheet of the pack, in manifest order. */
export interface PackSheets {
  readonly characters: readonly { readonly spec: CharacterSpec; readonly walk: PixelBuffer; readonly seated: PixelBuffer }[];
  readonly chairs: readonly { readonly material: ChairMaterial; readonly image: PixelBuffer }[];
  readonly desks: readonly { readonly material: TableMaterial; readonly sheet: DeskSheet }[];
  readonly floors: readonly { readonly terrain: Terrain; readonly image: PixelBuffer }[];
  readonly walls: readonly { readonly material: WallMaterial; readonly image: PixelBuffer }[];
  readonly tileset: PixelBuffer;
  readonly trees: readonly { readonly kind: TreeKind; readonly image: PixelBuffer }[];
  readonly plants: readonly { readonly kind: PlantKind; readonly image: PixelBuffer }[];
  readonly bridge: PixelBuffer;
  readonly hedge: PixelBuffer;
  readonly tables: readonly { readonly kind: RoomTable; readonly image: PixelBuffer }[];
}

export function buildPackSheets(): PackSheets {
  return {
    characters: BASE_CHARACTERS.map((spec) => {
      const sprites = buildCharacterSprites(spec);
      return { spec, walk: characterWalkSheet(sprites), seated: characterSeatedSheet(sprites) };
    }),
    chairs: CHAIR_MATERIALS.map((material) => ({ material, image: chairSheet(material) })),
    desks: TABLE_MATERIALS.map((material) => ({ material, sheet: deskSheet(material) })),
    floors: TERRAINS.map((terrain) => ({ terrain, image: floorSheet(terrain) })),
    walls: WALL_MATERIALS.map((material) => ({ material, image: wallSheet(material) })),
    tileset: terrainTilesetSheet(),
    trees: TREE_KINDS.map((kind) => ({ kind, image: treeSheet(kind) })),
    plants: PLANT_KINDS.map((kind) => ({ kind, image: plantSheet(kind) })),
    bridge: bridgeSheet(),
    hedge: hedgeSheet(),
    tables: ROOM_TABLES.map((kind) => ({ kind, image: tableSheet(kind) })),
  };
}
