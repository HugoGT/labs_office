/**
 * Live side of withdrawing a character (#122). Retiring it in the catalog
 * moves every account wearing it to the pack default in the directory, which
 * only takes effect on the next join; this port is how the retire route
 * reaches the rooms and changes `PlayerState.avatarId` of whoever is inside,
 * without closing their session. Each client already redraws an avatar whose
 * replicated character changes.
 *
 * Same shape and same reasons as `sessionEviction.ts`: a port because the
 * routes are pure functions tested without Colyseus, and a hub because
 * Colyseus creates rooms on demand. Each room registers on create and
 * unregisters on dispose. Injected by `createOfficeServer.ts`, never a module
 * singleton.
 */

export interface CharacterRetirement {
  /** Every player wearing `pieceId`, connected or waiting to reconnect, now wears `fallbackId`. */
  retireCharacter(pieceId: string, fallbackId: string): void;
}

export interface CharacterRetirementHub extends CharacterRetirement {
  /** Returns the unregister function, for the room's `onDispose`. */
  register(retire: (pieceId: string, fallbackId: string) => void): () => void;
}

export function createCharacterRetirementHub(): CharacterRetirementHub {
  const rooms = new Set<(pieceId: string, fallbackId: string) => void>();

  return {
    register(retire) {
      rooms.add(retire);
      return () => {
        rooms.delete(retire);
      };
    },
    retireCharacter(pieceId, fallbackId) {
      // Every room is tried before any failure surfaces, like eviction.
      const failures: unknown[] = [];
      for (const retire of rooms) {
        try {
          retire(pieceId, fallbackId);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
    },
  };
}
