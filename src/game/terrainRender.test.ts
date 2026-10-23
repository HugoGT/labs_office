import { describe, expect, it } from 'vitest';
import {
  TERRAIN_LAYER_COUNT,
  TERRAIN_VOID_COLOR,
  hedgeFrameIndex,
  propPlacement,
  terrainDecalIndex,
  terrainLayerData,
  terrainVoidCapIndex,
  wallFrameIndex,
  type ArtPackManifest,
} from './artContract';
import { findPiece, parseArtPackManifest } from './artPack';
import { TILE } from './mapData';
import {
  LAYOUT_MATERIALS,
  terrainMaterialAt,
  terrainSnapshot,
  wallFootprintRects,
  type OfficeLayout,
} from './officeLayout';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN } from '../test/legacyOffice';
import {
  TERRAIN_FLAT_COLORS,
  VOID_COLOR,
  decalTileData,
  drawnTerrainAt,
  fallbackTerrainData,
  hedgeSprites,
  propFrame,
  terrainTileData,
  wallSprites,
} from './terrainRender';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';

/** The legacy fixture keeps the 126x90 world it was drawn in. */
const MAP_W = BASE_TERRAIN.width;
const MAP_H = BASE_TERRAIN.height;

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
    expect(data).toEqual(terrainLayerData(MAP_W, MAP_H, (tx, ty) => drawnTerrainAt(BASE_TERRAIN, tx, ty)));
  });

  it('draws nothing at all for void, so the black background shows through', () => {
    const empty = terrainSnapshot(blankLayout({ blocks: ['void', 'void'] }));

    for (const layer of terrainTileData(empty)) for (const row of layer) expect(row.every((tile) => tile === -1)).toBe(true);
    expect(drawnTerrainAt(empty, 3, 3)).toBeNull();
    expect(drawnTerrainAt(BASE_TERRAIN, 20, 20)).toBe(terrainMaterialAt(BASE_TERRAIN, 20, 20));
  });

  it('edges a land block straight over the void: the grass runs under a void cap on the tile line', () => {
    const half = terrainSnapshot(blankLayout({ blocks: ['grass', 'void'] }));
    const data = terrainTileData(half);

    // Cell (9, 4) sits on the border: grass on its west corners, void on the east ones.
    expect(data[0]![4]![9]).toBe(terrainLayerData(18, 9, (tx) => (tx < 9 ? 'grass' : null))[0]![4]![9]);
    expect(data[1]![4]![9]).toBe(terrainVoidCapIndex(2 | 8));
    expect(data[2]![4]![9]).toBe(-1);
    expect(data.flat(2).filter((tile) => tile !== -1).length).toBeGreaterThan(0);
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

  it('never draws a decal over the void', () => {
    const layout = blankLayout({ blocks: ['void', 'void'], decals: tiles(18, { '1,1': 'clover', '4,4': 'lily-pad' }) });
    const data = decalTileData(layout, terrainSnapshot(layout));

    expect(data[1]![1]).toBe(-1);
    expect(data[4]![4]).toBe(-1);
  });
});

describe('fallbackTerrainData', () => {
  it('gives each tile its material index, for the flat tileset drawn when the pack is missing', () => {
    const data = fallbackTerrainData(BASE_TERRAIN);

    expect(data).toHaveLength(MAP_H);
    expect(data[20]![20]).toBe(LAYOUT_MATERIALS.indexOf('water'));
    expect(data[28]![22]).toBe(LAYOUT_MATERIALS.indexOf('grass'));
  });

  it('paints the void solid black, like the background around the world', () => {
    const data = fallbackTerrainData(terrainSnapshot(blankLayout({ blocks: ['void', 'grass'] })));

    expect(data[4]![4]).toBe(LAYOUT_MATERIALS.indexOf('void'));
    expect(VOID_COLOR).toBe(0x000000);
    // The tileset's void caps paint this same color over the terrain's edge.
    expect(VOID_COLOR).toBe(TERRAIN_VOID_COLOR);
    expect(TERRAIN_FLAT_COLORS.void).toBe(VOID_COLOR);
    expect(Object.keys(TERRAIN_FLAT_COLORS)).toEqual([...LAYOUT_MATERIALS]);
  });
});

