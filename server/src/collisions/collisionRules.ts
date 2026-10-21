/**
 * Pure rules of a collision edit: what a valid edit is and when an edit would
 * close a rectangle over someone. Kept apart from the runtime and the routes for the same reason as
 * `terrainRules.ts`: they are tested without a server.
 */

import {
  InvalidCollisionRectsError,
  bodyBoxAt,
  boxOverlapsRects,
  isEditablePieceId,
  parseCollisionRects,
  type CollisionPoint,
  type CollisionRect,
} from '../../../src/game/pieceCollisions.ts';

/** The edit was malformed: a piece that cannot be edited or invalid rectangles (400). */
export class InvalidCollisionEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCollisionEditError';
  }
}

/**
 * The edit would put a rectangle over a player who is in the office (or in
 * their reconnection window). Unlike terrain edits, collision edits wait
 * until that person walks away; they do not relocate players.
 */
export class CollisionProtectedError extends Error {
  constructor() {
    super('a collision rectangle would close over a player');
    this.name = 'CollisionProtectedError';
  }
}

export interface CollisionEdit {
  pieceId: string;
  rects: CollisionRect[];
}

/** The piece of `/admin/collisions/:pieceId`; only pieces that stand in the world can be edited. */
export function parsePieceId(raw: unknown): string {
  if (!isEditablePieceId(raw)) throw new InvalidCollisionEditError('this piece has no editable collision');
  return raw;
}

/** The piece of the path and the `rects` of the body. */
export function parseCollisionEdit(pieceId: unknown, body: unknown): CollisionEdit {
  const piece = parsePieceId(pieceId);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidCollisionEditError('the body is not an object');
  try {
    return { pieceId: piece, rects: parseCollisionRects((body as Record<string, unknown>).rects) };
  } catch (error) {
    if (error instanceof InvalidCollisionRectsError) throw new InvalidCollisionEditError(error.message);
    throw error;
  }
}

/**
 * Whether the rectangles of a piece after an edit overlap the Arcade body of
 * someone they did not overlap before. Anyone already inside one (a sitter at
 * a desk, say) is not trapped by the edit; a new overlap would leave the
 * client's physics pushing them out while the room refuses their moves.
 */
export function trapsPlayer(
  before: readonly CollisionRect[],
  after: readonly CollisionRect[],
  players: readonly CollisionPoint[],
): boolean {
  return players.some((position) => {
    const body = bodyBoxAt(position);
    return boxOverlapsRects(after, body) && !boxOverlapsRects(before, body);
  });
}
