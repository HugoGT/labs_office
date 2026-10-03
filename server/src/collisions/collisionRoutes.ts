/**
 * HTTP adapter of the collision editor. Pure handlers returning
 * `{ status, body }`, same contract and same role guard (`authorize`) as
 * `terrainRoutes.ts`: editing what blocks the way is administration.
 *
 * There is no read route. Every client already gets the table with the room
 * state (`OfficeState.pieceCollisions`), on join and on every change.
 */

import { authorize, INVALID_REQUEST, NOT_FOUND, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { CollisionProtectedError, InvalidCollisionEditError, parseCollisionEdit, parsePieceId } from './collisionRules.ts';
import type { CollisionRuntime, PlayerPositions } from './collisionRuntime.ts';

export interface CollisionDeps extends AdminDeps {
  collisions: CollisionRuntime;
  players: PlayerPositions;
  /** Whether the office knows the piece: the art catalog, the layout or the base chairs. */
  pieceExists: (pieceId: string) => Promise<boolean>;
}

const UNDER_PLAYER: AdminResult = { status: 409, body: { error: 'collision-under-player' } };

function refusal(error: unknown): AdminResult {
  if (error instanceof InvalidCollisionEditError) return INVALID_REQUEST;
  if (error instanceof CollisionProtectedError) return UNDER_PLAYER;
  throw error;
}

/** `POST /admin/collisions/:pieceId` `{ rects }`: replaces a piece's rectangles; `[]` is walk-through. */
export async function handleSetPieceCollision(
  authorization: unknown,
  pieceId: unknown,
  body: unknown,
  deps: CollisionDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  try {
    const edit = parseCollisionEdit(pieceId, body);
    if (!(await deps.pieceExists(edit.pieceId))) return NOT_FOUND;
    await deps.collisions.setRects({ ...edit, actorId: authorized.user.id }, deps.players);
    return { status: 200, body: { pieceId: edit.pieceId, rects: edit.rects } };
  } catch (error) {
    return refusal(error);
  }
}

/** `POST /admin/collisions/:pieceId/reset`: forgets a piece's rectangles, back to its default. */
export async function handleResetPieceCollision(authorization: unknown, pieceId: unknown, deps: CollisionDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  try {
    const piece = parsePieceId(pieceId);
    if (!(await deps.pieceExists(piece))) return NOT_FOUND;
    await deps.collisions.reset({ pieceId: piece, actorId: authorized.user.id }, deps.players);
    return { status: 200, body: { pieceId: piece, rects: null } };
  } catch (error) {
    return refusal(error);
  }
}
