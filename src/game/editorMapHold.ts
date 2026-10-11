/**
 * When an open map editor holds the map: something is picked that the next
 * click or drag on the map would act on. Only then do walking, sitting,
 * dragging the view and the minimap stop; an editor that is merely open
 * (nothing picked yet, or after Escape) leaves the admin free to move around
 * the office to find what to edit.
 */

import type { CollisionEditCommand } from './collisionEditor';
import type { LayoutEditCommand } from './layoutEditor';
import type { TerrainEditCommand } from './terrainEditor';

/** A desk or room selected, or one being placed (created or moved). */
export function layoutEditHoldsMap(command: LayoutEditCommand | null): boolean {
  return command !== null && (command.selectedId !== null || command.placing !== null);
}

/** A floor, wall or chair brush (erasers included) picked. */
export function terrainEditHoldsMap(command: Pick<TerrainEditCommand, 'brush'> | null): boolean {
  return command !== null && command.brush !== null;
}

/** A piece picked, whose rectangles the map drags. */
export function collisionEditHoldsMap(command: CollisionEditCommand | null): boolean {
  return command !== null && command.pieceId !== null;
}
