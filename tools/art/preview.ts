/**
 * Review previews of the pack, drawn only from the production sheets and the contract's anchors
 * and rects, the same inputs the office will use. They are for people, not for the office: they
 * carry a backdrop and are upscaled, so they are written outside public/ (see PREVIEW_DIR).
 */
import {
  ART_TILE,
  WALL,
  wallFrameIndex,
  BRIDGE,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  DOOR,
  RUG,
  FLOOR,
  HEDGE,
  PACK_FACINGS,
  PLANT,
  SOFA,
  TABLE,
  TABLE_FACINGS,
  TERRAIN_MATERIALS,
  TERRAIN_TILESET,
  TREE,
  bridgeFrameIndex,
  doorFrameIndex,
  doorHingeOf,
  doorPlacement,
  doorVariantOf,
  facingColumn,
  floorFrameAt,
  hedgeFrameIndex,
  propPlacement,
  type TableFacing,
  seatedRowForFacing,
  terrainDecalIndex,
  WALK_DIRECTIONS,
  type ArtFacing,
  type BridgeOrientation,
  type Footprint,
  type Point,
  type TerrainDecal,
  type TerrainMaterial,
} from '../../src/game/artContract.ts';
import { PixelBuffer } from '../../src/art/pixelBuffer.ts';
import type { Terrain } from './domain/tiles.ts';
import { type WallMaterial } from './domain/wallMap.ts';
import { wallTileFrames } from '../../src/game/officeLayout.ts';
import { doorAxis, doorOpenings, doorSpan } from '../../src/game/officeDoors.ts';
import type { DecorItem } from '../../src/game/officeDecor.ts';
import { BACKDROP, crop, upscale } from './imageOps.ts';
import { treeSprite } from './domain/props.ts';
import { ROOM_TABLE_FOOTPRINTS, type RoomTable } from './domain/tables.ts';
import { terrainLayerImage, type PackSheets } from './sheets.ts';

/** Nearest-neighbor zoom of every preview; production files stay at 1x. */
export const PREVIEW_SCALE = 2;

const GAP = 4;

function backdrop(width: number, height: number): PixelBuffer {
  const image = new PixelBuffer(width, height);
  image.fillRect(0, 0, width, height, BACKDROP);
  return image;
}

function frameOf(sheet: PixelBuffer, spec: { readonly frame: { readonly width: number; readonly height: number } }, column: number, row: number): PixelBuffer {
  return crop(sheet, column * spec.frame.width, row * spec.frame.height, spec.frame.width, spec.frame.height);
}

/** Lays a floor out tile by tile through `floorFrameAt`, as the office will. */
function tiledFloor(sheet: PixelBuffer, cols: number, rows: number): PixelBuffer {
  const out = new PixelBuffer(cols * ART_TILE, rows * ART_TILE);
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      const frame = floorFrameAt(tx, ty);
      out.blit(frameOf(sheet, FLOOR, frame % FLOOR.motifTiles, Math.floor(frame / FLOOR.motifTiles)), tx * ART_TILE, ty * ART_TILE);
    }
  }
  return out;
}

/** One row per character: the idle pose in the 8 walk directions, then seated idle in the 4 facings. */
function charactersPreview(sheets: PackSheets): PixelBuffer {
  const rowHeight = CHARACTER_SEATED.frame.height;
  const seatedX = GAP + WALK_DIRECTIONS.length * CHARACTER_WALK.frame.width + GAP;
  const width = seatedX + PACK_FACINGS.length * CHARACTER_SEATED.frame.width + GAP;
  const out = backdrop(width, GAP + sheets.characters.length * (rowHeight + GAP));
  sheets.characters.forEach(({ walk, seated }, index) => {
    const y = GAP + index * (rowHeight + GAP);
    const walkY = y + rowHeight - CHARACTER_WALK.frame.height;
    WALK_DIRECTIONS.forEach((_, row) => out.blit(frameOf(walk, CHARACTER_WALK, CHARACTER_WALK.idleColumn, row), GAP + row * CHARACTER_WALK.frame.width, walkY));
    PACK_FACINGS.forEach((facing, column) => {
      const idle = CHARACTER_SEATED.idleColumns[0] as number;
      out.blit(frameOf(seated, CHARACTER_SEATED, idle, seatedRowForFacing(facing)), seatedX + column * CHARACTER_SEATED.frame.width, y);
    });
  });
  return out;
}

