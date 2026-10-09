/**
 * Postgres adapter of `TerrainStore` (#123 phase 2), tested like
 * `pgDesks.test.ts`: a fake pool that answers by the text of the query, with
 * no database. The upsert is asserted by its SQL because one row per block is
 * what the primary key enforces, and a plain INSERT would fail the second edit.
 */

import { describe, expect, it } from 'vitest';
import type { DirectoryPool, DirectoryQueryResult } from '../directory/pgDirectory.ts';
import { createPgTerrain } from './pgTerrain.ts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function fakePool(rows: Record<string, unknown>[] = []): DirectoryPool & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const run = async (text: string, values: unknown[] = []): Promise<DirectoryQueryResult> => {
    queries.push({ text, values });
    return { rows: squash(text).startsWith('select') ? rows : [], rowCount: 1 };
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

describe('pgTerrain', () => {
  it('saves the whole batch in one atomic statement, never one query per block', async () => {
    const pool = fakePool();
    const edits = [{ index: 0, material: 'grass' as const }, { index: 1, material: 'wood' as const }];
    await createPgTerrain(pool).saveBlocks(edits, 'user-1');
    expect(pool.queries).toHaveLength(1);
    expect(squash(pool.queries[0]!.text)).toContain('from jsonb_to_recordset($1::jsonb)');
    expect(squash(pool.queries[0]!.text)).toContain('on conflict (block_index) do update');
    expect(pool.queries[0]!.values).toEqual([JSON.stringify(edits), 'user-1']);
  });
  it('loads every stored block by index, skipping a row it cannot read', async () => {
    const pool = fakePool([
      { block_index: 3, material: 'sand' },
      { block_index: 35, material: 'water' },
      { block_index: 'x', material: 'grass' },
      { block_index: 7, material: 'lava' },
    ]);

    const blocks = await createPgTerrain(pool).loadBlocks();

    expect(new Map(blocks)).toEqual(new Map([[3, 'sand'], [35, 'water']]));
    expect(squash(pool.queries[0]!.text)).toBe('select block_index, material from terrain_blocks');
  });

  it('upserts one row per block with its material, actor and time', async () => {
    const pool = fakePool();

    await createPgTerrain(pool).saveBlock(35, 'water', 'user-1');

    const [query] = pool.queries;
    expect(squash(query!.text)).toBe(
      'insert into terrain_blocks (block_index, material, updated_by) values ($1, $2, $3) ' +
        'on conflict (block_index) do update set material = excluded.material, updated_by = excluded.updated_by, updated_at = now()',
    );
    expect(query!.values).toEqual([35, 'water', 'user-1']);
  });

  it('loads every stored wall by tile, skipping a row it cannot read', async () => {
    const pool = fakePool([
      { tile_index: 3, piece_id: 'wall-brick' },
      { tile_index: 40, piece_id: 'wall-glass' },
      { tile_index: 'x', piece_id: 'wall-stone' },
      { tile_index: 7, piece_id: 'hedge-boxwood' },
    ]);

    const walls = await createPgTerrain(pool).loadWalls();

    expect(new Map(walls)).toEqual(new Map([[3, 'wall-brick'], [40, 'wall-glass']]));
    expect(squash(pool.queries[0]!.text)).toBe('select tile_index, piece_id from terrain_walls');
  });

  it('places and removes a whole wall batch in one atomic statement', async () => {
    const pool = fakePool();
    const edits = [{ index: 3, piece: 'wall-brick' as const }, { index: 4, piece: null }];

    await createPgTerrain(pool).saveWalls(edits, 'user-1');

    expect(pool.queries).toHaveLength(1);
    const sql = squash(pool.queries[0]!.text);
    expect(sql).toContain('from jsonb_to_recordset($1::jsonb) as entry(index integer, piece text)');
    expect(sql).toContain('delete from terrain_walls where tile_index in (select index from entries where piece is null)');
    expect(sql).toContain('insert into terrain_walls (tile_index, piece_id, updated_by)');
    expect(sql).toContain('on conflict (tile_index) do update set piece_id = excluded.piece_id, updated_by = excluded.updated_by, updated_at = now()');
    expect(pool.queries[0]!.values).toEqual([JSON.stringify(edits), 'user-1']);
  });
});
