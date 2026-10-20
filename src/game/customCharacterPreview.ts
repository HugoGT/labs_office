/**
 * Live preview of a character built with the creator (standing still), drawn
 * in the browser by the shared renderer (`src/art/previewFrames.ts`), so what
 * the person sees is pixel for pixel what the server will serve, and the
 * thumbnails of its style menus: that same frame cropped to the body part a
 * choice changes. Both are kept per spec in small LRUs: going back to a
 * combination already seen, or reopening a menu, costs nothing.
 */

import { encodeCustomCharacterSpec, toCharacterSpec, type CustomCharacterSpec } from '../art/customCharacter';
import { PixelBuffer } from '../art/pixelBuffer';
import { renderCharacterIdle } from '../art/previewFrames';

/** Regions of the 32x52 idle frame (facing the viewer) each style choice changes. */
export const CHARACTER_PARTS = {
  hair: { x: 6, y: 0, width: 20, height: 22 },
  glasses: { x: 9, y: 8, width: 14, height: 10 },
  top: { x: 5, y: 16, width: 22, height: 18 },
  accessory: { x: 0, y: 16, width: 18, height: 28 },
  bottom: { x: 8, y: 27, width: 16, height: 21 },
  shoes: { x: 7, y: 40, width: 18, height: 10 },
} as const;

export type CharacterPart = keyof typeof CHARACTER_PARTS;

function lru<T>(capacity: number) {
  const entries = new Map<string, T>();
  return (key: string, make: () => T): T => {
    const cached = entries.get(key);
    if (cached !== undefined) {
      entries.delete(key);
      entries.set(key, cached);
      return cached;
    }
    const value = make();
    entries.set(key, value);
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    return value;
  };
}

// A menu shows up to eight options of one part; several menus and a few edits fit.
const idleFrames = lru<PixelBuffer>(96);
const partCrops = lru<PixelBuffer>(256);

export function customCharacterPreview(spec: CustomCharacterSpec): PixelBuffer {
  return idleFrames(encodeCustomCharacterSpec(spec), () => renderCharacterIdle(toCharacterSpec(spec)));
}

export function customCharacterPart(spec: CustomCharacterSpec, part: CharacterPart): PixelBuffer {
  return partCrops(`${part}:${encodeCustomCharacterSpec(spec)}`, () => {
    const { x, y, width, height } = CHARACTER_PARTS[part];
    const idle = customCharacterPreview(spec);
    const crop = new PixelBuffer(width, height);
    for (let row = 0; row < height; row += 1) {
      const from = ((y + row) * idle.width + x) * 4;
      crop.data.set(idle.data.subarray(from, from + width * 4), row * width * 4);
    }
    return crop;
  });
}
