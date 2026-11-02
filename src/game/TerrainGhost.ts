/**
 * Phaser side of the terrain ghost: the floor the editor has picked, drawn
 * over the block under the pointer with the scene's own terrain renderer, so
 * the art, a carpet color or an uploaded floor look as they will once placed
 * (`ghostTerrain.ts` is the data). Nearly opaque, over the live terrain and
 * under the walls and decor; drawing only, it never touches the map.
 */

import Phaser from 'phaser';
import { TERRAIN_LAYER_ORIGIN } from './artContract';
import { TILE } from './mapData';
import type { ArtTextures } from './artPackLoader';
import { renderTerrain, renderTerrainFloors, type TerrainFloorLayers, type TerrainTilemap } from './mapBuilder';
import type { LayoutMaterial } from './officeLayout';
import { GHOST_CENTER, GHOST_LAYOUT, TERRAIN_GHOST_ALPHA, ghostTerrain } from './ghostTerrain';
import { BLOCK_TILES } from './officeLayout';

/** Over the live floors (0.2) and their uploads, under the decals (0.3) and everything on the ground. */
const GHOST_DEPTH = 0.21;
const GHOST_DEPTH_STEP = 0.001;
const GHOST_FLOOR_DEPTH = 0.29;
/** Side of the block shown, in world pixels. */
const BLOCK_PX = BLOCK_TILES * TILE;

export interface GhostBrush {
  readonly material: LayoutMaterial;
  readonly color?: string;
  readonly floor?: string;
}

export class TerrainGhost {
  private readonly scene: Phaser.Scene;
  private readonly art: ArtTextures | undefined;
  private readonly sheetKey: (pieceId: string) => string | null;
  private terrain: TerrainTilemap | null = null;
  private floors: TerrainFloorLayers | null = null;
  /** What the layers draw now, so a pointer that only moves to the next block repositions them without redrawing. */
  private drawn: string | null = null;
  /** The block's rectangle, which every layer is cut to; moved with the pointer. */
  private clipShape: Phaser.GameObjects.Graphics | null = null;
  private clipMask: Phaser.Display.Masks.GeometryMask | null = null;

  /** `sheetKey` is the texture of an uploaded floor's sheet, or `null` while it is not loaded (the wood shows until then). */
  constructor(scene: Phaser.Scene, art: ArtTextures | undefined, sheetKey: (pieceId: string) => string | null) {
    this.scene = scene;
    this.art = art;
    this.sheetKey = sheetKey;
  }

  /** The tilemap layers it has drawn so far, for tests. */
  layers(): Phaser.Tilemaps.TilemapLayer[] {
    return [...(this.terrain?.layers ?? []), ...(this.terrain?.decals === null || this.terrain === null ? [] : [this.terrain.decals]), ...(this.floors?.layers.values() ?? [])];
  }

  /** The rectangle the ghost is cut to (the block it is shown at), in world pixels, or `null` before it was shown. */
  clip(): { x: number; y: number; width: number; height: number } | null {
    return this.clipShape === null ? null : { x: this.clipShape.x, y: this.clipShape.y, width: BLOCK_PX, height: BLOCK_PX };
  }

  /** Draws `brush`'s floor over the block whose top-left corner is at (`x`, `y`), in world pixels. */
  show(brush: GhostBrush, x: number, y: number): void {
    const ghost = ghostTerrain(brush);
    if (ghost === null) {
      this.hide();
      return;
    }
    const terrain = (this.terrain ??= this.create(ghost.snapshot, ghost.colors));
    const floors = (this.floors ??= renderTerrainFloors(this.scene));
    const key = JSON.stringify([brush.material, brush.color ?? null, brush.floor ?? null]);
    if (key !== this.drawn || ghost.floors.size > 0) {
      terrain.refresh(ghost.snapshot, ghost.colors);
      floors.refresh(ghost.snapshot, ghost.floors, this.sheetKey);
      this.drawn = key;
    }
    // The ghost's map is three blocks wide with the block shown in the middle: shift it back so that block lands at (x, y).
    const left = x - GHOST_CENTER.x * TILE;
    const top = y - GHOST_CENTER.y * TILE;
    const mask = this.mask(x, y);
    terrain.layers.forEach((layer, index) =>
      layer.setPosition(left + TERRAIN_LAYER_ORIGIN, top + TERRAIN_LAYER_ORIGIN).setDepth(GHOST_DEPTH + index * GHOST_DEPTH_STEP).setAlpha(TERRAIN_GHOST_ALPHA).setMask(mask).setVisible(true),
    );
    // The ghost has no decals of its own; the layer exists only because the renderer makes it.
    terrain.decals?.setVisible(false);
    for (const layer of floors.layers.values()) layer.setPosition(left, top).setDepth(GHOST_FLOOR_DEPTH).setAlpha(TERRAIN_GHOST_ALPHA).setMask(mask);
  }

  /** The mask that cuts the drawing to the block at (`x`, `y`): the dual-grid art blends half a tile past a block's sides. */
  private mask(x: number, y: number): Phaser.Display.Masks.GeometryMask {
    if (this.clipShape === null || this.clipMask === null) {
      this.clipShape = this.scene.make.graphics({}, false);
      this.clipShape.fillStyle(0xffffff).fillRect(0, 0, BLOCK_PX, BLOCK_PX);
      this.clipMask = this.clipShape.createGeometryMask();
    }
    this.clipShape.setPosition(x, y);
    return this.clipMask;
  }

  hide(): void {
    for (const layer of this.layers()) layer.setVisible(false);
  }

  destroy(): void {
    for (const layer of this.layers()) layer.destroy();
    this.floors?.destroy();
    this.clipMask?.destroy();
    this.clipShape?.destroy();
    this.clipMask = null;
    this.clipShape = null;
    this.terrain = null;
    this.floors = null;
    this.drawn = null;
  }

  private create(snapshot: Parameters<typeof renderTerrain>[1], colors: Parameters<typeof renderTerrain>[4]): TerrainTilemap {
    return renderTerrain(this.scene, snapshot, GHOST_LAYOUT, this.art, colors);
  }
}
