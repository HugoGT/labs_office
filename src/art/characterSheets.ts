/**
 * The two production sheets of a character in the art contract layout (src/game/artContract.ts):
 * the walk sheet (ten steps, then the idle pose in the last column) and the seated sheet. The art
 * pack exporter, the server (custom characters, rendered on request) and the browser (the
 * creator's live preview) all call this, so a custom character is drawn exactly like a pack one.
 */
import { CHARACTER_WALK, sheetSize } from '../game/artContract.ts';
import type { CharacterSpec } from './characters.ts';
import { PixelBuffer, place } from './pixelBuffer.ts';
import { buildCharacterSprites, type CharacterSprites } from './spriteSheet.ts';

export interface CharacterSheets {
  readonly walk: PixelBuffer;
  readonly seated: PixelBuffer;
}

/** The ten walk steps, then the idle pose in the last column. */
export function characterWalkSheet(sprites: CharacterSprites): PixelBuffer {
  const { width, height } = sheetSize(CHARACTER_WALK);
  const sheet = new PixelBuffer(width, height);
  place(sheet, sprites.walk, 0, 0);
  place(sheet, sprites.idle, CHARACTER_WALK.idleColumn * CHARACTER_WALK.frame.width, 0);
  return sheet;
}

/** The generator already draws the seated sheet in the contract layout. */
export function characterSeatedSheet(sprites: CharacterSprites): PixelBuffer {
  return new PixelBuffer(sprites.sit.width, sprites.sit.height, sprites.sit.data.slice());
}

export function renderCharacterSheets(spec: CharacterSpec): CharacterSheets {
  const sprites = buildCharacterSprites(spec);
  return { walk: characterWalkSheet(sprites), seated: characterSeatedSheet(sprites) };
}
