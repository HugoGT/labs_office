/**
 * Reading the art pack from disk. The path comes from wiring
 * (`directory/fromEnv.ts`); these tests only pin what happens with the file.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ART_PACK_FORMAT } from '../../../src/game/artContract.ts';
import { InvalidArtPackError } from './artCatalogRules.ts';
import { readArtPackManifest } from './artPackFile.ts';

const COMMITTED = new URL('../../../public/assets/pack/manifest.json', import.meta.url);

function tempFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'art-pack-')), 'manifest.json');
  writeFileSync(path, content);
  return path;
}

describe('readArtPackManifest', () => {
  it('reads and validates the committed manifest', () => {
    const pack = readArtPackManifest(COMMITTED);

    expect(pack.format).toBe(ART_PACK_FORMAT);
    expect(pack.pieces.length).toBeGreaterThan(0);
  });

  it('rejects a file that is not a valid pack', () => {
    expect(() => readArtPackManifest(tempFile('{"format":"other"}'))).toThrow(InvalidArtPackError);
  });

  it('fails loudly on a missing file or broken JSON instead of starting without a catalog', () => {
    expect(() => readArtPackManifest(join(tmpdir(), 'no-such-dir', 'manifest.json'))).toThrow();
    expect(() => readArtPackManifest(tempFile('{'))).toThrow();
  });
});
