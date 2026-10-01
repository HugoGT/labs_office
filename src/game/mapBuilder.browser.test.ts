import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { TERRAIN_LAYER_COUNT, TERRAIN_LAYER_ORIGIN, propPlacement, type ArtChairPiece } from './artContract';
import { artSheetKey, findPiece } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import { chairPlacement, DEFAULT_DESK_FACING, deskPlacement, footprintAnchor } from './artPlacement';
import { MAP_H, MAP_W, TILE, ZONE_LABELS } from './mapData';
import {
  FALLBACK_TERRAIN_KEY,
  placeLayout,
  placeSeats,
  placeZoneLabels,
  renderTerrain,
  type TerrainTilemap,
} from './mapBuilder';
import { BASE_LAYOUT, BASE_TERRAIN, terrainSnapshot } from './officeLayout';
import { BASE_MAP_SEATS } from './seating';
import { decalTileData, fallbackTerrainData, hedgeSprites, terrainTileData, wallSprites } from './terrainRender';
import { createOfficeTextures } from './textures';

/**
 * Capa navegador: tilemaps, `scene.add.image` y `scene.add.text` necesitan una
 * escena real dentro de un `Phaser.Game` (jsdom no implementa canvas/WebGL).
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

/** Without a pack every call below draws its visible fallback. `withArtScene` loads the real pack. */
async function withScene<T>(run: (scene: Phaser.Scene, art: ArtPackLoader) => T): Promise<T> {
  return withSceneAndArt(run, false);
}

async function withArtScene<T>(run: (scene: Phaser.Scene, art: ArtPackLoader) => T): Promise<T> {
  return withSceneAndArt(run, true);
}

async function withSceneAndArt<T>(run: (scene: Phaser.Scene, art: ArtPackLoader) => T, withPack: boolean): Promise<T> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  let result!: T;
  class ProbeScene extends Phaser.Scene {
    constructor() {
      super('probe');
    }
    private art!: ArtPackLoader;
    preload(): void {
      this.art = new ArtPackLoader(this, { manifestUrl: withPack ? undefined : null });
      this.art.preload();
    }
    create(): void {
      createOfficeTextures(this);
      result = run(this, this.art);
    }
  }

  const game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 320, height: 240, scene: [ProbeScene] });
  games.push(game);
  await waitForSceneRunning(game, 'probe');
  return result;
}

function images(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  return scene.children.list.filter((child): child is Phaser.GameObjects.Image => child.type === 'Image');
}

function layerIndices(layer: Phaser.Tilemaps.TilemapLayer): number[][] {
  return layer.layer.data.map((row) => row.map((tile) => tile.index));
}

function summary(terrain: TerrainTilemap) {
  return {
    layers: terrain.layers.map((layer) => ({
      x: layer.x,
      y: layer.y,
      width: layer.layer.width,
      height: layer.layer.height,
      texture: layer.tileset[0]?.image?.key,
    })),
    decals: terrain.decals === null ? null : { x: terrain.decals.x, y: terrain.decals.y, width: terrain.decals.layer.width },
  };
}

describe('renderTerrain', () => {
  it('draws the terrain as dual-grid tilemap layers of the shared tileset, not one image per tile', async () => {
    const result = await withArtScene((scene, art) => {
      const terrain = renderTerrain(scene, BASE_TERRAIN, BASE_LAYOUT, art);
      return {
        ...summary(terrain),
        tiles: terrain.layers.map(layerIndices),
        decalTiles: terrain.decals === null ? null : layerIndices(terrain.decals),
        images: images(scene).length,
        objects: scene.children.list.length,
      };
    });

    const key = artSheetKey('tileset-terrain', 'sheet');
    expect(result.layers).toEqual(
      Array.from({ length: TERRAIN_LAYER_COUNT }, () => ({
        x: TERRAIN_LAYER_ORIGIN,
        y: TERRAIN_LAYER_ORIGIN,
        width: MAP_W + 1,
        height: MAP_H + 1,
        texture: key,
      })),
    );
    expect(result.tiles).toEqual(terrainTileData(BASE_TERRAIN));
    expect(result.decals).toEqual({ x: 0, y: 0, width: MAP_W });
    expect(result.decalTiles).toEqual(decalTileData(BASE_LAYOUT, BASE_TERRAIN));
    // The number of game objects does not depend on the size of the map (#123).
    expect(result.images).toBe(0);
    expect(result.objects).toBe(TERRAIN_LAYER_COUNT + 1);
  });

  it('redraws every layer from a new terrain in place, as a block edit will', async () => {
    const flooded = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks.map(() => 'water'));
    const result = await withArtScene((scene, art) => {
      const terrain = renderTerrain(scene, BASE_TERRAIN, BASE_LAYOUT, art);
      const before = scene.children.list.length;
      terrain.refresh(flooded);
      return {
        tiles: terrain.layers.map(layerIndices),
        decalTiles: terrain.decals === null ? null : layerIndices(terrain.decals),
        added: scene.children.list.length - before,
      };
    });

    expect(result.tiles).toEqual(terrainTileData(flooded));
    expect(result.decalTiles).toEqual(decalTileData(BASE_LAYOUT, flooded));
    expect(result.added).toBe(0);
  });

  it('without the pack draws one flat color per material, so the map still reads', async () => {
    const result = await withScene((scene, art) => {
      const terrain = renderTerrain(scene, BASE_TERRAIN, BASE_LAYOUT, art);
      return { ...summary(terrain), tiles: terrain.layers.map(layerIndices) };
    });

    expect(result.layers).toEqual([{ x: 0, y: 0, width: MAP_W, height: MAP_H, texture: FALLBACK_TERRAIN_KEY }]);
    expect(result.tiles).toEqual([fallbackTerrainData(BASE_TERRAIN)]);
    expect(result.decals).toBeNull();
  });
});

