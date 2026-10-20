/**
 * Live preview of a character built with the creator (standing still), drawn
 * in the browser by the shared renderer (`src/art/previewFrames.ts`), so what the
 * person sees is pixel for pixel what the server will serve. Kept per spec in
 * a small LRU: going back to a combination already seen costs nothing.
 */

import { encodeCustomCharacterSpec, toCharacterSpec, type CustomCharacterSpec } from '../art/customCharacter';
import type { PixelBuffer } from '../art/pixelBuffer';
import { renderCharacterIdle } from '../art/previewFrames';

const CAPACITY = 32;
const cache = new Map<string, PixelBuffer>();

export function customCharacterPreview(spec: CustomCharacterSpec): PixelBuffer {
  const key = encodeCustomCharacterSpec(spec);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const idle = renderCharacterIdle(toCharacterSpec(spec));
  cache.set(key, idle);
  if (cache.size > CAPACITY) cache.delete(cache.keys().next().value!);
  return idle;
}
