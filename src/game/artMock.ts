/**
 * What the office mock of an art review shows (#121, #122): the cells of the
 * sheets a piece is drawn from, and where the pieces stand on a block. Pure
 * and Phaser-free like `characterPreview.ts`, so the review loads none of the
 * office, and every number comes from the contract: a cell is the one the
 * office would draw.
 *
 * The mock is `MOCK_COLUMNS` x `MOCK_ROWS` blocks of at least 3 x 3 tiles, the
 * motif of a floor; the three blocks in the middle row show the submission: a
 * character walking its 8 directions around one sitting, a plant (or a piece
 * in every orientation it has) on grass, and a floor, or water.
 */

import {
  ART_TILE,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  DOOR,
  PLANT,
  TABLE,
  doorFrameIndex,
  doorHingeOf,
  facingColumn,
  seatedRowForFacing,
  sheetSize,
  type ArtFacing,
  type Point,
  type Size,
  type TableFacing,
  type WalkDirection,
} from './artContract';
import { artPackFileUrl } from './artPack';

export const MOCK_COLUMNS = 5;
export const MOCK_ROWS = 3;
/** Tiles per side of a block: the motif of a floor (`FLOOR.motifTiles`). */
export const MOCK_BLOCK_TILES = 3;
export const MOCK_BLOCK_PX = MOCK_BLOCK_TILES * ART_TILE;

/** One cell of a sheet, enough to cut it with CSS. */
export interface MockSprite {
  readonly url: string;
  /** The whole sheet. */
  readonly sheet: Size;
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Frames a loop steps through to the right of `frame`; 0 for a still one. */
  readonly steps: number;
}

/** The pieces of the pack drawn where the submission is of another kind. */
export const MOCK_DEFAULTS = {
  /** The character a new user gets (`defaults.character` of the pack manifest, pinned by a test). */
  characterWalk: artPackFileUrl('character/p01-burgundy-suit-walk.png'),
  characterSeated: artPackFileUrl('character/p01-burgundy-suit-seated.png'),
  chair: artPackFileUrl('chair/wood.png'),
  /** The floor of the offices, around the three blocks. */
  office: artPackFileUrl('floor/wood.png'),
  grass: artPackFileUrl('floor/grass.png'),
  water: artPackFileUrl('floor/water.png'),
} as const;

/**
 * Distance between two neighbors of the compass: a walker is a tile wide and a tile and a half tall, so
 * a 3 x 3 tile block would stack them. The first block is as big as its 3 x 3 cells, not 3 x 3 tiles.
 */
export const COMPASS_PITCH = { x: ART_TILE + 8, y: CHARACTER_WALK.frame.height + 8 } as const;
export const COMPASS_SIZE = { width: 3 * COMPASS_PITCH.x, height: 3 * COMPASS_PITCH.y } as const;

/** The cell, in the 3 x 3 cells of the first block, where a character walking `direction` stands; the middle one is the sitter's. */
export const COMPASS: Readonly<Record<WalkDirection, { readonly col: 0 | 1 | 2; readonly row: 0 | 1 | 2 }>> = {
  NW: { col: 0, row: 0 },
  N: { col: 1, row: 0 },
  NE: { col: 2, row: 0 },
  W: { col: 0, row: 1 },
  E: { col: 2, row: 1 },
  SW: { col: 0, row: 2 },
  S: { col: 1, row: 2 },
  SE: { col: 2, row: 2 },
};

function cell(url: string, spec: { readonly frame: Size; readonly columns: number; readonly rows: number }, column: number, row: number, steps = 0): MockSprite {
  return {
    url,
    sheet: sheetSize(spec),
    frame: { x: column * spec.frame.width, y: row * spec.frame.height, width: spec.frame.width, height: spec.frame.height },
    steps,
  };
}

/** The walk cycle toward `direction`, from its first step. */
export function walkingSprite(url: string, direction: WalkDirection): MockSprite {
  return cell(url, CHARACTER_WALK, 0, CHARACTER_WALK.rowOrder.indexOf(direction), CHARACTER_WALK.stepColumns);
}

/** Sitting, facing the viewer. */
export function seatedSprite(url: string): MockSprite {
  return cell(url, CHARACTER_SEATED, CHARACTER_SEATED.idleColumns[0]!, seatedRowForFacing('down'));
}

/** Both layers of a chair: `back` goes under the sitter, `front` over. */
export function chairSprites(url: string, facing: ArtFacing): { readonly back: MockSprite; readonly front: MockSprite } {
  const column = facingColumn(facing);
  return { back: cell(url, CHAIR, column, CHAIR.rowOrder.indexOf('back')), front: cell(url, CHAIR, column, CHAIR.rowOrder.indexOf('front')) };
}

export function deskSprite(url: string, facing: ArtFacing): MockSprite {
  return cell(url, DESK, facingColumn(facing), 0);
}

export function tableSprite(url: string, orientation: TableFacing): MockSprite {
  return cell(url, TABLE, TABLE.columnOrder.indexOf(orientation), 0);
}

/** A closed door opening toward `rotation`, on the hinge a single door has there (an upload is always a single door). */
export function doorSprite(url: string, rotation: 0 | 90 | 180 | 270): MockSprite {
  const index = doorFrameIndex(rotation, doorHingeOf('door-upload-single', rotation), 0);
  return cell(url, DOOR, index % DOOR.columns, Math.floor(index / DOOR.columns));
}

export function plantSprite(url: string): MockSprite {
  return cell(url, PLANT, 0, 0);
}

/**
 * Where the chair and its sitter are drawn (top-left of their frames) for the
 * floor point under the seat: the pelvis of the seated frames rests on the
 * seat point of the chair, the same rule the office follows.
 */
export function seatedAt(ground: Point): { readonly chair: Point; readonly sitter: Point } {
  const chair = { x: ground.x - CHAIR.ground.x, y: ground.y - CHAIR.ground.y };
  const seat = { x: chair.x + CHAIR.anchor.x, y: chair.y + CHAIR.anchor.y };
  return { chair, sitter: { x: seat.x - CHARACTER_SEATED.anchor.x, y: seat.y - CHARACTER_SEATED.anchor.y } };
}

/** Captions, Spanish like the rest of the UI. */
export const WALK_CAPTIONS: Readonly<Record<WalkDirection, string>> = {
  S: 'hacia abajo',
  SE: 'hacia abajo a la derecha',
  E: 'hacia la derecha',
  NE: 'hacia arriba a la derecha',
  N: 'hacia arriba',
  NW: 'hacia arriba a la izquierda',
  W: 'hacia la izquierda',
  SW: 'hacia abajo a la izquierda',
};

export const FACING_CAPTIONS: Readonly<Record<ArtFacing, string>> = {
  up: 'hacia arriba',
  down: 'hacia abajo',
  left: 'hacia la izquierda',
  right: 'hacia la derecha',
};

export const TABLE_CAPTIONS: Readonly<Record<TableFacing, string>> = { horizontal: 'horizontal', vertical: 'vertical' };

/** The side a door opens to for each decor rotation (`DoorSpec`: 0 down, 90 right, 180 up, 270 left). */
export const DOOR_CAPTIONS: Readonly<Record<0 | 90 | 180 | 270, string>> = {
  0: 'abre hacia abajo',
  90: 'abre hacia la derecha',
  180: 'abre hacia arriba',
  270: 'abre hacia la izquierda',
};
