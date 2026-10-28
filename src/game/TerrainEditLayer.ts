/**
 * Phaser layer of the terrain editor (#123 phase 2): outlines the cell under
 * the pointer while a palette entry is picked, and turns a click on the map
 * into a pick: with a floor the cell is a 9x9 block and the pick a
 * `terrainpick`, with a wall (or the wall eraser) it is the nearest grid
 * vertex (a wall post stands on the line between tiles) and a `wallpick`,
 * with the tile under the pointer. Over a decor piece the eraser would take,
 * the box outlines the whole piece instead of the post. Holding the primary button down and dragging keeps reporting
 * every cell the stroke crosses, so a large area or a long wall is one
 * gesture instead of a click per cell. Same split as `LayoutEditLayer`: the
 * layer draws and reports pointer facts, React decides. Pending paints are
 * not drawn here: they change the terrain tilemap and the walls, which the
 * scene owns.
 */

import Phaser from 'phaser';
import { DECOR_DELETE_COLOR } from './DecorEditLayer';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';
import { BLOCK_TILES, type OfficeLayout } from './officeLayout';
import { ContextOutlines } from './spaceOutline';
import { cellOutlineCenter, cellsAlongStroke, postsAlongStroke, sameBrush, type StrokeGrid, type TerrainBrush, type TerrainEditCommand } from './terrainEditor';
import type { TileRect } from './terrainGrid';

export const TERRAIN_HOVER_NAME = 'terrain-edit:hover';

export const HOVER_STROKE_COLOR = 0x38bdf8;
/** The eraser over something it would take (#241): the decor layer's delete red, one red for removing. */
export const HOVER_ERASE_COLOR = DECOR_DELETE_COLOR;

const STROKE_WIDTH = 3;

export class TerrainEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private command: TerrainEditCommand | null = null;
  private readonly outlines: ContextOutlines;
  private hover: Phaser.GameObjects.Rectangle | null = null;
  /** The cell the box outlines, or `null` while it is hidden. */
  private hovered: number | null = null;
  /** The decor piece the eraser box outlines whole instead of the post, or `null`. */
  private hoveredDecor: TileRect | null = null;
  /** World point of the last pointer move, so a new command redraws the box under a still pointer. */
  private pointer: { x: number; y: number } | null = null;
  private erasable: ReadonlySet<number> = new Set();
  /** Floors paint 9x9 blocks. */
  private readonly blocks: StrokeGrid;
  /** Walls paint single posts, on the grid vertices. */
  private readonly vertices: StrokeGrid;
  /** World point of the last pointer event of a held stroke, or `null` while no stroke is held. */
  private stroke: { x: number; y: number } | null = null;
  /** The last pick a stroke reported (`index`, or `index:tile` for a wall), not reported again in a row. */
  private lastPicked: string | null = null;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.pointer = { x: pointer.worldX, y: pointer.worldY };
    this.updateHover();
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
    this.outlines = new ContextOutlines(scene);
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
    // Only the eraser needs the tile (a decor piece goes by it): a painted wall goes post by post.
    if (brush.kind === 'wall' && brush.piece === null) {
      for (const pick of postsAlongStroke(this.vertices, from, to)) {
        const key = `${pick.index}:${pick.tile}`;
        if (key === this.lastPicked) continue;
        this.lastPicked = key;
        this.bridge.emit('wallpick', pick);
      }
      return;
    }
    for (const index of cellsAlongStroke(this.gridOf(brush), from, to)) {
      if (String(index) === this.lastPicked) continue;
      this.lastPicked = String(index);
      this.bridge.emit(brush.kind === 'floor' ? 'terrainpick' : 'wallpick', { index });
    }
  }

  private applyCommand(command: TerrainEditCommand | null): void {
    // A stroke paints with the brush it started with. The editor resends its
    // command for every pending paint it draws, so only a new brush ends it.
    if (!sameBrush(command?.brush, this.command?.brush)) this.stroke = null;
    this.command = command;
    this.erasable = new Set(command?.erasable);
    this.outlines.show(command?.outlines);
    if (command === null) {
      this.hover?.destroy();
      this.hover = null;
      this.hovered = null;
      this.hoveredDecor = null;
      return;
    }
    if (command.brush === null) {
      this.hover?.setVisible(false);
      this.hovered = null;
      this.hoveredDecor = null;
      return;
    }
    // An erase lands under a still pointer: the box says so without waiting for a move.
    this.updateHover();
  }

  /** Red while the eraser points at something it would take, the usual color otherwise. */
  private colorHover(): void {
    if (this.hover === null) return;
    const brush = this.command?.brush;
    const erases = brush?.kind === 'wall' && brush.piece === null && (this.hoveredDecor !== null || (this.hovered !== null && this.erasable.has(this.hovered)));
    this.hover.setStrokeStyle(STROKE_WIDTH, erases ? HOVER_ERASE_COLOR : HOVER_STROKE_COLOR);
  }

  private updateHover(): void {
    if (this.command === null || this.command.brush === null || this.pointer === null) return;
    const grid = this.gridOf(this.command.brush);
    const [index] = cellsAlongStroke(grid, null, this.pointer);
    if (index === undefined) {
      this.hover?.setVisible(false);
      this.hovered = null;
      this.hoveredDecor = null;
      return;
    }
    this.hovered = index;
    this.hoveredDecor = this.decorUnderPointer();
    const rect = this.hoveredDecor;
    const width = rect === null ? grid.cellSize : (rect.x1 - rect.x0 + 1) * TILE;
    const height = rect === null ? grid.cellSize : (rect.y1 - rect.y0 + 1) * TILE;
    this.hover ??= this.scene.add
      .rectangle(0, 0, width, height)
      .setStrokeStyle(STROKE_WIDTH, HOVER_STROKE_COLOR)
      .setDepth(LAYOUT_GHOST_DEPTH)
      .setName(TERRAIN_HOVER_NAME);
    if (this.hover.width !== width || this.hover.height !== height) this.hover.setSize(width, height);
    const center = rect === null ? cellOutlineCenter(grid, index) : { x: ((rect.x0 + rect.x1 + 1) / 2) * TILE, y: ((rect.y0 + rect.y1 + 1) / 2) * TILE };
    this.hover.setPosition(center.x, center.y).setVisible(true);
    this.colorHover();
  }

  /**
   * With the eraser, the decor piece the tile under the pointer belongs to,
   * the smallest where they stack (`decorItemCovering`, what the click takes), or `null`.
   */
  private decorUnderPointer(): TileRect | null {
    const brush = this.command?.brush;
    if (brush?.kind !== 'wall' || brush.piece !== null || this.pointer === null) return null;
    const tx = Math.floor(this.pointer.x / TILE);
    const ty = Math.floor(this.pointer.y / TILE);
    let best: TileRect | null = null;
    for (const rect of this.command?.erasableDecor ?? []) {
      if (tx < rect.x0 || tx > rect.x1 || ty < rect.y0 || ty > rect.y1) continue;
      if (best === null || areaOf(rect) < areaOf(best)) best = rect;
    }
    return best;
  }
}

function areaOf(rect: TileRect): number {
  return (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1);
}
