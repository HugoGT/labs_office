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
 */

import Phaser from 'phaser';
import { regionBounds, type Rect } from './cameraBounds';

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
}

export class MinimapLayer {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly marker?: Phaser.GameObjects.Arc;
  private region: Rect;

  constructor(options: MinimapLayerOptions) {
    this.camera = options.camera;
    this.marker = options.marker;
    this.region = options.region;
    this.frame(options.center.y);
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
