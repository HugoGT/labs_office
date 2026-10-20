/**
 * Live preview frames of a character built with the creator, drawn in the
 * browser by the shared renderer (`src/art/previewFrames.ts`), so what the
 * person sees is pixel for pixel what the server will serve. Kept per spec in
 * a small LRU: going back to a combination already seen costs nothing.
 */

import { encodeCustomCharacterSpec, toCharacterSpec, type CustomCharacterSpec } from '../art/customCharacter';
import { renderCharacterPreview, type CharacterPreviewFrames } from '../art/previewFrames';

const CAPACITY = 32;
const cache = new Map<string, CharacterPreviewFrames>();

export function customCharacterPreview(spec: CustomCharacterSpec): CharacterPreviewFrames {
  const key = encodeCustomCharacterSpec(spec);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const frames = renderCharacterPreview(toCharacterSpec(spec));
  cache.set(key, frames);
  if (cache.size > CAPACITY) cache.delete(cache.keys().next().value!);
  return frames;
}
