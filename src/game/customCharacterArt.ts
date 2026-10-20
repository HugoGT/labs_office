/**
 * Characters built with the creator, as the office loads them. Their sheets
 * are not in any manifest: the server draws them on request at
 * `/assets/characters/<hash>/<walk|seated>.png` (`server/src/characters/`),
 * so a `character-custom-<hash>` id becomes a synthesized character piece
 * with the pack's frame geometry, anchors and footprint, and loads from that
 * folder like any other piece (`pieceLoadRequests`).
 */

import { customCharacterHashOf } from '../art/customCharacter';
import { CHARACTER_SEATED, CHARACTER_WALK, sheetSize, type ArtCharacterPiece } from './artContract';

export const CUSTOM_CHARACTERS_PATH = '/assets/characters/';

/** Folder of the server-drawn sheets for an office endpoint, or `null` without a server. */
export function artCustomCharactersUrl(officeEndpoint: string | null | undefined): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;
  const base = officeEndpoint.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
  return `${base}${CUSTOM_CHARACTERS_PATH}`;
}

/** The piece of a `character-custom-<hash>` id, file paths relative to `artCustomCharactersUrl`; `null` for any other id. */
export function customCharacterPiece(id: string): ArtCharacterPiece | null {
  const hash = customCharacterHashOf(id);
  if (hash === null) return null;
  const walk = sheetSize(CHARACTER_WALK);
  const seated = sheetSize(CHARACTER_SEATED);
  return {
    id,
    kind: 'character',
    name: 'Personaje propio',
    author: '',
    license: '',
    anchors: { walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor },
    footprint: CHARACTER_WALK.footprint,
    // No sha256: the hash in the path already names the content.
    files: [
      { role: 'walk', path: `${hash}/walk.png`, imageKind: 'character-walk', width: walk.width, height: walk.height, sha256: '' },
      { role: 'seated', path: `${hash}/seated.png`, imageKind: 'character-seated', width: seated.width, height: seated.height, sha256: '' },
    ],
  };
}

/** The two sheet URLs of a custom id, for CSS previews (`characterPreview.ts`); `null` for any other id. */
export function customCharacterSheetUrls(folderUrl: string, id: string): { walkUrl: string; seatedUrl: string } | null {
  const piece = customCharacterPiece(id);
  if (piece === null) return null;
  const [walk, seated] = piece.files;
  return { walkUrl: `${folderUrl}${walk!.path}`, seatedUrl: `${folderUrl}${seated!.path}` };
}
