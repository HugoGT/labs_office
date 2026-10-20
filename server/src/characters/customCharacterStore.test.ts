/**
 * The behavior contract of `CustomCharacterStore`, run against the memory
 * adapter and against the Postgres adapter on a fake pool that keeps rows by
 * the text of the query, like `pgCollisions.test.ts`: no database.
 */

import { describe, expect, it } from 'vitest';
import { CHARACTER_TEMPLATES, CHARACTER_RENDER_VERSION, customCharacterHash } from '../../../src/art/customCharacter.ts';
import type { DirectoryPool, DirectoryQueryResult } from '../directory/pgDirectory.ts';
import type { CustomCharacterStore } from './customCharacterPort.ts';
import { createMemoryCustomCharacters } from './memoryCustomCharacters.ts';
import { createPgCustomCharacters } from './pgCustomCharacters.ts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Stores `custom_characters` rows in a Map, enough for the two statements the adapter runs. */
function fakePool(seed: Record<string, unknown>[] = []): DirectoryPool & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const rows = new Map<string, Record<string, unknown>>(seed.map((row) => [row.hash as string, row]));
  const run = async (text: string, values: unknown[] = []): Promise<DirectoryQueryResult> => {
    queries.push({ text, values });
    const sql = squash(text);
    if (sql.startsWith('insert into custom_characters')) {
      const [hash, spec, version] = values as [string, string, number];
      if (!rows.has(hash)) rows.set(hash, { hash, spec: JSON.parse(spec), render_version: version });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('select')) {
      const row = rows.get(values[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    queries,
    query: run,
    async connect() {
      return { query: run, release() {} };
    },
    async end() {},
  };
}

const SPEC = CHARACTER_TEMPLATES[3]!.spec;
const HASH = customCharacterHash(SPEC);

describe.each([
  ['memory', () => createMemoryCustomCharacters()],
  ['pg', () => createPgCustomCharacters(fakePool())],
] as const)('%s CustomCharacterStore', (_name, build: () => CustomCharacterStore) => {
  it('finds nothing for a hash it never stored', async () => {
    expect(await build().findCustomCharacter(HASH)).toBeNull();
  });

  it('stores a spec under its hash and gives it back', async () => {
    const store = build();
    await store.saveCustomCharacter(HASH, SPEC);
    expect(await store.findCustomCharacter(HASH)).toEqual(SPEC);
  });

  it('saving the same hash twice keeps one spec', async () => {
    const store = build();
    await store.saveCustomCharacter(HASH, SPEC);
    await store.saveCustomCharacter(HASH, SPEC);
    expect(await store.findCustomCharacter(HASH)).toEqual(SPEC);
  });
});

describe('pgCustomCharacters', () => {
  it('upserts by hash with the canonical spec and the render version, never overwriting', async () => {
    const pool = fakePool();
    await createPgCustomCharacters(pool).saveCustomCharacter(HASH, SPEC);

    const insert = pool.queries[0]!;
    expect(squash(insert.text)).toBe(
      'insert into custom_characters (hash, spec, render_version) values ($1, $2::jsonb, $3) on conflict (hash) do nothing',
    );
    expect(insert.values[0]).toBe(HASH);
    expect(JSON.parse(insert.values[1] as string)).toEqual(SPEC);
    expect(insert.values[2]).toBe(CHARACTER_RENDER_VERSION);
  });

  it('reads one row by hash and skips a stored spec that no longer validates', async () => {
    const pool = fakePool([{ hash: HASH, spec: { ...SPEC, skin: '#000000' }, render_version: 1 }]);

    expect(await createPgCustomCharacters(pool).findCustomCharacter(HASH)).toBeNull();
    expect(squash(pool.queries[0]!.text)).toBe('select spec from custom_characters where hash = $1');
  });

  it('never queries for something that is not a hash', async () => {
    const pool = fakePool();
    expect(await createPgCustomCharacters(pool).findCustomCharacter("x' or 1=1")).toBeNull();
    expect(pool.queries).toEqual([]);
  });
});
