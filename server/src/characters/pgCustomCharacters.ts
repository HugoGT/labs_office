/**
 * Postgres adapter of `CustomCharacterStore`, on the same minimal `pg` shape
 * (`DirectoryPool`) and the same pool as the other directory-backed features.
 * The table is `custom_characters` in `directory/schema.sql`.
 */

import {
  CHARACTER_RENDER_VERSION,
  encodeCustomCharacterSpec,
  isCustomCharacterHash,
  parseCustomCharacterSpec,
} from '../../../src/art/customCharacter.ts';
import type { DirectoryPool } from '../directory/pgDirectory.ts';
import type { CustomCharacterStore } from './customCharacterPort.ts';

export function createPgCustomCharacters(pool: DirectoryPool): CustomCharacterStore {
  return {
    async saveCustomCharacter(hash, spec) {
      // DO NOTHING: a hash names its content, so the stored row is already this spec.
      await pool.query(
        `INSERT INTO custom_characters (hash, spec, render_version) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (hash) DO NOTHING`,
        [hash, encodeCustomCharacterSpec(spec), CHARACTER_RENDER_VERSION],
      );
    },

    async findCustomCharacter(hash) {
      if (!isCustomCharacterHash(hash)) return null;
      const result = await pool.query('SELECT spec FROM custom_characters WHERE hash = $1', [hash]);
      const row = result.rows[0];
      if (!row) return null;
      // `jsonb` has no shape of its own, and a swatch removed from the lists
      // makes an old row invalid: such a row is drawn by nobody.
      const parsed = parseCustomCharacterSpec(row.spec);
      return parsed.ok ? parsed.spec : null;
    },
  };
}
