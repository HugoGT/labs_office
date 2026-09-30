/**
 * Lays the generators' sprites out as the production sheets of the art contract
 * (src/game/artContract.ts): fixed grids, 1x, no backdrop. Every sprite is copied with `place`,
 * never blended, so a sheet holds exactly the pixels the generator drew.
 */
import {
  CHAIR,
  CHARACTER_WALK,
  DESK,
  PACK_FACINGS,
  WALL,
  facingColumn,
  sheetSize,
  wallBodyRect,
  wallFrameIndex,
  wallJointRect,
  type ArtDeskFacing,
  type ArtFacing,
  type WallPiece,
} from '../../src/game/artContract.ts';
import { CHAIR_MATERIALS, chairSprite, type ChairMaterial } from './domain/chairs.ts';
import { BASE_CHARACTERS, type CharacterSpec } from './domain/characters.ts';
import { PixelBuffer } from './domain/pixelBuffer.ts';
import { buildCharacterSprites, type CharacterSprites } from './domain/spriteSheet.ts';
import { TABLE_MATERIALS, tableSprite, type TableMaterial } from './domain/tables.ts';
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

/** Every production sheet of the pack, in manifest order. */
export interface PackSheets {
  readonly characters: readonly { readonly spec: CharacterSpec; readonly walk: PixelBuffer; readonly seated: PixelBuffer }[];
  readonly chairs: readonly { readonly material: ChairMaterial; readonly image: PixelBuffer }[];
  readonly desks: readonly { readonly material: TableMaterial; readonly sheet: DeskSheet }[];
  readonly floors: readonly { readonly terrain: Terrain; readonly image: PixelBuffer }[];
  readonly walls: readonly { readonly material: WallMaterial; readonly image: PixelBuffer }[];
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
  };
}
