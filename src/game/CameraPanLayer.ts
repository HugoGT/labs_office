/**
 * Capa Phaser del pan de camara (#53). Traduce input real de puntero a
 * `reduceCameraPan` (puro, sin Phaser) y aplica el efecto devuelto sobre UNA
 * sola camara -- nunca el minimapa. Mismo patron que `LayoutEditLayer`: la
 * capa solo escucha y dibuja/mueve, el reductor decide.
 *
 * `pointerup` en el canvas y `pointerupoutside` (soltar fuera de el)
 * terminan el pan igual -- ninguno de los dos necesita coordenadas.
 */

import Phaser from 'phaser';
import { reduceCameraPan, type CameraPanEffect, type CameraPanState } from './cameraPan';

export interface CameraPanLayerOptions {
  scene: Phaser.Scene;
  camera: Phaser.Cameras.Scene2D.Camera;
  target: Phaser.GameObjects.GameObject;
  lerp: number;
  /** Verdadero mientras el pan debe quedar desarmado (editor de layout activo). */
  isSuspended: () => boolean;
}

export class CameraPanLayer {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly target: Phaser.GameObjects.GameObject;
  private readonly lerp: number;
  private readonly isSuspended: () => boolean;
  private state: CameraPanState = { kind: 'idle' };

  private readonly onPointerDown = (
    pointer: Phaser.Input.Pointer,
    currentlyOver: Phaser.GameObjects.GameObject[],
  ): void => {
    // Mismo criterio que `closemenu` (OfficeScene.setupInput) para el clic
    // izquierdo sobre mapa vacio, mas dos guardas propias de este gesto:
    // nunca sobre la camara del minimapa, nunca editando layout.
    const eligible =
      pointer.button === 0 &&
      (!currentlyOver || currentlyOver.length === 0) &&
      pointer.camera === this.camera &&
      !this.isSuspended();
    this.dispatch({ kind: 'down', x: pointer.x, y: pointer.y, eligible });
  };

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.dispatch({ kind: 'move', x: pointer.x, y: pointer.y });
  };

  private readonly onPointerUp = (): void => {
    this.dispatch({ kind: 'up' });
  };

  constructor(options: CameraPanLayerOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.target = options.target;
    this.lerp = options.lerp;
    this.isSuspended = options.isSuspended;

    this.scene.input.on('pointerdown', this.onPointerDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
    this.scene.input.on('pointerupoutside', this.onPointerUp);
  }

  /** Simetrico con el `SHUTDOWN` de `OfficeScene`: mismo momento que `layoutEditLayer.destroy()`. */
  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUp);
  }

  private dispatch(event: Parameters<typeof reduceCameraPan>[1]): void {
    const { state, effect } = reduceCameraPan(this.state, event);
    this.state = state;
    this.applyEffect(effect);
  }

  private applyEffect(effect: CameraPanEffect): void {
    switch (effect.kind) {
      case 'none':
        return;

      case 'beginPan':
        this.camera.stopFollow();
        this.scroll(effect.dx, effect.dy);
        return;

      case 'scroll':
        this.scroll(effect.dx, effect.dy);
        return;

      case 'resumeFollow': {
        // `startFollow` salta el scroll de golpe (Camera.js): guardar y
        // reponerlo deja el `preRender` de cada cuadro como unico que lo
        // mueve, a `this.lerp` por cuadro -- el "glide" de vuelta, sin tween
        // aparte.
        const savedX = this.camera.scrollX;
        const savedY = this.camera.scrollY;
        this.camera.startFollow(this.target, true, this.lerp, this.lerp);
        this.camera.setScroll(savedX, savedY);
        return;
      }
    }
  }

  /** El clamp de los bounds de la camara lo escribe `preRender` de vuelta: no hace falta aplicarlo aqui. */
  private scroll(dx: number, dy: number): void {
    this.camera.scrollX -= dx / this.camera.zoom;
    this.camera.scrollY -= dy / this.camera.zoom;
  }
}
