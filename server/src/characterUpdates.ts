/**
 * Live side of a character change: the rooms set `PlayerState.avatarId` of
 * whoever is inside, without closing their session, and every client already
 * redraws an avatar whose replicated character changes.
 *
 * Two changes reach the rooms through here:
 * - withdrawing a character (#122): retiring it in the catalog moves every
 *   account wearing it to the pack default in the directory, which alone
 *   would only take effect on the next join;
 * - saving a new character from "Personalizar" (the creator): every session
 *   of that account, connected or waiting to reconnect, wears it at once.
 *
 * Same shape and same reasons as `sessionEviction.ts`: a port because the
 * routes are pure functions tested without Colyseus, and a hub because
 * Colyseus creates rooms on demand. Each room registers on create and
 * unregisters on dispose. Injected by `createOfficeServer.ts`, never a module
 * singleton.
 */

export interface CharacterUpdates {
  /** Every player wearing `pieceId`, connected or waiting to reconnect, now wears `fallbackId`. */
  retireCharacter(pieceId: string, fallbackId: string): void;
  /** Every session of the account `uid`, connected or waiting to reconnect, now wears `avatarId`. */
  changeCharacterOf(uid: string, avatarId: string): void;
}

/** What a room hands the hub: the same two changes, applied to its own players. */
export type CharacterRoom = CharacterUpdates;

export interface CharacterUpdatesHub extends CharacterUpdates {
  /** Returns the unregister function, for the room's `onDispose`. */
  register(room: CharacterRoom): () => void;
}

export function createCharacterUpdatesHub(): CharacterUpdatesHub {
  const rooms = new Set<CharacterRoom>();

  // Every room is tried before any failure surfaces, like eviction.
  const forEachRoom = (apply: (room: CharacterRoom) => void): void => {
    const failures: unknown[] = [];
    for (const room of rooms) {
      try {
        apply(room);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  };

  return {
    register(room) {
      rooms.add(room);
      return () => {
        rooms.delete(room);
      };
    },
    retireCharacter(pieceId, fallbackId) {
      forEachRoom((room) => room.retireCharacter(pieceId, fallbackId));
    },
    changeCharacterOf(uid, avatarId) {
      forEachRoom((room) => room.changeCharacterOf(uid, avatarId));
    },
  };
}
