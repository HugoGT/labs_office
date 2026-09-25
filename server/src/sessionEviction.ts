/**
 * Live eviction of an account (#93). Revoking someone in the directory only
 * closes the door: `decideAccess` runs on join, so whoever is already inside
 * the office would stay until they leave. This port is how an admin route
 * reaches the room and throws them out right away.
 *
 * It is a port and not a reference to the room because the admin routes are
 * pure functions tested without Colyseus, and because there is no single room
 * object to hold: Colyseus creates `OfficeRoom` instances on demand. Each room
 * registers itself on create and unregisters on dispose, the same way it
 * subscribes to the recordings registry.
 *
 * Injected by `createOfficeServer.ts`, never a module singleton: two test
 * files sharing it would couple to vitest's execution order (`liveSessions.ts`
 * documents the same reason).
 */

export interface SessionEvictor {
  /** Closes every live session of `uid`, and cancels any seat waiting to reconnect. */
  evictAccount(uid: string): void;
}

export interface SessionEvictionHub extends SessionEvictor {
  /** Returns the unregister function, for the room's `onDispose`. */
  register(evict: (uid: string) => void): () => void;
}

export function createSessionEvictionHub(): SessionEvictionHub {
  const rooms = new Set<(uid: string) => void>();

  return {
    register(evict) {
      rooms.add(evict);
      return () => {
        rooms.delete(evict);
      };
    },
    evictAccount(uid) {
      // Every room is tried before any failure surfaces: stopping at the first
      // one would leave the account inside the rest.
      const failures: unknown[] = [];
      for (const evict of rooms) {
        try {
          evict(uid);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
    },
  };
}
