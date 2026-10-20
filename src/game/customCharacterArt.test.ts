import { describe, expect, it } from 'vitest';
import { CHARACTER_SEATED, CHARACTER_WALK, sheetSize } from './artContract';
import { pieceLoadRequests } from './artPack';
import { artCustomCharactersUrl, customCharacterPiece, customCharacterSheetUrls } from './customCharacterArt';

const HASH = '0123456789abcdef0123456789abcdef';
const ID = `character-custom-${HASH}`;

describe('artCustomCharactersUrl', () => {
  it('turns the office endpoint into the folder of the server-drawn sheets', () => {
    expect(artCustomCharactersUrl('wss://app.example.com')).toBe('https://app.example.com/assets/characters/');
    expect(artCustomCharactersUrl('ws://localhost:2567/')).toBe('http://localhost:2567/assets/characters/');
    expect(artCustomCharactersUrl(null)).toBeNull();
    expect(artCustomCharactersUrl(undefined)).toBeNull();
  });
});

describe('customCharacterPiece', () => {
  it('describes a custom id as a character piece with the pack geometry', () => {
    const piece = customCharacterPiece(ID);

    expect(piece).toMatchObject({
      id: ID,
      kind: 'character',
      anchors: { walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor },
      footprint: CHARACTER_WALK.footprint,
    });
    expect(piece?.files).toEqual([
      expect.objectContaining({ role: 'walk', path: `${HASH}/walk.png`, imageKind: 'character-walk', ...sheetSize(CHARACTER_WALK) }),
      expect.objectContaining({ role: 'seated', path: `${HASH}/seated.png`, imageKind: 'character-seated', ...sheetSize(CHARACTER_SEATED) }),
    ]);
  });

  it('loads from the server folder with the contract frames', () => {
    const requests = pieceLoadRequests(customCharacterPiece(ID)!, 'http://localhost:2567/assets/characters/');

    expect(requests).toEqual([
      expect.objectContaining({
        url: `http://localhost:2567/assets/characters/${HASH}/walk.png`,
        frameWidth: CHARACTER_WALK.frame.width,
        frameHeight: CHARACTER_WALK.frame.height,
      }),
      expect.objectContaining({
        url: `http://localhost:2567/assets/characters/${HASH}/seated.png`,
        frameWidth: CHARACTER_SEATED.frame.width,
        frameHeight: CHARACTER_SEATED.frame.height,
      }),
    ]);
  });

  it('is null for any other id', () => {
    expect(customCharacterPiece('character-p01-burgundy-suit')).toBeNull();
    expect(customCharacterPiece('character-custom-nothex')).toBeNull();
  });
});

describe('customCharacterSheetUrls', () => {
  it('gives the CSS previews the same server URLs', () => {
    expect(customCharacterSheetUrls('http://localhost:2567/assets/characters/', ID)).toEqual({
      walkUrl: `http://localhost:2567/assets/characters/${HASH}/walk.png`,
      seatedUrl: `http://localhost:2567/assets/characters/${HASH}/seated.png`,
    });
    expect(customCharacterSheetUrls('http://localhost:2567/assets/characters/', 'character-p01-burgundy-suit')).toBeNull();
  });
});
