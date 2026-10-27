/**
 * The light blue outline of a room or desk, drawn the same way by every editor
 * that shows where spaces end: "Editar espacios" (`LayoutEditLayer`), "Decoración"
 * (`DecorEditLayer`) and "Editar terreno" (`TerrainEditLayer`, #216).
 */

import type Phaser from 'phaser';
import { LAYOUT_OUTLINE_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { TileRect } from './terrainGrid';

export const OUTLINE_STROKE_COLOR = 0x38bdf8;
export const OUTLINE_STROKE_WIDTH = 2;

/** Name of a context outline: on the map, not pickable (`LayoutEditCommand.outlines`). */
export const LAYOUT_OUTLINE_NAME = 'layout-outline';

/** A light blue outline over walls and avatars, so the whole reach of the area shows. */
export function drawOutline(scene: Phaser.Scene, rect: TileRect): Phaser.GameObjects.Rectangle {
  const w = (rect.x1 - rect.x0 + 1) * TILE;
  const h = (rect.y1 - rect.y0 + 1) * TILE;
  return scene.add
    .rectangle(rect.x0 * TILE + w / 2, rect.y0 * TILE + h / 2, w, h)
    .setStrokeStyle(OUTLINE_STROKE_WIDTH, OUTLINE_STROKE_COLOR)
    .setDepth(LAYOUT_OUTLINE_DEPTH);
}

/** Draws the context outlines of a command, named so the scene can tell them apart. */
export function drawContextOutlines(scene: Phaser.Scene, rects: readonly TileRect[]): Phaser.GameObjects.Rectangle[] {
  return rects.map((rect) => drawOutline(scene, rect).setName(LAYOUT_OUTLINE_NAME));
}

/**
 * The context outlines an editor shows while it is open. Its command is resent
 * for every brush, selection and pending edit, so a same set is left standing
 * instead of drawn again.
 */
export class ContextOutlines {
  private readonly scene: Phaser.Scene;
  private objects: Phaser.GameObjects.Rectangle[] = [];
  private key = '[]';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(rects: readonly TileRect[] | undefined): void {
    const key = JSON.stringify(rects ?? []);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    this.objects = drawContextOutlines(this.scene, rects ?? []);
  }

  clear(): void {
    for (const object of this.objects.splice(0)) object.destroy();
  }
}
