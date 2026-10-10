/**
 * The minimap camera framed on the terrain region, not on the whole world:
 * with most of the 189x135 world still void, fitting the world left the
 * painted office as a small box off to one side of a black minimap. The
 * region is the same `terrainRegion` the main camera is held to (#179), so
 * the minimap grows as terrain is painted and shrinks back when it is erased.
 *
 * The region always fills the minimap width. A region taller than the
 * minimap shows a horizontal band of it; `regionBounds` keeps that band
 * inside the region, and centers a region shorter than the minimap.
 *
 * Dragging the minimap scrolls that band; a click (a press released within
 * the drag threshold, `minimapGesture.ts`) hands its world point to
 * `onFocus`, which glides the main camera there (#98).
 */

import Phaser from 'phaser';
import { regionBounds, type Rect } from './cameraBounds';
import { reduceMinimapGesture, type MinimapGestureEvent, type MinimapGestureState } from './minimapGesture';

/** The player marker's radius in screen pixels, whatever the minimap zoom. */
export const MINIMAP_MARKER_RADIUS_PX = 4;

export interface MinimapLayerOptions {
  scene: Phaser.Scene;
  /** The minimap camera; this layer owns its zoom, bounds and scroll. */
  camera: Phaser.Cameras.Scene2D.Camera;
  /** `terrainRegion` of the live blocks, replaced through `setRegion`. */
  region: Rect;
  /** World point to show first (the player); clamped into the region. */
  center: { x: number; y: number };
  /** The player marker, sized here so it reads the same at any zoom. */
  marker?: Phaser.GameObjects.Arc;
  /** A click on the minimap, as the world point under it. */
  onFocus?: (point: { x: number; y: number }) => void;
}

export class MinimapLayer {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly marker?: Phaser.GameObjects.Arc;
  private readonly onFocus?: (point: { x: number; y: number }) => void;
  private region: Rect;
  private gesture: MinimapGestureState = { kind: 'idle' };

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    // Whatever is under it: a desk or a peer is a couple of pixels here, not a target.
    if (pointer.camera !== this.camera || pointer.button !== 0) return;
    this.dispatch({ kind: 'down', x: pointer.x, y: pointer.y });
  };

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.dispatch({ kind: 'move', x: pointer.x, y: pointer.y });
  };

  private readonly onPointerUp = (): void => {
    this.dispatch({ kind: 'up' });
  };

  private readonly onPointerUpOutside = (): void => {
    this.dispatch({ kind: 'cancel' });
  };

  constructor(options: MinimapLayerOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.marker = options.marker;
    this.onFocus = options.onFocus;
    this.region = options.region;
    this.frame(options.center.y);

    this.scene.input.on('pointerdown', this.onPointerDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
    this.scene.input.on('pointerupoutside', this.onPointerUpOutside);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUpOutside);
  }

  /** New live terrain: refit the width, keeping the band the minimap showed. */
  setRegion(region: Rect): void {
    const centerY = this.camera.scrollY + this.camera.height / 2;
    this.region = region;
    this.frame(centerY);
  }

  /** Shows the band around `point` (the restored player); the width never moves. */
  show(point: { x: number; y: number }): void {
    this.camera.centerOn(this.region.x + this.region.width / 2, point.y);
  }

  private dispatch(event: MinimapGestureEvent): void {
    const { state, effect } = reduceMinimapGesture(this.gesture, event);
    this.gesture = state;
    const cam = this.camera;
    switch (effect.kind) {
      case 'none':
        return;
      case 'scroll':
        // Clamped now, not at the next render, so a long drag past an edge comes back at once.
        cam.scrollX = cam.clampX(cam.scrollX - effect.dx / cam.zoom);
        cam.scrollY = cam.clampY(cam.scrollY - effect.dy / cam.zoom);
        return;
      case 'click':
        this.onFocus?.(cam.getWorldPoint(effect.x, effect.y));
        return;
    }
  }

  private frame(centerY: number): void {
    const cam = this.camera;
    const zoom = cam.width / this.region.width;
    cam.setZoom(zoom);
    const bounds = regionBounds(this.region, cam, zoom);
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    // Phaser's scroll centers the view at `scroll + size / 2` whatever the zoom.
    cam.centerOn(this.region.x + this.region.width / 2, centerY);
    this.marker?.setRadius(MINIMAP_MARKER_RADIUS_PX / zoom);
  }
}
