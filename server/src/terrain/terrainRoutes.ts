/**
 * HTTP adapter of the terrain editor (#123 phase 2). Pure handlers returning
 * `{ status, body }`, same contract as `spacesRoutes.ts`, and the same role
 * guard (`authorize`): editing the map is administration, like rooms and desks.
 *
 * There is no read route. Every client already gets the blocks and the walls
 * with the room state (`OfficeState.terrainBlocks`, `terrainWalls`,
 * `terrainChairs`), on join
 * and on every change, so a second copy over HTTP would be one more thing to
 * keep in step.
 */

import { authorize, INVALID_REQUEST, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import {
  InvalidTerrainEditError,
  TerrainProtectedError,
  TerrainStaleError,
  parseChairBatch,
  parseTerrainBatch,
  parseTerrainEdit,
  parseWallBatch,
  type TerrainProtections,
} from './terrainRules.ts';
import type { TerrainRuntime } from './terrainRuntime.ts';

export interface TerrainDeps extends AdminDeps {
  terrain: TerrainRuntime;
  /** Read only when an edit would flood a tile or place a wall; see `TerrainProtections`. */
  protections: () => Promise<TerrainProtections>;
}

/** Placements survive terrain and wall edits; players return to safe spawn instead. */
const UNDER_PLACEMENT: AdminResult = { status: 409, body: { error: 'terrain-under-placement' } };

export async function handleSetTerrainBlocks(authorization: unknown, body: unknown, deps: TerrainDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  try {
    const { edits, expected } = parseTerrainBatch(body, deps.terrain.blocks().length);
    await deps.terrain.setBlocks(edits, authorized.user.id, deps.protections, expected);
    return { status: 200, body: { updated: edits.length } };
  } catch (error) {
    if (error instanceof InvalidTerrainEditError) return INVALID_REQUEST;
    if (error instanceof TerrainStaleError) return { status: 409, body: { error: 'terrain-stale' } };
    if (error instanceof TerrainProtectedError) return UNDER_PLACEMENT;
    throw error;
  }
}

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
    if (error instanceof TerrainProtectedError) return UNDER_PLACEMENT;
    throw error;
  }
}

/**
 * `POST /admin/terrain/walls` `{ edits: [{ index, piece }] }`: places (`piece`
 * a wall piece) or removes (`null`) walls on single tiles, all or none. A
 * dragged wall is one request.
 */
export async function handleSetTerrainWalls(authorization: unknown, body: unknown, deps: TerrainDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  try {
    const edits = parseWallBatch(body, deps.terrain.walls().length);
    await deps.terrain.setWalls(edits, authorized.user.id, deps.protections);
    return { status: 200, body: { updated: edits.length } };
  } catch (error) {
    if (error instanceof InvalidTerrainEditError) return INVALID_REQUEST;
    if (error instanceof TerrainProtectedError) return UNDER_PLACEMENT;
    throw error;
  }
}

/**
 * `POST /admin/terrain/chairs` `{ edits: [{ index, chair }] }`: places or
 * turns (`chair` a `{ piece, facing }`) or removes (`null`) chairs on single
 * tiles, all or none. A dragged row of chairs is one request.
 */
export async function handleSetTerrainChairs(authorization: unknown, body: unknown, deps: TerrainDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  try {
    // Every tile of the map, the same count as the wall grid.
    const edits = parseChairBatch(body, deps.terrain.walls().length);
    await deps.terrain.setChairs(edits, authorized.user.id, deps.protections);
    return { status: 200, body: { updated: edits.length } };
  } catch (error) {
    if (error instanceof InvalidTerrainEditError) return INVALID_REQUEST;
    if (error instanceof TerrainProtectedError) return UNDER_PLACEMENT;
    throw error;
  }
}
