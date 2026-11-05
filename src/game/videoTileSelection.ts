/**
 * Pure rule deciding which conversation tiles are shown (#280). With 50
 * people in a room the bar cannot show everyone: before this, who was seen
 * depended on the `sessionId` order and the rest overflowed the screen or
 * was clipped by the side column, so the 6-8 cameras of a meeting could be
 * hidden.
 *
 * The capacity follows the layout (row or side column) and the viewport,
 * capped at 16 like WorkAdventure. Within it, cameras and speakers come
 * first, but the selection is sticky (WorkAdventure's `stableNSort`): a
 * visible tile only leaves when someone with strictly more priority needs its
 * slot, and the newcomer takes that very slot, so nobody else moves.
 */

/** Default upper bound of visible tiles, whatever the screen size. */
export const DEFAULT_MAX_VIDEO_TILES = 16;

// Keep pace with `VideoTiles.module.css` (`.bar`, `.tile`, the column bounds).
const TILE_WIDTH = 264;
const TILE_HEIGHT = 148.5;
const TILE_GAP = 8;
const BAR_SIDE_MARGIN = 12;
const COLUMN_TOP = 12;
const COLUMN_BOTTOM = 137;
// The row stays on top of the map: more than two rows would cover it.
const MAX_ROW_LINES = 2;

export type VideoTileLayout = 'row' | 'column';

export interface VideoTileCapacityInput {
  layout: VideoTileLayout;
  viewportWidth: number;
  viewportHeight: number;
  max?: number;
}

/** How many tile slots fit the layout, counting the "+N" counter as one. */
export function videoTileCapacity({
  layout,
  viewportWidth,
  viewportHeight,
  max = DEFAULT_MAX_VIDEO_TILES,
}: VideoTileCapacityInput): number {
  const fits =
    layout === 'row'
      ? Math.floor((viewportWidth - 2 * BAR_SIDE_MARGIN + TILE_GAP) / (TILE_WIDTH + TILE_GAP)) * MAX_ROW_LINES
      : Math.floor((viewportHeight - COLUMN_TOP - COLUMN_BOTTOM + TILE_GAP) / (TILE_HEIGHT + TILE_GAP));
  return Math.max(1, Math.min(max, fits));
}

export interface VideoTileCandidate {
  sessionId: string;
  hasVideo: boolean;
  speaking: boolean;
  /** Always shown and first: the own tile. */
  pinned?: boolean;
}

export interface VideoTileSelection {
  /** SessionIds to render, in slot order. */
  visible: string[];
  /** Candidates left without a tile, for the "+N" counter. */
  hiddenCount: number;
}

function priorityOf(candidate: VideoTileCandidate): number {
  if (candidate.pinned) return 4;
  return (candidate.hasVideo ? 2 : 0) + (candidate.speaking ? 1 : 0);
}

/**
 * @param candidates every participant with a right to a tile, in base order
 * @param capacity slots from `videoTileCapacity`
 * @param previous the `visible` of the last selection, to keep it stable
 */
export function selectVideoTiles(
  candidates: readonly VideoTileCandidate[],
  capacity: number,
  previous: readonly string[],
): VideoTileSelection {
  const byId = new Map(candidates.map((candidate) => [candidate.sessionId, candidate]));
  const baseOrder = new Map(candidates.map((candidate, index) => [candidate.sessionId, index]));
  const priority = (id: string) => priorityOf(byId.get(id)!);
  // On overflow one slot goes to the counter, but never below one tile.
  const slots = candidates.length > capacity ? Math.max(1, capacity - 1) : candidates.length;

  const pinned = candidates.filter((candidate) => candidate.pinned).map((candidate) => candidate.sessionId);
  const visible = [...pinned];
  for (const id of previous) {
    if (byId.has(id) && !visible.includes(id)) visible.push(id);
  }

  /** Slot of the visible tile that is cheapest to give up: lowest priority, the latest on ties. */
  const weakestIndex = () => {
    let weakest = -1;
    visible.forEach((id, index) => {
      if (byId.get(id)!.pinned) return;
      if (weakest === -1 || priority(id) <= priority(visible[weakest])) weakest = index;
    });
    return weakest;
  };

  while (visible.length > slots) {
    const weakest = weakestIndex();
    visible.splice(weakest === -1 ? visible.length - 1 : weakest, 1);
  }

  const hiddenByPriority = () =>
    candidates
      .map((candidate) => candidate.sessionId)
      .filter((id) => !visible.includes(id))
      .sort((a, b) => priority(b) - priority(a) || baseOrder.get(a)! - baseOrder.get(b)!);

  // Free slots: the best hidden ones, appended in base order.
  const newcomers = hiddenByPriority()
    .slice(0, slots - visible.length)
    .sort((a, b) => baseOrder.get(a)! - baseOrder.get(b)!);
  visible.push(...newcomers);

  // Full: a hidden candidate takes the slot of a strictly weaker visible one.
  for (const id of hiddenByPriority()) {
    const weakest = weakestIndex();
    if (weakest === -1 || priority(id) <= priority(visible[weakest])) break;
    visible[weakest] = id;
  }

  return { visible, hiddenCount: candidates.length - visible.length };
}
