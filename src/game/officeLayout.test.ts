import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { TERRAIN_DECALS, TERRAIN_MATERIALS, TERRAIN_WALKABLE } from './artContract';
import { physicalBodyRect } from './avatarGeometry';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from './mapData';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../test/legacyOffice';
import {
  AVATAR_BODY_CENTER_OFFSET,
  BLOCK_TILES,
  BORDER_JITTER_TILES,
  blockAtWorldPoint,
  blockCount,
  blockTileRect,
  decodeTerrainBlocks,
  decodeTerrainWalls,
  decodeTerrainWallOrder,
  encodeTerrainBlocks,
  encodeTerrainWalls,
  isWallPieceId,
  orderedWallPosts,
  tileAtWorldPoint,
  wallsJoin,
  withWallOrder,
  withWalls,
  MAX_WALL_EDITS,
  WALL_PIECES,
  isLayoutMaterial,
  newlyUnwalkableTiles,
  withBlock,
  InvalidOfficeLayoutError,
  LAYOUT_DECALS,
  LAYOUT_MATERIALS,
  MATERIAL_WALKABLE,
  blockIndexAt,
  isFootprintWalkable,
  isPositionWalkable,
  isTileWalkable,
  wallColliderRects,
  wallFootprintRects,
  wallPostTiles,
  wallStretches,
  wallTileFrames,
  jitteredBlockMaterial,
  parseOfficeLayout,
  terrainMaterialAt,
  terrainSnapshot,
  COLORABLE_TERRAIN_MATERIALS,
  decodeTerrainColors,
  encodeTerrainColors,
  isColorableTerrainMaterial,
  isTerrainColor,
  withTerrainColors,
  type LayoutMaterial,
  type OfficeLayout,
} from './officeLayout';

/** The palette every test map uses: terrain materials, walls and the hedge, by tile `type`. */
const PALETTE = [...LAYOUT_MATERIALS, 'wall-brick', 'wall-stone', 'wall-plaster', 'wall-glass', 'hedge-boxwood', ...LAYOUT_DECALS];

function gidOf(name: string): number {
  const index = PALETTE.indexOf(name);
  if (index < 0) throw new Error(`no palette tile ${name}`);
  return index + 1;
}

interface TestObject {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: { name: string; type: string; value: unknown }[];
}

