/**
 * The two layers of the office decor in `schema.sql` (#121): a tile holds one
 * floor item and one top item, so the primary key is (tile, layer). Asserted
 * by its SQL like `migrate.test.ts`, with no database: the file runs on every
 * start, so each statement must converge on a live table and be safe to run
 * again.
 */

import { describe, expect, it } from 'vitest';
import { readSchemaSql } from '../directory/migrate.ts';

function squash(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('schema.sql: the top layer of the office decor (#121)', () => {
  const squashed = squash(readSchemaSql());
  const column = "alter table office_decor add column if not exists layer text not null default 'floor' check (layer in ('floor', 'top'));";
  const dropKey = 'alter table office_decor drop constraint if exists office_decor_pkey;';
  const addKey = 'alter table office_decor add constraint office_decor_pkey primary key (tile_index, layer);';

  it('adds the layer of every item, the floor for every row stored before it', () => {
    // `CREATE TABLE IF NOT EXISTS` never touches a live table: the column comes with an ALTER.
    expect(squashed).toContain(column);
  });

  it('keys the table by (tile, layer), rebuilding the key on every start so a re-run converges', () => {
    expect(squashed).toContain(`${dropKey} ${addKey}`);
    expect(squashed.indexOf(dropKey)).toBeGreaterThan(squashed.indexOf(column));
  });

  it('changes the key after the one-time copy, whose ON CONFLICT names the old one-column key', () => {
    const copyEnd = squashed.indexOf('end $$;', squashed.indexOf('if not exists (select 1 from office_decor_version) then'));
    expect(copyEnd).toBeGreaterThan(0);
    expect(squashed.indexOf(column)).toBeGreaterThan(copyEnd);
    // No block of its own: the grid-move test reads the last `DO $$` as the decor copy.
    expect(squashed.lastIndexOf('do $$')).toBeLessThan(copyEnd);
  });

  it('moves a plant stored on the floor before the layers to the top, where its id puts it, unless a top item holds its tile', () => {
    const lift =
      "update office_decor set layer = 'top' where layer = 'floor' and piece_id like 'plant-%' " +
      "and not exists (select 1 from office_decor above where above.tile_index = office_decor.tile_index and above.layer = 'top');";
    expect(squashed).toContain(lift);
    // After the new key: (tile, 'top') is a row of its own only then.
    expect(squashed.indexOf(lift)).toBeGreaterThan(squashed.indexOf(addKey));
  });
});