describe('wallSprites', () => {
  it('runs a wall along the grid lines between its posts: joints by their connections, bodies in between', () => {
    // An L of posts on the vertices (2,2) (3,2) (3,3): the top-left corners of those tiles.
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '3,3': 'wall-brick' }) });
    const sprites = wallSprites(layout);
    const joints = sprites.filter((sprite) => sprite.part === 'joint');
    const bodies = sprites.filter((sprite) => sprite.part === 'body');

    expect(joints).toEqual([
      { piece: 'wall-brick', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 2 }), x: 2 * TILE - 8, y: 2 * TILE - 8, depthY: 2 * TILE + 8 },
      { piece: 'wall-brick', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 8 | 4 }), x: 3 * TILE - 8, y: 2 * TILE - 8, depthY: 2 * TILE + 8 },
      { piece: 'wall-brick', part: 'joint', frame: wallFrameIndex({ piece: 'joint', mask: 1 }), x: 3 * TILE - 8, y: 3 * TILE - 8, depthY: 3 * TILE + 8 },
    ]);
    expect(bodies).toEqual([
      { piece: 'wall-brick', part: 'body', frame: wallFrameIndex({ piece: 'body', axis: 'horizontal' }), x: 2 * TILE + 8, y: 2 * TILE - 8, depthY: 2 * TILE + 8 },
      { piece: 'wall-brick', part: 'body', frame: wallFrameIndex({ piece: 'body', axis: 'vertical' }), x: 3 * TILE - 8, y: 2 * TILE + 8, depthY: 2 * TILE + 24 },
    ]);
  });

  it('joins walls of different materials (#223): connected joints, the later post laid over the earlier one', () => {
    // The same L, its last post glass and the latest one placed: it joins the brick corner.
    const walls = tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '3,3': 'wall-glass' });
    const sprites = wallSprites(blankLayout({ walls }));
    const above = (sprite: { depthY: number }, base: number): boolean => sprite.depthY > base && sprite.depthY < base + 1;

    const joints = sprites.filter((sprite) => sprite.part === 'joint');
    expect(joints.map(({ piece, frame }) => [piece, frame])).toEqual([
      ['wall-brick', wallFrameIndex({ piece: 'joint', mask: 2 })],
      // The earlier corner draws connected toward the later wall: no rounded cap on that side.
      ['wall-brick', wallFrameIndex({ piece: 'joint', mask: 8 | 4 })],
      ['wall-glass', wallFrameIndex({ piece: 'joint', mask: 1 })],
    ]);
    // The body between them is the later post's material, over the earlier wall.
    const bodies = sprites.filter((sprite) => sprite.part === 'body');
    expect(bodies.map(({ piece, x, y }) => [piece, x, y])).toEqual([
      ['wall-brick', 2 * TILE + 8, 2 * TILE - 8],
      ['wall-glass', 3 * TILE - 8, 2 * TILE + 8],
    ]);
    expect(above(bodies[1]!, 2 * TILE + 24)).toBe(true);
    expect(above(joints[2]!, 3 * TILE + 8)).toBe(true);
    // The earlier wall is not raised: only what the later one lays over it.
    expect(joints[1]!.depthY).toBe(2 * TILE + 8);
    expect(bodies[0]!.depthY).toBe(2 * TILE + 8);
  });

  it('lays whichever post was placed last over the other, whatever its tile order', () => {
    const walls = tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-glass' });
    const byIndex = wallSprites(blankLayout({ walls }));
    expect(byIndex.filter((sprite) => sprite.part === 'body').map(({ piece }) => piece)).toEqual(['wall-glass']);

    // The brick post at tile 2,2 placed after the glass one: its material wins the body.
    const brickLast = wallSprites({ ...blankLayout({ walls }), wallOrder: [2 * 18 + 3, 2 * 18 + 2] });
    expect(brickLast.filter((sprite) => sprite.part === 'body').map(({ piece }) => piece)).toEqual(['wall-brick']);
    expect(brickLast.filter((sprite) => sprite.part === 'joint').map(({ frame }) => frame)).toEqual([
      wallFrameIndex({ piece: 'joint', mask: 2 }),
      wallFrameIndex({ piece: 'joint', mask: 8 }),
    ]);
  });

  it('draws three materials in a row as one wall, each cut cleanly by the later one', () => {
    const walls = tiles(18, { '2,2': 'wall-plaster', '3,2': 'wall-glass', '4,2': 'wall-stone' });
    const sprites = wallSprites({ ...blankLayout({ walls }), wallOrder: [2 * 18 + 2, 2 * 18 + 3, 2 * 18 + 4] });

    expect(sprites.filter((sprite) => sprite.part === 'joint').map(({ piece, frame }) => [piece, frame])).toEqual([
      ['wall-plaster', wallFrameIndex({ piece: 'joint', mask: 2 })],
      ['wall-glass', wallFrameIndex({ piece: 'joint', mask: 2 | 8 })],
      ['wall-stone', wallFrameIndex({ piece: 'joint', mask: 8 })],
    ]);
    expect(sprites.filter((sprite) => sprite.part === 'body').map(({ piece }) => piece)).toEqual(['wall-glass', 'wall-stone']);
    const [glassBody, stoneBody] = sprites.filter((sprite) => sprite.part === 'body');
    expect(stoneBody!.depthY).toBeGreaterThan(glassBody!.depthY);
  });

  it('draws a wall of one material exactly as before, whatever the placement order', () => {
    const walls = tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '3,3': 'wall-brick' });
    const plain = wallSprites(blankLayout({ walls }));

    expect(wallSprites({ ...blankLayout({ walls }), wallOrder: [3 * 18 + 3, 2 * 18 + 2, 2 * 18 + 3] })).toEqual(plain);
    expect(plain.map(({ depthY }) => depthY)).toEqual([2 * TILE + 8, 2 * TILE + 8, 3 * TILE + 8, 2 * TILE + 8, 2 * TILE + 24]);
  });

  it('leaves out the body of a door opening (#223), its joints still drawn connected', () => {
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '4,2': 'wall-brick' }) });
    const sprites = wallSprites({ ...layout, openings: [{ col: 2, row: 2, axis: 'horizontal' }] });

    expect(sprites.filter((sprite) => sprite.part === 'joint').map(({ frame }) => frame)).toEqual([
      wallFrameIndex({ piece: 'joint', mask: 2 }),
      wallFrameIndex({ piece: 'joint', mask: 2 | 8 }),
      wallFrameIndex({ piece: 'joint', mask: 8 }),
    ]);
    expect(sprites.filter((sprite) => sprite.part === 'body')).toEqual([
      { piece: 'wall-brick', part: 'body', frame: wallFrameIndex({ piece: 'body', axis: 'horizontal' }), x: 3 * TILE + 8, y: 2 * TILE - 8, depthY: 2 * TILE + 8 },
    ]);
    // Without openings every body is drawn as before.
    expect(wallSprites({ ...layout, openings: [] })).toEqual(wallSprites(layout));
  });

  it('draws no joint at a post whose only connections are open door edges: two doors read as one opening (#223)', () => {
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '4,2': 'wall-brick', '5,2': 'wall-brick' }) });
    const doors = [{ col: 2, row: 2, axis: 'horizontal' as const }, { col: 3, row: 2, axis: 'horizontal' as const }];
    const joints = (grid: Parameters<typeof wallSprites>[0]) => wallSprites(grid).filter((sprite) => sprite.part === 'joint').map(({ frame, x }) => [frame, x]);

    // Post 3,2 sits between the two leaves and nothing else meets it: it draws nothing. The posts at the ends of the opening stay.
    expect(joints({ ...layout, openings: doors })).toEqual([
      [wallFrameIndex({ piece: 'joint', mask: 2 }), 2 * TILE - 8],
      [wallFrameIndex({ piece: 'joint', mask: 2 | 8 }), 4 * TILE - 8],
      [wallFrameIndex({ piece: 'joint', mask: 8 }), 5 * TILE - 8],
    ]);
    // Neither door leaves a body behind.
    expect(wallSprites({ ...layout, openings: doors }).filter((sprite) => sprite.part === 'body')).toHaveLength(1);
  });

  it('keeps the joint of a post between two doors where another wall meets it (a T) (#223)', () => {
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '4,2': 'wall-brick', '3,3': 'wall-brick' }) });
    const doors = [{ col: 2, row: 2, axis: 'horizontal' as const }, { col: 3, row: 2, axis: 'horizontal' as const }];
    const tee = wallSprites({ ...layout, openings: doors }).filter((sprite) => sprite.part === 'joint' && sprite.x === 3 * TILE - 8 && sprite.y === 2 * TILE - 8);

    expect(tee.map(({ frame }) => frame)).toEqual([wallFrameIndex({ piece: 'joint', mask: 2 | 4 | 8 })]);
  });

  it('draws exactly the rectangles the wall blocks', () => {
    const layout = blankLayout({ walls: tiles(18, { '2,2': 'wall-brick', '3,2': 'wall-brick', '3,3': 'wall-glass' }) });
    const drawn = wallSprites(layout).map(({ x, y }) => ({ x, y, w: 16, h: 16 }));

    expect(drawn).toEqual(wallFootprintRects(layout));
  });

  it('shows a lone post instead of dropping it', () => {
    const sprites = wallSprites(blankLayout({ walls: tiles(18, { '5,5': 'wall-stone' }) }));

    expect(sprites).toEqual([
      { piece: 'wall-stone', part: 'joint', frame: wallFrameIndex({ piece: 'body', axis: 'vertical' }), x: 5 * TILE - 8, y: 5 * TILE - 8, depthY: 5 * TILE + 8 },
    ]);
  });

  it('closes both rooms of the office except their doors', () => {
    const joints = wallSprites(BASE_LAYOUT).filter((sprite) => sprite.part === 'joint');

    // Two rings of posts on the vertices one tile inside each 13x14 room (12x13
    // posts, 46 each), less the three posts around each two-tile door.
    expect(joints).toHaveLength(2 * (2 * 12 + 2 * 13 - 4 - 3));
    for (const ty of [8, 9, 10]) expect(joints.some((joint) => joint.x === 51 * TILE - 8 && joint.y === ty * TILE - 8)).toBe(false);
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
        // A desk piece is a decor table now (3 tiles); a Tiled desk keeps its own footprint, along the same axis.
        const declared = piece.facings[prop.facing!].footprint;
        expect(declared.w > declared.h).toBe(prop.w > prop.h);
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
