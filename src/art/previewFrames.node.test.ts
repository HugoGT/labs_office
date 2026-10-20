import { describe, expect, it } from 'vitest';
import { CHARACTER_SEATED } from '../game/artContract.ts';
import { BASE_CHARACTERS } from './characters.ts';
import { CHARACTER_TEMPLATES, toCharacterSpec } from './customCharacter.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { renderCharacterPreview } from './previewFrames.ts';
import { buildCharacterSprites, frameRect, sitFrameRect, type FrameRect } from './spriteSheet.ts';
import { WALK_FRAME_COUNT } from './walkCycle.ts';

function cut(sheet: PixelBuffer, rect: FrameRect): number[] {
  const out = new PixelBuffer(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) out.setPixel(x, y, sheet.getPixel(rect.x + x, rect.y + y));
  }
  return Array.from(out.data);
}

describe('renderCharacterPreview', () => {
  it.each([
    ['a base character', BASE_CHARACTERS[3]!],
    ['a custom character', toCharacterSpec({ ...CHARACTER_TEMPLATES[7]!.spec, accessory: 'none', glasses: true })],
  ])('draws exactly the cells of the full sheets for %s, facing the viewer', (_label, spec) => {
    const sprites = buildCharacterSprites(spec);
    const preview = renderCharacterPreview(spec);

    expect(Array.from(preview.idle.data)).toEqual(cut(sprites.idle, frameRect('S', 0)));
    expect(preview.walk).toHaveLength(WALK_FRAME_COUNT);
    preview.walk.forEach((frame, column) => {
      expect(Array.from(frame.data)).toEqual(cut(sprites.walk, frameRect('S', column)));
    });
    expect(Array.from(preview.seated.data)).toEqual(cut(sprites.sit, sitFrameRect('down', CHARACTER_SEATED.idleColumns[0]!)));
  });
});