const STATION = 4 * ART_TILE;
/** Desk anchor inside a station cell: low enough that a sitter behind the desk keeps its head. */
const STATION_ANCHOR = { x: STATION / 2, y: STATION / 2 + 4 };

/**
 * One desk, the chair of the same facing at its chair ground and a seated character between the
 * chair's two layers, depth sorted by ground point.
 */
function station(sheets: PackSheets, floor: PixelBuffer, deskIndex: number, chairIndex: number, facing: ArtFacing, sitter: number): PixelBuffer {
  const cell = tiledFloor(floor, STATION / ART_TILE, STATION / ART_TILE);
  const desk = sheets.desks[deskIndex]!.sheet;
  const chair = sheets.chairs[chairIndex]!.image;
  const character = sheets.characters[sitter % sheets.characters.length]!;
  const offsets = desk.facings[facing];
  const column = facingColumn(facing);
  const chairGround = { x: STATION_ANCHOR.x + offsets.chairGround.x, y: STATION_ANCHOR.y + offsets.chairGround.y };
  const chairX = chairGround.x - CHAIR.ground.x;
  const chairY = chairGround.y - CHAIR.ground.y;
  const items = [
    {
      depth: STATION_ANCHOR.y + offsets.ground.y,
      draw: () => cell.blit(frameOf(desk.image, DESK, column, 0), STATION_ANCHOR.x - DESK.anchor.x, STATION_ANCHOR.y - DESK.anchor.y),
    },
    {
      depth: chairGround.y,
      draw: () => {
        cell.blit(frameOf(chair, CHAIR, column, 0), chairX, chairY);
        const idle = CHARACTER_SEATED.idleColumns[0] as number;
        const pose = frameOf(character.seated, CHARACTER_SEATED, idle, seatedRowForFacing(facing));
        cell.blit(pose, chairX + CHAIR.anchor.x - CHARACTER_SEATED.anchor.x, chairY + CHAIR.anchor.y - CHARACTER_SEATED.anchor.y);
        cell.blit(frameOf(chair, CHAIR, column, 1), chairX, chairY);
      },
    },
  ];
  items.sort((a, b) => a.depth - b.depth).forEach((item) => item.draw());
  return cell;
}

/** Every desk material with every chair material, in the four facings, on the wood floor. */
function furniturePreview(sheets: PackSheets): PixelBuffer {
  const floor = sheets.floors.find((entry) => entry.terrain === 'wood')!.image;
  const rows = sheets.desks.length * sheets.chairs.length;
  const out = backdrop(GAP + PACK_FACINGS.length * (STATION + GAP), GAP + rows * (STATION + GAP));
  for (let desk = 0; desk < sheets.desks.length; desk += 1) {
    for (let chair = 0; chair < sheets.chairs.length; chair += 1) {
      const row = desk * sheets.chairs.length + chair;
      PACK_FACINGS.forEach((facing, column) => {
        out.blit(station(sheets, floor, desk, chair, facing, row * PACK_FACINGS.length + column), GAP + column * (STATION + GAP), GAP + row * (STATION + GAP));
      });
    }
  }
  return out;
}

const FLOOR_PREVIEW_TILES = 6;

/** Each floor over 6x6 tiles: two motif repeats per side, to check seams between tiles and motifs. */
function floorsPreview(sheets: PackSheets): PixelBuffer {
  const side = FLOOR_PREVIEW_TILES * ART_TILE;
  const out = backdrop(GAP + sheets.floors.length * (side + GAP), GAP + side + GAP);
  sheets.floors.forEach(({ image }, index) => out.blit(tiledFloor(image, FLOOR_PREVIEW_TILES, FLOOR_PREVIEW_TILES), GAP + index * (side + GAP), GAP));
  return out;
}

/** The art demo's pairing of wall material and floor. */
const WALL_FLOORS: Readonly<Record<WallMaterial, Terrain>> = { brick: 'wood', stone: 'grass', plaster: 'water' };
const ROOM_COLS = 8;
const ROOM_ROWS = 9;

