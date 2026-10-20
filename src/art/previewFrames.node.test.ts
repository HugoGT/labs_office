import { describe, expect, it } from 'vitest';
import { BASE_CHARACTERS } from './characters.ts';
import { CHARACTER_TEMPLATES, toCharacterSpec } from './customCharacter.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { renderCharacterIdle } from './previewFrames.ts';
import { buildCharacterSprites, frameRect, type FrameRect } from './spriteSheet.ts';

function cut(sheet: PixelBuffer, rect: FrameRect): number[] {
  const out = new PixelBuffer(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) out.setPixel(x, y, sheet.getPixel(rect.x + x, rect.y + y));
  }
  return Array.from(out.data);
}

describe('renderCharacterIdle', () => {
  it.each([
    ['a base character', BASE_CHARACTERS[3]!],
    ['a custom character', toCharacterSpec({ ...CHARACTER_TEMPLATES[7]!.spec, accessory: 'none', glasses: 'sunglasses' })],
  ])('draws exactly the idle cell of the full sheet for %s, facing the viewer', (_label, spec) => {
    const sprites = buildCharacterSprites(spec);

    expect(Array.from(renderCharacterIdle(spec).data)).toEqual(cut(sprites.idle, frameRect('S', 0)));
  });
});
