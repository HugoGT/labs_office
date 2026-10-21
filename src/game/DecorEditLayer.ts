/**
 * Phaser layer of the decor editor (#208): while a piece is picked it draws
 * a translucent ghost of it on the tile under the pointer, turned the way the
 * brush is, with its footprint outlined (red where the room would refuse
 * it), and turns a primary click into a `decorpick` of that tile. The R key
 * (Shift+R back) turns a picked chair, desk table or room table through
 * `decorrotate`, and so does
 * the mouse wheel (#207: one notch a quarter turn, down forward, up back,
 * while `CameraZoomLayer` leaves the wheel alone through `holdsWheel`), so
 * the brush turns without reaching for the sidebar, which steps aside while
 * a piece is picked. Same split as `TerrainEditLayer`: the layer draws and reports
 * pointer facts, React decides. Pending edits are not drawn here: they are
 * the decor layer's, which the scene owns.
 *
 * With nothing picked, a click (a release within `PAN_THRESHOLD_PX` of its
 * primary press, on the main camera) reports `decorselect` with the item
 * under it (`decorPickAt`, inside the command's area) or `null`. The
 * selected item (`command.selected`) is outlined, with a move button (four
 * arrows) and a red trash button under it, kept a fixed size on screen at
 * any zoom; a click on them reports `decormove` or `decordelete` instead of
 * selecting. Clicks act on the release, so a drag of the view selects
 * nothing, and a press that placed a piece never selects on its release.
 */

import Phaser from 'phaser';
import { PAN_THRESHOLD_PX } from './cameraPan';
import { decorBrushTarget, decorPickAt, decorPlacementAllowed, sameDecorBrush, type DecorEditCommand, type DecorGround } from './decorEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { isEditableElementFocused } from './inputFocusGuard';
import { TILE } from './mapData';
import { INITIAL_WHEEL_STATE, ROTATE_WHEEL_RULES, accumulateWheel, type WheelState } from './mapZoom';
import type { OfficeBridge } from './officeBridge';
import { decorFootprint, isRotatable, type DecorItem, type DecorPieceInfo, type DecorTileRect } from './officeDecor';

export const DECOR_HOVER_NAME = 'decor-edit:hover';
export const DECOR_GHOST_NAME = 'decor-edit:ghost';
export const DECOR_VALID_COLOR = 0x38bdf8;
export const DECOR_INVALID_COLOR = 0xef4444;
/** See-through enough to show what is under it, solid enough to read the piece. */
export const DECOR_GHOST_ALPHA = 0.6;
const STROKE_WIDTH = 3;
export const DECOR_SELECTION_NAME = 'decor-edit:selection';
export const DECOR_MOVE_BUTTON_NAME = 'decor-edit:move';
export const DECOR_DELETE_BUTTON_NAME = 'decor-edit:delete';
export const DECOR_SELECTION_COLOR = DECOR_VALID_COLOR;
export const DECOR_DELETE_COLOR = 0xdc2626;
const DECOR_MOVE_COLOR = 0x1f2937;
const DECOR_ICON_COLOR = 0xffffff;
/** Side of each button on screen: big enough to hit at any zoom, small next to a chair at 2x. */
export const DECOR_BUTTON_PX = 24;
/** Screen gap between the footprint and the buttons, and between the two buttons. */
const BUTTON_GAP_PX = 4;

type SelectionAction = 'move' | 'delete';

