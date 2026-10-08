/**
 * Shapes of the terrain editor (#123 phase 2) shared by React and the scene,
 * kept free of Phaser so the sidebar can import them.
 */

import type { LayoutMaterial } from './officeLayout';

/**
 * What the terrain editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this admin only and
 * never changes collisions: the room decides once the edit is applied.
 */
export interface TerrainEditCommand {
  /** The block outlined as selected, or `null`. */
  selected: number | null;
  /** The material to draw on a block before applying it, or `null`. */
  preview: { index: number; material: LayoutMaterial } | null;
  /** Whole-map local draft. Drawing only, never walkability. */
  previewBlocks?: readonly LayoutMaterial[];
}