/** A room seen from the front: a top wall, two side runs, a bottom wall with a doorway and a short inner wall. */
function roomWalls(material: WallMaterial): (string | null)[] {
  const walls = new Array<string | null>(ROOM_COLS * ROOM_ROWS).fill(null);
  const put = (tx: number, ty: number): void => {
    walls[ty * ROOM_COLS + tx] = `wall-${material}`;
  };
  for (let tx = 0; tx < ROOM_COLS; tx += 1) put(tx, 1);
  for (let ty = 2; ty < ROOM_ROWS - 1; ty += 1) {
    put(0, ty);
    put(ROOM_COLS - 1, ty);
  }
  for (let tx = 0; tx < ROOM_COLS; tx += 1) if (tx !== 3 && tx !== 4) put(tx, ROOM_ROWS - 2);
  put(5, 4);
  return walls;
}

function wallsPreview(sheets: PackSheets): PixelBuffer {
  const width = ROOM_COLS * ART_TILE;
  const height = ROOM_ROWS * ART_TILE;
  const out = backdrop(GAP + sheets.walls.length * (width + GAP), GAP + height + GAP);
  sheets.walls.forEach(({ material, image }, index) => {
    const floor = sheets.floors.find((entry) => entry.terrain === WALL_FLOORS[material])!.image;
    const room = tiledFloor(floor, ROOM_COLS, ROOM_ROWS);
    for (const { tx, ty, frame } of wallTileFrames({ width: ROOM_COLS, height: ROOM_ROWS, walls: roomWalls(material) })) {
      const index = wallFrameIndex(frame, tx);
      const sx = (index % WALL.columns) * ART_TILE;
      const sy = Math.floor(index / WALL.columns) * ART_TILE;
      room.blit(crop(image, sx, sy, ART_TILE, ART_TILE), tx * ART_TILE, ty * ART_TILE);
    }
    out.blit(room, GAP + index * (width + GAP), GAP);
  });
  return out;
}

const OPENING_COLS = 12;
const OPENING_ROWS = 12;

/** A room for doors and windows: a top and a bottom horizontal run and two vertical side runs, all of one material. */
function openingRoomWalls(material: WallMaterial): (string | null)[] {
  const walls = new Array<string | null>(OPENING_COLS * OPENING_ROWS).fill(null);
  const put = (tx: number, ty: number): void => {
    walls[ty * OPENING_COLS + tx] = `wall-${material}`;
  };
  for (let tx = 0; tx < OPENING_COLS; tx += 1) {
    put(tx, 1);
    put(tx, OPENING_ROWS - 2);
  }
  for (let ty = 2; ty < OPENING_ROWS - 2; ty += 1) {
    put(0, ty);
    put(OPENING_COLS - 1, ty);
  }
  return walls;
}

/**
 * The doors and windows of the opening room: a door and two windows side by side in each
 * horizontal run (the bottom pair right beside the double door), a door in each vertical one.
 */
const OPENING_ITEMS: readonly DecorItem[] = [
  { index: 1 * OPENING_COLS + 2, piece: 'door-wood', rotation: 0 },
  { index: 1 * OPENING_COLS + 6, piece: 'door-glass-window', rotation: 0 },
  { index: 1 * OPENING_COLS + 8, piece: 'door-glass-window', rotation: 0 },
  { index: (OPENING_ROWS - 2) * OPENING_COLS + 2, piece: 'door-glass-window', rotation: 0 },
  { index: (OPENING_ROWS - 2) * OPENING_COLS + 4, piece: 'door-glass-window', rotation: 0 },
  { index: (OPENING_ROWS - 2) * OPENING_COLS + 6, piece: 'door-wood-double', rotation: 180 },
  { index: 4 * OPENING_COLS + 0, piece: 'door-wood', rotation: 90 },
  { index: 3 * OPENING_COLS + OPENING_COLS - 1, piece: 'door-wood-double', rotation: 270 },
];

/**
 * Doors and windows in the walls of every material (tile walls), drawn through the office's own
 * rules: the walls by `wallTileFrames` with the doors' openings, each door or window by its
 * placement and closed frame.
 */
