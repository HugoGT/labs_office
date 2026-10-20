import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.ts';

describe('sha256Hex', () => {
  it.each(['', 'abc', 'character-custom', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), 'Piel ñandú 🙂'.repeat(9)])(
    'matches node:crypto for %j',
    (text) => {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    },
  );
});