describe('placeLayout', () => {
  it('draws walls, hedges and every prop of the layout from the pack, at their anchors', async () => {
    const result = await withArtScene((scene, art) => {
      placeLayout(scene, BASE_LAYOUT, art);
      const manifest = art.manifest!;
      const drawn = images(scene).map((img) => ({ key: img.texture.key, x: img.x, y: img.y, frame: Number(img.frame.name) }));
      return { drawn, manifest };
    });
    const { drawn, manifest } = result;
    const ofKey = (id: string) => drawn.filter((image) => image.key === artSheetKey(id, 'sheet'));

    expect(ofKey('wall-plaster').length + ofKey('wall-brick').length).toBe(wallSprites(BASE_LAYOUT).length);
    const firstWall = wallSprites(BASE_LAYOUT)[0]!;
    expect(drawn).toContainEqual({ key: artSheetKey(firstWall.piece, 'sheet'), x: firstWall.x, y: firstWall.y, frame: firstWall.frame });
    expect(ofKey('hedge-boxwood')).toHaveLength(hedgeSprites(BASE_LAYOUT).length);

    for (const prop of BASE_LAYOUT.props) {
      const piece = findPiece(manifest, prop.piece)!;
      if (piece.kind === 'desk') {
        const placement = deskPlacement(piece, prop.facing ?? DEFAULT_DESK_FACING, footprintAnchor({ x: prop.tx * TILE, y: prop.ty * TILE, w: prop.w * TILE, h: prop.h * TILE }));
        expect(drawn).toContainEqual({ key: artSheetKey(prop.piece, 'sheet'), x: placement.x, y: placement.y, frame: placement.frame });
        continue;
      }
      const placement = propPlacement(piece as Parameters<typeof propPlacement>[0], prop.tx, prop.ty);
      expect(drawn).toContainEqual(expect.objectContaining({ key: artSheetKey(prop.piece, 'sheet'), x: placement.x, y: placement.y }));
    }
    // Nothing left of the Kenney placeholder art.
    expect(drawn.every((image) => image.key.startsWith('art:'))).toBe(true);
  });

  it('sorts tall props by their anchor and lays bridges on the ground under everyone', async () => {
    const depths = await withArtScene((scene, art) => {
      placeLayout(scene, BASE_LAYOUT, art);
      const of = (id: string) => images(scene).filter((img) => img.texture.key === artSheetKey(id, 'sheet')).map((img) => img.depth);
      return { bridges: of('bridge-wood'), tables: of('table-meeting') };
    });

    expect(depths.bridges.every((depth) => depth < 1)).toBe(true);
    expect(depths.tables).toEqual([11 * TILE]);
  });

  it('without the pack keeps a grey placeholder on every footprint', async () => {
    const count = await withScene((scene, art) => {
      placeLayout(scene, BASE_LAYOUT, art);
      return { rectangles: scene.children.list.filter((child) => child.type === 'Rectangle').length, images: images(scene).length };
    });

    const walls = BASE_LAYOUT.walls.filter((wall) => wall !== null).length;
    const hedges = BASE_LAYOUT.hedges.filter((hedge) => hedge !== null).length;
    expect(count.rectangles).toBe(walls + hedges + BASE_LAYOUT.props.length);
    expect(count.images).toBe(0);
  });
});

describe('placeSeats', () => {
  it('draws each room chair from the pack in both layers, facing the table', async () => {
    const chairs = await withArtScene((scene, art) => {
      placeSeats(scene, BASE_MAP_SEATS, art);
      return images(scene)
        .filter((img) => img.texture.key === artSheetKey('chair-wood', 'sheet'))
        .map((img) => ({ x: img.x, y: img.y, frame: Number(img.frame.name) }));
    });

    expect(chairs).toHaveLength(BASE_MAP_SEATS.length * 2);
    const piece = { anchors: { seat: { x: 18, y: 22 }, ground: { x: 18, y: 31 } } } as ArtChairPiece;
    const { back, front } = chairPlacement(piece, 'down', { x: 53.5 * TILE, y: 5.5 * TILE });
    expect(chairs).toContainEqual({ x: back.x, y: back.y, frame: back.frame });
    expect(chairs).toContainEqual({ x: front.x, y: front.y, frame: front.frame });
    const left = chairPlacement(piece, 'right', { x: 52.5 * TILE, y: 6.5 * TILE });
    expect(chairs).toContainEqual({ x: left.back.x, y: left.back.y, frame: left.back.frame });
  });

  it('without the pack marks each chair with a placeholder', async () => {
    const rectangles = await withScene((scene, art) => {
      placeSeats(scene, BASE_MAP_SEATS, art);
      return scene.children.list.filter((child) => child.type === 'Rectangle').length;
    });

    expect(rectangles).toBe(BASE_MAP_SEATS.length);
  });
});

describe('placeZoneLabels', () => {
  it('renderiza un texto por cada ZONE_LABELS con su contenido y posicion', async () => {
    const texts = await withScene((scene) => {
      placeZoneLabels(scene);
      return scene.children.list
        .filter((child): child is Phaser.GameObjects.Text => child.type === 'Text')
        .map((child) => ({ x: child.x, y: child.y, text: child.text }));
    });

    expect(texts).toHaveLength(ZONE_LABELS.length);
    expect(texts).toEqual(expect.arrayContaining(ZONE_LABELS.map((z) => ({ x: z.x * TILE, y: z.y * TILE, text: z.t }))));
  });
});
