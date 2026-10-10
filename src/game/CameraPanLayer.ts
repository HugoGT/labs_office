/**
 * Capa Phaser de la navegacion de camara (#53, #98). Traduce input real de
 * puntero a `reduceCameraPan` (puro, sin Phaser) y aplica el efecto devuelto
 * sobre UNA sola camara -- nunca el minimapa. Mismo patron que
 * `LayoutEditLayer`: la capa solo escucha y dibuja/mueve, el reductor decide.
 *
 * `pointerup` en el canvas y `pointerupoutside` (soltar fuera de el)
 * terminan el pan igual -- ninguno de los dos necesita coordenadas.
 *
 * #179: following, dragging and the minimap glide all use the same bounds,
 * `regionBounds` of the terrain region (painted blocks plus a margin of
 * `CAMERA_MARGIN_TILES` tiles), so the view never wanders into the black void and starting or
 * ending a drag never makes the camera jump to other bounds.
 *
 * map-zoom: this layer is the ONLY writer of the main camera bounds, every
 * frame (zoom aware, region centered where the visible area covers it). Zoom
 * and window resize then never need to touch the bounds themselves.
 */

import Phaser from 'phaser';
import {
  centeredScroll,
  glideStep,
  regionBounds,
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
  /** Where the view may go (#179): `terrainRegion` of the live blocks, replaced through `setRegion`. */
  region: Rect;
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
  private region: Rect;
  private readonly minimap?: Phaser.Cameras.Scene2D.Camera;
  private readonly isSuspended: () => boolean;
  private state: CameraPanState = { kind: 'idle' };
  private glide: Glide | null = null;
  /**
   * Progreso propio del planeo, en vez de releer `camera.scrollX/Y`: con
   * `roundPixels` (createGame.ts) `preRender` trunca el scroll a entero cada
   * cuadro, y con un lerp pequeno el paso siguiente puede recalcularse desde
   * el mismo entero una y otra vez -- la camara se queda corta del destino
   * para siempre. Llevando el float aqui, el planeo si converge; solo el
   * render final se ve a pixel entero.
   */
  private glideScrollX = 0;
  private glideScrollY = 0;
  /** Player position at minimap focus or drag release; movement resumes follow. */
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
      const { x, y, width, height } = this.region;
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
    const wasPanning = this.state.kind === 'panning';
    this.dispatch({ kind: 'up' });
    // #146: compare against release, not movement made during the drag.
    if (wasPanning) this.focusedFrom = { x: this.target.x, y: this.target.y };
  };

  private readonly onUpdate = (): void => {
    if (
      this.state.kind === 'focused' &&
      this.focusedFrom !== null &&
      (this.target.x !== this.focusedFrom.x || this.target.y !== this.focusedFrom.y)
    ) {
      this.dispatch({ kind: 'playerMoved' });
    }
    // Every frame: a window resize, a zoom change or a new region moves the bounds at once.
    this.applyBounds();
    this.stepGlide();
  };

  constructor(options: CameraPanLayerOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.target = options.target;
    this.lerp = options.lerp;
    this.region = options.region;
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

  /** New live terrain (#179); the next frame clamps the view into it. */
  setRegion(region: Rect): void {
    this.region = region;
  }

  /** A new authoritative origin must not keep a pan/glide aimed at the old spawn (#148). */
  resetFollow(): void {
    this.state = { kind: 'idle' };
    this.glide = null;
    this.focusedFrom = null;
    this.reattach();
    this.camera.centerOn(this.target.x, this.target.y);
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
        this.glide = null;
        this.focusedFrom = null;
        this.scroll(effect.dx, effect.dy);
        return;

      case 'scroll':
        this.scroll(effect.dx, effect.dy);
        return;

      case 'resumeFollow':
        // Sin `startFollow` todavia: el planeo lleva la camara hasta donde el
        // seguimiento la dejaria (clampada a la region) y `reattach` lo
        // reengancha cuando ya no queda nada que mover.
        this.glide = { kind: 'return' };
        this.glideScrollX = this.camera.scrollX;
        this.glideScrollY = this.camera.scrollY;
        this.focusedFrom = null;
        return;

      case 'focus':
        this.camera.stopFollow();
        this.glide = { kind: 'focus', x: effect.x, y: effect.y };
        this.glideScrollX = this.camera.scrollX;
        this.glideScrollY = this.camera.scrollY;
        this.focusedFrom = { x: this.target.x, y: this.target.y };
        return;
    }
  }

  private applyBounds(): void {
    const bounds = regionBounds(this.region, this.camera, this.camera.zoom);
    this.camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  private stepGlide(): void {
    if (this.glide === null) return;
    const cam = this.camera;
    // Where the clamp lets the camera rest, not the point centered as such:
    // near a region edge they differ, and a glide aimed past the clamp would
    // stop dead against it instead of easing in.
    const point = this.glide.kind === 'focus' ? this.glide : this.target;
    const bounds = regionBounds(this.region, cam, cam.zoom);
    const rangeX = scrollRange(bounds.x, bounds.width, cam.width, cam.zoom);
    const rangeY = scrollRange(bounds.y, bounds.height, cam.height, cam.zoom);
    const targetX = Phaser.Math.Clamp(centeredScroll(point.x, cam.width), rangeX.min, rangeX.max);
    const targetY = Phaser.Math.Clamp(centeredScroll(point.y, cam.height), rangeY.min, rangeY.max);

    const stepX = glideStep(this.glideScrollX, targetX, this.lerp);
    const stepY = glideStep(this.glideScrollY, targetY, this.lerp);
    this.glideScrollX = stepX.value;
    this.glideScrollY = stepY.value;
    cam.setScroll(stepX.value, stepY.value);
    if (!stepX.arrived || !stepY.arrived) return;

    if (this.glide.kind === 'return') this.reattach();
    this.glide = null;
  }

  private reattach(): void {
    const savedX = this.camera.scrollX;
    const savedY = this.camera.scrollY;
    this.applyBounds();
    // `startFollow` salta el scroll de golpe (Camera.js): reponerlo deja el
    // `preRender` de cada cuadro como unico que lo mueve, a `this.lerp`.
    this.camera.startFollow(this.target, true, this.lerp, this.lerp);
    this.camera.setScroll(savedX, savedY);
  }

  /** El clamp de los bounds de la camara lo escribe `preRender` de vuelta: no hace falta aplicarlo aqui. */
  private scroll(dx: number, dy: number): void {
    this.camera.scrollX -= dx / this.camera.zoom;
    this.camera.scrollY -= dy / this.camera.zoom;
  }
}