function wallOpeningsPreview(sheets: PackSheets): PixelBuffer {
  const width = OPENING_COLS * ART_TILE;
  const height = OPENING_ROWS * ART_TILE;
  const out = backdrop(GAP + sheets.walls.length * (width + GAP), GAP + height + GAP);
  sheets.walls.forEach(({ material, image }, index) => {
    const floor = sheets.floors.find((entry) => entry.terrain === WALL_FLOORS[material])!.image;
    const room = tiledFloor(floor, OPENING_COLS, OPENING_ROWS);
    const grid = { width: OPENING_COLS, height: OPENING_ROWS, walls: openingRoomWalls(material) };
    const openings = doorOpenings(OPENING_ITEMS, grid);
    for (const { tx, ty, frame, crop: part } of wallTileFrames({ ...grid, openings })) {
      const at = wallFrameIndex(frame, tx);
      const { x, w, h = ART_TILE } = part ?? { x: 0, w: ART_TILE };
      room.blit(crop(image, (at % WALL.columns) * ART_TILE + x, Math.floor(at / WALL.columns) * ART_TILE, w, h), tx * ART_TILE + x, ty * ART_TILE);
    }
    for (const item of OPENING_ITEMS) {
      const sheet = sheets.doors.find((entry) => entry.variant === doorVariantOf(item.piece))!.image;
      const frame = doorFrameIndex(item.rotation, doorHingeOf(item.piece, item.rotation), 0);
      const tx = item.index % OPENING_COLS;
      const ty = Math.floor(item.index / OPENING_COLS);
      const placed = doorPlacement(doorAxis(item), tx, ty, doorSpan(item));
      room.blit(frameOf(sheet, DOOR, frame % DOOR.columns, Math.floor(frame / DOOR.columns)), placed.x, placed.y);
    }
    out.blit(room, GAP + index * (width + GAP), GAP);
  });
  return out;
}

// --- Terrain and map props --------------------------------------------------------------------

const MATERIAL_KEYS: Readonly<Record<string, TerrainMaterial>> = {
  W: 'water',
  G: 'grass',
  D: 'dirt',
  S: 'sand',
  C: 'cobblestone',
  O: 'wood',
  T: 'tile',
  K: 'carpet',
};

function mapOf(rows: readonly string[]): (tx: number, ty: number) => TerrainMaterial {
  return (tx, ty) => MATERIAL_KEYS[rows[ty]![tx]!]!;
}

/** Something drawn over the terrain: ground props first, then the rest by depth. */
interface Drawable {
  readonly layer: 'ground' | 'sorted';
  readonly depth: number;
  readonly draw: (image: PixelBuffer) => void;
}

function drawScene(image: PixelBuffer, items: readonly Drawable[]): void {
  const order = (item: Drawable): number => (item.layer === 'ground' ? -1e6 : item.depth);
  [...items].sort((a, b) => order(a) - order(b)).forEach((item) => item.draw(image));
}

function prop(frame: PixelBuffer, spec: { readonly anchor: Point; readonly footprint: Footprint }, tx: number, ty: number, layer: 'ground' | 'sorted' = 'sorted'): Drawable {
  const placed = propPlacement(spec, tx, ty);
  return { layer, depth: placed.depthY, draw: (image) => image.blit(frame, placed.x, placed.y) };
}

function decal(sheets: PackSheets, name: TerrainDecal, tx: number, ty: number): Drawable {
  const index = terrainDecalIndex(name);
  const tile = frameOf(sheets.tileset, TERRAIN_TILESET, index % TERRAIN_TILESET.columns, Math.floor(index / TERRAIN_TILESET.columns));
  return { layer: 'ground', depth: 0, draw: (image) => image.blit(tile, tx * ART_TILE, ty * ART_TILE) };
}

function bridge(sheets: PackSheets, orientation: BridgeOrientation, tx: number, ty: number): Drawable {
  return prop(frameOf(sheets.bridge, BRIDGE, bridgeFrameIndex(orientation), 0), BRIDGE, tx, ty, 'ground');
}

