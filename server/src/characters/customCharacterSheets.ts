/**
 * The PNG sheets of a custom character, drawn by the shared renderer
 * (`src/art/characterSheets.ts`, the one the pack exporter uses) and encoded
 * by the shared codec, so they have the layout, anchors and bytes rules of a
 * pack character. Rendering takes about a tenth of a second of the event
 * loop, so both sheets are drawn together and kept in a bounded LRU cache.
 */

import { renderCharacterSheets } from '../../../src/art/characterSheets.ts';
import { toCharacterSpec, type CustomCharacterSpec } from '../../../src/art/customCharacter.ts';
import { encodePng } from '../assets/pngCodec.ts';

export interface RenderedSheets {
  readonly walk: Uint8Array;
  readonly seated: Uint8Array;
}

export function renderCustomCharacterPngs(spec: CustomCharacterSpec): RenderedSheets {
  const { walk, seated } = renderCharacterSheets(toCharacterSpec(spec));
  return { walk: new Uint8Array(encodePng(walk)), seated: new Uint8Array(encodePng(seated)) };
}

/** About 30 KB per character: the default keeps a busy office's worth in a few MB. */
export const DEFAULT_SHEET_CACHE_CAPACITY = 128;

export interface CharacterSheetCache {
  /** The sheets of `spec`, stored under `hash`, rendered only when not cached. */
  sheets(hash: string, spec: CustomCharacterSpec): RenderedSheets;
}

export function createCharacterSheetCache(options: {
  capacity?: number;
  render?: (spec: CustomCharacterSpec) => RenderedSheets;
} = {}): CharacterSheetCache {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_SHEET_CACHE_CAPACITY);
  const render = options.render ?? renderCustomCharacterPngs;
  // A Map iterates in insertion order: re-inserting on every hit keeps the
  // least recently used entry first.
  const entries = new Map<string, RenderedSheets>();

  return {
    sheets(hash, spec) {
      const cached = entries.get(hash);
      if (cached) {
        entries.delete(hash);
        entries.set(hash, cached);
        return cached;
      }
      const rendered = render(spec);
      entries.set(hash, rendered);
      if (entries.size > capacity) entries.delete(entries.keys().next().value!);
      return rendered;
    },
  };
}
