/**
 * Phaser layer of the decor editor (#208): while a piece is picked it draws
 * a translucent ghost of it on the tile under the pointer, turned the way the
 * brush is, with its footprint outlined (red where the room would refuse
 * it), and turns a primary click into a `decorpick` of that tile. With the
 * eraser it outlines the item a click would remove. The R key (Shift+R back)
 * turns a picked chair or desk table through `decorrotate`, and so does
 * the mouse wheel (#207: one notch a quarter turn, down forward, up back,
 * while `CameraZoomLayer` leaves the wheel alone through `holdsWheel`), so
 * the brush turns without reaching for the sidebar, which steps aside while
 * a piece is picked. Same split as `TerrainEditLayer`: the layer draws and reports
 * pointer facts, React decides. Pending edits are not drawn here: they are
 * the decor layer's, which the scene owns.
 */

import Phaser from 'phaser';
import { decorBrushTarget, decorPlacementAllowed, sameDecorBrush, type DecorEditCommand, type DecorGround } from './decorEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { isEditableElementFocused } from './inputFocusGuard';
import { TILE } from './mapData';
import { INITIAL_WHEEL_STATE, ROTATE_WHEEL_RULES, accumulateWheel, type WheelState } from './mapZoom';
import type { OfficeBridge } from './officeBridge';
import { isRotatable, type DecorItem, type DecorPieceInfo } from './officeDecor';

export const DECOR_HOVER_NAME = 'decor-edit:hover';
export const DECOR_GHOST_NAME = 'decor-edit:ghost';
export const DECOR_VALID_COLOR = 0x38bdf8;
export const DECOR_INVALID_COLOR = 0xef4444;
/** See-through enough to show what is under it, solid enough to read the piece. */
export const DECOR_GHOST_ALPHA = 0.6;
const STROKE_WIDTH = 3;

export interface DecorEditLayerDeps {
  /** The map in tiles. */
  readonly width: number;
  readonly height: number;
  /** The layer as this person sees it: the live items with the pending edits applied. */
  items(): readonly DecorItem[];
  infoOf(piece: string): DecorPieceInfo | null;
  /** The live terrain the ghost is judged on. */
  ground(): DecorGround;
  /** Draws one item the way the decor layer would (the scene's drawing); the layer makes it a ghost. */
  drawPiece(item: DecorItem): Phaser.GameObjects.GameObject[];
  /** Clock for wheel accumulation; injectable so tests do not wait on real time. */
  now?: () => number;
}

