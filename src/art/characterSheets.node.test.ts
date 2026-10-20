import { describe, expect, it } from 'vitest';
import { CHARACTER_SEATED, CHARACTER_WALK, sheetSize } from '../game/artContract.ts';
import { BASE_CHARACTERS } from './characters.ts';
import { renderCharacterSheets } from './characterSheets.ts';

describe('renderCharacterSheets', () => {
  it('draws both production sheets at their contract sizes', () => {
    const { walk, seated } = renderCharacterSheets(BASE_CHARACTERS[0]!);
    expect({ width: walk.width, height: walk.height }).toEqual(sheetSize(CHARACTER_WALK));
    expect({ width: seated.width, height: seated.height }).toEqual(sheetSize(CHARACTER_SEATED));
  });
});
