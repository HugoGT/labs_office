/**
 * Review previews of the pack, drawn only from the production sheets and the contract's anchors
 * and rects, the same inputs the office will use. They are for people, not for the office: they
 * carry a backdrop and are upscaled, so they are written outside public/ (see PREVIEW_DIR).
 */
import {
  ART_TILE,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  FLOOR,
  PACK_FACINGS,
  facingColumn,
  floorFrameAt,
  seatedRowForFacing,
  WALK_DIRECTIONS,
  type ArtFacing,
} from '../../src/game/artContract.ts';
import { PixelBuffer } from './domain/pixelBuffer.ts';
import type { Terrain } from './domain/tiles.ts';
import { groupWallGeometry, resolveWallGeometry } from './domain/wallGeometry.ts';
import { WallMap, type WallMaterial } from './domain/wallMap.ts';
import { BACKDROP, crop, upscale } from './imageOps.ts';
import { wallLayer, type PackSheets } from './sheets.ts';

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
const WALL_FLOORS: Readonly<Record<WallMaterial, Terrain>> = { brick: 'wood', stone: 'grass', plaster: 'water', glass: 'plain' };
const ROOM_COLS = 7;
const ROOM_ROWS = 6;

/** A room with a doorway and a cross of inner walls: every joint shape, ends included. */
function roomMap(material: WallMaterial): WallMap {
  const map = new WallMap(ROOM_COLS, ROOM_ROWS);
  map.run({ col: 1, row: 1 }, 'east', 5, material);
  map.run({ col: 1, row: 1 }, 'south', 4, material);
  map.run({ col: 6, row: 1 }, 'south', 4, material);
  map.run({ col: 1, row: 5 }, 'east', 2, material);
  map.run({ col: 4, row: 5 }, 'east', 2, material);
  map.run({ col: 3, row: 1 }, 'south', 3, material);
  map.run({ col: 1, row: 3 }, 'east', 4, material);
  return map;
}

function wallsPreview(sheets: PackSheets): PixelBuffer {
  const width = ROOM_COLS * ART_TILE;
  const height = ROOM_ROWS * ART_TILE;
  const out = backdrop(GAP + sheets.walls.length * (width + GAP), GAP + height + GAP);
  sheets.walls.forEach(({ material, image }, index) => {
    const floor = sheets.floors.find((entry) => entry.terrain === WALL_FLOORS[material])!.image;
    const room = tiledFloor(floor, ROOM_COLS, ROOM_ROWS);
    for (const group of groupWallGeometry(resolveWallGeometry(roomMap(material)))) {
      const layer = wallLayer(image, group);
      room.blit(layer.image, layer.left, layer.top);
    }
    out.blit(room, GAP + index * (width + GAP), GAP);
  });
  return out;
}

/** Preview images by file name, already upscaled. */
export function renderPreviews(sheets: PackSheets): Map<string, PixelBuffer> {
  return new Map([
    ['characters.png', upscale(charactersPreview(sheets), PREVIEW_SCALE)],
    ['floors.png', upscale(floorsPreview(sheets), PREVIEW_SCALE)],
    ['furniture.png', upscale(furniturePreview(sheets), PREVIEW_SCALE)],
    ['walls.png', upscale(wallsPreview(sheets), PREVIEW_SCALE)],
  ]);
}
