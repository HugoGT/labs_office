/**
 * Phaser layer of the terrain editor (#123 phase 2): outlines the selected
 * block and the one under the pointer, and turns a click on the map into
 * `terrainpick`. Same split as `LayoutEditLayer`: the layer draws and reports
 * pointer facts, React decides. The material preview is not drawn here: it
 * changes the terrain tilemap, which the scene owns.
 */

import Phaser from 'phaser';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';
import { blockAtWorldPoint, blockTileRect, type OfficeLayout } from './officeLayout';
import type { TerrainEditCommand } from './terrainEditor';

export const TERRAIN_SELECTION_NAME = 'terrain-edit:selected';
export const TERRAIN_HOVER_NAME = 'terrain-edit:hover';

const SELECTED_STROKE_COLOR = 0xfacc15;
const HOVER_STROKE_COLOR = 0x38bdf8;
const STROKE_WIDTH = 3;

export class TerrainEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private readonly layout: Pick<OfficeLayout, 'width' | 'height'>;
  private command: TerrainEditCommand | null = null;
  private selected: Phaser.GameObjects.Rectangle | null = null;
  private hover: Phaser.GameObjects.Rectangle | null = null;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.updateHover(pointer);
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.command === null) return;
    const index = blockAtWorldPoint(this.layout, pointer.worldX, pointer.worldY);
    if (index !== null) this.bridge.emit('terrainpick', { index });
  };

  constructor(scene: Phaser.Scene, bridge: OfficeBridge, layout: Pick<OfficeLayout, 'width' | 'height'>) {
    this.scene = scene;
    this.bridge = bridge;
    this.layout = layout;
    this.unsubscribeCommand = bridge.onCommand('terrainedit', (command) => this.applyCommand(command));
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerdown', this.onPointerDown);
  }

  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.applyCommand(null);
  }

  private applyCommand(command: TerrainEditCommand | null): void {
    this.command = command;
    this.selected?.destroy();
    this.selected = null;
    if (command === null) {
      this.hover?.destroy();
      this.hover = null;
      return;
    }
    if (command.selected !== null) {
      this.selected = this.outlineBlock(command.selected, SELECTED_STROKE_COLOR).setName(TERRAIN_SELECTION_NAME);
    }
  }

  private updateHover(pointer: Phaser.Input.Pointer): void {
    if (this.command === null) return;
    const index = blockAtWorldPoint(this.layout, pointer.worldX, pointer.worldY);
    if (index === null) {
      this.hover?.setVisible(false);
      return;
    }
    if (this.hover === null) this.hover = this.outlineBlock(index, HOVER_STROKE_COLOR).setName(TERRAIN_HOVER_NAME);
    const { tx, ty, w, h } = blockTileRect(this.layout.width, index);
    this.hover.setPosition((tx + w / 2) * TILE, (ty + h / 2) * TILE).setVisible(true);
  }

  private outlineBlock(index: number, color: number): Phaser.GameObjects.Rectangle {
    const { tx, ty, w, h } = blockTileRect(this.layout.width, index);
    return this.scene.add
      .rectangle((tx + w / 2) * TILE, (ty + h / 2) * TILE, w * TILE, h * TILE)
      .setStrokeStyle(STROKE_WIDTH, color)
      .setDepth(LAYOUT_GHOST_DEPTH);
  }
}
