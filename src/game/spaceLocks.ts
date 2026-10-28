/**
 * Locked spaces: anyone inside a room or a desk cubicle may lock it with
 * whoever is in. Nobody outside walks in while it holds; whoever is inside
 * moves and leaves freely. Only whoever locked it unlocks it, and the lock
 * goes anyway once the space is empty.
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
  locked: ReadonlyMap<string, string>,
): SpaceArea | null {
  if (locked.size === 0) return null;
  const target = detectSpace(to, spaces);
  if (target === null || !locked.has(target.id)) return null;
  return detectSpace(from, spaces)?.id === target.id ? null : target;
}

/**
 * The locks that still hold, each with who locked it: those of an existing
 * space with at least one of `players` inside.
 */
export function heldLocks(
  locked: ReadonlyMap<string, string>,
  spaces: readonly SpaceArea[],
  players: readonly Point[],
): Map<string, string> {
  const held = new Map<string, string>();
  for (const player of players) {
    const space = detectSpace(player, spaces);
    const locker = space === null ? undefined : locked.get(space.id);
    if (space !== null && locker !== undefined) held.set(space.id, locker);
  }
  return held;
}

/**
 * The wire form, a replicated string of the room state: `<space id>:<locker
 * session id>` pairs sorted by space and joined by commas, empty for none.
 * Neither id ever holds a `:` or a `,`.
 */
export function encodeLockedSpaces(locked: ReadonlyMap<string, string>): string {
  return [...locked]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([spaceId, locker]) => `${spaceId}:${locker}`)
    .join(',');
}

export function decodeLockedSpaces(wire: string): Map<string, string> {
  const locked = new Map<string, string>();
  for (const pair of wire === '' ? [] : wire.split(',')) {
    const at = pair.indexOf(':');
    if (at > 0) locked.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return locked;
}
