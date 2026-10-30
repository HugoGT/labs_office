/**
 * A floor an Admin uploaded (#121), painted on the terrain: a separate layer
 * over blocks of wood, in the way `terrainColors` is one over carpet. The
 * terrain keeps its closed list of materials (the baked tileset, the SQL check
 * and every client in the field depend on it); a block with an uploaded floor
 * is `wood` underneath, which every client already draws, walks and collides,
 * and the floor shows over it where the client knows the piece. Import-free:
 * the server and the client share it.
 */

/** The material an uploaded floor lies on. */
export const TERRAIN_FLOOR_BASE = 'wood';

/** Same ids as the uploads (`server/src/assets/assetUploadRules.ts`: `<kind>-upload-<16 hex>`). */
const FLOOR_PIECE_ID = /^floor-upload-[0-9a-f]{16}$/;

export type TerrainFloors = ReadonlyMap<number, string>;

export function isTerrainFloorPieceId(value: unknown): value is string {
  return typeof value === 'string' && FLOOR_PIECE_ID.test(value);
}

/**
 * The floors after `edits`: an edit sets its block's whole look, so a floor it
 * carries on wood stays, and any other edit of that block (another material,
 * or no floor) leaves it without one. `floors` is left alone.
 */
export function withTerrainFloors(
  floors: TerrainFloors,
  edits: readonly { readonly index: number; readonly material: string; readonly floor?: string }[],
): Map<number, string> {
  const next = new Map(floors);
  for (const { index, material, floor } of edits) {
    if (floor !== undefined && material === TERRAIN_FLOOR_BASE) next.set(index, floor);
    else next.delete(index);
  }
  return next;
}

/** The wire form, a replicated string of the room state apart from `terrainBlocks`: `<block>:<piece id>` pairs sorted by block, joined by `,`, empty for none. */
export function encodeTerrainFloors(floors: TerrainFloors): string {
  return [...floors].sort(([a], [b]) => a - b).map(([index, piece]) => `${index}:${piece}`).join(',');
}

/** The floors of a wire string, or `null` unless every entry is an uploaded floor on a distinct block below `count`. */
export function decodeTerrainFloors(raw: unknown, count: number): Map<number, string> | null {
  if (typeof raw !== 'string') return null;
  const floors = new Map<number, string>();
  if (raw === '') return floors;
  for (const part of raw.split(',')) {
    const match = /^(\d+):(.+)$/.exec(part);
    if (match === null || !isTerrainFloorPieceId(match[2])) return null;
    const index = Number(match[1]);
    if (index >= count || floors.has(index)) return null;
    floors.set(index, match[2]);
  }
  return floors;
}
