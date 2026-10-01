import { describe, expect, it } from 'vitest';
import {
  TERRAIN_LAYER_COUNT,
  hedgeFrameIndex,
  propPlacement,
  terrainDecalIndex,
  terrainLayerData,
  wallFrameIndex,
  type ArtPackManifest,
} from './artContract';
import { findPiece, parseArtPackManifest } from './artPack';
import { MAP_H, MAP_W, TILE } from './mapData';
import {
  BASE_LAYOUT,
  BASE_TERRAIN,
  LAYOUT_MATERIALS,
  terrainMaterialAt,
  terrainSnapshot,
  type OfficeLayout,
} from './officeLayout';
import {
  decalTileData,
  fallbackTerrainData,
  hedgeSprites,
  propFrame,
  terrainTileData,
  wallSprites,
} from './terrainRender';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';

function pack(): ArtPackManifest {
  const manifest = parseArtPackManifest(JSON.parse(exportedManifest));
  if (manifest === null) throw new Error('the exported manifest must parse');
  return manifest;
}

/** A blank 18x9 layout to place a few pieces on. */
function blankLayout(edit: Partial<OfficeLayout> = {}): OfficeLayout {
  const empty = new Array<null>(18 * 9).fill(null);
  return {
    width: 18,
    height: 9,
    blocks: ['grass', 'grass'],
    ground: empty,
    walls: empty,
    hedges: empty,
    decals: empty,
    props: [],
    ...edit,
  };
}

function tiles<T>(width: number, at: Record<string, T>): (T | null)[] {
  return Array.from({ length: width * 9 }, (_, index) => at[`${index % width},${Math.floor(index / width)}`] ?? null);
}

describe('terrainTileData', () => {
  it('is the dual-grid layer data of the effective terrain: a (W+1)x(H+1) cell per corner set', () => {
    const data = terrainTileData(BASE_TERRAIN);

    expect(data).toHaveLength(TERRAIN_LAYER_COUNT);
    expect(data[0]).toHaveLength(MAP_H + 1);
    expect(data[0]![0]).toHaveLength(MAP_W + 1);
    expect(data).toEqual(terrainLayerData(MAP_W, MAP_H, (tx, ty) => terrainMaterialAt(BASE_TERRAIN, tx, ty)));
  });

  it('follows a new set of blocks without another layout: the hook for live block edits', () => {
    const flooded = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks.map(() => 'water'));

    expect(terrainTileData(flooded)).not.toEqual(terrainTileData(BASE_TERRAIN));
  });
});

describe('decalTileData', () => {
  it('draws each decal of the layout on the map grid, and only on the terrain it belongs to', () => {
    const layout = blankLayout({
      ground: tiles(18, { '4,4': 'water', '5,4': 'water' }),
      decals: tiles(18, { '1,1': 'clover', '4,4': 'lily-pad', '5,4': 'flowers-blue', '6,4': 'lily-pad' }),
    });
    const data = decalTileData(layout, terrainSnapshot(layout));

    expect(data).toHaveLength(9);
    expect(data[0]).toHaveLength(18);
    expect(data[1]![1]).toBe(terrainDecalIndex('clover'));
    expect(data[4]![4]).toBe(terrainDecalIndex('lily-pad'));
    // Flowers do not float, and lily pads do not grow on grass.
    expect(data[4]![5]).toBe(-1);
    expect(data[4]![6]).toBe(-1);
    expect(data[0]![0]).toBe(-1);
  });
});

describe('fallbackTerrainData', () => {
  it('gives each tile its material index, for the flat tileset drawn when the pack is missing', () => {
    const data = fallbackTerrainData(BASE_TERRAIN);

    expect(data).toHaveLength(MAP_H);
    expect(data[20]![20]).toBe(LAYOUT_MATERIALS.indexOf('water'));
    expect(data[28]![22]).toBe(LAYOUT_MATERIALS.indexOf('grass'));
  });
});

