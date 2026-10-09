/**
 * Phaser layer of the terrain editor (#123 phase 2): outlines the cell under
 * the pointer while a palette entry is picked, and turns a click on the map
 * into a pick: with a floor the cell is a 9x9 block and the pick a
 * `terrainpick`, with a wall (or the wall eraser) it is the nearest grid
 * vertex (a wall post stands on the line between tiles) and a `wallpick`. Holding the primary button down and dragging keeps reporting
 * every cell the stroke crosses, so a large area or a long wall is one
 * gesture instead of a click per cell. Same split as `LayoutEditLayer`: the
 * layer draws and reports pointer facts, React decides. Pending paints are
 * not drawn here: they change the terrain tilemap and the walls, which the
 * scene owns.
 */

import Phaser from 'phaser';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';
import { BLOCK_TILES, type OfficeLayout } from './officeLayout';
import { cellOutlineCenter, cellsAlongStroke, sameBrush, type StrokeGrid, type TerrainBrush, type TerrainEditCommand } from './terrainEditor';

export const TERRAIN_HOVER_NAME = 'terrain-edit:hover';

const HOVER_STROKE_COLOR = 0x38bdf8;
const STROKE_WIDTH = 3;

export class TerrainEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private command: TerrainEditCommand | null = null;
  private hover: Phaser.GameObjects.Rectangle | null = null;
  /** Floors paint 9x9 blocks. */
  private readonly blocks: StrokeGrid;
  /** Walls paint single posts, on the grid vertices. */
  private readonly vertices: StrokeGrid;
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
    this.blocks = { columns: layout.width / BLOCK_TILES, rows: layout.height / BLOCK_TILES, cellSize: BLOCK_TILES * TILE };
    this.vertices = { columns: layout.width, rows: layout.height, cellSize: TILE, snap: 'vertex' };
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

  /** The grid a brush paints on: blocks for a floor, vertices for a wall. */
  private gridOf(brush: TerrainBrush): StrokeGrid {
    return brush.kind === 'floor' ? this.blocks : this.vertices;
  }

  /** Reports the cells from `from` (the press when `null`) to the pointer, skipping the one just reported. */
  private paintStroke(from: { x: number; y: number } | null, pointer: Phaser.Input.Pointer): void {
    const brush = this.command?.brush;
    if (brush == null) return;
    const to = { x: pointer.worldX, y: pointer.worldY };
    this.stroke = to;
    for (const index of cellsAlongStroke(this.gridOf(brush), from, to)) {
      if (index === this.lastPicked) continue;
      this.lastPicked = index;
      this.bridge.emit(brush.kind === 'floor' ? 'terrainpick' : 'wallpick', { index });
    }
  }

  private applyCommand(command: TerrainEditCommand | null): void {
    // A stroke paints with the brush it started with. The editor resends its
    // command for every pending paint it draws, so only a new brush ends it.
    if (!sameBrush(command?.brush, this.command?.brush)) this.stroke = null;
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
    const grid = this.gridOf(this.command.brush);
    const [index] = cellsAlongStroke(grid, null, { x: pointer.worldX, y: pointer.worldY });
    if (index === undefined) {
      this.hover?.setVisible(false);
      return;
    }
    const size = grid.cellSize;
    this.hover ??= this.scene.add
      .rectangle(0, 0, size, size)
      .setStrokeStyle(STROKE_WIDTH, HOVER_STROKE_COLOR)
      .setDepth(LAYOUT_GHOST_DEPTH)
      .setName(TERRAIN_HOVER_NAME);
    if (this.hover.width !== size) this.hover.setSize(size, size);
    const center = cellOutlineCenter(grid, index);
    this.hover.setPosition(center.x, center.y).setVisible(true);
  }
}
