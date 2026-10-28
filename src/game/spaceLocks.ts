/**
 * Locked spaces: anyone inside a room or a desk cubicle may lock it with
 * whoever is in. Nobody outside walks in while it holds; whoever is inside
 * moves and leaves freely. Only whoever locked it unlocks it, and the lock
 * goes by itself once they leave (so also once the space is empty).
 *
 * Shared by the room, which enforces it, and the scene, which refuses the
 * same step locally (the client stays the stricter side). Positions are
 * network positions in pixels and membership is `detectSpace`'s, so both
 * sides agree on who is inside.
 */

import { TILE, type SpaceArea } from './mapData.ts';
import { doorFarSide, type DoorLeaf } from './officeDoors.ts';
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
 * The locked space a door leads into from outside it, for a body at network
 * position `position` lined up with it (`doorFarSide`), or `null`. Such a
 * door stays shut for that body: it is the way in nobody outside may take.
 */
export function lockedBehindDoor(
  door: DoorLeaf,
  position: Point,
  spaces: readonly SpaceArea[],
  locked: ReadonlyMap<string, string>,
): SpaceArea | null {
  if (locked.size === 0) return null;
  const across = doorFarSide(door, position);
  return across === null ? null : lockedSpaceEntered(position, across, spaces, locked);
}

/**
 * The locked space behind a door that a body at `position`, heading
 * `heading`, is pushing into from outside, or `null`. Lined up with the door
 * is enough, even with the body held back by a post beside it: a door is the
 * way into a room, so walking at it is trying to get in.
 */
export function lockedDoorAhead(
  doors: readonly DoorLeaf[],
  position: Point,
  heading: Point,
  spaces: readonly SpaceArea[],
  locked: ReadonlyMap<string, string>,
): SpaceArea | null {
  if (locked.size === 0) return null;
  for (const door of doors) {
    const across = doorFarSide(door, position);
    if (across === null) continue;
    const toward = door.edge.axis === 'horizontal' ? (across.y - door.edge.row * TILE) * heading.y : (across.x - door.edge.col * TILE) * heading.x;
    if (toward <= 0) continue;
    const space = lockedSpaceEntered(position, across, spaces, locked);
    if (space !== null) return space;
  }
  return null;
}

/**
 * The locks that still hold, each with who locked it: those whose locker is
 * among `players` and inside that space, which must still exist.
 */
export function heldLocks(
  locked: ReadonlyMap<string, string>,
  spaces: readonly SpaceArea[],
  players: readonly (Point & { readonly sessionId: string })[],
): Map<string, string> {
  const held = new Map<string, string>();
  for (const player of players) {
    const space = detectSpace(player, spaces);
    if (space !== null && locked.get(space.id) === player.sessionId) held.set(space.id, player.sessionId);
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
