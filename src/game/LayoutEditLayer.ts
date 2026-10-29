/**
 * Capa Phaser del editor de layout (#74, PR3b). Dibuja los overlays del
 * comando `layoutedit` (contornos pickable, ghost de colocacion) y traduce
 * input real a `layoutpick`/`layoutplace` -- misma regla que el resto del
 * juego: la capa/escena solo dibuja y reporta hechos de puntero, React (el
 * reductor de `layoutEditor.ts`) decide.
 *
 * Sin `zone.pointerdown` para confirmar la colocacion: un clic de
 * confirmacion puede caer en CUALQUIER tile, no solo sobre un rectangulo
 * pickable existente, asi que se escucha el `pointerdown` global de la
 * escena, mismo punto de enganche que ya usa `OfficeScene` para
 * `closemenu`.
 *
 * The selected desk or room is outlined, with the decor editor's move and
 * trash buttons under it (`SelectionButtons`); a click on them reports
 * `layoutaction` instead of picking what lies under them, and a click on the
 * empty map lets the selection go. Like the decor editor, those act on the
 * release, so a drag of the view does nothing.
 */

import Phaser from 'phaser';
import { PAN_THRESHOLD_PX } from './cameraPan';
import {
  isPlacementValid,
  snapToTile,
  snapToBlock,
  type LayoutEditCommand,
  type PickableRect,
} from './layoutEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { MAP_H, TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';
import { SelectionButtons, type SelectionAction } from './selectionButtons';
import { LAYOUT_OUTLINE_NAME, drawContextOutlines, drawOutline } from './spaceOutline';

export { LAYOUT_OUTLINE_NAME };

const GHOST_VALID_COLOR = 0x22c55e;
const GHOST_INVALID_COLOR = 0xef4444;
const GHOST_ALPHA = 0.35;
const SELECTION_COLOR = 0x38bdf8;
const SELECTION_STROKE_WIDTH = 3;
export const LAYOUT_SELECTION_NAME = 'layout-edit:selection';
export const LAYOUT_MOVE_BUTTON_NAME = 'layout-edit:move';
export const LAYOUT_DELETE_BUTTON_NAME = 'layout-edit:delete';

/** Nombre Phaser del contorno pickable de un item, para volver a encontrarlo (mismo idioma que `deskZoneName`). */
export function layoutPickName(id: string): string {
  return `layout-pick:${id}`;
}

