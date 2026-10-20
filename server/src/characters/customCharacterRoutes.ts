/**
 * `GET /assets/characters/<hash>/<walk|seated>.png`: the sheets of a
 * character built with the creator. Public and immutable like
 * `/assets/files/<sha256>.png` (a hash names its content, and the render
 * version is part of the hash), but needing no bucket: the server draws them
 * from the stored spec, so a deployment with only `DATABASE_URL` has them.
 *
 * Only a hash in `custom_characters` is drawn; anything else is 404 before
 * any rendering, so nobody can make the server render specs nobody saved.
 */

import { isCustomCharacterHash } from '../../../src/art/customCharacter.ts';
import { ASSET_FILE_HEADERS, type AssetFileResult } from '../assets/assetUploadRoutes.ts';
import type { CustomCharacterStore } from './customCharacterPort.ts';
import type { CharacterSheetCache } from './customCharacterSheets.ts';

export interface CustomCharacterSheetDeps {
  store: Pick<CustomCharacterStore, 'findCustomCharacter'>;
  cache: CharacterSheetCache;
}

const NOT_FOUND = { status: 404, body: { error: 'not-found' } } as const;

const SHEET_FILES: Readonly<Record<string, 'walk' | 'seated'>> = { 'walk.png': 'walk', 'seated.png': 'seated' };

export async function handleGetCustomCharacterSheet(
  hash: unknown,
  file: unknown,
  deps: CustomCharacterSheetDeps,
): Promise<AssetFileResult> {
  if (typeof hash !== 'string' || !isCustomCharacterHash(hash)) return NOT_FOUND;
  if (typeof file !== 'string' || !Object.hasOwn(SHEET_FILES, file)) return NOT_FOUND;
  const spec = await deps.store.findCustomCharacter(hash);
  if (spec === null) return NOT_FOUND;
  const png = deps.cache.sheets(hash, spec)[SHEET_FILES[file]!];
  return { status: 200, headers: ASSET_FILE_HEADERS, png };
}
