/**
 * Phaser layer of the terrain editor (#123 phase 2): outlines the block under
 * the pointer while a floor is picked in the palette, and turns a click on
 * the map into `terrainpick`. Holding the primary button down and dragging
 * keeps reporting every block the stroke crosses, so a large area is one
 * gesture instead of a click per block. Same split as `LayoutEditLayer`: the layer
 * draws and reports pointer facts, React decides. Pending paints are not
 * drawn here: they change the terrain tilemap, which the scene owns.
 */

import Phaser from 'phaser';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';
import { BLOCK_TILES, blockAtWorldPoint, blockTileRect, type OfficeLayout } from './officeLayout';
import { cellsAlongStroke, type StrokeGrid, type TerrainEditCommand } from './terrainEditor';

export const TERRAIN_HOVER_NAME = 'terrain-edit:hover';

const HOVER_STROKE_COLOR = 0x38bdf8;
const STROKE_WIDTH = 3;

export class TerrainEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private readonly layout: Pick<OfficeLayout, 'width' | 'height'>;
  private command: TerrainEditCommand | null = null;
  private hover: Phaser.GameObjects.Rectangle | null = null;
  private readonly blocks: StrokeGrid;
  /** World point of the last pointer event of a held stroke, or `null` while no stroke is held. */
  private stroke: { x: number; y: number } | null = null;
  private lastPicked: number | null = null;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.updateHover(pointer);
    if (this.stroke !== null) this.paintStroke(this.stroke, pointer);
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.command?.brush == null || pointer.button !== 0) return;
    this.lastPicked = null;
    this.paintStroke(null, pointer);
  };
  private readonly onPointerUp = (): void => {
    this.stroke = null;
  };

  constructor(scene: Phaser.Scene, bridge: OfficeBridge, layout: Pick<OfficeLayout, 'width' | 'height'>) {
    this.scene = scene;
    this.bridge = bridge;
    this.layout = layout;
    this.blocks = { columns: layout.width / BLOCK_TILES, rows: layout.height / BLOCK_TILES, cellSize: BLOCK_TILES * TILE };
    this.unsubscribeCommand = bridge.onCommand('terrainedit', (command) => this.applyCommand(command));
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.on('pointerup', this.onPointerUp);
    scene.input.on('pointerupoutside', this.onPointerUp);
  }

  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUp);
    this.applyCommand(null);
  }

  /** Reports the blocks from `from` (the press when `null`) to the pointer, skipping the one just reported. */
  private paintStroke(from: { x: number; y: number } | null, pointer: Phaser.Input.Pointer): void {
    const to = { x: pointer.worldX, y: pointer.worldY };
    this.stroke = to;
    for (const index of cellsAlongStroke(this.blocks, from, to)) {
      if (index === this.lastPicked) continue;
      this.lastPicked = index;
      this.bridge.emit('terrainpick', { index });
    }
  }

  private applyCommand(command: TerrainEditCommand | null): void {
    // A stroke paints with the brush it started with. The editor resends its
    // command for every pending paint it draws, so only a new brush ends it.
    if (command?.brush !== this.command?.brush) this.stroke = null;
    this.command = command;
    if (command === null) {
      this.hover?.destroy();
      this.hover = null;
      return;
    }
    if (command.brush === null) this.hover?.setVisible(false);
  }

  private updateHover(pointer: Phaser.Input.Pointer): void {
    if (this.command === null || this.command.brush === null) return;
    const index = blockAtWorldPoint(this.layout, pointer.worldX, pointer.worldY);
    if (index === null) {
      this.hover?.setVisible(false);
      return;
    }
    const { tx, ty, w, h } = blockTileRect(this.layout.width, index);
    this.hover ??= this.scene.add
      .rectangle(0, 0, w * TILE, h * TILE)
      .setStrokeStyle(STROKE_WIDTH, HOVER_STROKE_COLOR)
      .setDepth(LAYOUT_GHOST_DEPTH)
      .setName(TERRAIN_HOVER_NAME);
    this.hover.setPosition((tx + w / 2) * TILE, (ty + h / 2) * TILE).setVisible(true);
  }
}