/** A Tiled JSON map as Tiled saves it, small enough to read in a test. */
function tiledMap(options: {
  width: number;
  height: number;
  blocks: (tx: number, ty: number) => string;
  ground?: (tx: number, ty: number) => string | null;
  walls?: (tx: number, ty: number) => string | null;
  hedges?: (tx: number, ty: number) => boolean;
  decals?: (tx: number, ty: number) => string | null;
  props?: TestObject[];
}): Record<string, unknown> {
  const { width, height } = options;
  const layer = (name: string, id: number, cell: (tx: number, ty: number) => number) => {
    const data: number[] = [];
    for (let ty = 0; ty < height; ty += 1) for (let tx = 0; tx < width; tx += 1) data.push(cell(tx, ty));
    return { data, height, id, name, opacity: 1, type: 'tilelayer', visible: true, width, x: 0, y: 0 };
  };
  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [
      layer('blocks', 1, (tx, ty) => gidOf(options.blocks(tx, ty))),
      layer('ground', 2, (tx, ty) => {
        const material = options.ground?.(tx, ty) ?? null;
        return material === null ? 0 : gidOf(material);
      }),
      layer('walls', 3, (tx, ty) => {
        const wall = options.walls?.(tx, ty) ?? null;
        return wall === null ? 0 : gidOf(wall);
      }),
      layer('hedges', 4, (tx, ty) => (options.hedges?.(tx, ty) ? gidOf('hedge-boxwood') : 0)),
      layer('decals', 6, (tx, ty) => {
        const decal = options.decals?.(tx, ty) ?? null;
        return decal === null ? 0 : gidOf(decal);
      }),
      {
        draworder: 'topdown',
        id: 5,
        name: 'props',
        objects: (options.props ?? []).map((object, index) => ({ id: index + 1, name: '', rotation: 0, visible: true, ...object })),
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 6,
    nextobjectid: 1,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    tileheight: 32,
    tilesets: [
      {
        columns: PALETTE.length,
        firstgid: 1,
        image: 'layout-palette.png',
        imageheight: 32,
        imagewidth: 32 * PALETTE.length,
        margin: 0,
        name: 'layout-palette',
        spacing: 0,
        tilecount: PALETTE.length,
        tileheight: 32,
        tiles: PALETTE.map((name, id) => ({ id, type: name })),
        tilewidth: 32,
      },
    ],
    tilewidth: 32,
    type: 'map',
    version: '1.10',
    width,
  };
}

const grassMap = (extra: Partial<Parameters<typeof tiledMap>[0]> = {}) =>
  parseOfficeLayout(tiledMap({ width: 18, height: 9, blocks: () => 'grass', ...extra }));

describe('layout vocabulary', () => {
  it('restates the terrain materials of the art contract in its drawing priority', () => {
    // Void ("no terrain") comes first: below water, nothing is drawn for it and nobody walks on it.
    expect(LAYOUT_MATERIALS).toEqual(['void', ...TERRAIN_MATERIALS]);
    expect(MATERIAL_WALKABLE).toEqual({ void: false, ...TERRAIN_WALKABLE });
    expect(LAYOUT_DECALS).toEqual(TERRAIN_DECALS);
  });

  it('checks movement at the center of the Arcade body, which sits up and left of the position', () => {
    const body = physicalBodyRect({ x: 500, y: 300 });
    expect({ x: 500 + AVATAR_BODY_CENTER_OFFSET.x, y: 300 + AVATAR_BODY_CENTER_OFFSET.y }).toEqual({
      x: body.x + body.width / 2,
      y: body.y + body.height / 2,
    });
  });
});

describe('parseOfficeLayout', () => {
  it('reads blocks, tile overrides, walls, hedges and props from the named layers', () => {
    const layout = parseOfficeLayout(
      tiledMap({
        width: 18,
        height: 9,
        blocks: (tx) => (tx < 9 ? 'grass' : 'sand'),
        ground: (_tx, ty) => (ty === 4 ? 'water' : null),
        walls: (tx, ty) => (tx === 2 && ty === 2 ? 'wall-brick' : null),
        hedges: (tx, ty) => tx === 0 && ty === 0,
        decals: (tx, ty) => (tx === 1 && ty === 7 ? 'clover' : null),
        props: [
          { type: 'tree-oak', x: 160, y: 64, width: 32, height: 32 },
          {
            type: 'bridge-wood',
            x: 32 * 6,
            y: 32 * 3,
            width: 96,
            height: 96,
            properties: [{ name: 'orientation', type: 'string', value: 'north-south' }],
          },
          { type: 'desk-wood', x: 32 * 12, y: 32, width: 64, height: 32 },
        ],
      }),
    );

    expect(layout.width).toBe(18);
    expect(layout.height).toBe(9);
    expect(layout.blocks).toEqual(['grass', 'sand']);
    expect(layout.ground[4 * 18 + 3]).toBe('water');
    expect(layout.ground[0]).toBeNull();
    expect(layout.walls[2 * 18 + 2]).toBe('wall-brick');
    expect(layout.walls[0]).toBeNull();
    expect(layout.hedges[0]).toBe('hedge-boxwood');
    expect(layout.hedges[1]).toBeNull();
    expect(layout.decals[7 * 18 + 1]).toBe('clover');
    expect(layout.decals[0]).toBeNull();
    expect(layout.props).toEqual([
      { piece: 'tree-oak', kind: 'tree', tx: 5, ty: 2, w: 1, h: 1, collision: 'solid', orientation: null, facing: null },
      { piece: 'bridge-wood', kind: 'bridge', tx: 6, ty: 3, w: 3, h: 3, collision: 'deck', orientation: 'north-south', facing: null },
      { piece: 'desk-wood', kind: 'desk', tx: 12, ty: 1, w: 2, h: 1, collision: 'solid', orientation: null, facing: 'down' },
    ]);
  });

  it('accepts the Tiled 1.9 `class` spelling of tile and object types and strips flip flags from gids', () => {
    const raw = tiledMap({ width: 9, height: 9, blocks: () => 'dirt', props: [{ type: 'plant-bonsai', x: 0, y: 0, width: 32, height: 32 }] });
    const tileset = (raw.tilesets as { tiles: { id: number; type?: string; class?: string }[] }[])[0];
    tileset.tiles = tileset.tiles.map(({ id, type }) => ({ id, class: type }));
    const props = (raw.layers as { name: string; objects?: Record<string, unknown>[] }[]).find((layer) => layer.name === 'props');
    props!.objects = props!.objects!.map(({ type, ...object }) => ({ ...object, class: type }));
    const blocks = (raw.layers as { name: string; data?: number[] }[]).find((layer) => layer.name === 'blocks');
    blocks!.data = blocks!.data!.map((gid) => (gid | 0x80000000) >>> 0);

    const layout = parseOfficeLayout(raw);

    expect(layout.blocks).toEqual(['dirt']);
    expect(layout.props[0]?.piece).toBe('plant-bonsai');
  });

  it('rejects a block that is not one material, naming it, so a stray stroke in Tiled cannot pass', () => {
    const raw = tiledMap({ width: 18, height: 9, blocks: (tx, ty) => (tx === 12 && ty === 3 ? 'sand' : 'grass') });

    expect(() => parseOfficeLayout(raw)).toThrow(InvalidOfficeLayoutError);
    expect(() => parseOfficeLayout(raw)).toThrow(/block \(1, 0\)/);
  });

  it('rejects maps that are not whole blocks, layers saved compressed, and pieces in the wrong layer', () => {
    expect(() => parseOfficeLayout(tiledMap({ width: 10, height: 9, blocks: () => 'grass' }))).toThrow(/whole 9x9 blocks/);

    const compressed = tiledMap({ width: 9, height: 9, blocks: () => 'grass' });
    (compressed.layers as Record<string, unknown>[])[0]!.data = 'eJzt...';
    expect(() => parseOfficeLayout(compressed)).toThrow(/CSV/);

    expect(() => parseOfficeLayout(tiledMap({ width: 9, height: 9, blocks: () => 'wall-brick' }))).toThrow(/blocks/);
    expect(() => parseOfficeLayout(tiledMap({ width: 9, height: 9, blocks: () => 'grass', walls: () => 'sand' }))).toThrow(/walls/);
    expect(() => parseOfficeLayout(tiledMap({ width: 9, height: 9, blocks: () => 'grass', decals: () => 'hedge-boxwood' }))).toThrow(/decals/);
    expect(() => parseOfficeLayout({})).toThrow(InvalidOfficeLayoutError);
    expect(() => parseOfficeLayout(null)).toThrow(InvalidOfficeLayoutError);
  });

  it('rejects props off the grid, outside the map, of an unknown kind, or bridges without orientation', () => {
    const withProp = (prop: TestObject) => () =>
      parseOfficeLayout(tiledMap({ width: 9, height: 9, blocks: () => 'grass', props: [prop] }));

    expect(withProp({ type: 'tree-oak', x: 10, y: 0, width: 32, height: 32 })).toThrow(/grid/);
    expect(withProp({ type: 'tree-oak', x: 32 * 8, y: 0, width: 64, height: 32 })).toThrow(/outside/);
    expect(withProp({ type: 'sofa-red', x: 0, y: 0, width: 32, height: 32 })).toThrow(/sofa-red/);
    expect(withProp({ type: 'bridge-wood', x: 0, y: 0, width: 96, height: 96 })).toThrow(/orientation/);
    expect(
      withProp({
        type: 'desk-wood',
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        properties: [{ name: 'facing', type: 'string', value: 'sideways' }],
      }),
    ).toThrow(/facing/);
  });
});

describe('terrain per tile', () => {
  const twoBlocks = (left: LayoutMaterial, right: LayoutMaterial): OfficeLayout =>
    grassMap({ blocks: (tx) => (tx < BLOCK_TILES ? left : right) });

  it('indexes blocks of 9x9 tiles row by row', () => {
    expect(blockIndexAt(18, 0, 0)).toBe(0);
    expect(blockIndexAt(18, 8, 8)).toBe(0);
    expect(blockIndexAt(18, 9, 0)).toBe(1);
    expect(blockIndexAt(18, 17, 8)).toBe(1);
    expect(blockIndexAt(126, 125, 89)).toBe(14 * 10 - 1);
  });

  it('keeps the inside of a block its own material and moves only the tiles near a border', () => {
    const layout = twoBlocks('grass', 'sand');

    for (let ty = 0; ty < 9; ty += 1) {
      for (let tx = 0; tx < 18; tx += 1) {
        const material = jitteredBlockMaterial(layout.blocks, 18, 9, tx, ty);
        if (tx < BLOCK_TILES - BORDER_JITTER_TILES) expect(material).toBe('grass');
        else if (tx >= BLOCK_TILES + BORDER_JITTER_TILES) expect(material).toBe('sand');
        else expect(['grass', 'sand']).toContain(material);
      }
    }
  });

  it('draws a border between blocks that is not a straight line, and the same one every time', () => {
    const layout = twoBlocks('grass', 'sand');
    const border = (): number[] => {
      const columns: number[] = [];
      for (let ty = 0; ty < 9; ty += 1) {
        let tx = 0;
        while (jitteredBlockMaterial(layout.blocks, 18, 9, tx, ty) === 'grass') tx += 1;
        columns.push(tx);
      }
      return columns;
    };

    expect(new Set(border()).size).toBeGreaterThan(1);
    expect(border()).toEqual(border());
  });

  it('lets a tile override of the layout win over the block, exactly at its tile', () => {
    const snapshot = terrainSnapshot(grassMap({ ground: (tx, ty) => (tx === 9 && ty === 4 ? 'water' : null) }));

    expect(terrainMaterialAt(snapshot, 9, 4)).toBe('water');
    expect(terrainMaterialAt(snapshot, 8, 4)).toBe('grass');
    expect(terrainMaterialAt(snapshot, 10, 4)).toBe('grass');
  });

  it('builds the snapshot from other blocks without touching the layout (the hook for persisted blocks)', () => {
    const layout = twoBlocks('grass', 'grass');
    const snapshot = terrainSnapshot(layout, ['grass', 'water']);

    expect(terrainMaterialAt(snapshot, 17, 0)).toBe('water');
    expect(isTileWalkable(snapshot, 17, 0)).toBe(false);
    expect(layout.blocks).toEqual(['grass', 'grass']);
    expect(() => terrainSnapshot(layout, ['grass'])).toThrow(/2 blocks/);
  });
});

describe('effective walkability', () => {
  it('blocks water and void and nothing else of the terrain', () => {
    const snapshot = terrainSnapshot(grassMap({ ground: (tx) => LAYOUT_MATERIALS[tx % LAYOUT_MATERIALS.length] ?? null }));

    for (let tx = 0; tx < 18; tx += 1) {
      const material = terrainMaterialAt(snapshot, tx, 4);
      expect(isTileWalkable(snapshot, tx, 4)).toBe(material !== 'water' && material !== 'void');
    }
  });

  it('opens water under a bridge deck, and the deck only', () => {
    const snapshot = terrainSnapshot(
      grassMap({
        ground: (_tx, ty) => (ty >= 3 && ty <= 5 ? 'water' : null),
        props: [
          {
            type: 'bridge-wood',
            x: 32 * 6,
            y: 32 * 3,
            width: 96,
            height: 96,
            properties: [{ name: 'orientation', type: 'string', value: 'north-south' }],
          },
        ],
      }),
    );

    expect(isTileWalkable(snapshot, 5, 4)).toBe(false);
    expect(isTileWalkable(snapshot, 6, 4)).toBe(true);
    expect(isTileWalkable(snapshot, 8, 5)).toBe(true);
    expect(isTileWalkable(snapshot, 9, 4)).toBe(false);
  });

  it('lets walls and hedges block whatever is under them, and leaves solid props to their collision rectangles', () => {
    const snapshot = terrainSnapshot(
      grassMap({
        ground: (_tx, ty) => (ty >= 3 && ty <= 5 ? 'water' : null),
        walls: (tx, ty) => (tx === 1 && ty === 1 ? 'wall-stone' : null),
        hedges: (tx, ty) => tx === 2 && ty === 1,
        props: [
          { type: 'table-cafeteria', x: 32 * 10, y: 0, width: 32 * 5, height: 96 },
          {
            type: 'bridge-wood',
            x: 32 * 6,
            y: 32 * 3,
            width: 96,
            height: 96,
            properties: [{ name: 'orientation', type: 'string', value: 'east-west' }],
          },
          { type: 'plant-bonsai', x: 32 * 7, y: 32 * 4, width: 32, height: 32 },
        ],
      }),
    );

    // A wall stands on tiles: it collides through its rectangle (rows 0 to 2 of its column), never by tile.
    expect(isTileWalkable(snapshot, 1, 1)).toBe(true);
    expect(snapshot.wallRects).toEqual([{ x: 32, y: 0, w: 32, h: 96 }]);
    expect(isTileWalkable(snapshot, 2, 1)).toBe(false);
    // The table and the plant on the deck collide through pieceCollisions.ts, not here.
    expect(isTileWalkable(snapshot, 12, 1)).toBe(true);
    expect(isTileWalkable(snapshot, 15, 1)).toBe(true);
    expect(isTileWalkable(snapshot, 7, 4)).toBe(true);
    expect(isTileWalkable(snapshot, 6, 4)).toBe(true);
  });

  it('never walks outside the map', () => {
    const snapshot = terrainSnapshot(grassMap());

    expect(isTileWalkable(snapshot, -1, 0)).toBe(false);
    expect(isTileWalkable(snapshot, 0, -1)).toBe(false);
    expect(isTileWalkable(snapshot, 18, 0)).toBe(false);
    expect(isTileWalkable(snapshot, 0, 9)).toBe(false);
    expect(isTileWalkable(snapshot, 1.5, 0)).toBe(false);
  });

  it('judges a network position by the tile under its body center', () => {
    const snapshot = terrainSnapshot(grassMap({ ground: (tx, ty) => (tx === 4 && ty === 4 ? 'water' : null) }));
    // Body center (x, y + 11), centered in tile (4, 4).
    const onWater = { x: 4 * 32 + 16, y: 4 * 32 + 5 };

    expect(isPositionWalkable(snapshot, onWater.x, onWater.y)).toBe(false);
    expect(isPositionWalkable(snapshot, onWater.x + 32, onWater.y)).toBe(true);
    expect(isPositionWalkable(snapshot, Number.NaN, onWater.y)).toBe(false);
  });
});

describe('the committed layout (maps/office.json)', () => {
  const props = (kind: string) => BASE_LAYOUT.props.filter((prop) => prop.kind === kind);

  it('keeps the base desks, tables, plants and trees of the map that was code, at the same tiles', () => {
    const deskRows = [
      [3, 5, 3],
      [13, 4, 2],
      [20, 4, 3],
      [27, 4, 2],
      [3, 14, 3],
      [12, 15, 3],
      [25, 15, 3],
      [33, 14, 3],
      [4, 24, 2],
      [16, 24, 3],
      [27, 24, 3],
      [4, 36, 3],
      [16, 36, 3],
      [28, 36, 3],
    ];
    const desks = deskRows.flatMap(([x, y, n]) => Array.from({ length: n! }, (_, i) => ({ tx: x! + i * 2, ty: y!, w: 2, h: 1 })));
    const oldTrees = [
      [2, 2], [9, 2], [18, 2], [30, 2], [40, 2], [46, 4], [2, 9], [46, 12], [2, 26], [46, 26],
      [2, 34], [44, 34], [12, 41], [24, 41], [36, 41], [44, 41], [52, 34], [56, 36], [60, 34],
    ];

    expect(props('desk').map(({ tx, ty, w, h }) => ({ tx, ty, w, h }))).toEqual(desks);
    expect(props('desk').every((desk) => desk.piece === 'desk-wood' && desk.facing === 'down')).toBe(true);
    expect(props('table').map(({ piece, tx, ty, w, h }) => ({ piece, tx, ty, w, h }))).toEqual([
      { piece: 'table-meeting', tx: 53, ty: 6, w: 7, h: 5 },
      { piece: 'table-cafeteria', tx: 53, ty: 23, w: 5, h: 3 },
    ]);
    for (const [tx, ty] of [[51, 19], [61, 19], [51, 30], [61, 30]]) {
      expect(props('plant')).toContainEqual(expect.objectContaining({ piece: 'plant-bonsai', tx, ty }));
    }
    for (const [tx, ty] of oldTrees) expect(props('tree')).toContainEqual(expect.objectContaining({ tx, ty }));
    expect(props('bridge').map(({ tx, ty, orientation }) => ({ tx, ty, orientation }))).toEqual([
      { tx: 13, ty: 19, orientation: 'north-south' },
      { tx: 32, ty: 19, orientation: 'north-south' },
    ]);
  });

  it('grows the world with trees and a lake, without a tree, plant or table on water', () => {
    const bare = terrainSnapshot({ ...BASE_LAYOUT, props: props('bridge') });

    expect(props('tree').length).toBeGreaterThan(100);
    expect(BASE_TERRAIN.materials.filter((material) => material === 'water').length).toBeGreaterThan(300);
    for (const prop of BASE_LAYOUT.props.filter((candidate) => candidate.kind !== 'bridge')) {
      for (let ty = prop.ty; ty < prop.ty + prop.h; ty += 1) {
        for (let tx = prop.tx; tx < prop.tx + prop.w; tx += 1) {
          expect(isTileWalkable(bare, tx, ty), `${prop.piece} at (${tx}, ${ty})`).toBe(true);
        }
      }
    }
  });

  it('spawns everyone on walkable ground, and keeps every chair reachable', () => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        expect(isTileWalkable(BASE_TERRAIN, PLAYER_SPAWN_TX + dx, PLAYER_SPAWN_TY + dy)).toBe(true);
      }
    }
    for (const seat of BASE_MAP_SEATS) expect(isTileWalkable(BASE_TERRAIN, seat.tx, seat.ty)).toBe(true);
  });

  it('blocks the river and the lake', () => {
    expect(isTileWalkable(BASE_TERRAIN, 20, 20)).toBe(false);
    expect(isTileWalkable(BASE_TERRAIN, 14, 20)).toBe(true);
    // The middle of the lake blocks: 9x9 tiles stay their block's material that far from a border.
    expect(terrainMaterialAt(BASE_TERRAIN, 94, 62)).toBe('water');
    expect(isTileWalkable(BASE_TERRAIN, 94, 62)).toBe(false);
  });
});

