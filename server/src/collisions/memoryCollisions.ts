/**
 * In-memory `CollisionStore`, for tests and injection. Same contract as
 * `pgCollisions.ts`, asked the same questions by its tests.
 */

import type { CollisionRect } from '../../../src/game/pieceCollisions.ts';
import type { CollisionStore } from './collisionPort.ts';

export interface MemoryCollisions extends CollisionStore {
  /** Who saved a piece last, for tests that check the actor is recorded. */
  actorOf(pieceId: string): string | null | undefined;
}

export function createMemoryCollisions(seed: Iterable<readonly [string, readonly CollisionRect[]]> = []): MemoryCollisions {
  const rows = new Map<string, { rects: readonly CollisionRect[]; actorId: string | null }>();
  for (const [pieceId, rects] of seed) rows.set(pieceId, { rects: [...rects], actorId: null });

  return {
    async loadCollisions() {
      return new Map([...rows].map(([pieceId, { rects }]) => [pieceId, rects]));
    },
    async saveCollision(pieceId, rects, actorId) {
      rows.set(pieceId, { rects: [...rects], actorId });
    },
    async deleteCollision(pieceId) {
      rows.delete(pieceId);
    },
    actorOf(pieceId) {
      return rows.get(pieceId)?.actorId;
    },
  };
}
