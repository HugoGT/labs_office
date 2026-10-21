/**
 * When an open map editor holds the map: something is picked that the next
 * click or drag on the map would act on. Only then do walking, sitting,
 * dragging the view and the minimap stop; an editor that is merely open
 * (nothing picked yet, or after Escape) leaves the admin free to move around
 * the office to find what to edit.
 */

import type { CollisionEditCommand } from './collisionEditor';
import type { DecorEditCommand } from './decorEditor';
import type { LayoutEditCommand } from './layoutEditor';
import type { TerrainEditCommand } from './terrainEditor';

/** A desk or room selected, or one being placed (created or moved). */
export function layoutEditHoldsMap(command: LayoutEditCommand | null): boolean {
  return command !== null && (command.selectedId !== null || command.placing !== null);
}

/**
 * A floor or wall brush (erasers included) picked. It also hides the
 * right rail (minimap, zoom card, sidebar, exit buttons) so the map can be
 * painted up to the screen edge, until Escape unpicks the brush.
 */
export function terrainEditHoldsMap(command: Pick<TerrainEditCommand, 'brush'> | null): boolean {
  return command !== null && command.brush !== null;
}

/**
 * A decor piece or the decor eraser picked (#208). Like a terrain brush it
 * also hides the right rail, so the ghost can be placed up to the screen
 * edge, until Escape unpicks it.
 */
export function decorEditHoldsMap(command: DecorEditCommand | null): boolean {
  return command !== null && command.brush !== null;
}

/** A piece picked, whose rectangles the map drags. */
export function collisionEditHoldsMap(command: CollisionEditCommand | null): boolean {
  return command !== null && command.pieceId !== null;
}