/**
 * Block edits (#123 phase 2): the server persists one material per block and
 * replicates the whole list, so both sides need the same helpers to apply an
 * edit, carry it on the wire and find the tiles it floods.
 */
describe('terrain block edits', () => {
  const COUNT = (BASE_LAYOUT.width / BLOCK_TILES) * (BASE_LAYOUT.height / BLOCK_TILES);

  it('counts the blocks of a layout and replaces exactly one of them', () => {
    expect(blockCount(BASE_LAYOUT)).toBe(140);
    const next = withBlock(BASE_LAYOUT.blocks, 35, 'water');

    expect(next[35]).toBe('water');
    expect(next.filter((material, index) => material !== BASE_LAYOUT.blocks[index])).toEqual(['water']);
    expect(BASE_LAYOUT.blocks[35]).toBe('grass');
    expect(() => withBlock(BASE_LAYOUT.blocks, COUNT, 'sand')).toThrow(InvalidOfficeLayoutError);
    expect(() => withBlock(BASE_LAYOUT.blocks, -1, 'sand')).toThrow(InvalidOfficeLayoutError);
    expect(() => withBlock(BASE_LAYOUT.blocks, 1.5, 'sand')).toThrow(InvalidOfficeLayoutError);
  });

  it('round-trips the block list through its wire form, and refuses anything else', () => {
    const blocks = withBlock(BASE_LAYOUT.blocks, 0, 'carpet');

    expect(decodeTerrainBlocks(encodeTerrainBlocks(blocks), COUNT)).toEqual(blocks);
    expect(decodeTerrainBlocks(encodeTerrainBlocks(blocks), COUNT - 1)).toBeNull();
    expect(decodeTerrainBlocks(encodeTerrainBlocks(blocks).replace('carpet', 'lava'), COUNT)).toBeNull();
    expect(decodeTerrainBlocks('', COUNT)).toBeNull();
    expect(decodeTerrainBlocks(42, COUNT)).toBeNull();
  });

  it('round-trips the sparse block colors through their wire form, sorted by block, empty for none (#222)', () => {
    const colors = new Map([[35, '#aa3322'], [2, '#0055ff']]);

    expect(encodeTerrainColors(colors)).toBe('2:#0055ff,35:#aa3322');
    expect(decodeTerrainColors(encodeTerrainColors(colors), COUNT)).toEqual(new Map([[2, '#0055ff'], [35, '#aa3322']]));
    expect(encodeTerrainColors(new Map())).toBe('');
    expect(decodeTerrainColors('', COUNT)).toEqual(new Map());
  });

  it('refuses a whole colors string with any malformed, off-map or repeated entry', () => {
    for (const raw of ['2:#0055FF', '2:#05f', '2:0055ff', `${COUNT}:#0055ff`, '2:#0055ff,2:#aa3322', '2:#0055ff,', 'x:#0055ff', '-1:#0055ff']) {
      expect(decodeTerrainColors(raw, COUNT), raw).toBeNull();
    }
    expect(decodeTerrainColors(undefined, COUNT)).toBeNull();
    expect(decodeTerrainColors(42, COUNT)).toBeNull();
  });

  it('names exactly the terrain materials whose art pack floor is colorable', () => {
    const pack = JSON.parse(exportedManifest) as { pieces: { kind: string; material?: string; colorable?: boolean }[] };
    const colorable = pack.pieces
      .filter((piece) => piece.kind === 'floor' && piece.colorable === true && isLayoutMaterial(piece.material))
      .map((piece) => piece.material);
    expect([...COLORABLE_TERRAIN_MATERIALS].sort()).toEqual(colorable.sort());
    for (const material of LAYOUT_MATERIALS) expect(isColorableTerrainMaterial(material)).toBe(colorable.includes(material));
  });

  it('takes only a strict lower-case #rrggbb as a terrain color', () => {
    expect(isTerrainColor('#a0b1c2')).toBe(true);
    for (const value of ['#A0B1C2', '#abc', 'a0b1c2', '#a0b1c2 ', null, undefined, 7]) expect(isTerrainColor(value)).toBe(false);
  });

  it('sets the color an edit carries on a colorable block and clears it on any other edit of that block', () => {
    const colors = new Map([[1, '#111111'], [2, '#222222'], [3, '#333333']]);

    const next = withTerrainColors(colors, [
      { index: 1, material: 'grass' },
      { index: 2, material: 'carpet' },
      { index: 4, material: 'carpet', color: '#444444' },
    ]);

    expect(next).toEqual(new Map([[3, '#333333'], [4, '#444444']]));
    expect(colors).toEqual(new Map([[1, '#111111'], [2, '#222222'], [3, '#333333']]));
  });

  it('tells a material name from anything else', () => {
    for (const material of LAYOUT_MATERIALS) expect(isLayoutMaterial(material)).toBe(true);
    expect(isLayoutMaterial('lava')).toBe(false);
    expect(isLayoutMaterial(undefined)).toBe(false);
  });

  it('finds the 9x9 tiles of a block and the block under a world point', () => {
    expect(blockTileRect(BASE_LAYOUT.width, 0)).toEqual({ tx: 0, ty: 0, w: 9, h: 9 });
    expect(blockTileRect(BASE_LAYOUT.width, 15)).toEqual({ tx: 9, ty: 9, w: 9, h: 9 });
    expect(blockAtWorldPoint(BASE_LAYOUT, 9 * 32 + 1, 9 * 32 + 1)).toBe(15);
    expect(blockAtWorldPoint(BASE_LAYOUT, BASE_LAYOUT.width * 32 - 1, BASE_LAYOUT.height * 32 - 1)).toBe(139);
    expect(blockAtWorldPoint(BASE_LAYOUT, -1, 10)).toBeNull();
    expect(blockAtWorldPoint(BASE_LAYOUT, 10, BASE_LAYOUT.height * 32)).toBeNull();
  });

  it('lists exactly the tiles an edit turns into water, never neighboring blocks', () => {
    const watered = newlyUnwalkableTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 35, 'water')));
    const inside = (index: number) => {
      const tx = index % BASE_LAYOUT.width;
      const ty = Math.floor(index / BASE_LAYOUT.width);
      return tx >= 63 && tx < 72 && ty >= 18 && ty < 27;
    };

    // The middle of the block is always its own material.
    expect(watered).toContain(22 * BASE_LAYOUT.width + 67);
    expect(watered.every(inside)).toBe(true);
    expect(watered).toHaveLength(81);
    expect(watered.every((index) => BASE_TERRAIN.materials[index] !== 'water')).toBe(true);
    // Drying the lake floods nothing.
    expect(newlyUnwalkableTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 94, 'grass')))).toEqual([]);
  });

  it('treats void like water: erasing a lawn lists its tiles, turning water into void lists none', () => {
    const erased = newlyUnwalkableTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 35, 'void')));
    expect(erased).toHaveLength(81);
    expect(erased).toContain(22 * BASE_LAYOUT.width + 67);
    expect(newlyUnwalkableTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 94, 'void')))).toEqual([]);
  });

  it('makes a void block nonwalkable, like water', () => {
    const voided = terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 35, 'void'));
    expect(terrainMaterialAt(voided, 67, 22)).toBe('void');
    expect(isTileWalkable(voided, 67, 22)).toBe(false);
  });
});