interface SelectionButton {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Graphics;
}

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
  private selection: Phaser.GameObjects.Rectangle | null = null;
  private buttons: Record<SelectionAction, SelectionButton> | null = null;
  /** The anchor the outline and buttons stand for, or `null` while none are shown. */
  private shownSelection: number | null = null;
  /** The camera zoom the buttons were sized for: a new zoom resizes them. */
  private buttonZoom = 1;
  /** Whether the press now down began with nothing picked, so its release may select. */
  private pressSelects = false;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.tile = this.tileAt(pointer);
    this.draw();
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.pressSelects = this.command != null && this.command.brush === null && pointer.button === 0 && this.onMainCamera(pointer);
    if (this.command?.brush == null || pointer.button !== 0) return;
    const index = this.tileAt(pointer);
    if (index !== null) this.bridge.emit('decorpick', { index });
  };
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    const pressed = this.pressSelects;
    this.pressSelects = false;
    const command = this.command;
    if (!pressed || command == null || command.brush !== null || pointer.button !== 0 || !this.onMainCamera(pointer)) return;
    // A drag of the view is not a click.
    if ((pointer.getDistance?.() ?? 0) > PAN_THRESHOLD_PX) return;
    const action = this.buttonAt(pointer);
    if (action !== null && this.shownSelection !== null) {
      this.bridge.emit(action === 'move' ? 'decormove' : 'decordelete', { index: this.shownSelection });
      return;
    }
    const tile = this.tileAt(pointer);
    const picked = tile === null ? null : decorPickAt(this.deps.items(), (piece) => this.deps.infoOf(piece), this.deps.width, tile, command.area);
    this.bridge.emit('decorselect', { index: picked?.index ?? null });
  };
  /** The buttons keep their screen size: a zoom step resizes them on the next frame. */
  private readonly onPostUpdate = (): void => {
    if (this.shownSelection !== null && this.scene.cameras.main.zoom !== this.buttonZoom) this.drawSelection();
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
    scene.input.on('pointerup', this.onPointerUp);
    scene.input.on('wheel', this.onWheel);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
    window.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('wheel', this.onWheel);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
    window.removeEventListener('keydown', this.onKeyDown);
    this.applyCommand(null);
    this.selection?.destroy();
    this.selection = null;
    if (this.buttons !== null) for (const button of Object.values(this.buttons)) {
      button.background.destroy();
      button.icon.destroy();
    }
    this.buttons = null;
  }

  /**
   * Whether the wheel turns the brush instead of zooming: a chair, a desk
   * table or a room table is picked. A plant has nothing to turn.
   */
  holdsWheel(): boolean {
    const brush = this.command?.brush;
    return brush != null && isRotatable(brush.info.kind);
  }

  /** Judges and draws the ghost again, and the selection: the layer or the terrain under it changed. */
  refresh(): void {
    this.drawnKey = '';
    this.draw();
    this.drawSelection();
  }

  private onMainCamera(pointer: Phaser.Input.Pointer): boolean {
    // Over the minimap a click is navigation (`CameraPanLayer`), never a pick.
    return pointer.camera == null || pointer.camera === this.scene.cameras.main;
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
    this.drawSelection();
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
    const target = decorBrushTarget(this.tile, brush, width);
    const allowed = decorPlacementAllowed(items, infoOf, this.deps.ground(), this.command?.area ?? null, this.tile, brush);

    this.clearGhost();
    // The ghost is the piece as it would stand, painted color included.
    this.ghost = this.deps.drawPiece({ index: this.tile, piece: brush.piece, rotation: brush.rotation, ...(brush.color === undefined ? {} : { color: brush.color }) });
    for (const object of this.ghost) {
      const shown = object as unknown as Phaser.GameObjects.Components.Alpha & Phaser.GameObjects.Components.Depth;
      // A chair's two layers keep their order: the front one stays over the back one.
      shown.setDepth?.(LAYOUT_GHOST_DEPTH + (shown.depth % 1));
      shown.setAlpha?.(DECOR_GHOST_ALPHA);
      object.setName(DECOR_GHOST_NAME);
    }

    this.hover ??= this.scene.add.rectangle(0, 0, TILE, TILE).setFillStyle().setDepth(LAYOUT_GHOST_DEPTH + 1).setName(DECOR_HOVER_NAME);
    this.hover
      .setSize(target.w * TILE, target.h * TILE)
      .setStrokeStyle(STROKE_WIDTH, allowed ? DECOR_VALID_COLOR : DECOR_INVALID_COLOR)
      .setPosition((target.x + target.w / 2) * TILE, (target.y + target.h / 2) * TILE)
      .setVisible(true);
  }

  /** The selected item, if it is still on the layer and nothing is picked; `null` otherwise. */
  private selectedFootprint(): { index: number; rect: DecorTileRect } | null {
    const command = this.command;
    const index = command?.selected ?? null;
    if (command == null || command.brush !== null || index === null) return null;
    const item = this.deps.items().find((candidate) => candidate.index === index);
    if (item === undefined) return null;
    return { index, rect: decorFootprint(item, this.deps.infoOf(item.piece), this.deps.width) };
  }

  /** Outlines the selected item and puts its two buttons under it (over it at the map's bottom edge). */
  private drawSelection(): void {
    const selected = this.selectedFootprint();
    this.shownSelection = selected?.index ?? null;
    if (selected === null) {
      this.selection?.setVisible(false);
      if (this.buttons !== null) for (const button of Object.values(this.buttons)) {
        button.background.setVisible(false);
        button.icon.setVisible(false);
      }
      return;
    }
    const { rect } = selected;
    this.selection ??= this.scene.add.rectangle(0, 0, TILE, TILE).setFillStyle().setDepth(LAYOUT_GHOST_DEPTH + 1).setName(DECOR_SELECTION_NAME);
    this.selection
      .setSize(rect.w * TILE, rect.h * TILE)
      .setStrokeStyle(STROKE_WIDTH, DECOR_SELECTION_COLOR)
      .setPosition((rect.x + rect.w / 2) * TILE, (rect.y + rect.h / 2) * TILE)
      .setVisible(true);

    const zoom = this.scene.cameras.main.zoom || 1;
    this.buttonZoom = zoom;
    const size = DECOR_BUTTON_PX / zoom;
    const gap = BUTTON_GAP_PX / zoom;
    const below = rect.y + rect.h < this.deps.height;
    const centerY = below ? (rect.y + rect.h) * TILE + gap + size / 2 : rect.y * TILE - gap - size / 2;
    const centerX = (rect.x + rect.w / 2) * TILE;
    const offset = (size + gap) / 2;
    this.buttons ??= { move: this.makeButton('move'), delete: this.makeButton('delete') };
    for (const [action, x] of [['move', centerX - offset], ['delete', centerX + offset]] as const) {
      const { background, icon } = this.buttons[action];
      background.setScale(1 / zoom).setPosition(x, centerY).setVisible(true);
      icon.setScale(1 / zoom).setPosition(x, centerY).setVisible(true);
    }
  }

  /** A button drawn at its screen size around (0, 0); `drawSelection` scales and places it. */
  private makeButton(action: SelectionAction): SelectionButton {
    const depth = LAYOUT_GHOST_DEPTH + 2;
    const background = this.scene.add
      .rectangle(0, 0, DECOR_BUTTON_PX, DECOR_BUTTON_PX, action === 'move' ? DECOR_MOVE_COLOR : DECOR_DELETE_COLOR)
      .setStrokeStyle(1, DECOR_ICON_COLOR, 0.6)
      .setDepth(depth)
      .setName(action === 'move' ? DECOR_MOVE_BUTTON_NAME : DECOR_DELETE_BUTTON_NAME);
    const icon = this.scene.add.graphics().setDepth(depth + 0.5).setName(`${background.name}:icon`);
    icon.lineStyle(2, DECOR_ICON_COLOR, 1);
    icon.fillStyle(DECOR_ICON_COLOR, 1);
    if (action === 'move') drawMoveIcon(icon);
    else drawTrashIcon(icon);
    return { background, icon };
  }

  /** Which button, if any, the pointer is on. */
  private buttonAt(pointer: Phaser.Input.Pointer): SelectionAction | null {
    if (this.buttons === null || this.shownSelection === null) return null;
    for (const action of ['move', 'delete'] as const) {
      const { background } = this.buttons[action];
      if (background.visible && background.getBounds().contains(pointer.worldX, pointer.worldY)) return action;
    }
    return null;
  }
}

/** Four arrows out of the middle, like a "move" cursor. */
function drawMoveIcon(icon: Phaser.GameObjects.Graphics): void {
  const reach = 8;
  const head = 3;
  icon.lineBetween(-reach + 1, 0, reach - 1, 0);
  icon.lineBetween(0, -reach + 1, 0, reach - 1);
  icon.fillTriangle(0, -reach - 1, -head, -reach + head, head, -reach + head);
  icon.fillTriangle(0, reach + 1, -head, reach - head, head, reach - head);
  icon.fillTriangle(-reach - 1, 0, -reach + head, -head, -reach + head, head);
  icon.fillTriangle(reach + 1, 0, reach - head, -head, reach - head, head);
}

/** A trash can: lid with its handle, and the can with two ribs. */
function drawTrashIcon(icon: Phaser.GameObjects.Graphics): void {
  icon.lineBetween(-7, -5, 7, -5);
  icon.strokeRect(-2, -8, 4, 3);
  icon.strokeRect(-5, -3, 10, 11);
  icon.lineBetween(-1.5, -1, -1.5, 6);
  icon.lineBetween(1.5, -1, 1.5, 6);
}