/** Hedge tiles at `tiles`, each with the frame of its connections to the others. */
function hedges(sheets: PackSheets, tiles: readonly (readonly [number, number])[]): Drawable[] {
  const set = new Set(tiles.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number): boolean => set.has(`${x},${y}`);
  return tiles.map(([x, y]) => {
    const mask = (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
    return prop(frameOf(sheets.hedge, HEDGE, hedgeFrameIndex(mask), 0), HEDGE, x, y);
  });
}

/** The leaf color the previews paint one tree in, to show the tree takes any. */
const AUTUMN_LEAVES = '#d9822b';

function sheetOf<K extends string>(entries: readonly { readonly kind: K; readonly image: PixelBuffer }[], kind: K): PixelBuffer {
  return entries.find((entry) => entry.kind === kind)!.image;
}

/** A tiled-layer scene: lake with a beach, a river, a path, a plaza and built floors, with props. */
const TERRAIN_SCENE = [
  'GGGGGGGGGGGGGGGGGGGGGGGG',
  'GGGGGSSSSGGGGGGGDDDGGGGG',
  'GGGGSSWWSSSGGGGDDDDDGGGG',
  'GGGSSWWWWWSSGGGDDCCDDGGG',
  'GGGSWWWWWWWSGGDDCCCCDDGG',
  'GGGSSWWWWWSSGGDCCCCCCDGG',
  'GGGGSSWWWSSGGGDDCCCCDDGG',
  'GGSGGSSWSSGGGGGDDDDDDGGG',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'GGDDDDGGGGGGGOOOOOOOOGGG',
  'GGDGGDDGGGGGGOOKKKKOOTTG',
  'GGDGGGDDDDDDDOOKKKKOOTTG',
  'GDGGWGGGGGGGGOOOOOOOOTTG',
  'GGGGGGGGGGGGGGGGGGGGGGGG',
];

function terrainScene(sheets: PackSheets): PixelBuffer {
  const width = TERRAIN_SCENE[0]!.length;
  const image = terrainLayerImage(sheets.tileset, width, TERRAIN_SCENE.length, mapOf(TERRAIN_SCENE));
  const oak = sheetOf(sheets.trees, 'oak');
  // The same tree with its leaves painted orange, as the office paints it.
  const autumn = treeSprite('oak', AUTUMN_LEAVES);
  drawScene(image, [
    decal(sheets, 'lily-pad', 6, 3),
    decal(sheets, 'lily-pad', 8, 5),
    decal(sheets, 'flowers-white', 1, 2),
    decal(sheets, 'flowers-yellow', 13, 1),
    decal(sheets, 'flowers-blue', 22, 5),
    decal(sheets, 'clover', 9, 12),
    decal(sheets, 'mushrooms', 11, 14),
    decal(sheets, 'pebbles', 17, 1),
    decal(sheets, 'leaves', 0, 12),
    bridge(sheets, 'north-south', 2, 8),
    prop(oak, TREE, 1, 4),
    prop(autumn, TREE, 13, 5),
    prop(oak, TREE, 22, 1),
    prop(oak, TREE, 9, 14),
    prop(sheetOf(sheets.trees, 'ficus'), TREE, 20, 12),
    ...hedges(sheets, [
      [15, 15],
      [16, 15],
      [17, 15],
      [18, 15],
      [19, 15],
      [19, 14],
    ]),
  ]);
  return image;
}

const PAIR_COLS = 4;
const PAIR_ROWS = 3;
/** An island of the higher material on the lower one: straight sides, both corner kinds and a lone tile. */
const PAIR_ISLAND = [
  [1, 0],
  [2, 0],
  [1, 1],
  [3, 2],
] as const;

/** Every pair of materials that can meet, the higher one drawn as an island over the lower. */
function terrainPairsPreview(sheets: PackSheets): PixelBuffer {
  const pairs: [TerrainMaterial, TerrainMaterial][] = [];
  TERRAIN_MATERIALS.forEach((low, i) => TERRAIN_MATERIALS.slice(i + 1).forEach((high) => pairs.push([low, high])));
  const cellWidth = PAIR_COLS * ART_TILE;
  const cellHeight = PAIR_ROWS * ART_TILE;
  const columns = 7;
  const out = backdrop(GAP + columns * (cellWidth + GAP), GAP + Math.ceil(pairs.length / columns) * (cellHeight + GAP));
  pairs.forEach(([low, high], index) => {
    const island = (tx: number, ty: number): TerrainMaterial => (PAIR_ISLAND.some(([x, y]) => x === tx && y === ty) ? high : low);
    const cell = terrainLayerImage(sheets.tileset, PAIR_COLS, PAIR_ROWS, island);
    out.blit(cell, GAP + (index % columns) * (cellWidth + GAP), GAP + Math.floor(index / columns) * (cellHeight + GAP));
  });
  return out;
}

/**
 * Map seats around a table whose footprint starts at (x, y), as BASE_MAP_SEATS lays them out:
 * along its top and bottom rows (`rows`) and at its left and right ends (`ends`).
 */
function tableSeats(x: number, y: number, { w, h }: Footprint, ends: boolean, rows = true): { tx: number; ty: number; facing: ArtFacing }[] {
  const seats: { tx: number; ty: number; facing: ArtFacing }[] = [];
  if (rows) for (let i = 0; i < w; i += 1) seats.push({ tx: x + i, ty: y - 1, facing: 'down' }, { tx: x + i, ty: y + h, facing: 'up' });
  if (ends) for (let j = 0; j < h; j += 1) seats.push({ tx: x - 1, ty: y + j, facing: 'right' }, { tx: x + w, ty: y + j, facing: 'left' });
  return seats;
}

/** A room table's frame for a facing and the footprint it covers there (swapped standing vertical). */
function roomTable(sheets: PackSheets, kind: RoomTable, facing: TableFacing): { frame: PixelBuffer; footprint: Footprint } {
  const { w, h } = ROOM_TABLE_FOOTPRINTS[kind];
  return {
    frame: frameOf(sheetOf(sheets.tables, kind), TABLE, TABLE_FACINGS.indexOf(facing), 0),
    footprint: facing === 'vertical' ? { w: h, h: w } : { w, h },
  };
}

function chairAt(chair: PixelBuffer, seat: { tx: number; ty: number; facing: ArtFacing }): Drawable {
  const ground = { x: (seat.tx + 0.5) * ART_TILE, y: (seat.ty + 0.5) * ART_TILE };
  const x = ground.x - CHAIR.ground.x;
  const y = ground.y - CHAIR.ground.y;
  const column = facingColumn(seat.facing);
  return {
    layer: 'sorted',
    depth: ground.y,
    draw: (image) => {
      image.blit(frameOf(chair, CHAIR, column, 0), x, y);
      image.blit(frameOf(chair, CHAIR, column, 1), x, y);
    },
  };
}

const RIVERS = [
  'GGGGGGGGGGGWWWGGGGGGGG',
  'GGGGGGGGGGGWWWGGGGGGGG',
  'GGGGGGGGGGGWWWGGGGGGGG',
  'WWWWWWWWWWWWWWGGGGGGGG',
  'WWWWWWWWWWWWWWGGGGGGGG',
  'WWWWWWWWWWWWWWGGGGGGGG',
  'GGGGGGGGGGGWWWGGGGGGGG',
  'GGGGGGGGGGGWWWGGGGGGGG',
  'GGGGGGGGGGGWWWGGGGGGGG',
];

/** Trees, the plant, both bridges and every hedge joint outdoors; the room tables with their chairs indoors. */
function propsPreview(sheets: PackSheets): PixelBuffer {
  const outdoor = terrainLayerImage(sheets.tileset, RIVERS[0]!.length, RIVERS.length, mapOf(RIVERS));
  const ring: [number, number][] = [];
  for (let x = 15; x <= 20; x += 1) ring.push([x, 1], [x, 6]);
  for (let y = 2; y <= 5; y += 1) ring.push([15, y], [20, y]);
  ring.push([17, 3], [18, 3], [17, 4], [21, 8]);
  drawScene(outdoor, [
    bridge(sheets, 'north-south', 4, 3),
    bridge(sheets, 'east-west', 11, 0),
    prop(sheetOf(sheets.trees, 'oak'), TREE, 1, 1),
    prop(treeSprite('oak', AUTUMN_LEAVES), TREE, 8, 1),
    prop(sheetOf(sheets.trees, 'oak'), TREE, 8, 7),
    prop(sheetOf(sheets.trees, 'large'), TREE, 6, 7),
    prop(sheetOf(sheets.trees, 'ficus'), TREE, 2, 7),
    prop(sheetOf(sheets.plants, 'bonsai'), PLANT, 4, 7),
    ...hedges(sheets, ring),
  ]);

  const roomCols = RIVERS[0]!.length;
  const roomRows = 9;
  const room = tiledFloor(sheets.floors.find((entry) => entry.terrain === 'wood')!.image, roomCols, roomRows);
  const chair = sheets.chairs.find((entry) => entry.material === 'wood')!.image;
  const table = (kind: RoomTable, tx: number, ty: number, ends: boolean): Drawable[] => {
    const { frame, footprint } = roomTable(sheets, kind, 'horizontal');
    return [prop(frame, { anchor: TABLE.anchor, footprint }, tx, ty), ...tableSeats(tx, ty, footprint, ends).map((seat) => chairAt(chair, seat))];
  };
  drawScene(room, [
    ...table('meeting', 1, 2, true),
    ...table('cafeteria', 12, 3, false),
    prop(sheetOf(sheets.trees, 'ficus'), TREE, 20, 1),
    prop(sheetOf(sheets.trees, 'ficus'), TREE, 20, 7),
    prop(sheetOf(sheets.plants, 'bonsai'), PLANT, 21, 4),
  ]);

  const out = backdrop(GAP + outdoor.width + GAP, GAP + outdoor.height + GAP + room.height + GAP);
  out.blit(outdoor, GAP, GAP);
  out.blit(room, GAP, GAP + outdoor.height + GAP);
  return out;
}

/**
 * Every room table in both facings with chairs around it (#208): horizontal on the top row,
 * standing vertical on the bottom one, each above or below its own horizontal drawing.
 */
function tablesPreview(sheets: PackSheets): PixelBuffer {
  const chair = sheets.chairs.find((entry) => entry.material === 'wood')!.image;
  const room = tiledFloor(sheets.floors.find((entry) => entry.terrain === 'wood')!.image, 24, 19);
  const table = (kind: RoomTable, facing: TableFacing, tx: number, ty: number, seats: { ends: boolean; rows: boolean }): Drawable[] => {
    const { frame, footprint } = roomTable(sheets, kind, facing);
    return [prop(frame, { anchor: TABLE.anchor, footprint }, tx, ty), ...tableSeats(tx, ty, footprint, seats.ends, seats.rows).map((seat) => chairAt(chair, seat))];
  };
  drawScene(room, [
    ...table('meeting', 'horizontal', 1, 2, { ends: true, rows: true }),
    ...table('cafeteria', 'horizontal', 10, 2, { ends: false, rows: true }),
    ...table('oval', 'horizontal', 17, 2, { ends: true, rows: true }),
    ...table('oval', 'vertical', 22, 2, { ends: true, rows: true }),
    ...table('meeting', 'vertical', 2, 10, { ends: true, rows: true }),
    ...table('cafeteria', 'vertical', 11, 10, { ends: true, rows: false }),
    ...table('round', 'horizontal', 18, 12, { ends: true, rows: true }),
  ]);
  const out = backdrop(GAP + room.width + GAP, GAP + room.height + GAP);
  out.blit(room, GAP, GAP);
  return out;
}

/** Every rug sheet (both facings) over a wood floor, one row per rug. */
function rugsPreview(sheets: PackSheets): PixelBuffer {
  const width = RUG.columns * RUG.frame.width;
  const height = Math.ceil(RUG.frame.height / ART_TILE) * ART_TILE;
  const out = backdrop(GAP + width + GAP, GAP + sheets.rugs.length * (height + GAP));
  const floor = sheets.floors.find((entry) => entry.terrain === 'wood')!.image;
  sheets.rugs.forEach(({ image }, row) => {
    const cell = tiledFloor(floor, width / ART_TILE, height / ART_TILE);
    cell.blit(image, 0, 0);
    out.blit(cell, GAP, GAP + row * (height + GAP));
  });
  return out;
}

/** Preview images by file name, already upscaled. */
/** Every door sheet over a wood floor, frame grid as the sheet lays it out (#223). */
function doorsPreview(sheets: PackSheets): PixelBuffer {
  const width = DOOR.columns * DOOR.frame.width;
  const height = DOOR.rows * DOOR.frame.height;
  const out = backdrop(GAP + sheets.doors.length * (width + GAP), GAP + height + GAP);
  const floor = sheets.floors.find((entry) => entry.terrain === 'wood')!.image;
  sheets.doors.forEach(({ image }, index) => {
    const cell = tiledFloor(floor, width / ART_TILE, height / ART_TILE);
    cell.blit(image, 0, 0);
    out.blit(cell, GAP + index * (width + GAP), GAP);
  });
  return out;
}

const SOFA_CELL = { cols: 4, rows: 5 } as const;

/**
 * One sofa in one facing on a cell of floor, a sitter on every seat between its two layers: the
 * back layer, the sitters by their ground, then the front layer. Its footprint is laid on the tile
 * grid like the office does, the floor under its middle on SOFA.anchor, each sitter on the middle
 * of its own tile.
 */
function sofaCell(sheets: PackSheets, floor: PixelBuffer, sheet: PixelBuffer, seats: number, facing: ArtFacing, sitter: number): PixelBuffer {
  const cell = tiledFloor(floor, SOFA_CELL.cols, SOFA_CELL.rows);
  const sideways = facing === 'left' || facing === 'right';
  const rect = sideways ? { x: 1, y: 1, w: 1, h: seats } : { x: Math.floor((SOFA_CELL.cols - seats) / 2), y: 3, w: seats, h: 1 };
  const center = { x: (rect.x + rect.w / 2) * ART_TILE, y: (rect.y + rect.h / 2) * ART_TILE };
  const x = center.x - SOFA.anchor.x;
  const y = center.y - SOFA.anchor.y;
  const column = facingColumn(facing);
  cell.blit(frameOf(sheet, SOFA, column, 0), x, y);
  const idle = CHARACTER_SEATED.idleColumns[0] as number;
  for (let index = 0; index < seats; index += 1) {
    const ground = sideways ? { x: (rect.x + 0.5) * ART_TILE, y: (rect.y + index + 0.5) * ART_TILE } : { x: (rect.x + index + 0.5) * ART_TILE, y: (rect.y + 0.5) * ART_TILE };
    const character = sheets.characters[(sitter + index) % sheets.characters.length]!;
    const pose = frameOf(character.seated, CHARACTER_SEATED, idle, seatedRowForFacing(facing));
    cell.blit(pose, ground.x - CHARACTER_SEATED.anchor.x + CHAIR.anchor.x - CHAIR.ground.x, ground.y - CHARACTER_SEATED.anchor.y + CHAIR.anchor.y - CHAIR.ground.y);
  }
  cell.blit(frameOf(sheet, SOFA, column, 1), x, y);
  return cell;
}

/** Every sofa in the four facings on the wood floor, a sitter on each seat. */
function sofasPreview(sheets: PackSheets): PixelBuffer {
  const floor = sheets.floors.find((entry) => entry.terrain === 'wood')!.image;
  const width = SOFA_CELL.cols * ART_TILE;
  const height = SOFA_CELL.rows * ART_TILE;
  const out = backdrop(GAP + PACK_FACINGS.length * (width + GAP), GAP + sheets.sofas.length * (height + GAP));
  sheets.sofas.forEach(({ seats, image }, row) => {
    PACK_FACINGS.forEach((facing, column) => {
      out.blit(sofaCell(sheets, floor, image, seats, facing, (row * PACK_FACINGS.length + column) * 3), GAP + column * (width + GAP), GAP + row * (height + GAP));
    });
  });
  return out;
}

export function renderPreviews(sheets: PackSheets): Map<string, PixelBuffer> {
  return new Map([
    ['doors.png', upscale(doorsPreview(sheets), PREVIEW_SCALE)],
    ['characters.png', upscale(charactersPreview(sheets), PREVIEW_SCALE)],
    ['floors.png', upscale(floorsPreview(sheets), PREVIEW_SCALE)],
    ['furniture.png', upscale(furniturePreview(sheets), PREVIEW_SCALE)],
    ['props.png', upscale(propsPreview(sheets), PREVIEW_SCALE)],
    ['rugs.png', upscale(rugsPreview(sheets), PREVIEW_SCALE)],
    ['sofas.png', upscale(sofasPreview(sheets), PREVIEW_SCALE)],
    ['tables.png', upscale(tablesPreview(sheets), PREVIEW_SCALE)],
    ['terrain-pairs.png', upscale(terrainPairsPreview(sheets), PREVIEW_SCALE)],
    ['terrain.png', upscale(terrainScene(sheets), PREVIEW_SCALE)],
    ['walls.png', upscale(wallsPreview(sheets), PREVIEW_SCALE)],
    ['wall-openings.png', upscale(wallOpeningsPreview(sheets), PREVIEW_SCALE)],
  ]);
}
