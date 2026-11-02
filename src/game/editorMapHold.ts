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
 * A floor or wall brush (erasers included) picked: the next click or drag
 * on the map paints, so it must not walk or drag the view too.
 */
export function terrainEditHoldsMap(command: Pick<TerrainEditCommand, 'brush' | 'pickingColor'> | null): boolean {
  return command !== null && command.brush !== null;
}

/**
 * The same brush also hides the right rail (minimap, zoom card, sidebar,
 * exit buttons) so the map can be painted up to the screen edge, until
 * Escape unpicks the brush. Not while the color picker of its palette tile
 * is open: the picker hangs from that sidebar and closes with it.
 */
export function terrainEditHidesRail(command: Pick<TerrainEditCommand, 'brush' | 'pickingColor'> | null): boolean {
  return terrainEditHoldsMap(command) && command?.pickingColor !== true;
}

/**
 * A decor piece picked, or a placed item selected (#208): the next click on
 * the map places, moves or deletes, so it must not walk or sit too.
 */
export function decorEditHoldsMap(command: DecorEditCommand | null): boolean {
  return command !== null && (command.brush !== null || (command.selected ?? null) !== null);
}

/**
 * Only a picked piece (a new one or an item being moved) hides the right
 * rail, like a terrain brush, so the ghost can be placed up to the screen
 * edge until Escape unpicks it, except while the color picker of its palette
 * tile is open (it hangs from the sidebar). A selection keeps the rail: the
 * editor's panel stays at hand.
 */
export function decorEditHidesRail(command: DecorEditCommand | null): boolean {
  return command !== null && command.brush !== null && command.pickingColor !== true;
}

/** A piece picked, whose rectangles the map drags. */
export function collisionEditHoldsMap(command: CollisionEditCommand | null): boolean {
  return command !== null && command.pieceId !== null;
}
