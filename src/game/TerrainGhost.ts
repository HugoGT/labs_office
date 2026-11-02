/**
 * Phaser side of the terrain ghost: the floor the editor has picked, drawn
 * over the block under the pointer with the scene's own terrain renderer, so
 * the art, a carpet color or an uploaded floor look as they will once placed
 * (`ghostTerrain.ts` is the data). Nearly opaque, over the live terrain and
 * under the walls and decor; drawing only, it never touches the map.
 */

import Phaser from 'phaser';
import { TERRAIN_LAYER_ORIGIN } from './artContract';
import type { ArtTextures } from './artPackLoader';
import { renderTerrain, renderTerrainFloors, type TerrainFloorLayers, type TerrainTilemap } from './mapBuilder';
import type { LayoutMaterial } from './officeLayout';
import { GHOST_LAYOUT, TERRAIN_GHOST_ALPHA, ghostTerrain } from './ghostTerrain';

/** Over the live floors (0.2) and their uploads, under the decals (0.3) and everything on the ground. */
const GHOST_DEPTH = 0.21;
const GHOST_DEPTH_STEP = 0.001;
const GHOST_FLOOR_DEPTH = 0.29;

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
    terrain.layers.forEach((layer, index) => layer.setPosition(x + TERRAIN_LAYER_ORIGIN, y + TERRAIN_LAYER_ORIGIN).setDepth(GHOST_DEPTH + index * GHOST_DEPTH_STEP).setAlpha(TERRAIN_GHOST_ALPHA).setVisible(true));
    // The ghost has no decals of its own; the layer exists only because the renderer makes it.
    terrain.decals?.setVisible(false);
    for (const layer of floors.layers.values()) layer.setPosition(x, y).setDepth(GHOST_FLOOR_DEPTH).setAlpha(TERRAIN_GHOST_ALPHA);
  }

  hide(): void {
    for (const layer of this.layers()) layer.setVisible(false);
  }

  destroy(): void {
    for (const layer of this.layers()) layer.destroy();
    this.floors?.destroy();
    this.terrain = null;
    this.floors = null;
    this.drawn = null;
  }

  private create(snapshot: Parameters<typeof renderTerrain>[1], colors: Parameters<typeof renderTerrain>[4]): TerrainTilemap {
    return renderTerrain(this.scene, snapshot, GHOST_LAYOUT, this.art, colors);
  }
}
