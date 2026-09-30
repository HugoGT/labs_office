/**
 * Reads the art pack manifest from disk (art migration, step 3). The path is
 * the caller's: only wiring (`directory/fromEnv.ts`) knows where the file
 * lives, so the catalog adapters and rules never touch the disk.
 *
 * A missing or broken file throws instead of returning an empty pack: an
 * empty pack would retire every piece of the catalog at the next start.
 */

import { readFileSync } from 'node:fs';
import type { ArtPackManifest } from '../../../src/game/artContract.ts';
import { normalizeArtPack } from './artCatalogRules.ts';

export function readArtPackManifest(path: URL | string): ArtPackManifest {
  return normalizeArtPack(JSON.parse(readFileSync(path, 'utf8')));
}
