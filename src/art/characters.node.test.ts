import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BASE_CHARACTERS, CHARACTERS, CUSTOM_CHARACTERS } from './characters.ts';

test('the base roster has the 18 characters from the three base sheets', () => {
  assert.equal(BASE_CHARACTERS.length, 18);
  for (const sheet of [1, 2, 3]) {
    assert.equal(BASE_CHARACTERS.filter((c) => c.source?.sheet === sheet).length, 6);
  }
});

test('the full roster is the base characters followed by the custom ones', () => {
  assert.deepEqual(CHARACTERS, [...BASE_CHARACTERS, ...CUSTOM_CHARACTERS]);
});

test('every character id is unique and kebab-case', () => {
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, CHARACTERS.length);
  for (const character of CHARACTERS) {
    assert.match(character.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, character.id);
  }
});

test('custom characters do not claim a base sheet source', () => {
  for (const character of CUSTOM_CHARACTERS) {
    assert.equal(character.source, undefined, character.id);
  }
});

test('every palette entry is a valid hex color', () => {
  for (const character of CHARACTERS) {
    for (const [key, value] of Object.entries(character.palette)) {
      if (value === undefined) continue;
      assert.match(value, /^#[0-9a-f]{6}$/i, `${character.id}.${key}`);
    }
  }
});
