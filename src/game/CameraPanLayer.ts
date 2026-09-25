/**
 * Capa Phaser de la navegacion de camara (#53, #98). Traduce input real de
 * puntero a `reduceCameraPan` (puro, sin Phaser) y aplica el efecto devuelto
 * sobre UNA sola camara -- nunca el minimapa. Mismo patron que
 * `LayoutEditLayer`: la capa solo escucha y dibuja/mueve, el reductor decide.
 *
 * `pointerup` en el canvas y `pointerupoutside` (soltar fuera de el)
 * terminan el pan igual -- ninguno de los dos necesita coordenadas.
 *
 * Mientras la camara no sigue al jugador usa `navigationBounds` en vez de los
 * bounds del mundo: con los del mundo, una vista igual o mayor que el mapa no
 * se podia mover (#53). Los del mundo vuelven solo al aterrizar el planeo de
 * regreso, cuando reponerlos ya no provoca un salto.
 */

import Phaser from 'phaser';
import {
  centeredScroll,
  glideStep,
  navigationBounds,
  scrollRange,
  type Rect,
} from './cameraBounds';
import { reduceCameraPan, type CameraPanEffect, type CameraPanState } from './cameraPan';

type FollowTarget = Phaser.GameObjects.GameObject & { x: number; y: number };

export interface CameraPanLayerOptions {
  scene: Phaser.Scene;
  camera: Phaser.Cameras.Scene2D.Camera;
  target: FollowTarget;
  lerp: number;
  /** Los mismos bounds que `setBounds` pone a la camara mientras sigue al jugador. */
  worldBounds: Rect;
  /** Camara del minimapa (#98): un click sobre ella lleva la principal a ese punto. */
  minimap?: Phaser.Cameras.Scene2D.Camera;
  /** Verdadero mientras el pan debe quedar desarmado (editor de layout activo). */
  isSuspended: () => boolean;
}

type Glide = { kind: 'focus'; x: number; y: number } | { kind: 'return' };

export class CameraPanLayer {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly target: FollowTarget;
  private readonly lerp: number;
  private readonly worldBounds: Rect;
  private readonly minimap?: Phaser.Cameras.Scene2D.Camera;
  private readonly isSuspended: () => boolean;
  private state: CameraPanState = { kind: 'idle' };
  /** Verdadero mientras la camara navega sin el jugador (bounds ampliados). */
  private detached = false;
  private glide: Glide | null = null;
  /** Donde estaba el jugador al enfocar desde el minimapa: moverse de ahi devuelve la camara. */
  private focusedFrom: { x: number; y: number } | null = null;

  private readonly onPointerDown = (
    pointer: Phaser.Input.Pointer,
    currentlyOver: Phaser.GameObjects.GameObject[],
  ): void => {
    if (this.minimap && pointer.camera === this.minimap) {
      // Sin exigir `currentlyOver` vacio: en el minimapa un escritorio o un
      // peer mide un par de pixeles y no es un destino de clic razonable.
      if (pointer.button !== 0 || this.isSuspended()) return;
      const point = this.minimap.getWorldPoint(pointer.x, pointer.y);
      const { x, y, width, height } = this.worldBounds;
      this.dispatch({
        kind: 'minimap',
        x: Phaser.Math.Clamp(point.x, x, x + width),
        y: Phaser.Math.Clamp(point.y, y, y + height),
      });
      return;
    }

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

  private readonly onUpdate = (): void => {
    if (
      this.state.kind === 'focused' &&
      this.focusedFrom !== null &&
      (this.target.x !== this.focusedFrom.x || this.target.y !== this.focusedFrom.y)
    ) {
      this.dispatch({ kind: 'playerMoved' });
    }
    // Cada cuadro y no solo al desacoplar: si la ventana cambia de tamano a
    // mitad de la navegacion, los bounds siguen a la vista nueva.
    if (this.detached) this.applyNavigationBounds();
    this.stepGlide();
  };

  constructor(options: CameraPanLayerOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.target = options.target;
    this.lerp = options.lerp;
    this.worldBounds = options.worldBounds;
    this.minimap = options.minimap;
    this.isSuspended = options.isSuspended;

    this.scene.input.on('pointerdown', this.onPointerDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
    this.scene.input.on('pointerupoutside', this.onPointerUp);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
  }

  /** Simetrico con el `SHUTDOWN` de `OfficeScene`: mismo momento que `layoutEditLayer.destroy()`. */
  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUp);
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
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
        this.detach();
        this.glide = null;
        this.focusedFrom = null;
        this.scroll(effect.dx, effect.dy);
        return;

      case 'scroll':
        this.scroll(effect.dx, effect.dy);
        return;

      case 'resumeFollow':
        // Sin `startFollow` todavia: con los bounds del mundo repuestos de
        // golpe, `preRender` clamparia el scroll en el mismo cuadro -- un salto.
        // El planeo lleva la camara dentro de ellos y ahi se reponen.
        this.glide = { kind: 'return' };
        this.focusedFrom = null;
        return;

      case 'focus':
        this.detach();
        this.glide = { kind: 'focus', x: effect.x, y: effect.y };
        this.focusedFrom = { x: this.target.x, y: this.target.y };
        return;
    }
  }

  private detach(): void {
    this.camera.stopFollow();
    this.detached = true;
    this.applyNavigationBounds();
  }

  private applyNavigationBounds(): void {
    const bounds = navigationBounds(this.worldBounds, this.camera, this.camera.zoom);
    this.camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  private stepGlide(): void {
    if (this.glide === null) return;
    const cam = this.camera;
    let targetX: number;
    let targetY: number;

    if (this.glide.kind === 'focus') {
      targetX = centeredScroll(this.glide.x, cam.width);
      targetY = centeredScroll(this.glide.y, cam.height);
    } else {
      // Donde el seguimiento con los bounds del mundo dejaria la camara, no
      // el jugador centrado a secas: junto a un borde del mapa no coinciden.
      const world = this.worldBounds;
      const rangeX = scrollRange(world.x, world.width, cam.width, cam.zoom);
      const rangeY = scrollRange(world.y, world.height, cam.height, cam.zoom);
      targetX = Phaser.Math.Clamp(centeredScroll(this.target.x, cam.width), rangeX.min, rangeX.max);
      targetY = Phaser.Math.Clamp(centeredScroll(this.target.y, cam.height), rangeY.min, rangeY.max);
    }

    const stepX = glideStep(cam.scrollX, targetX, this.lerp);
    const stepY = glideStep(cam.scrollY, targetY, this.lerp);
    cam.setScroll(stepX.value, stepY.value);
    if (!stepX.arrived || !stepY.arrived) return;

    if (this.glide.kind === 'return') this.reattach();
    this.glide = null;
  }

  private reattach(): void {
    const { x, y, width, height } = this.worldBounds;
    const savedX = this.camera.scrollX;
    const savedY = this.camera.scrollY;
    this.camera.setBounds(x, y, width, height);
    // `startFollow` salta el scroll de golpe (Camera.js): reponerlo deja el
    // `preRender` de cada cuadro como unico que lo mueve, a `this.lerp`.
    this.camera.startFollow(this.target, true, this.lerp, this.lerp);
    this.camera.setScroll(savedX, savedY);
    this.detached = false;
  }

  /** El clamp de los bounds de la camara lo escribe `preRender` de vuelta: no hace falta aplicarlo aqui. */
  private scroll(dx: number, dy: number): void {
    this.camera.scrollX -= dx / this.camera.zoom;
    this.camera.scrollY -= dy / this.camera.zoom;
  }
}
