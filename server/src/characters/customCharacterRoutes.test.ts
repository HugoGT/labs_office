/**
 * `GET /assets/characters/<hash>/<walk|seated>.png`, tested as a pure
 * function like `assetUploadRoutes.test.ts`: the real renderer and codec, a
 * memory store.
 */

import { describe, expect, it } from 'vitest';
import { CHARACTER_TEMPLATES, customCharacterHash } from '../../../src/art/customCharacter.ts';
import { CHARACTER_SEATED, CHARACTER_WALK, sheetSize } from '../../../src/game/artContract.ts';
import { decodePng } from '../assets/pngCodec.ts';
import { ASSET_FILE_HEADERS } from '../assets/assetUploadRoutes.ts';
import { createCharacterSheetCache, type RenderedSheets } from './customCharacterSheets.ts';
import { handleGetCustomCharacterSheet } from './customCharacterRoutes.ts';
import { createMemoryCustomCharacters } from './memoryCustomCharacters.ts';

const SPEC = CHARACTER_TEMPLATES[0]!.spec;
const HASH = customCharacterHash(SPEC);

function deps(render?: (spec: typeof SPEC) => RenderedSheets) {
  return {
    store: createMemoryCustomCharacters([[HASH, SPEC]]),
    cache: createCharacterSheetCache({ capacity: 4, ...(render ? { render } : {}) }),
  };
}

describe('handleGetCustomCharacterSheet', () => {
  it.each([
    ['walk.png', CHARACTER_WALK],
    ['seated.png', CHARACTER_SEATED],
  ] as const)('serves the stored character %s at its contract size, immutable', async (file, spec) => {
    const result = await handleGetCustomCharacterSheet(HASH, file, deps());

    expect(result.status).toBe(200);
    if (!('png' in result)) throw new Error('expected a png');
    expect(result.headers).toEqual(ASSET_FILE_HEADERS);
    const image = decodePng(result.png);
    expect({ width: image.width, height: image.height }).toEqual(sheetSize(spec));
  });

  it.each([
    ['an unknown hash', 'f'.repeat(32), 'walk.png'],
    ['a malformed hash', 'nope', 'walk.png'],
    ['a hash with a path', `../${HASH}`, 'walk.png'],
    ['an unknown sheet', HASH, 'idle.png'],
    ['a sheet without extension', HASH, 'walk'],
    ['no file', HASH, undefined],
  ])('answers 404 for %s, rendering nothing', async (_case, hash, file) => {
    let renders = 0;
    const result = await handleGetCustomCharacterSheet(hash, file, deps(() => {
      renders += 1;
      return { walk: new Uint8Array(), seated: new Uint8Array() };
    }));

    expect(result).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(renders).toBe(0);
  });

  it('renders a character once for both of its sheets', async () => {
    let renders = 0;
    const d = deps(() => {
      renders += 1;
      return { walk: new Uint8Array([1]), seated: new Uint8Array([2]) };
    });

    await handleGetCustomCharacterSheet(HASH, 'walk.png', d);
    const seated = await handleGetCustomCharacterSheet(HASH, 'seated.png', d);

    expect(renders).toBe(1);
    expect('png' in seated && Array.from(seated.png)).toEqual([2]);
  });
});

describe('createCharacterSheetCache', () => {
  it('keeps at most its capacity, dropping the least recently used', () => {
    const rendered: string[] = [];
    const cache = createCharacterSheetCache({
      capacity: 2,
      render: (spec) => {
        rendered.push(spec.skin);
        return { walk: new Uint8Array(), seated: new Uint8Array() };
      },
    });
    const [a, b, c] = CHARACTER_TEMPLATES.slice(0, 3).map((template) => template.spec);

    cache.sheets('a', a!);
    cache.sheets('b', b!);
    cache.sheets('a', a!);
    cache.sheets('c', c!);
    cache.sheets('a', a!);
    cache.sheets('b', b!);

    expect(rendered).toEqual([a!.skin, b!.skin, c!.skin, b!.skin]);
  });
});