describe('wallSprites', () => {
  it('runs a wall through the centers of its tiles: joints by their connections, bodies in between', () => {
    // An L: (2,2) (3,2) (3,3).
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '3,3': 'wall-glass' }) });
    const sprites = wallSprites(layout);
    const joints = sprites.filter((sprite) => sprite.part === 'joint');
    const bodies = sprites.filter((sprite) => sprite.part === 'body');

    expect(joints).toEqual([
      { piece: 'wall-brick', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 2 }), x: 2 * TILE + 8, y: 2 * TILE + 8, depthY: 2 * TILE + 24 },
      { piece: 'wall-brick', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 8 | 4 }), x: 3 * TILE + 8, y: 2 * TILE + 8, depthY: 2 * TILE + 24 },
      { piece: 'wall-glass', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 1 }), x: 3 * TILE + 8, y: 3 * TILE + 8, depthY: 3 * TILE + 24 },
    ]);
    expect(bodies).toEqual([
      { piece: 'wall-brick', part: 'body', frame: wallFrameIndex({ piece: 'body', axis: 'horizontal' }), x: 2 * TILE + 24, y: 2 * TILE + 8, depthY: 2 * TILE + 24 },
      { piece: 'wall-brick', part: 'body', frame: wallFrameIndex({ piece: 'body', axis: 'vertical' }), x: 3 * TILE + 8, y: 2 * TILE + 24, depthY: 2 * TILE + 40 },
    ]);
  });

  it('shows a lone wall tile as a post instead of dropping it', () => {
    const sprites = wallSprites(blankLayout({ walls: tiles(18, { '5,5': 'wall-stone' }) }));

    expect(sprites).toEqual([
      { piece: 'wall-stone', part: 'joint', frame: wallFrameIndex({ piece: 'body', axis: 'vertical' }), x: 5 * TILE + 8, y: 5 * TILE + 8, depthY: 5 * TILE + 24 },
    ]);
  });

  it('closes both rooms of the office except their doors', () => {
    const joints = wallSprites(BASE_LAYOUT).filter((sprite) => sprite.part === 'joint');

    // Two 13x14 rings of 50 tiles each, less a two-tile door.
    expect(joints).toHaveLength(2 * (2 * 13 + 2 * 12 - 2));
    expect(joints.some((joint) => joint.x === 50 * TILE + 8 && joint.y === 8 * TILE + 8)).toBe(false);
  });
});

describe('hedgeSprites', () => {
  it('picks each hedge frame by its hedge neighbors (north 1, east 2, south 4, west 8)', () => {
    const layout = blankLayout({ hedges: tiles(18, { '1,1': 'hedge-boxwood', '2,1': 'hedge-boxwood', '2,2': 'hedge-boxwood', '9,5': 'hedge-boxwood' }) });

    expect(hedgeSprites(layout)).toEqual([
      { piece: 'hedge-boxwood', frame: hedgeFrameIndex(2), tx: 1, ty: 1 },
      { piece: 'hedge-boxwood', frame: hedgeFrameIndex(8 | 4), tx: 2, ty: 1 },
      { piece: 'hedge-boxwood', frame: hedgeFrameIndex(1), tx: 2, ty: 2 },
      { piece: 'hedge-boxwood', frame: hedgeFrameIndex(0), tx: 9, ty: 5 },
    ]);
  });
});

describe('props of the committed layout against the pack', () => {
  it('names a pack piece of the right kind for every prop, wall and hedge, with the footprint the pack declares', () => {
    const manifest = pack();

    for (const prop of BASE_LAYOUT.props) {
      const piece = findPiece(manifest, prop.piece);
      expect(piece?.kind, prop.piece).toBe(prop.kind);
      if (piece === undefined) continue;
      if (piece.kind === 'desk') {
        expect(piece.facings[prop.facing!].footprint).toEqual({ w: prop.w, h: prop.h });
      } else if ('footprint' in piece) {
        expect(piece.footprint, `${prop.piece} at (${prop.tx}, ${prop.ty})`).toEqual({ w: prop.w, h: prop.h });
      }
    }
    for (const id of new Set([...BASE_LAYOUT.walls, ...BASE_LAYOUT.hedges].filter((id) => id !== null))) {
      expect(findPiece(manifest, id!), id!).toBeDefined();
    }
  });

  it('frames a bridge by its orientation and every other prop by its only frame', () => {
    const manifest = pack();
    const bridge = BASE_LAYOUT.props.find((prop) => prop.kind === 'bridge')!;
    const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;

    expect(propFrame(bridge)).toBe(0);
    expect(propFrame({ ...bridge, orientation: 'east-west' })).toBe(1);
    expect(propFrame(tree)).toBe(0);
    // Placement is the contract's: the anchor lands on the bottom middle of the footprint.
    const piece = findPiece(manifest, bridge.piece) as Parameters<typeof propPlacement>[0];
    expect(propPlacement(piece, bridge.tx, bridge.ty).depthY).toBe((bridge.ty + bridge.h) * TILE);
  });
});