export class DecorEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private readonly deps: DecorEditLayerDeps;
  private readonly now: () => number;
  private command: DecorEditCommand | null = null;
  private hover: Phaser.GameObjects.Rectangle | null = null;
  private ghost: Phaser.GameObjects.GameObject[] = [];
  /** The tile the ghost stands on, or `null` while the pointer is off the map. */
  private tile: number | null = null;
  /** What the ghost was drawn for, so a pointer move inside the same tile draws nothing new. */
  private drawnKey = '';
  private wheelState: WheelState = INITIAL_WHEEL_STATE;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.tile = this.tileAt(pointer);
    this.draw();
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.command?.brush == null || pointer.button !== 0) return;
    const index = this.tileAt(pointer);
    if (index !== null) this.bridge.emit('decorpick', { index });
  };
  private readonly onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number): void => {
    if (!this.holdsWheel()) {
      this.wheelState = INITIAL_WHEEL_STATE;
      return;
    }
    const native = pointer.event as WheelEvent | undefined;
    const { state, step } = accumulateWheel(
      this.wheelState,
      { deltaY, deltaMode: native?.deltaMode ?? 0, ctrlKey: native?.ctrlKey ?? false, now: this.now() },
      ROTATE_WHEEL_RULES,
    );
    this.wheelState = state;
    // `accumulateWheel` signs like the zoom (up is 1): turning down goes forward.
    if (step !== 0) this.bridge.emit('decorrotate', { step: step === -1 ? 1 : -1 });
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.holdsWheel()) return;
    if (event.key.toLowerCase() !== 'r' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableElementFocused()) return;
    this.bridge.emit('decorrotate', { step: event.shiftKey ? -1 : 1 });
  };

  constructor(scene: Phaser.Scene, bridge: OfficeBridge, deps: DecorEditLayerDeps) {
    this.scene = scene;
    this.bridge = bridge;
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.unsubscribeCommand = bridge.onCommand('decoredit', (command) => this.applyCommand(command));
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.on('wheel', this.onWheel);
    window.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    this.applyCommand(null);
  }

  /**
   * Whether the wheel turns the brush instead of zooming: a chair or a desk
   * table is picked. Plants, room tables and the eraser have nothing to turn.
   */
  holdsWheel(): boolean {
    const brush = this.command?.brush;
    return brush?.kind === 'piece' && isRotatable(brush.info.kind);
  }

  /** Judges and draws the ghost again: the layer or the terrain under it changed. */
  refresh(): void {
    this.drawnKey = '';
    this.draw();
  }

  private tileAt(pointer: Phaser.Input.Pointer): number | null {
    const tx = Math.floor(pointer.worldX / TILE);
    const ty = Math.floor(pointer.worldY / TILE);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx >= this.deps.width || ty >= this.deps.height) return null;
    return ty * this.deps.width + tx;
  }

  private applyCommand(command: DecorEditCommand | null): void {
    const redraw = !sameDecorBrush(command?.brush, this.command?.brush) || JSON.stringify(command?.area) !== JSON.stringify(this.command?.area);
    this.command = command;
    if (command === null) {
      this.clearGhost();
      this.hover?.destroy();
      this.hover = null;
      this.drawnKey = '';
      return;
    }
    // A new preview moves what the ghost is judged against, so it is judged again too.
    this.drawnKey = redraw ? '' : this.drawnKey;
    if (redraw || command.preview !== undefined) this.refresh();
  }

  private clearGhost(): void {
    for (const object of this.ghost) object.destroy();
    this.ghost = [];
  }

  private draw(): void {
    const brush = this.command?.brush ?? null;
    if (brush === null || this.tile === null) {
      this.clearGhost();
      this.hover?.setVisible(false);
      this.drawnKey = '';
      return;
    }
    const key = `${this.tile}|${JSON.stringify(brush)}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;

    const { width } = this.deps;
    const items = this.deps.items();
    const infoOf = (piece: string): DecorPieceInfo | null => this.deps.infoOf(piece);
    const target = decorBrushTarget(items, infoOf, width, this.tile, brush) ?? { x: this.tile % width, y: Math.floor(this.tile / width), w: 1, h: 1 };
    const allowed = decorPlacementAllowed(items, infoOf, this.deps.ground(), this.command?.area ?? null, this.tile, brush);

    this.clearGhost();
    if (brush.kind === 'piece') {
      this.ghost = this.deps.drawPiece({ index: this.tile, piece: brush.piece, rotation: brush.rotation });
      for (const object of this.ghost) {
        const shown = object as unknown as Phaser.GameObjects.Components.Alpha & Phaser.GameObjects.Components.Depth;
        // A chair's two layers keep their order: the front one stays over the back one.
        shown.setDepth?.(LAYOUT_GHOST_DEPTH + (shown.depth % 1));
        shown.setAlpha?.(DECOR_GHOST_ALPHA);
        object.setName(DECOR_GHOST_NAME);
      }
    }

    this.hover ??= this.scene.add.rectangle(0, 0, TILE, TILE).setFillStyle().setDepth(LAYOUT_GHOST_DEPTH + 1).setName(DECOR_HOVER_NAME);
    this.hover
      .setSize(target.w * TILE, target.h * TILE)
      .setStrokeStyle(STROKE_WIDTH, allowed ? DECOR_VALID_COLOR : DECOR_INVALID_COLOR)
      .setPosition((target.x + target.w / 2) * TILE, (target.y + target.h / 2) * TILE)
      .setVisible(true);
  }
}