export class LayoutEditLayer {
  private readonly scene: Phaser.Scene;
  private readonly bridge: OfficeBridge;
  private command: LayoutEditCommand | null = null;
  private pickableObjects: Phaser.GameObjects.Rectangle[] = [];
  private ghost: Phaser.GameObjects.Rectangle | null = null;
  private selection: Phaser.GameObjects.Rectangle | null = null;
  private readonly buttons: SelectionButtons;
  /** The selected rectangle the outline and buttons stand for, or `null` while none are shown. */
  private shownSelection: PickableRect | null = null;
  /** Set by a pickable's own press, which Phaser reports before the scene's. */
  private pressPicked = false;
  /** What the release of the press now down does, decided on the press: the selection changes in between. */
  private pressAct: { id: string; action: SelectionAction | 'deselect' } | null = null;

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.updateGhost(pointer);
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    const picked = this.pressPicked;
    this.pressPicked = false;
    this.pressAct = null;
    const shown = this.shownSelection;
    if (shown !== null && pointer.button === 0 && this.onMainCamera(pointer)) {
      const action = this.buttons.at(pointer);
      if (action !== null) this.pressAct = { id: shown.id, action };
      else if (!picked) this.pressAct = { id: shown.id, action: 'deselect' };
    }
    this.confirmPlacement(pointer);
  };
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    const act = this.pressAct;
    this.pressAct = null;
    if (act === null || pointer.button !== 0) return;
    // A drag of the view is not a click.
    if ((pointer.getDistance?.() ?? 0) > PAN_THRESHOLD_PX) return;
    this.bridge.emit('layoutaction', act);
  };
  /** The buttons keep their screen size: a zoom step resizes them on the next frame. */
  private readonly onPostUpdate = (): void => {
    if (this.shownSelection !== null && this.scene.cameras.main.zoom !== this.buttons.zoom) this.drawSelection();
  };

  constructor(scene: Phaser.Scene, bridge: OfficeBridge) {
    this.scene = scene;
    this.bridge = bridge;
    this.buttons = new SelectionButtons(scene, { move: LAYOUT_MOVE_BUTTON_NAME, delete: LAYOUT_DELETE_BUTTON_NAME });

    this.unsubscribeCommand = bridge.onCommand('layoutedit', (command) => this.applyCommand(command));
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.on('pointerup', this.onPointerUp);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
  }

  /** Simetrico con el `SHUTDOWN` de `OfficeScene`: se llama en el mismo momento que el resto de desuscripciones. */
  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
    this.clearPickable();
    this.ghost?.destroy();
    this.ghost = null;
    this.selection?.destroy();
    this.selection = null;
    this.buttons.destroy();
  }

  private applyCommand(command: LayoutEditCommand | null): void {
    this.command = command;
    this.clearPickable();
    this.ghost?.destroy();
    this.ghost = null;
    this.drawSelection();

    if (command === null) return;

    this.pickableObjects.push(...drawContextOutlines(this.scene, command.outlines ?? []));
    for (const rect of command.pickable) this.drawPickable(rect);

    if (command.placing) {
      // Sin color de relleno todavia: `updateGhost` lo fija en cuanto llega
      // el primer `pointermove`, y hasta entonces esta oculto.
      this.ghost = this.scene.add
        .rectangle(0, 0, command.placing.w * TILE, command.placing.h * TILE)
        .setDepth(LAYOUT_GHOST_DEPTH)
        .setVisible(false);
    }
  }

  private drawPickable(rect: PickableRect): void {
    const zone = drawOutline(this.scene, rect).setName(layoutPickName(rect.id)).setInteractive();

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Mismo `stopPropagation` que el clic de un escritorio: sin el, el
      // `pointerdown` global de esta misma capa lo tomaria TAMBIEN como
      // confirmacion de colocacion.
      pointer.event.stopPropagation();
      // A press on a selection button is the button's, whatever lies under it.
      if (this.shownSelection !== null && this.buttons.at(pointer) !== null) return;
      this.pressPicked = true;
      this.bridge.emit('layoutpick', { id: rect.id });
    });

    this.pickableObjects.push(zone);
  }

  /** Outlines the selected rectangle and puts its two buttons under it (over it at the map's bottom edge). */
  private drawSelection(): void {
    const command = this.command;
    const rect = command === null || command.placing !== null ? undefined : command.pickable.find((item) => item.id === command.selectedId);
    this.shownSelection = rect ?? null;
    if (rect === undefined) {
      this.selection?.setVisible(false);
      this.buttons.hide();
      return;
    }
    const w = rect.x1 - rect.x0 + 1;
    const h = rect.y1 - rect.y0 + 1;
    this.selection ??= this.scene.add.rectangle(0, 0, TILE, TILE).setFillStyle().setDepth(LAYOUT_GHOST_DEPTH + 1).setName(LAYOUT_SELECTION_NAME);
    this.selection
      .setSize(w * TILE, h * TILE)
      .setStrokeStyle(SELECTION_STROKE_WIDTH, SELECTION_COLOR)
      .setPosition((rect.x0 + w / 2) * TILE, (rect.y0 + h / 2) * TILE)
      .setVisible(true);
    this.buttons.show({ x: rect.x0, y: rect.y0, w, h }, MAP_H);
  }

  private onMainCamera(pointer: Phaser.Input.Pointer): boolean {
    // Over the minimap a click is navigation (`CameraPanLayer`), never a pick.
    return pointer.camera == null || pointer.camera === this.scene.cameras.main;
  }

  private clearPickable(): void {
    for (const object of this.pickableObjects.splice(0)) object.destroy();
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    if (!this.command?.placing || !this.ghost) return;

    const { w, h, obstacles } = this.command.placing;
    const { tx, ty } = this.command.placing.snap === 'block' ? snapToBlock(pointer.worldX, pointer.worldY) : snapToTile(pointer.worldX, pointer.worldY, w, h);
    const valid = isPlacementValid({ x: tx, y: ty, w, h }, obstacles);

    this.ghost
      .setPosition(tx * TILE + (w * TILE) / 2, ty * TILE + (h * TILE) / 2)
      .setFillStyle(valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR, GHOST_ALPHA)
      .setVisible(true);
  }

  private confirmPlacement(pointer: Phaser.Input.Pointer): void {
    if (!this.command?.placing) return;

    const { w, h, obstacles } = this.command.placing;
    const { tx, ty } = this.command.placing.snap === 'block' ? snapToBlock(pointer.worldX, pointer.worldY) : snapToTile(pointer.worldX, pointer.worldY, w, h);
    const valid = isPlacementValid({ x: tx, y: ty, w, h }, obstacles);

    this.bridge.emit('layoutplace', { tx, ty, valid });
  }
}
