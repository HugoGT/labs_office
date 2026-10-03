/**
 * The live collision areas of the server: the saved rectangles per piece and
 * the world rectangles of every instance, kept in memory. `OfficeRoom`
 * checks every `move` against `rects()`, so a move never queries Postgres;
 * they are rebuilt at `load()`, per accepted edit, and when the served desks
 * or their decor change (`refreshPlacements`).
 *
 * Edits and refreshes run one at a time. The table only changes after the
 * store saved it: a failed save leaves the office exactly as it was.
 */

import type { OfficeLayout } from '../../../src/game/officeLayout.ts';
import {
  collisionWorld,
  deskInstances,
  encodeCollisionTable,
  staticCollisionInstances,
  type CollisionDesk,
  type CollisionInstance,
  type CollisionPoint,
  type CollisionRect,
  type CollisionTable,
  type WorldCollisionRect,
} from '../../../src/game/pieceCollisions.ts';
import type { MapSeat } from '../../../src/game/seating.ts';
import type { CollisionStore } from './collisionPort.ts';
import { CollisionProtectedError, trapsPlayer } from './collisionRules.ts';

export type CollisionListener = (encoded: string) => void;
/** Network positions of the sessions the room holds, those waiting to reconnect included. */
export type PlayerPositions = () => readonly CollisionPoint[];

export interface CollisionRuntime {
  /** Reads the saved pieces and the served desks. Called once, after the schema is applied. */
  load(): Promise<void>;
  table(): CollisionTable;
  /** The table in its wire form (`encodeCollisionTable`), as the room replicates it. */
  encoded(): string;
  /** Every world rectangle, what a `move` is checked against. */
  rects(): readonly WorldCollisionRect[];
  /** False without a store (no `DATABASE_URL`): every piece keeps its default. */
  readonly editable: boolean;
  /** Saves a piece's rectangles, or throws `CollisionProtectedError` when one would close over a player. */
  setRects(edit: { pieceId: string; rects: readonly CollisionRect[]; actorId: string | null }, players: PlayerPositions): Promise<void>;
  /** Gives a piece back its default, under the same player check. */
  reset(edit: { pieceId: string; actorId: string | null }, players: PlayerPositions): Promise<void>;
  /** Re-reads the served desks and their decor. */
  refreshPlacements(): Promise<void>;
  /** Called after each accepted edit with the new wire form. */
  subscribe(listener: CollisionListener): () => void;
}

export function createCollisionRuntime({
  layout,
  seats,
  store,
  listDesks,
}: {
  layout: Pick<OfficeLayout, 'props'>;
  seats: readonly MapSeat[];
  store?: CollisionStore;
  /** The served desks; absent (no desks store), there are none. */
  listDesks?: () => Promise<readonly CollisionDesk[]>;
}): CollisionRuntime {
  const staticInstances = staticCollisionInstances(layout.props, seats);
  const listeners = new Set<CollisionListener>();
  let table: CollisionTable = new Map();
  let instances: readonly CollisionInstance[] = staticInstances;
  let rects: readonly WorldCollisionRect[] = collisionWorld(instances, table);
  let encoded = encodeCollisionTable(table);
  let queue: Promise<unknown> = Promise.resolve();

  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run);
    // The chain must survive a refused or failed step; the caller still sees it.
    queue = next.catch(() => undefined);
    return next;
  }

  function rebuild(): void {
    rects = collisionWorld(instances, table);
  }

  async function change(pieceId: string, rectsAfter: readonly CollisionRect[] | null, players: PlayerPositions, save: () => Promise<void>): Promise<void> {
    const next = new Map(table);
    if (rectsAfter === null) next.delete(pieceId);
    else next.set(pieceId, [...rectsAfter]);
    const ofPiece = (candidate: CollisionTable): CollisionRect[] =>
      collisionWorld(
        instances.filter((instance) => instance.piece === pieceId),
        candidate,
      );
    if (trapsPlayer(ofPiece(table), ofPiece(next), players())) throw new CollisionProtectedError();
    await save();
    table = next;
    encoded = encodeCollisionTable(table);
    rebuild();
    for (const listener of listeners) listener(encoded);
  }

  async function readPlacements(): Promise<void> {
    instances = [...staticInstances, ...deskInstances((await listDesks?.()) ?? [])];
    rebuild();
  }

  return {
    load() {
      return serialized(async () => {
        if (store) {
          table = new Map(await store.loadCollisions());
          encoded = encodeCollisionTable(table);
        }
        await readPlacements();
      });
    },
    table: () => table,
    encoded: () => encoded,
    rects: () => rects,
    editable: store !== undefined,
    setRects({ pieceId, rects: next, actorId }, players) {
      return serialized(() => {
        if (!store) throw new Error('no collision store: collisions cannot be edited');
        return change(pieceId, next, players, () => store.saveCollision(pieceId, next, actorId));
      });
    },
    reset({ pieceId }, players) {
      return serialized(() => {
        if (!store) throw new Error('no collision store: collisions cannot be edited');
        if (!table.has(pieceId)) return Promise.resolve();
        return change(pieceId, null, players, () => store.deleteCollision(pieceId));
      });
    },
    refreshPlacements() {
      return serialized(readPlacements);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
