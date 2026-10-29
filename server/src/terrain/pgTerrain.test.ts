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
  it('saves each block color with its material in the same statement, NULL where an edit carries none (#222)', async () => {
    const pool = fakePool();
    const edits = [{ index: 0, material: 'carpet' as const, color: '#a0b1c2' }, { index: 1, material: 'grass' as const }];
    await createPgTerrain(pool).saveBlocks(edits, 'user-1');
    expect(pool.queries).toHaveLength(1);
    const text = squash(pool.queries[0]!.text);
    // A missing `color` key reads as NULL in jsonb_to_recordset, so a block painted without one loses its old color.
    expect(text).toContain('select entry.index, entry.material, entry.color, entry.floor, $2::uuid from jsonb_to_recordset($1::jsonb) as entry(index integer, material text, color text, floor text)');
    expect(text).toContain('color = excluded.color,');
    expect(pool.queries[0]!.values).toEqual([JSON.stringify(edits), 'user-1']);
  });

  it('saves each block floor with its material in the same statement, NULL where an edit carries none', async () => {
    const pool = fakePool();
    const edits = [{ index: 0, material: 'wood' as const, floor: 'floor-upload-0123456789abcdef' }, { index: 1, material: 'grass' as const }];
    await createPgTerrain(pool).saveBlocks(edits, 'user-1');
    expect(pool.queries).toHaveLength(1);
    const text = squash(pool.queries[0]!.text);
    expect(text).toContain('insert into terrain_blocks (block_index, material, color, floor_piece, updated_by)');
    expect(text).toContain('select entry.index, entry.material, entry.color, entry.floor, $2::uuid from jsonb_to_recordset($1::jsonb) as entry(index integer, material text, color text, floor text)');
    expect(text).toContain('set material = excluded.material, color = excluded.color, floor_piece = excluded.floor_piece, updated_by = excluded.updated_by, updated_at = now()');
    expect(pool.queries[0]!.values).toEqual([JSON.stringify(edits), 'user-1']);
  });

  it('loads every stored block floor, skipping a row it cannot read; a row without one has none', async () => {
    const pool = fakePool([
      { block_index: 3, floor_piece: 'floor-upload-0123456789abcdef' },
      { block_index: 4, floor_piece: null },
      { block_index: 'x', floor_piece: 'floor-upload-0123456789abcdef' },
      { block_index: 7, floor_piece: 'floor-wood' },
    ]);

    const floors = await createPgTerrain(pool).loadBlockFloors();

    expect(new Map(floors)).toEqual(new Map([[3, 'floor-upload-0123456789abcdef']]));
    expect(squash(pool.queries[0]!.text)).toBe('select block_index, floor_piece from terrain_blocks where floor_piece is not null');
  });

  it('loads every stored block color, skipping a row it cannot read; a row without one has none (#222)', async () => {
    const pool = fakePool([
      { block_index: 3, color: '#a0b1c2' },
      { block_index: 4, color: null },
      { block_index: 'x', color: '#a0b1c2' },
      { block_index: 7, color: 'rojo' },
    ]);

    const colors = await createPgTerrain(pool).loadBlockColors();

    expect(new Map(colors)).toEqual(new Map([[3, '#a0b1c2']]));
    expect(squash(pool.queries[0]!.text)).toBe('select block_index, color from terrain_blocks where color is not null');
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
    expect(squash(pool.queries[0]!.text)).toBe('select tile_index, piece_id from terrain_walls order by updated_at, tile_index');
  });

  it('loads the walls in placement order: the order the query returns them, oldest first (#223)', async () => {
    const pool = fakePool([
      { tile_index: 40, piece_id: 'wall-glass' },
      { tile_index: 3, piece_id: 'wall-brick' },
      { tile_index: 9, piece_id: 'wall-stone' },
    ]);

    expect([...(await createPgTerrain(pool).loadWalls())]).toEqual([[40, 'wall-glass'], [3, 'wall-brick'], [9, 'wall-stone']]);
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

  it('saves a block batch and removes its walls in one atomic statement', async () => {
    const pool = fakePool();
    const edits = [{ index: 0, material: 'void' as const }, { index: 1, material: 'carpet' as const, color: '#a0b1c2' }];

    await createPgTerrain(pool).saveBlocksClearingWalls(edits, [3, 4], 'user-1');

    expect(pool.queries).toHaveLength(1);
    const sql = squash(pool.queries[0]!.text);
    expect(sql).toContain('delete from terrain_walls where tile_index in (select value::integer from jsonb_array_elements_text($2::jsonb))');
    expect(sql).toContain('insert into terrain_blocks (block_index, material, color, floor_piece, updated_by)');
    expect(sql).toContain('from jsonb_to_recordset($1::jsonb) as entry(index integer, material text, color text, floor text)');
    expect(sql).toContain('on conflict (block_index) do update set material = excluded.material, color = excluded.color, floor_piece = excluded.floor_piece');
    expect(pool.queries[0]!.values).toEqual([JSON.stringify(edits), JSON.stringify([3, 4]), 'user-1']);
  });

  it('loads every stored decor item sorted by tile, skipping a row it cannot read', async () => {
    const pool = fakePool([
      { tile_index: 40, piece_id: 'table-meeting', rotation: 0, color: null },
      { tile_index: 3, piece_id: 'chair-wood', rotation: 270, color: null },
      { tile_index: 12, piece_id: 'desk-painted', rotation: 90, color: '#c83c3c' },
      { tile_index: 13, piece_id: 'desk-painted', rotation: 0, color: 'rojo' },
      { tile_index: 'x', piece_id: 'chair-wood', rotation: 0 },
      { tile_index: 7, piece_id: 'chair:wood', rotation: 0 },
      { tile_index: 8, piece_id: 'chair-metal', rotation: 45 },
    ]);

    const items = await createPgTerrain(pool).loadDecor();

    expect(items).toEqual([
      { index: 3, piece: 'chair-wood', rotation: 270 },
      { index: 12, piece: 'desk-painted', rotation: 90, color: '#c83c3c' },
      { index: 40, piece: 'table-meeting', rotation: 0 },
    ]);
    expect(squash(pool.queries[0]!.text)).toBe('select tile_index, piece_id, rotation, color from office_decor');
  });

  it('places, turns and removes a whole decor batch in one atomic statement', async () => {
    const pool = fakePool();

    await createPgTerrain(pool).saveDecor(
      [{ index: 3, item: { piece: 'desk-wood', rotation: 90 } }, { index: 4, item: null }, { index: 5, item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } }],
      'user-1',
    );

    expect(pool.queries).toHaveLength(1);
    const sql = squash(pool.queries[0]!.text);
    expect(sql).toContain('from jsonb_to_recordset($1::jsonb) as entry(index integer, piece text, rotation smallint, color text)');
    // The insert reads color from entries, so the CTE must carry it.
    expect(sql).toContain('select entry.index, entry.piece, entry.rotation, entry.color from jsonb_to_recordset');
    expect(sql).toContain('delete from office_decor where tile_index in (select index from entries where piece is null)');
    expect(sql).toContain('insert into office_decor (tile_index, piece_id, rotation, color, updated_by)');
    expect(sql).toContain(
      'on conflict (tile_index) do update set piece_id = excluded.piece_id, rotation = excluded.rotation, color = excluded.color, updated_by = excluded.updated_by, updated_at = now()',
    );
    expect(pool.queries[0]!.values).toEqual([
      JSON.stringify([
        { index: 3, piece: 'desk-wood', rotation: 90, color: null },
        { index: 4, piece: null, rotation: null, color: null },
        { index: 5, piece: 'desk-painted', rotation: 0, color: '#c83c3c' },
      ]),
      'user-1',
    ]);
  });

  it('saves walls and decor of a carried area in one statement, removals and placements of both tables together', async () => {
    const pool = fakePool();

    await createPgTerrain(pool).saveWallsAndDecor(
      [{ index: 3, piece: null }, { index: 7, piece: 'wall-glass' }],
      [{ index: 4, item: null }, { index: 8, item: { piece: 'desk-painted', rotation: 90, color: '#c83c3c' } }],
      'user-1',
    );

    expect(pool.queries).toHaveLength(1);
    const sql = squash(pool.queries[0]!.text);
    expect(sql).toContain('delete from terrain_walls where tile_index in (select index from wall_entries where piece is null)');
    expect(sql).toContain('insert into terrain_walls (tile_index, piece_id, updated_by) select index, piece, $3::uuid from wall_entries where piece is not null');
    expect(sql).toContain('on conflict (tile_index) do update set piece_id = excluded.piece_id, updated_by = excluded.updated_by, updated_at = now()');
    expect(sql).toContain('delete from office_decor where tile_index in (select index from decor_entries where piece is null)');
    expect(sql).toContain('insert into office_decor (tile_index, piece_id, rotation, color, updated_by) select index, piece, rotation, color, $3::uuid from decor_entries where piece is not null');
    expect(pool.queries[0]!.values).toEqual([
      JSON.stringify([{ index: 3, piece: null }, { index: 7, piece: 'wall-glass' }]),
      JSON.stringify([
        { index: 4, piece: null, rotation: null, color: null },
        { index: 8, piece: 'desk-painted', rotation: 90, color: '#c83c3c' },
      ]),
      'user-1',
    ]);
  });
});
