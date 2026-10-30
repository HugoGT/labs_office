import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { TERRAIN_LAYER_COUNT, TERRAIN_LAYER_ORIGIN, propPlacement, type ArtChairPiece } from './artContract';
import { artSheetKey, findPiece } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import { chairPlacement, deskPlacement, footprintAnchor } from './artPlacement';
import { TILE, ZONE_LABELS } from './mapData';
import {
  CHAIR_OBJECT_NAME,
  FALLBACK_TERRAIN_KEY,
  placeChairs,
  placeLayout,
  placeSeats,
  placeWalls,
  placeZoneLabels,
  renderTerrain,
  renderTerrainFloors,
  type TerrainTilemap,
} from './mapBuilder';
import { terrainSnapshot, wallFootprintRects, type OfficeLayout, type TerrainColors } from './officeLayout';
import { terrainMaterialBand, terrainRecolor } from './terrainColorTiles';
import { terrainFloorTileData } from './terrainFloorTiles';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../test/legacyOffice';

/** The legacy fixture keeps the 126x90 world it was drawn in. */
const MAP_W = BASE_TERRAIN.width;
const MAP_H = BASE_TERRAIN.height;
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

describe('renderTerrainFloors (S13)', () => {
  const PIECE = 'floor-upload-0123456789abcdef';
  const empty = new Array<null>(18 * 9).fill(null);
  /** Two wood blocks side by side. */
  const woods: OfficeLayout = { width: 18, height: 9, blocks: ['wood', 'wood'], ground: empty, walls: empty, hedges: empty, decals: empty, props: [] };
  const terrain = terrainSnapshot(woods);
  const sheet = artSheetKey('floor-wood', 'sheet');

  it('lays the frames of the piece sheet on one layer between the terrain and the decals, only over the floored block', async () => {
    const result = await withArtScene((scene, art) => {
      const tilemap = renderTerrain(scene, terrain, woods, art);
      const before = scene.children.list.length;
      const floors = renderTerrainFloors(scene);
      floors.refresh(terrain, new Map([[1, PIECE]]), () => sheet);
      const layer = floors.layers.get(PIECE)!;
      return {
        added: scene.children.list.length - before,
        depth: layer.depth,
        under: tilemap.layers.map((entry) => entry.depth),
        decals: tilemap.decals?.depth,
        texture: layer.tileset[0]?.image?.key,
        tiles: layerIndices(layer),
        visible: layer.visible,
      };
    });

    expect(result.added).toBe(1);
    expect(result.texture).toBe(sheet);
    expect(result.depth).toBeGreaterThan(Math.max(...result.under));
    expect(result.depth).toBeLessThan(result.decals!);
    expect(result.tiles).toEqual(terrainFloorTileData(terrain, new Map([[1, PIECE]])).get(PIECE));
    expect(result.visible).toBe(true);
  });

  it('draws nothing until the sheet is there, and the layer appears when a later refresh finds it', async () => {
    const result = await withArtScene((scene) => {
      const floors = renderTerrainFloors(scene);
      const floored = new Map([[0, PIECE]]);
      floors.refresh(terrain, floored, () => null);
      const waiting = floors.layers.size;
      floors.refresh(terrain, floored, () => sheet);
      return { waiting, landed: floors.layers.size };
    });

    expect(result).toEqual({ waiting: 0, landed: 1 });
  });

  it('hides the layer of a piece that no block shows any more, and keeps the rest in place', async () => {
    const result = await withArtScene((scene) => {
      const floors = renderTerrainFloors(scene);
      floors.refresh(terrain, new Map([[0, PIECE]]), () => sheet);
      const layer = floors.layers.get(PIECE)!;
      floors.refresh(terrain, new Map(), () => sheet);
      const hidden = !layer.visible;
      floors.refresh(terrainSnapshot({ ...woods, blocks: ['grass', 'wood'] }), new Map([[0, PIECE]]), () => sheet);
      return { hidden, stillHidden: !layer.visible, layers: floors.layers.size };
    });

    expect(result).toEqual({ hidden: true, stillHidden: true, layers: 1 });
  });
});

