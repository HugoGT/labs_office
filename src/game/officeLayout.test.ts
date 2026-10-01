import { describe, expect, it } from 'vitest';
import { TERRAIN_DECALS, TERRAIN_MATERIALS, TERRAIN_WALKABLE } from './artContract';
import { physicalBodyRect } from './avatarGeometry';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from './mapData';
import { BASE_MAP_SEATS } from './seating';
import {
  AVATAR_BODY_CENTER_OFFSET,
  BASE_LAYOUT,
  BASE_TERRAIN,
  BLOCK_TILES,
  BORDER_JITTER_TILES,
  blockAtWorldPoint,
  blockCount,
  blockTileRect,
  decodeTerrainBlocks,
  encodeTerrainBlocks,
  isLayoutMaterial,
  newlyWateredTiles,
  withBlock,
  InvalidOfficeLayoutError,
  LAYOUT_DECALS,
  LAYOUT_MATERIALS,
  MATERIAL_WALKABLE,
  blockIndexAt,
  isPositionWalkable,
  isTileWalkable,
  jitteredBlockMaterial,
  parseOfficeLayout,
  terrainMaterialAt,
  terrainSnapshot,
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
    expect(LAYOUT_MATERIALS).toEqual(TERRAIN_MATERIALS);
    expect(MATERIAL_WALKABLE).toEqual(TERRAIN_WALKABLE);
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
    const raw = tiledMap({ width: 9, height: 9, blocks: () => 'dirt', props: [{ type: 'plant-ficus', x: 0, y: 0, width: 32, height: 32 }] });
    const tileset = (raw.tilesets as { tiles: { id: number; type?: string; class?: string }[] }[])[0];
    tileset.tiles = tileset.tiles.map(({ id, type }) => ({ id, class: type }));
    const props = (raw.layers as { name: string; objects?: Record<string, unknown>[] }[]).find((layer) => layer.name === 'props');
    props!.objects = props!.objects!.map(({ type, ...object }) => ({ ...object, class: type }));
    const blocks = (raw.layers as { name: string; data?: number[] }[]).find((layer) => layer.name === 'blocks');
    blocks!.data = blocks!.data!.map((gid) => (gid | 0x80000000) >>> 0);

    const layout = parseOfficeLayout(raw);

    expect(layout.blocks).toEqual(['dirt']);
    expect(layout.props[0]?.piece).toBe('plant-ficus');
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
  it('blocks water and nothing else of the terrain', () => {
    const snapshot = terrainSnapshot(grassMap({ ground: (tx) => LAYOUT_MATERIALS[tx % LAYOUT_MATERIALS.length] ?? null }));

    for (let tx = 0; tx < 18; tx += 1) {
      const material = terrainMaterialAt(snapshot, tx, 4);
      expect(isTileWalkable(snapshot, tx, 4)).toBe(material !== 'water');
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

  it('lets walls, hedges and solid props block whatever is under them, a bridge deck included', () => {
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
          { type: 'plant-ficus', x: 32 * 7, y: 32 * 4, width: 32, height: 32 },
        ],
      }),
    );

    expect(isTileWalkable(snapshot, 1, 1)).toBe(false);
    expect(isTileWalkable(snapshot, 2, 1)).toBe(false);
    expect(isTileWalkable(snapshot, 12, 1)).toBe(false);
    expect(isTileWalkable(snapshot, 15, 1)).toBe(true);
    expect(isTileWalkable(snapshot, 7, 4)).toBe(false);
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
    // Body center (x - 16, y - 9): position (4 * 32 + 16 + 16, 4 * 32 + 9 + 16) centers it in tile (4, 4).
    const onWater = { x: 4 * 32 + 32, y: 4 * 32 + 25 };

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
      expect(props('plant')).toContainEqual(expect.objectContaining({ piece: 'plant-ficus', tx, ty }));
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
    expect(BASE_TERRAIN.materials.filter((material) => material === 'water').length).toBeGreaterThan(400);
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

  it('lists the tiles an edit turns into water, borders that wobble into the neighbors included', () => {
    const watered = newlyWateredTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 35, 'water')));
    const inside = (index: number) => {
      const tx = index % BASE_LAYOUT.width;
      const ty = Math.floor(index / BASE_LAYOUT.width);
      return tx >= 63 && tx < 72 && ty >= 18 && ty < 27;
    };

    // The middle of the block is always its own material.
    expect(watered).toContain(22 * BASE_LAYOUT.width + 67);
    expect(watered.some((index) => !inside(index))).toBe(true);
    expect(watered.every((index) => BASE_TERRAIN.materials[index] !== 'water')).toBe(true);
    // Drying the lake floods nothing.
    expect(newlyWateredTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, 94, 'grass')))).toEqual([]);
  });
});
