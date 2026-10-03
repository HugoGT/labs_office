/**
 * Postgres adapter of `CollisionStore`, tested like `pgTerrain.test.ts`: a
 * fake pool that answers by the text of the query, with no database.
 */

import { describe, expect, it } from 'vitest';
import type { DirectoryPool, DirectoryQueryResult } from '../directory/pgDirectory.ts';
import { createPgCollisions } from './pgCollisions.ts';

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

describe('pgCollisions', () => {
  it('loads every stored piece, skipping a row it cannot read', async () => {
    const pool = fakePool([
      { piece_id: 'tree-oak', rects: [{ x: -8, y: -12, w: 16, h: 12 }] },
      { piece_id: 'desk-wood', rects: [] },
      { piece_id: 'wall-brick', rects: [] },
      { piece_id: 'plant-ficus', rects: [{ x: 0, y: 0, w: 0, h: 1 }] },
      { piece_id: 'table-x', rects: 'nope' },
    ]);

    const table = await createPgCollisions(pool).loadCollisions();

    expect(new Map(table)).toEqual(
      new Map([
        ['tree-oak', [{ x: -8, y: -12, w: 16, h: 12 }]],
        ['desk-wood', []],
      ]),
    );
    expect(squash(pool.queries[0]!.text)).toBe('select piece_id, rects from piece_collisions');
  });

  it('upserts one row per piece with its rectangles as JSON, its actor and time', async () => {
    const pool = fakePool();

    await createPgCollisions(pool).saveCollision('tree-oak', [{ x: -8, y: -12, w: 16, h: 12 }], 'user-1');

    const [query] = pool.queries;
    expect(squash(query!.text)).toBe(
      'insert into piece_collisions (piece_id, rects, updated_by) values ($1, $2::jsonb, $3) ' +
        'on conflict (piece_id) do update set rects = excluded.rects, updated_by = excluded.updated_by, updated_at = now()',
    );
    expect(query!.values).toEqual(['tree-oak', '[{"x":-8,"y":-12,"w":16,"h":12}]', 'user-1']);
  });

  it('deletes the row of a piece to give it back its default', async () => {
    const pool = fakePool();

    await createPgCollisions(pool).deleteCollision('tree-oak');

    expect(squash(pool.queries[0]!.text)).toBe('delete from piece_collisions where piece_id = $1');
    expect(pool.queries[0]!.values).toEqual(['tree-oak']);
  });
});