describe('renderTerrain: colored blocks (#222)', () => {
  const RED = '#aa0000';
  const empty = new Array<null>(18 * 9).fill(null);
  /** Two carpet blocks side by side: block 0 on tiles 0-8, block 1 on tiles 9-17. */
  const carpets: OfficeLayout = { width: 18, height: 9, blocks: ['carpet', 'carpet'], ground: empty, walls: empty, hedges: empty, decals: empty, props: [] };
  const terrain = terrainSnapshot(carpets);
  const band = terrainMaterialBand('carpet');
  /** Display cells whose four corners are in one block. */
  const inBlock0 = { cx: 4, cy: 4 };
  const inBlock1 = { cx: 13, cy: 4 };

  function drawnAt(tilemap: TerrainTilemap, cx: number, cy: number) {
    return tilemap.layers
      .map((layer) => layer.getTileAt(cx, cy, true))
      .filter((tile) => tile !== null && tile.index !== -1)
      .map((tile) => ({ index: tile.index, texture: tile.tileset?.image?.key, local: tile.index - (tile.tileset?.firstgid ?? 0) }));
  }

  function defaultAt(cx: number, cy: number) {
    const key = artSheetKey('tileset-terrain', 'sheet');
    return terrainTileData(terrain)
      .map((rows) => rows[cy]![cx]!)
      .filter((index) => index !== -1)
      .map((index) => ({ index, texture: key, local: index }));
  }

  it('draws a colored carpet block from a recolored copy of the carpet band, and a block without a color as before', async () => {
    const result = await withArtScene((scene, art) => {
      const tilemap = renderTerrain(scene, terrain, carpets, art, new Map([[0, RED]]));
      const recolor = terrainRecolor(art.manifest, 'carpet', RED)!;
      return {
        colored: drawnAt(tilemap, inBlock0.cx, inBlock0.cy),
        plain: drawnAt(tilemap, inBlock1.cx, inBlock1.cy),
        copy: art.recoloredRegion('tileset-terrain', 'sheet', band.rect, recolor),
        objects: scene.children.list.length,
      };
    });

    expect(result.copy).not.toBeNull();
    expect(result.colored).toEqual(
      defaultAt(inBlock0.cx, inBlock0.cy).map(({ index }) => ({ index: expect.any(Number), texture: result.copy, local: index - band.firstTile })),
    );
    expect(result.plain).toEqual(defaultAt(inBlock1.cx, inBlock1.cy));
    // Still one tilemap: a color adds a tileset, not game objects.
    expect(result.objects).toBe(TERRAIN_LAYER_COUNT + 1);
  });

  it('repaints a color-only change in place, and draws the default art again once the color is gone', async () => {
    const result = await withArtScene((scene, art) => {
      const tilemap = renderTerrain(scene, terrain, carpets, art);
      const before = drawnAt(tilemap, inBlock0.cx, inBlock0.cy);
      tilemap.refresh(terrain, new Map([[0, RED]]));
      const painted = drawnAt(tilemap, inBlock0.cx, inBlock0.cy);
      tilemap.refresh(terrain, new Map());
      return { before, painted, after: tilemap.layers.map(layerIndices), objects: scene.children.list.length };
    });

    expect(result.before).toEqual(defaultAt(inBlock0.cx, inBlock0.cy));
    expect(result.painted.map(({ texture }) => texture)).not.toContain(artSheetKey('tileset-terrain', 'sheet'));
    expect(result.after).toEqual(terrainTileData(terrain));
    expect(result.objects).toBe(TERRAIN_LAYER_COUNT + 1);
  });

  it('draws the default carpet when this browser cannot paint the copy', async () => {
    const result = await withArtScene((scene, art) => {
      const blind = { manifest: art.manifest, sheet: art.sheet.bind(art), request: art.request.bind(art), recoloredRegion: () => null };
      const colors: TerrainColors = new Map([[0, RED]]);
      return renderTerrain(scene, terrain, carpets, blind, colors).layers.map(layerIndices);
    });

    expect(result).toEqual(terrainTileData(terrain));
  });

  it('without the pack draws the flat colors as before, colored blocks included', async () => {
    const result = await withScene((scene, art) => renderTerrain(scene, terrain, carpets, art, new Map([[0, RED]])).layers.map(layerIndices));

    expect(result).toEqual([fallbackTerrainData(terrain)]);
  });
});

