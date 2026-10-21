/**
 * HTTP adapter of the office decor layer (#208). Pure handlers returning
 * `{ status, body }`, like `terrainRoutes.ts`, over the same edit queue (the
 * terrain runtime's `setDecor`), so no wall, block or desk check lands
 * between a decor check and its save.
 *
 * Two surfaces, one body (`{ edits: [{ index, item }] }`):
 *
 *   - `POST /admin/decor`: an admin or superadmin, anywhere on the map.
 *   - `POST /me/decor`: anyone signed in, only inside the desk they occupy.
 *     The desk is read from the store, never from the body, so nobody
 *     decorates someone else's desk by naming it.
 *
 * There is no read route: every client gets the layer with the room state
 * (`OfficeState.officeDecor`), on join and on every change.
 */

import { authenticate, authorize, INVALID_REQUEST, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { DESK_SIDE } from '../desks/deskRules.ts';
import type { DeskDirectory } from '../desks/desksPort.ts';
import type { DecorTileRect } from '../../../src/game/officeDecor.ts';
import { InvalidTerrainEditError, TerrainProtectedError, parseDecorBatch } from './terrainRules.ts';
import { DecorOutsideAreaError, type TerrainRuntime } from './terrainRuntime.ts';

export interface OfficeDecorDeps extends AdminDeps {
  terrain: TerrainRuntime;
  /** Where the caller's desk is, for `POST /me/decor`. Absent (no directory) nobody has one. */
  desks?: Pick<DeskDirectory, 'listDesks'>;
}

const UNDER_PLACEMENT: AdminResult = { status: 409, body: { error: 'terrain-under-placement' } };
const NO_DESK: AdminResult = { status: 403, body: { error: 'no-desk' } };
const OUTSIDE_DESK: AdminResult = { status: 403, body: { error: 'outside-desk' } };

async function apply(body: unknown, actorId: string, deps: OfficeDecorDeps, area?: DecorTileRect): Promise<AdminResult> {
  try {
    // Every tile of the map, the same count as the wall grid.
    const edits = parseDecorBatch(body, deps.terrain.walls().length);
    await deps.terrain.setDecor(edits, actorId, area);
    return { status: 200, body: { updated: edits.length } };
  } catch (error) {
    if (error instanceof InvalidTerrainEditError) return INVALID_REQUEST;
    if (error instanceof DecorOutsideAreaError) return OUTSIDE_DESK;
    if (error instanceof TerrainProtectedError) return UNDER_PLACEMENT;
    throw error;
  }
}

/** `POST /admin/decor`: places, turns, replaces or removes decor items anywhere, all or none. */
export async function handleSetOfficeDecor(authorization: unknown, body: unknown, deps: OfficeDecorDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  return apply(body, authorized.user.id, deps);
}

/**
 * `POST /me/decor`: the same edits, limited to the caller's desk. Every item
 * placed, replaced or removed must lie entirely inside its 3x3 area. Admins
 * go through the same rule here; they have `/admin/decor` for the rest.
 */
export async function handleSetMyDecor(authorization: unknown, body: unknown, deps: OfficeDecorDeps): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;
  const desk = ((await deps.desks?.listDesks()) ?? []).find((candidate) => candidate.occupantId === authenticated.user.id);
  if (desk === undefined) return NO_DESK;
  return apply(body, authenticated.user.id, deps, { x: desk.x, y: desk.y, w: DESK_SIDE, h: DESK_SIDE });
}
