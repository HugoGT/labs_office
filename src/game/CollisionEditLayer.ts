/**
 * Phaser layer of the collision editor. Same split as `TerrainEditLayer`: the
 * layer draws and turns pointer input into facts (`collisionpick`,
 * `collisiondraft`), React owns the draft and decides what to save.
 *
 * While the editor is open it draws the draft of the selected piece over
 * every instance of that piece, every other collision rectangle faintly, and
 * handles on the selected rectangle of the instance that was clicked. A click
 * picks a piece (or selects one of its rectangles), a drag inside a rectangle
 * moves it, a drag from its edge or corner resizes it, and a drag anywhere
 * else draws a new one. The debug view (`collisiondebug`) outlines every
 * rectangle of the office, open or not.
 *
 * Drawn with one `Graphics` object, not one rectangle per collision: the
 * debug view shows a few hundred of them.
 */

import Phaser from 'phaser';
import { dragRect, hitRect, rectFromDrag, type CollisionEditCommand, type RectHandle } from './collisionEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import type { OfficeBridge } from './officeBridge';
import {
  MAX_COLLISION_RECTS,
  collisionWorld,
  pickInstance,
  pieceRectsOf,
  toPiecePoint,
  worldRectsOf,
  type CollisionInstance,
  type CollisionPoint,
  type CollisionRect,
  type CollisionTable,
} from './pieceCollisions';

export const COLLISION_EDIT_GRAPHICS_NAME = 'collision-edit:graphics';

/** Where the layer reads the live collisions from: the scene, which follows the room and the desks. */
export interface CollisionSource {
  instances(): readonly CollisionInstance[];
  table(): CollisionTable;
}

/** World pixels around an edge that grab it instead of the inside. */
const HANDLE_PX = 3;
/** World pixels a press must travel before it is a drag rather than a click. */
const DRAG_PX = 4;
const HANDLE_SIZE = 4;

const FAINT_COLOR = 0xe5e7eb;
const FAINT_ALPHA = 0.55;
const DEBUG_COLOR = 0xef4444;
const PIECE_COLOR = 0xfacc15;
const SELECTED_COLOR = 0x38bdf8;

type Drag =
  | { kind: 'edit'; index: number; handle: RectHandle; start: CollisionPoint; original: CollisionRect }
  | { kind: 'pending'; startWorld: CollisionPoint; startPiece: CollisionPoint | null }
  | { kind: 'draw'; startPiece: CollisionPoint; rect: CollisionRect | null };