describe('placeWalls', () => {
  it('draws a live wall grid and hands back every object it drew, so a redraw can clear them', async () => {
    const width = 6;
    const height = 4;
    const walls = new Array<string | null>(width * height).fill(null);
    walls[width + 1] = 'wall-brick';
    walls[width + 2] = 'wall-brick';
    walls[2 * width + 4] = 'wall-glass';
    const grid = { width, height, walls };
    const result = await withArtScene((scene, art) => {
      const drawn = placeWalls(scene, grid, art);
      const keys = images(scene).map((img) => img.texture.key);
      for (const object of drawn) object.destroy();
      return { count: drawn.length, keys, left: images(scene).length };
    });

    expect(result.count).toBe(wallSprites(grid).length);
    expect(result.keys.filter((key) => key === artSheetKey('wall-brick', 'sheet')).length).toBe(wallSprites(grid).filter((sprite) => sprite.piece === 'wall-brick').length);
    expect(result.keys).toContain(artSheetKey('wall-glass', 'sheet'));
    expect(result.left).toBe(0);
  });

  it('without the pack draws a grey placeholder over the footprint of every post, never a whole tile', async () => {
    const walls = new Array<string | null>(4).fill(null);
    walls[1] = 'wall-stone';
    const lone = await withScene((scene) => placeWalls(scene, { width: 2, height: 2, walls }).length);
    expect(lone).toBe(1);

    // Two connected posts on the vertices (0,1) and (1,1): two joints and the body between them.
    const pair = new Array<string | null>(4).fill(null);
    pair[2] = 'wall-stone';
    pair[3] = 'wall-stone';
    const boxes = await withScene((scene) =>
      placeWalls(scene, { width: 2, height: 2, walls: pair }).map((object) => {
        const rect = object as Phaser.GameObjects.Rectangle;
        return { x: rect.x - rect.width / 2, y: rect.y - rect.height / 2, w: rect.width, h: rect.height };
      }),
    );
    expect(boxes).toEqual(wallFootprintRects({ width: 2, height: 2, walls: pair }));
  });
});

describe('placeLayout', () => {
  it('draws walls, hedges and every prop of the layout from the pack, at their anchors', async () => {
    const result = await withArtScene((scene, art) => {
      placeWalls(scene, BASE_LAYOUT, art);
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
        const placement = deskPlacement(piece, prop.facing ?? 'down', footprintAnchor({ x: prop.tx * TILE, y: prop.ty * TILE, w: prop.w * TILE, h: prop.h * TILE }));
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
      placeWalls(scene, BASE_LAYOUT, art);
      placeLayout(scene, BASE_LAYOUT, art);
      return { rectangles: scene.children.list.filter((child) => child.type === 'Rectangle').length, images: images(scene).length };
    });

    const walls = wallSprites(BASE_LAYOUT).length;
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

describe('placeChairs', () => {
  const W = BASE_LAYOUT.width;

  it('draws each placed chair from its own pack piece in both layers, on the middle of its tile, facing its way', async () => {
    const drawn = await withArtScene((scene, art) => {
      const objects = placeChairs(scene, [{ index: 5 * W + 3, piece: 'chair-gamer', facing: 'left' }, { index: 7 * W + 9, piece: 'chair-metal', facing: 'up' }], W, art);
      return {
        count: objects.length,
        named: objects.every((object) => object.name === CHAIR_OBJECT_NAME),
        gamer: images(scene)
          .filter((img) => img.texture.key === artSheetKey('chair-gamer', 'sheet'))
          .map((img) => ({ x: img.x, y: img.y, frame: Number(img.frame.name) })),
        metal: images(scene).filter((img) => img.texture.key === artSheetKey('chair-metal', 'sheet')).length,
      };
    });

    expect(drawn.count).toBe(4);
    expect(drawn.named).toBe(true);
    expect(drawn.metal).toBe(2);
    const piece = { anchors: { seat: { x: 18, y: 22 }, ground: { x: 18, y: 31 } } } as ArtChairPiece;
    const { back, front } = chairPlacement(piece, 'left', { x: 3.5 * TILE, y: 5.5 * TILE });
    expect(drawn.gamer).toEqual([
      { x: back.x, y: back.y, frame: back.frame },
      { x: front.x, y: front.y, frame: front.frame },
    ]);
  });

  it('without the pack marks each chair with a placeholder, and draws nothing for no chair', async () => {
    const counts = await withScene((scene, art) => [
      placeChairs(scene, [{ index: 0, piece: 'chair-wood', facing: 'down' }], W, art).length,
      placeChairs(scene, [], W, art).length,
    ]);

    expect(counts).toEqual([1, 0]);
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
