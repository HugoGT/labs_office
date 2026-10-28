/**
 * Locked spaces: anyone inside a room or a desk cubicle may lock it with
 * whoever is in. Nobody outside walks in while it holds; whoever is inside
 * moves and leaves freely, and the lock goes once the space is empty.
 *
 * Shared by the room, which enforces it, and the scene, which refuses the
 * same step locally (the client stays the stricter side). Positions are
 * network positions in pixels and membership is `detectSpace`'s, so both
 * sides agree on who is inside.
 */

import type { SpaceArea } from './mapData.ts';
import { detectSpace, type Point } from './proximity.ts';

/**
 * The locked space a move from `from` to `to` would walk into from outside
 * it, or `null`. A move inside the same space, or out of it, is never
 * refused, so nobody inside gets stuck.
 */
export function lockedSpaceEntered(
  from: Point,
  to: Point,
  spaces: readonly SpaceArea[],
  locked: ReadonlySet<string>,
): SpaceArea | null {
  if (locked.size === 0) return null;
  const target = detectSpace(to, spaces);
  if (target === null || !locked.has(target.id)) return null;
  return detectSpace(from, spaces)?.id === target.id ? null : target;
}

/** The locks that still hold: those of an existing space with at least one of `players` inside. */
export function heldLocks(locked: ReadonlySet<string>, spaces: readonly SpaceArea[], players: readonly Point[]): Set<string> {
  const occupied = new Set<string>();
  for (const player of players) {
    const space = detectSpace(player, spaces);
    if (space !== null && locked.has(space.id)) occupied.add(space.id);
  }
  return occupied;
}

/** The wire form, a replicated string of the room state: the ids sorted and joined by commas, empty for none. */
export function encodeLockedSpaces(locked: ReadonlySet<string>): string {
  return [...locked].sort().join(',');
}

export function decodeLockedSpaces(wire: string): Set<string> {
  return new Set(wire === '' ? [] : wire.split(','));
}