export class CollisionEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private readonly source: CollisionSource;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private command: CollisionEditCommand | null = null;
  private debug = false;
  /** The instance that was clicked: rectangles are edited in its space and get handles on it. */
  private primary: CollisionInstance | null = null;
  /** The draft as the current drag leaves it, before React hears about it on release. */
  private draft: CollisionRect[] = [];
  private selectedRect: number | null = null;
  private drag: Drag | null = null;
  private lastDrawing: { faint: CollisionRect[]; piece: CollisionRect[]; selected: CollisionRect | null } = { faint: [], piece: [], selected: null };

  private readonly unsubscribeCommand: () => void;
  private readonly unsubscribeDebug: () => void;
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => this.pointerDown(pointer);
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => this.pointerMove(pointer);
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => this.pointerUp(pointer);

  constructor(scene: Phaser.Scene, bridge: OfficeBridge, source: CollisionSource) {
    this.scene = scene;
    this.bridge = bridge;
    this.source = source;
    this.graphics = scene.add.graphics().setDepth(LAYOUT_GHOST_DEPTH).setName(COLLISION_EDIT_GRAPHICS_NAME);
    this.unsubscribeCommand = bridge.onCommand('collisionedit', (command) => this.applyCommand(command));
    this.unsubscribeDebug = bridge.onCommand('collisiondebug', ({ show }) => {
      this.debug = show;
      this.redraw();
    });
    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerup', this.onPointerUp);
  }

  /** What the last redraw outlined, in world pixels. Read by tests. */
  get drawing(): { faint: CollisionRect[]; piece: CollisionRect[]; selected: CollisionRect | null } {
    return this.lastDrawing;
  }

  /** The live table or the placed pieces changed: find the clicked instance again and redraw. */
  refresh(): void {
    if (this.primary !== null) {
      const { piece, pivot } = this.primary;
      const instances = this.source.instances().filter((instance) => instance.piece === piece);
      this.primary = instances.find((instance) => instance.pivot.x === pivot.x && instance.pivot.y === pivot.y) ?? instances[0] ?? null;
    }
    this.redraw();
  }

  destroy(): void {
    this.unsubscribeCommand();
    this.unsubscribeDebug();
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.graphics.destroy();
  }

  private applyCommand(command: CollisionEditCommand | null): void {
    this.command = command;
    this.drag = null;
    if (command === null || command.pieceId === null || command.pieceId !== this.primary?.piece) this.primary = null;
    this.draft = command === null ? [] : [...command.draft];
    this.selectedRect = command?.selectedRect ?? null;
    this.redraw();
  }

  /** The draft as shown: with the rectangle being drawn, if any, as the selected one. */
  private shown(): { draft: CollisionRect[]; selectedRect: number | null } {
    if (this.drag?.kind === 'draw' && this.drag.rect !== null) return { draft: [...this.draft, this.drag.rect], selectedRect: this.draft.length };
    return { draft: this.draft, selectedRect: this.selectedRect };
  }

  private redraw(): void {
    const pieceId = this.command?.pieceId ?? null;
    const instances = this.source.instances();
    const showFaint = this.command !== null || this.debug;
    const others = pieceId === null ? instances : instances.filter((instance) => instance.piece !== pieceId);
    const faint = showFaint ? collisionWorld(others, this.source.table()).map(({ x, y, w, h }) => ({ x, y, w, h })) : [];
    const shown = this.shown();
    const table = new Map(this.source.table());
    if (pieceId !== null) table.set(pieceId, shown.draft);
    const piece =
      this.command === null || pieceId === null
        ? []
        : instances.filter((instance) => instance.piece === pieceId).flatMap((instance) => worldRectsOf(instance, table));
    const selectedPiece = shown.selectedRect === null ? undefined : shown.draft[shown.selectedRect];
    const selected = this.primary !== null && selectedPiece !== undefined ? worldRectsOf(this.primary, new Map([[this.primary.piece, [selectedPiece]]]))[0]! : null;

    const g = this.graphics.clear();
    g.lineStyle(1, this.command === null ? DEBUG_COLOR : FAINT_COLOR, this.command === null ? 0.9 : FAINT_ALPHA);
    for (const rect of faint) g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    g.lineStyle(2, PIECE_COLOR, 1);
    for (const rect of piece) g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    if (selected !== null) {
      g.lineStyle(2, SELECTED_COLOR, 1);
      g.strokeRect(selected.x, selected.y, selected.w, selected.h);
      g.fillStyle(SELECTED_COLOR, 1);
      for (const [cx, cy] of [
        [selected.x, selected.y],
        [selected.x + selected.w, selected.y],
        [selected.x, selected.y + selected.h],
        [selected.x + selected.w, selected.y + selected.h],
      ] as const) {
        g.fillRect(cx - HANDLE_SIZE / 2, cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }
    }
    this.lastDrawing = { faint, piece, selected };
  }

  private piecePoint(pointer: Phaser.Input.Pointer): CollisionPoint | null {
    return this.primary === null ? null : toPiecePoint(this.primary, { x: pointer.worldX, y: pointer.worldY });
  }

  /** The rectangle and handle under a piece point: the selected rectangle first, then the others from the top. */
  private grab(point: CollisionPoint): { index: number; handle: RectHandle } | null {
    if (this.primary === null) return null;
    const tolerance = HANDLE_PX / Math.min(this.primary.scale.x, this.primary.scale.y);
    const order = this.draft.map((_, index) => index).reverse();
    if (this.selectedRect !== null && this.draft[this.selectedRect] !== undefined) order.unshift(this.selectedRect);
    for (const index of order) {
      const handle = hitRect(this.draft[index]!, point, tolerance);
      // Only the selected rectangle resizes; another one is grabbed whole.
      if (handle !== null) return { index, handle: index === this.selectedRect ? handle : 'move' };
    }
    return null;
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.command === null) return;
    const point = this.piecePoint(pointer);
    const grabbed = point === null ? null : this.grab(point);
    if (point !== null && grabbed !== null) {
      this.drag = { kind: 'edit', ...grabbed, start: point, original: this.draft[grabbed.index]! };
      this.selectedRect = grabbed.index;
      this.redraw();
      return;
    }
    this.drag = { kind: 'pending', startWorld: { x: pointer.worldX, y: pointer.worldY }, startPiece: point };
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (this.command === null || drag === null || !pointer.isDown) return;
    const point = this.piecePoint(pointer);
    const snap = this.command.snap;
    if (drag.kind === 'edit' && point !== null) {
      this.draft[drag.index] = dragRect(drag.original, drag.handle, point.x - drag.start.x, point.y - drag.start.y, snap);
      this.redraw();
      return;
    }
    if (drag.kind === 'pending') {
      const far = Math.hypot(pointer.worldX - drag.startWorld.x, pointer.worldY - drag.startWorld.y) > DRAG_PX;
      if (!far || drag.startPiece === null || this.draft.length >= MAX_COLLISION_RECTS) return;
      this.drag = { kind: 'draw', startPiece: drag.startPiece, rect: null };
    }
    if (this.drag?.kind === 'draw' && point !== null) {
      this.drag.rect = rectFromDrag(this.drag.startPiece, point, snap);
      this.redraw();
    }
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    this.drag = null;
    if (this.command === null || drag === null) return;
    if (drag.kind === 'edit') {
      this.bridge.emit('collisiondraft', { rects: [...this.draft], selectedRect: drag.index });
      return;
    }
    if (drag.kind === 'draw') {
      if (drag.rect === null) return;
      this.bridge.emit('collisiondraft', { rects: [...this.draft, drag.rect], selectedRect: this.draft.length });
      return;
    }
    this.pick({ x: pointer.worldX, y: pointer.worldY });
  }

  /** A click on the map: the piece under it becomes the one edited, in the space of this instance. */
  private pick(point: CollisionPoint): void {
    const table = this.source.table();
    const instance = pickInstance(this.source.instances(), table, point);
    if (instance === null) return;
    this.primary = instance;
    const { rects, saved } = pieceRectsOf(instance, table);
    this.bridge.emit('collisionpick', { pieceId: instance.piece, rects, saved, defaults: pieceRectsOf(instance, new Map()).rects });
  }
}