describe('terrain walls', () => {
  const TILES = BASE_LAYOUT.width * BASE_LAYOUT.height;
  const at = (tx: number, ty: number) => ty * BASE_LAYOUT.width + tx;

  it('names exactly the wall pieces of the art pack', () => {
    const pack = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string }[] };
    expect([...WALL_PIECES].sort()).toEqual(pack.pieces.filter((piece) => piece.kind === 'wall').map((piece) => piece.id).sort());
    for (const piece of WALL_PIECES) expect(isWallPieceId(piece)).toBe(true);
    expect(isWallPieceId('wall-lava')).toBe(false);
    expect(isWallPieceId(null)).toBe(false);
    expect(MAX_WALL_EDITS).toBe(2000);
  });

  it('sets and erases single tiles, leaving every other tile and the input alone', () => {
    const empty = new Array<string | null>(TILES).fill(null);
    const built = withWalls(empty, [{ index: 5, piece: 'wall-brick' }, { index: 6, piece: 'wall-glass' }]);
    const erased = withWalls(built, [{ index: 5, piece: null }]);

    expect(built[5]).toBe('wall-brick');
    expect(built[6]).toBe('wall-glass');
    expect(empty.every((wall) => wall === null)).toBe(true);
    expect(erased.filter((wall) => wall !== null)).toEqual(['wall-glass']);
    expect(() => withWalls(empty, [{ index: TILES, piece: 'wall-brick' }])).toThrow(InvalidOfficeLayoutError);
    expect(() => withWalls(empty, [{ index: -1, piece: 'wall-brick' }])).toThrow(InvalidOfficeLayoutError);
  });

  it('round-trips the walls through a sparse wire form, and refuses anything else', () => {
    const walls = withWalls(new Array<string | null>(TILES).fill(null), [
      { index: 0, piece: 'wall-brick' },
      { index: 7, piece: 'wall-stone' },
      { index: TILES - 1, piece: 'wall-plaster' },
      { index: 40, piece: 'wall-glass' },
    ]);
    const encoded = encodeTerrainWalls(walls);

    expect(encoded).toBe(`0:brick,7:stone,40:glass,${TILES - 1}:plaster`);
    expect(decodeTerrainWalls(encoded, TILES)).toEqual(walls);
    expect(encodeTerrainWalls(new Array<string | null>(TILES).fill(null))).toBe('');
    expect(decodeTerrainWalls('', TILES)).toEqual(new Array(TILES).fill(null));
    for (const garbage of [`${TILES}:brick`, '-1:brick', '1.5:brick', '3:lava', '3', '3:brick,3:stone', 'x:brick', ',', ' 3:brick']) {
      expect(decodeTerrainWalls(garbage, TILES), garbage).toBeNull();
    }
    expect(decodeTerrainWalls(42, TILES)).toBeNull();
    expect(decodeTerrainWalls(undefined, TILES)).toBeNull();
  });

  it('lists the standing posts in placement order: the unordered ones first by tile, then the ordered ones', () => {
    const walls = withWalls(new Array<string | null>(TILES).fill(null), [
      { index: 9, piece: 'wall-brick' },
      { index: 3, piece: 'wall-stone' },
      { index: 5, piece: 'wall-glass' },
      { index: 1, piece: 'wall-glass' },
    ]);

    expect(orderedWallPosts(walls)).toEqual([1, 3, 5, 9]);
    expect(orderedWallPosts(walls, [5, 9])).toEqual([1, 3, 5, 9]);
    expect(orderedWallPosts(walls, [9, 5])).toEqual([1, 3, 9, 5]);
    // A listed tile with no post any more, and a repeated one, are ignored.
    expect(orderedWallPosts(walls, [7, 9, 1, 9])).toEqual([3, 5, 9, 1]);
  });

  it('moves a post to the end of the placement order when it is placed or repainted, and drops it when removed', () => {
    const walls = withWalls(new Array<string | null>(TILES).fill(null), [
      { index: 2, piece: 'wall-brick' },
      { index: 4, piece: 'wall-brick' },
      { index: 6, piece: 'wall-brick' },
    ]);

    expect(withWallOrder([2, 4, 6], walls, [{ index: 8, piece: 'wall-glass' }])).toEqual([2, 4, 6, 8]);
    // A repaint (another piece on a standing post) makes it the latest.
    expect(withWallOrder([2, 4, 6], walls, [{ index: 2, piece: 'wall-glass' }])).toEqual([4, 6, 2]);
    // The same piece again is no edit at all.
    expect(withWallOrder([2, 4, 6], walls, [{ index: 2, piece: 'wall-brick' }])).toEqual([2, 4, 6]);
    expect(withWallOrder([2, 4, 6], walls, [{ index: 4, piece: null }])).toEqual([2, 6]);
    expect(withWallOrder([2, 4, 6], walls, [{ index: 6, piece: 'wall-stone' }, { index: 2, piece: 'wall-stone' }])).toEqual([4, 6, 2]);
  });

  it('puts the walls on the wire in placement order, and an index-ordered string stays valid', () => {
    const walls = withWalls(new Array<string | null>(TILES).fill(null), [
      { index: 7, piece: 'wall-stone' },
      { index: 0, piece: 'wall-brick' },
      { index: 40, piece: 'wall-glass' },
    ]);
    const encoded = encodeTerrainWalls(walls, [40, 7, 0]);

    expect(encoded).toBe('40:glass,7:stone,0:brick');
    expect(decodeTerrainWalls(encoded, TILES)).toEqual(walls);
    expect(decodeTerrainWallOrder(encoded, TILES)).toEqual([40, 7, 0]);
    // Without an order the string is index ordered, as before, and decodes to that order.
    expect(encodeTerrainWalls(walls)).toBe('0:brick,7:stone,40:glass');
    expect(decodeTerrainWallOrder('0:brick,7:stone,40:glass', TILES)).toEqual([0, 7, 40]);
    expect(decodeTerrainWallOrder('', TILES)).toEqual([]);
    for (const garbage of [`${TILES}:brick`, '3:brick,3:stone', 'x:brick', ',']) expect(decodeTerrainWallOrder(garbage, TILES), garbage).toBeNull();
    expect(decodeTerrainWallOrder(undefined, TILES)).toBeNull();
  });

  it('carries the placement order in the snapshot, empty when none is given', () => {
    const walls = withWalls(BASE_LAYOUT.walls, [{ index: at(67, 22), piece: 'wall-brick' }]);

    expect(terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, walls).wallOrder).toEqual([]);
    expect(terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, walls, [], [at(67, 22)]).wallOrder).toEqual([at(67, 22)]);
  });

  it('carries the live walls in the snapshot as columns of three tiles, over terrain and decks alike', () => {
    const walls = withWalls(BASE_LAYOUT.walls, [{ index: at(67, 22), piece: 'wall-brick' }]);
    const snapshot = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, walls);
    const column = { x: 67 * 32, y: 21 * 32, w: 32, h: 3 * 32 };

    expect(snapshot.walls).toEqual(walls);
    // The wall stands on tile (67, 22) and covers the tiles above and below it, through its rectangle, never by tile.
    expect(isTileWalkable(snapshot, 67, 22)).toBe(true);
    expect(snapshot.wallRects).toContainEqual(column);
    expect(BASE_TERRAIN.wallRects).not.toContainEqual(column);
    for (const ty of [21, 22, 23]) expect(snapshot.wallTiles[at(67, ty)]).toBe(true);
    for (const [tx, ty] of [[67, 20], [67, 24], [66, 22], [68, 22]] as const) expect(snapshot.wallTiles[at(tx, ty)]).toBe(BASE_TERRAIN.wallTiles[at(tx, ty)]);
    expect(terrainSnapshot(BASE_LAYOUT).walls).toEqual(BASE_LAYOUT.walls);
    // A bridge deck opens water, a wall on it closes the wall's tiles again.
    const deck = BASE_LAYOUT.props.find((prop) => prop.collision === 'deck')!;
    const onDeck = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, withWalls(BASE_LAYOUT.walls, [{ index: at(deck.tx + 1, deck.ty + 1), piece: 'wall-stone' }]));
    const center = { x: (deck.tx + 1) * 32 + 16 - AVATAR_BODY_CENTER_OFFSET.x, y: (deck.ty + 1) * 32 + 16 - AVATAR_BODY_CENTER_OFFSET.y };
    expect(isPositionWalkable(BASE_TERRAIN, center.x, center.y)).toBe(true);
    expect(isPositionWalkable(onDeck, center.x, center.y)).toBe(false);
    expect(isPositionWalkable(onDeck, center.x, center.y - 32)).toBe(false);
    expect(() => terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, [])).toThrow(InvalidOfficeLayoutError);
  });

  it('refuses a move whose body center falls inside a wall rectangle, half open like a tile', () => {
    const snapshot = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, withWalls(BASE_LAYOUT.walls, [{ index: at(67, 22), piece: 'wall-brick' }]));
    // Network position whose body center is (cx, cy).
    const move = (cx: number, cy: number) => isPositionWalkable(snapshot, cx - AVATAR_BODY_CENTER_OFFSET.x, cy - AVATAR_BODY_CENTER_OFFSET.y);
    // The wall's column: x 67 to 68 tiles, y 21 to 24 tiles.
    const [x0, x1, y0, y1] = [67 * 32, 68 * 32, 21 * 32, 24 * 32];

    expect(move(x0, y0)).toBe(false);
    expect(move(x0 + 16, 22 * 32 + 16)).toBe(false);
    expect(move(x1 - 0.5, y1 - 0.5)).toBe(false);
    expect(move(x1, y0 + 40)).toBe(true);
    expect(move(x0 - 0.5, y0 + 40)).toBe(true);
    expect(move(x0 + 16, y1)).toBe(true);
    expect(move(x0 + 16, y0 - 0.5)).toBe(true);
  });

  it('keeps a whole body off a wall rectangle for restoration and relocation; touching edges do not count', () => {
    const snapshot = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, withWalls(BASE_LAYOUT.walls, [{ index: at(67, 22), piece: 'wall-brick' }]));
    const [x0, x1, y1] = [67 * 32, 68 * 32, 24 * 32];
    const ty = 22 * 32;
    // The network position whose physical body has its left edge at `left` and its top at `top`.
    const probe = physicalBodyRect({ x: 0, y: 0 });
    const at2 = (left: number, top: number) => ({ x: left - probe.x, y: top - probe.y });

    expect(isFootprintWalkable(snapshot, at2(x1, ty))).toBe(true);
    expect(isFootprintWalkable(snapshot, at2(x1 - 1, ty))).toBe(false);
    expect(isFootprintWalkable(snapshot, at2(x0 - probe.width, ty))).toBe(true);
    expect(isFootprintWalkable(snapshot, at2(x0 - probe.width + 1, ty))).toBe(false);
    expect(isFootprintWalkable(snapshot, at2(x0 + 4, y1))).toBe(true);
    expect(isFootprintWalkable(snapshot, at2(x0 + 4, y1 - 1))).toBe(false);
    expect(isFootprintWalkable(BASE_TERRAIN, at2(x1 - 1, ty))).toBe(true);
  });

  it('draws the footprint of a wall grid: one whole-tile rectangle per vertical stretch of wall tiles', () => {
    const width = 6;
    const height = 7;
    const walls = new Array<string | null>(width * height).fill(null);
    const put = (tx: number, ty: number) => (walls[ty * width + tx] = 'wall-brick');
    // Column 1: two walls one tile apart overlap into one stretch, rows 0 to 3.
    put(1, 1);
    put(1, 2);
    put(2, 1);
    // Column 3: walls three rows apart touch (rows 0-2 and 3-5) into one stretch; column 4: a wall on the bottom row is clipped.
    put(3, 1);
    put(3, 4);
    put(4, 6);

    expect(wallFootprintRects({ width, height, walls })).toEqual([
      { x: 32, y: 0, w: 32, h: 4 * 32 },
      { x: 64, y: 0, w: 32, h: 3 * 32 },
      { x: 96, y: 0, w: 32, h: 6 * 32 },
      { x: 128, y: 5 * 32, w: 32, h: 2 * 32 },
    ]);
    expect(wallFootprintRects({ width, height, walls: new Array(width * height).fill(null) })).toEqual([]);
    // Walls four rows apart leave a free tile between their stretches.
    const apart = new Array<string | null>(width * height).fill(null);
    apart[1 * width + 2] = 'wall-brick';
    apart[5 * width + 2] = 'wall-brick';
    expect(wallFootprintRects({ width, height, walls: apart })).toEqual([
      { x: 64, y: 0, w: 32, h: 3 * 32 },
      { x: 64, y: 4 * 32, w: 32, h: 3 * 32 },
    ]);
    // A wall on the last column never wraps onto the next row.
    const wrap = new Array<string | null>(width * height).fill(null);
    wrap[2 * width + width - 1] = 'wall-brick';
    expect(wallFootprintRects({ width, height, walls: wrap })).toEqual([{ x: 5 * 32, y: 32, w: 32, h: 3 * 32 }]);
  });

  it('gives each stretch the material of its lowest wall, the one whose face shows', () => {
    const width = 6;
    const height = 7;
    const walls = new Array<string | null>(width * height).fill(null);
    walls[1 * width + 2] = 'wall-brick';
    walls[3 * width + 2] = 'wall-glass';

    expect(wallStretches({ width, height, walls })).toEqual([{ tx: 2, top: 0, bottom: 4, base: 3, piece: 'wall-glass' }]);
  });

  it('frames each tile of a stretch: cap above the bottom three, End frames only where the run ends on the right', () => {
    const width = 6;
    const height = 7;
    const walls = new Array<string | null>(width * height).fill(null);
    // A horizontal run on row 5 (columns 1 and 2) and a vertical run in column 4 (rows 2 to 5).
    walls[5 * width + 1] = 'wall-brick';
    walls[5 * width + 2] = 'wall-brick';
    walls[2 * width + 4] = 'wall-brick';
    walls[5 * width + 4] = 'wall-brick';
    const frames = wallTileFrames({ width, height, walls }).map(({ tx, ty, frame, depthY }) => [tx, ty, frame, depthY]);

    expect(frames).toEqual([
      [1, 4, 'crown', 7 * 32],
      [1, 5, 'face', 7 * 32],
      [1, 6, 'base', 7 * 32],
      [2, 4, 'crownEnd', 7 * 32],
      [2, 5, 'faceEnd', 7 * 32],
      [2, 6, 'baseEnd', 7 * 32],
      [4, 1, 'cap', 7 * 32],
      [4, 2, 'cap', 7 * 32],
      [4, 3, 'cap', 7 * 32],
      [4, 4, 'crownEnd', 7 * 32],
      [4, 5, 'faceEnd', 7 * 32],
      [4, 6, 'baseEnd', 7 * 32],
    ]);
  });

  it('merges side by side stretches of the same rows for the colliders, covering exactly the same ground', () => {
    const width = 6;
    const height = 7;
    const walls = new Array<string | null>(width * height).fill(null);
    // A run on row 2 (columns 1 to 3), a taller column 4 next to it, and a lone wall on column 5 lower down.
    for (const [tx, ty] of [[1, 2], [2, 2], [3, 2], [4, 2], [4, 3], [5, 5]] as const) walls[ty * width + tx] = 'wall-brick';
    const grid = { width, height, walls };
    const runs = wallColliderRects(grid);

    expect(runs).toEqual([
      { x: 32, y: 32, w: 3 * 32, h: 3 * 32 },
      { x: 128, y: 32, w: 32, h: 4 * 32 },
      { x: 160, y: 4 * 32, w: 32, h: 3 * 32 },
    ]);
    const inside = (rects: readonly { x: number; y: number; w: number; h: number }[], x: number, y: number) =>
      rects.some((rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h);
    const footprint = wallFootprintRects(grid);
    for (let y = -16; y < height * 32; y += 4) {
      for (let x = -16; x < width * 32; x += 4) expect(inside(runs, x, y), `${x},${y}`).toBe(inside(footprint, x, y));
    }
  });

  it('joins neighboring walls whatever their material (#223), in the footprint and in the colliders alike', () => {
    const width = 6;
    const height = 5;
    const shape = (material: (tx: number, ty: number) => string): (string | null)[] => {
      const walls = new Array<string | null>(width * height).fill(null);
      // A run (1..3, 1) whose east end meets a wall (4, 1), and a wall under its west end.
      for (const [tx, ty] of [[1, 1], [2, 1], [3, 1], [4, 1], [1, 2]] as const) walls[ty * width + tx] = material(tx, ty);
      return walls;
    };
    const mixed = { width, height, walls: shape((tx, ty) => (tx === 4 || ty === 2 ? 'wall-glass' : 'wall-brick')) };
    const plain = { width, height, walls: shape(() => 'wall-brick') };

    expect(wallsJoin(mixed, 3, 1, 4, 1)).toBe(true);
    expect(wallsJoin(mixed, 1, 1, 1, 2)).toBe(true);
    expect(wallsJoin(mixed, 3, 1, 3, 2)).toBe(false);
    expect(wallsJoin(mixed, 4, 1, 5, 1)).toBe(false);
    expect(wallFootprintRects(mixed)).toEqual(wallFootprintRects(plain));
    expect(wallColliderRects(mixed)).toEqual([
      { x: 32, y: 0, w: 32, h: 4 * 32 },
      { x: 64, y: 0, w: 3 * 32, h: 3 * 32 },
    ]);
    expect(wallColliderRects(mixed)).toEqual(wallColliderRects(plain));
  });

  it('names the tiles a wall covers: the one it is placed on and the ones above and below, clipped to the map', () => {
    const grid = { width: 6, height: 5 };
    expect(wallPostTiles(grid, 2 * 6 + 3)).toEqual([1 * 6 + 3, 2 * 6 + 3, 3 * 6 + 3]);
    expect(wallPostTiles(grid, 3)).toEqual([3, 6 + 3]);
    expect(wallPostTiles(grid, 4 * 6 + 2)).toEqual([3 * 6 + 2, 4 * 6 + 2]);
  });

  it('finds the tile under a world point', () => {
    expect(tileAtWorldPoint(BASE_LAYOUT, 0, 0)).toBe(0);
    expect(tileAtWorldPoint(BASE_LAYOUT, 3 * 32 + 31, 2 * 32)).toBe(at(3, 2));
    expect(tileAtWorldPoint(BASE_LAYOUT, BASE_LAYOUT.width * 32 - 1, BASE_LAYOUT.height * 32 - 1)).toBe(TILES - 1);
    expect(tileAtWorldPoint(BASE_LAYOUT, -1, 10)).toBeNull();
    expect(tileAtWorldPoint(BASE_LAYOUT, 10, BASE_LAYOUT.height * 32)).toBeNull();
    expect(tileAtWorldPoint(BASE_LAYOUT, Number.NaN, 10)).toBeNull();
  });
});

describe('wall openings: doors (#223)', () => {
  it('leaves tile walls whole for now: a door opening changes neither the footprint nor the colliders', () => {
    // Doors move onto tile walls in their own change; until then an opening cuts nothing.
    const width = 6;
    const height = 5;
    const walls = new Array<string | null>(width * height).fill(null);
    for (const tx of [1, 2, 3, 4]) walls[2 * width + tx] = 'wall-brick';
    const openings = [{ col: 2, row: 2, axis: 'horizontal' as const }];

    expect(wallFootprintRects({ width, height, walls, openings })).toEqual(wallFootprintRects({ width, height, walls }));
    expect(wallColliderRects({ width, height, walls, openings })).toEqual([{ x: 32, y: 32, w: 4 * 32, h: 3 * 32 }]);
  });
});
