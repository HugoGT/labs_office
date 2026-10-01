/**
 * HTTP adapter of the terrain editor (#123 phase 2). Pure handlers returning
 * `{ status, body }`, same contract as `spacesRoutes.ts`, and the same role
 * guard (`authorize`): editing the map is administration, like rooms and desks.
 *
 * There is no read route. Every client already gets the blocks with the room
 * state (`OfficeState.terrainBlocks`), on join and on every change, so a
 * second copy over HTTP would be one more thing to keep in step.
 */

import { authorize, INVALID_REQUEST, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { InvalidTerrainEditError, TerrainProtectedError, parseTerrainEdit, type TerrainProtections } from './terrainRules.ts';
import type { TerrainRuntime } from './terrainRuntime.ts';

export interface TerrainDeps extends AdminDeps {
  terrain: TerrainRuntime;
  /** Read only when an edit would flood a tile; see `TerrainProtections`. */
  protections: () => Promise<TerrainProtections>;
}

/** One code per reason, because they are fixed differently: another block, or waiting. */
const UNDER_PLACEMENT: AdminResult = { status: 409, body: { error: 'terrain-under-placement' } };
const UNDER_PLAYER: AdminResult = { status: 409, body: { error: 'terrain-under-player' } };

export async function handleSetTerrainBlock(
  authorization: unknown,
  index: unknown,
  body: unknown,
  deps: TerrainDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  try {
    const edit = parseTerrainEdit(index, body, deps.terrain.blocks().length);
    await deps.terrain.setBlock({ ...edit, actorId: authorized.user.id }, deps.protections);
    return { status: 200, body: { index: edit.index, material: edit.material } };
  } catch (error) {
    if (error instanceof InvalidTerrainEditError) return INVALID_REQUEST;
    if (error instanceof TerrainProtectedError) return error.reason === 'player' ? UNDER_PLAYER : UNDER_PLACEMENT;
    throw error;
  }
}
