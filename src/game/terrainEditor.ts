/**
 * Shapes of the terrain editor (#123 phase 2) shared by React and the scene,
 * kept free of Phaser so the sidebar can import them.
 */

import type { LayoutMaterial } from './officeLayout';

/**
 * What the terrain editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this admin only and
 * never changes collisions: the room decides once each paint is applied.
 */
export interface TerrainEditCommand {
  /**
   * The floor picked in the palette, or `null`. While one is picked the map
   * outlines the block a click would paint; every click reports its block.
   */
  brush: LayoutMaterial | null;
  /** Paints on their way to the room, drawn over the live blocks. Drawing only, never walkability. */
  previewBlocks?: readonly LayoutMaterial[];
}
