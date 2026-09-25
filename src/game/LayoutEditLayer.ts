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
 */

import Phaser from 'phaser';
import {
  isPlacementValid,
  snapToTile,
  type LayoutEditCommand,
  type PickableRect,
} from './layoutEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import type { OfficeBridge } from './officeBridge';

const PICKABLE_STROKE_COLOR = 0x38bdf8;
const PICKABLE_STROKE_WIDTH = 2;
const GHOST_VALID_COLOR = 0x22c55e;
const GHOST_INVALID_COLOR = 0xef4444;
const GHOST_ALPHA = 0.35;

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

  private readonly unsubscribeCommand: () => void;
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.updateGhost(pointer);
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.confirmPlacement(pointer);
  };

  constructor(scene: Phaser.Scene, bridge: OfficeBridge) {
    this.scene = scene;
    this.bridge = bridge;

    this.unsubscribeCommand = bridge.onCommand('layoutedit', (command) => this.applyCommand(command));
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerdown', this.onPointerDown);
  }

  /** Simetrico con el `SHUTDOWN` de `OfficeScene`: se llama en el mismo momento que el resto de desuscripciones. */
  destroy(): void {
    this.unsubscribeCommand();
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.clearPickable();
    this.ghost?.destroy();
    this.ghost = null;
  }

  private applyCommand(command: LayoutEditCommand | null): void {
    this.command = command;
    this.clearPickable();
    this.ghost?.destroy();
    this.ghost = null;

    if (command === null) return;

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
    const w = (rect.x1 - rect.x0 + 1) * TILE;
    const h = (rect.y1 - rect.y0 + 1) * TILE;

    const zone = this.scene.add
      .rectangle(rect.x0 * TILE + w / 2, rect.y0 * TILE + h / 2, w, h)
      .setStrokeStyle(PICKABLE_STROKE_WIDTH, PICKABLE_STROKE_COLOR)
      .setName(layoutPickName(rect.id))
      .setInteractive();

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Mismo `stopPropagation` que el clic de un escritorio: sin el, el
      // `pointerdown` global de esta misma capa lo tomaria TAMBIEN como
      // confirmacion de colocacion.
      pointer.event.stopPropagation();
      this.bridge.emit('layoutpick', { id: rect.id });
    });

    this.pickableObjects.push(zone);
  }

  private clearPickable(): void {
    for (const object of this.pickableObjects.splice(0)) object.destroy();
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    if (!this.command?.placing || !this.ghost) return;

    const { w, h, obstacles } = this.command.placing;
    const { tx, ty } = snapToTile(pointer.worldX, pointer.worldY, w, h);
    const valid = isPlacementValid({ x: tx, y: ty, w, h }, obstacles);

    this.ghost
      .setPosition(tx * TILE + (w * TILE) / 2, ty * TILE + (h * TILE) / 2)
      .setFillStyle(valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR, GHOST_ALPHA)
      .setVisible(true);
  }

  private confirmPlacement(pointer: Phaser.Input.Pointer): void {
    if (!this.command?.placing) return;

    const { w, h, obstacles } = this.command.placing;
    const { tx, ty } = snapToTile(pointer.worldX, pointer.worldY, w, h);
    const valid = isPlacementValid({ x: tx, y: ty, w, h }, obstacles);

    this.bridge.emit('layoutplace', { tx, ty, valid });
  }
}
