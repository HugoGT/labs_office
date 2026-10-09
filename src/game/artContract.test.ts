import { describe, expect, it } from 'vitest';
import {
  ART_CONTRACT_VERSION,
  ART_IMAGE_KINDS,
  ART_IMAGE_SPECS,
  ART_PIECE_KINDS,
  ART_TILE,
  BRIDGE,
  BRIDGE_ORIENTATIONS,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  FLOOR,
  FLOOR_MOTIF_SIZE,
  HEDGE,
  MAX_COLORS_PER_IMAGE,
  PACK_FACINGS,
  PLANT,
  TABLE,
  TERRAIN_BUILT_FLOORS,
  TERRAIN_DECALS,
  TERRAIN_LAYER_COUNT,
  TERRAIN_LAYER_ORIGIN,
  TERRAIN_MATERIALS,
  TERRAIN_TILESET,
  TERRAIN_WALKABLE,
  TREE,
  WALK_DIRECTIONS,
  WALL,
  assembleFloorMotif,
  bridgeFrameIndex,
  countColors,
  floorFrameAt,
  hedgeFrameIndex,
  propPlacement,
  seatedRowForFacing,
  sheetSize,
  splitFloorMotif,
  terrainBankIndex,
  terrainCellCorners,
  terrainCellLayers,
  terrainCornerMask,
  terrainDecalIndex,
  terrainFloorPieceId,
  terrainLayerData,
  terrainPhaseAt,
  terrainPhaseOrigin,
  terrainTileIndex,
  validateArtImage,
  walkRowForFacing,
  wallBodyRect,
  wallFrameIndex,
  wallJointRect,
  type ArtImageKind,
  type RgbaImage,
  type TerrainMaterial,
} from './artContract';
import { FACINGS } from './officeProtocol';
import { TILE } from './mapData';

function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function setPixel(image: RgbaImage, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  image.data.set(rgba, (y * image.width + x) * 4);
}

/** An image of the exact size of `kind` that satisfies every rule: one opaque pixel per frame, away from its corners. */
function validImage(kind: ArtImageKind): RgbaImage {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const image = blank(width, height);
  const opaque = spec.alpha === 'opaque';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inFrame = { x: x % spec.frame.width, y: y % spec.frame.height };
      const center = inFrame.x === spec.frame.width >> 1 && inFrame.y === spec.frame.height >> 1;
      if (opaque || center) setPixel(image, x, y, [120, 80, 40, 255]);
    }
  }
  return image;
}

/** A 96x96 motif where every pixel is distinct, so any misplaced pixel shows up. */
function numberedMotif(): RgbaImage {
  const motif = blank(FLOOR_MOTIF_SIZE, FLOOR_MOTIF_SIZE);
  for (let y = 0; y < FLOOR_MOTIF_SIZE; y += 1) {
    for (let x = 0; x < FLOOR_MOTIF_SIZE; x += 1) setPixel(motif, x, y, [x, y, (x * 7 + y) % 256, 255]);
  }
  return motif;
}

describe('art contract constants', () => {
  it('is versioned and keeps the 32px logical tile of the office', () => {
    // Version 2 added terrain tilesets and map props: a version 1 reader
    // (the server's catalog) rejects their kinds, so the bump is required.
    expect(ART_CONTRACT_VERSION).toBe(2);
    // The contract has no imports (the server loads it with type stripping), so
    // it restates the tile instead of importing it; this keeps them equal.
    expect(ART_TILE).toBe(TILE);
  });

  it('fixes the pack character sheets: walk 32x52 x (10 steps + idle) x 8 directions', () => {
    expect(CHARACTER_WALK.frame).toEqual({ width: 32, height: 52 });
    expect(CHARACTER_WALK.stepColumns).toBe(10);
    expect(CHARACTER_WALK.idleColumn).toBe(10);
    expect(CHARACTER_WALK.anchor).toEqual({ x: 16, y: 47 });
    expect(sheetSize(CHARACTER_WALK)).toEqual({ width: 352, height: 416 });
    expect(WALK_DIRECTIONS).toEqual(['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);
  });

  it('fixes the seated sheet: 44x58 x (6 transition + 2 idle) x 4 facings', () => {
    expect(CHARACTER_SEATED.frame).toEqual({ width: 44, height: 58 });
    expect(CHARACTER_SEATED.transitionColumns).toBe(6);
    expect(CHARACTER_SEATED.idleColumns).toEqual([6, 7]);
    expect(CHARACTER_SEATED.anchor).toEqual({ x: 22, y: 42 });
    expect(sheetSize(CHARACTER_SEATED)).toEqual({ width: 352, height: 232 });
  });

  it('keeps PNG size apart from the logical footprint', () => {
    expect(CHARACTER_WALK.footprint).toEqual({ w: 1, h: 1 });
    // A chair cell is 36x38, bigger than a tile, but it still occupies one tile.
    expect(ART_IMAGE_SPECS.chair.frame).toEqual({ width: 36, height: 38 });
    expect(ART_IMAGE_SPECS.chair.footprint).toEqual({ w: 1, h: 1 });
    expect(ART_IMAGE_SPECS.desk.frame).toEqual({ width: 64, height: 64 });
    expect(ART_IMAGE_SPECS.desk.footprintByFacing).toEqual({
      up: { w: 2, h: 1 },
      down: { w: 2, h: 1 },
      left: { w: 1, h: 2 },
      right: { w: 1, h: 2 },
    });
  });

  it('lays chairs out as facings by layers, back before front', () => {
    const chair = ART_IMAGE_SPECS.chair;
    expect(chair.columns).toBe(PACK_FACINGS.length);
    expect(chair.rows).toBe(CHAIR_LAYERS.length);
    expect(CHAIR_LAYERS).toEqual(['back', 'front']);
    expect(chair.anchor).toEqual({ x: 18, y: 22 });
    expect(chair.ground).toEqual({ x: 18, y: 31 });
  });

  it('allows the partial alpha and the color count the pack actually uses', () => {
    expect(MAX_COLORS_PER_IMAGE).toBeGreaterThanOrEqual(75);
    for (const kind of ART_IMAGE_KINDS) expect(ART_IMAGE_SPECS[kind].maxColors).toBe(MAX_COLORS_PER_IMAGE);
    expect(ART_IMAGE_SPECS['character-walk'].alpha).toBe('partial');
    expect(ART_IMAGE_SPECS.wall.alpha).toBe('partial');
    expect(ART_IMAGE_SPECS.floor.alpha).toBe('opaque');
  });
});

describe('orientation orders', () => {
  it('maps every office facing to its walk row', () => {
    expect(walkRowForFacing('down')).toBe(WALK_DIRECTIONS.indexOf('S'));
    expect(walkRowForFacing('up')).toBe(WALK_DIRECTIONS.indexOf('N'));
    expect(walkRowForFacing('left')).toBe(WALK_DIRECTIONS.indexOf('W'));
    expect(walkRowForFacing('right')).toBe(WALK_DIRECTIONS.indexOf('E'));
  });

  it('maps office facings to seated rows in the pack order, which is not the office order', () => {
    expect(PACK_FACINGS).toEqual(['up', 'down', 'left', 'right']);
    expect(PACK_FACINGS).not.toEqual(FACINGS);
    for (const facing of FACINGS) expect(PACK_FACINGS[seatedRowForFacing(facing)]).toBe(facing);
    expect(seatedRowForFacing('down')).toBe(1);
  });
});

describe('floor motifs', () => {
  it('splits a 96x96 motif into nine 32x32 tiles that reassemble into the same motif', () => {
    const motif = numberedMotif();
    const tiles = splitFloorMotif(motif);
    expect(tiles).toHaveLength(9);
    for (const tile of tiles) expect([tile.width, tile.height]).toEqual([32, 32]);
    const again = assembleFloorMotif(tiles);
    expect(again.width).toBe(96);
    expect(Array.from(again.data)).toEqual(Array.from(motif.data));
  });

  it('puts motif sub-tile (col, row) in frame row * 3 + col', () => {
    const tiles = splitFloorMotif(numberedMotif());
    // Top-left pixel of frame 5 is motif sub-tile (2, 1): pixel (64, 32).
    expect(Array.from(tiles[5]!.data.slice(0, 4))).toEqual([64, 32, (64 * 7 + 32) % 256, 255]);
  });

  it('rejects a motif of any other size', () => {
    expect(() => splitFloorMotif(blank(64, 64))).toThrow(/96x96/);
    expect(() => assembleFloorMotif([])).toThrow(/9 tiles/);
  });

  it('picks the motif sub-tile from the world tile so the pattern repeats every 3 tiles', () => {
    expect(floorFrameAt(0, 0)).toBe(0);
    expect(floorFrameAt(2, 0)).toBe(2);
    expect(floorFrameAt(0, 1)).toBe(3);
    expect(floorFrameAt(4, 5)).toBe(2 * 3 + 1);
    expect(floorFrameAt(3, 3)).toBe(0);
    // Negative tiles wrap the same way instead of producing a negative frame.
    expect(floorFrameAt(-1, -1)).toBe(8);
  });

  it('describes the exported floor sheet as the motif itself: 3x3 frames of one tile', () => {
    expect(FLOOR.frame).toEqual({ width: ART_TILE, height: ART_TILE });
    expect(sheetSize(FLOOR)).toEqual({ width: FLOOR_MOTIF_SIZE, height: FLOOR_MOTIF_SIZE });
  });
});

describe('wall segments on the 32px grid', () => {
  it('uses one tile per segment, 16px thick, split into a joint and a body', () => {
    expect(WALL.segmentLength).toBe(ART_TILE);
    expect(WALL.thickness).toBe(16);
    expect(WALL.jointSize + WALL.bodyLength).toBe(WALL.segmentLength);
    expect(WALL.frame).toEqual({ width: 16, height: 16 });
  });

  it('centers joints on vertices and fits bodies between them without overlap', () => {
    expect(wallJointRect({ col: 2, row: 1 })).toEqual({ x: 56, y: 24, width: 16, height: 16 });
    expect(wallBodyRect({ axis: 'horizontal', col: 2, row: 1 })).toEqual({ x: 72, y: 24, width: 16, height: 16 });
    expect(wallBodyRect({ axis: 'vertical', col: 2, row: 1 })).toEqual({ x: 56, y: 40, width: 16, height: 16 });
    // The next joint along the horizontal edge starts where the body ends.
    expect(wallJointRect({ col: 3, row: 1 }).x).toBe(72 + 16);
  });

  it('numbers frames: horizontal body, vertical body, then one joint per connection mask', () => {
    expect(wallFrameIndex({ piece: 'body', axis: 'horizontal' })).toBe(0);
    expect(wallFrameIndex({ piece: 'body', axis: 'vertical' })).toBe(1);
    expect(wallFrameIndex({ piece: 'joint', mask: 1 })).toBe(2);
    expect(wallFrameIndex({ piece: 'joint', mask: 15 })).toBe(16);
    expect(WALL.columns).toBe(17);
    expect(() => wallFrameIndex({ piece: 'joint', mask: 0 })).toThrow(/mask/);
  });
});

describe('countColors', () => {
  it('counts distinct non-transparent RGBA values, alpha included', () => {
    const image = blank(3, 1);
    setPixel(image, 0, 0, [10, 20, 30, 255]);
    setPixel(image, 1, 0, [10, 20, 30, 128]);
    setPixel(image, 2, 0, [0, 0, 0, 0]);
    expect(countColors(image)).toBe(2);
  });
});

describe('validateArtImage', () => {
  it('accepts an image of the exact size and limits of each kind', () => {
    for (const kind of ART_IMAGE_KINDS) expect(validateArtImage(kind, validImage(kind))).toEqual([]);
  });

  it('rejects wrong dimensions', () => {
    const violations = validateArtImage('character-walk', blank(128, 320));
    expect(violations.map((v) => v.code)).toEqual(['invalid-dimensions']);
    expect(violations[0]!.message).toMatch(/352x416/);
  });

  it('rejects a buffer that does not match the declared size', () => {
    const image = { width: 352, height: 416, data: new Uint8ClampedArray(10) };
    expect(validateArtImage('character-walk', image).map((v) => v.code)).toEqual(['invalid-dimensions']);
  });

  it('rejects more colors than the cap', () => {
    const image = validImage('floor');
    for (let i = 0; i <= MAX_COLORS_PER_IMAGE; i += 1) setPixel(image, i % 96, Math.floor(i / 96), [i, 0, 0, 255]);
    expect(validateArtImage('floor', image).map((v) => v.code)).toEqual(['too-many-colors']);
  });

  it('accepts partial alpha on sprites but not on floors', () => {
    const walk = validImage('character-walk');
    setPixel(walk, 16, 30, [46, 26, 20, 78]);
    expect(validateArtImage('character-walk', walk)).toEqual([]);
    const floor = validImage('floor');
    setPixel(floor, 5, 5, [46, 26, 20, 78]);
    expect(validateArtImage('floor', floor).map((v) => v.code)).toEqual(['not-opaque']);
  });

  it('rejects a baked-in background: sprite frame corners must be transparent', () => {
    const chair = validImage('chair');
    // Bottom-right corner of the second frame of the first row.
    setPixel(chair, 36 * 2 - 1, 37, [201, 167, 124, 255]);
    const violations = validateArtImage('chair', chair);
    expect(violations.map((v) => v.code)).toEqual(['background-present']);
    expect(violations[0]!.message).toMatch(/frame 1/);
  });
});

describe('terrain materials (#123)', () => {
  it('lists the eight block types in drawing priority, water lowest and carpet highest', () => {
    // Highest first, the order asked for: carpet, tile, wood, grass, cobblestone, dirt, sand, water.
    expect(TERRAIN_MATERIALS).toEqual(['water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet']);
  });

  it('makes only water impassable', () => {
    for (const material of TERRAIN_MATERIALS) expect(TERRAIN_WALKABLE[material], material).toBe(material !== 'water');
  });

  it('draws each material with the floor piece of the same name', () => {
    expect(terrainFloorPieceId('cobblestone')).toBe('floor-cobblestone');
    expect(terrainFloorPieceId('tile')).toBe('floor-tile');
  });
});

describe('terrain corner masks', () => {
  it('numbers corners in reading order: NW 1, NE 2, SW 4, SE 8', () => {
    expect(terrainCornerMask({ nw: true, ne: false, sw: false, se: false })).toBe(1);
    expect(terrainCornerMask({ nw: false, ne: true, sw: false, se: false })).toBe(2);
    expect(terrainCornerMask({ nw: false, ne: false, sw: true, se: false })).toBe(4);
    expect(terrainCornerMask({ nw: false, ne: false, sw: false, se: true })).toBe(8);
    expect(terrainCornerMask({ nw: true, ne: true, sw: true, se: true })).toBe(15);
  });
});

describe('terrain dual grid', () => {
  const grid = (rows: readonly string[]): ((tx: number, ty: number) => TerrainMaterial) => {
    const key: Record<string, TerrainMaterial> = { W: 'water', G: 'grass', D: 'dirt', S: 'sand', C: 'cobblestone', O: 'wood', T: 'tile', K: 'carpet' };
    return (tx, ty) => key[rows[ty]![tx]!]!;
  };

  it('offsets the display grid half a tile, so each cell corner is the center of a map tile', () => {
    expect(TERRAIN_LAYER_ORIGIN).toBe(-ART_TILE / 2);
    const at = grid(['GW', 'DS']);
    expect(terrainCellCorners(at, 2, 2, 1, 1)).toEqual({ nw: 'grass', ne: 'water', sw: 'dirt', se: 'sand' });
  });

  it('clamps corners outside the map to the nearest map tile', () => {
    const at = grid(['GW', 'DS']);
    expect(terrainCellCorners(at, 2, 2, 0, 0)).toEqual({ nw: 'grass', ne: 'grass', sw: 'grass', se: 'grass' });
    expect(terrainCellCorners(at, 2, 2, 2, 2)).toEqual({ nw: 'sand', ne: 'sand', sw: 'sand', se: 'sand' });
    expect(terrainCellCorners(at, 2, 2, 2, 0)).toEqual({ nw: 'water', ne: 'water', sw: 'water', se: 'water' });
  });

  it('draws one full tile when the four corners agree', () => {
    expect(terrainCellLayers({ nw: 'grass', ne: 'grass', sw: 'grass', se: 'grass' })).toEqual([{ material: 'grass', mask: 15 }]);
  });

  it('lays the lowest material full and each higher one over the corners at or above it', () => {
    expect(terrainCellLayers({ nw: 'sand', ne: 'water', sw: 'water', se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { material: 'sand', mask: 1 },
    ]);
    // Nested: dirt covers the corners where grass and carpet are too, so each
    // edge blends over the material just below it instead of over water.
    expect(terrainCellLayers({ nw: 'carpet', ne: 'dirt', sw: 'grass', se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { bank: true, mask: 1 },
      { material: 'dirt', mask: 1 | 2 | 4 },
      { material: 'grass', mask: 1 | 4 },
      { material: 'carpet', mask: 1 },
    ]);
  });

  it('draws grass over cobblestone, dirt and sand where they meet', () => {
    for (const low of ['cobblestone', 'dirt', 'sand'] as const) {
      expect(terrainCellLayers({ nw: 'grass', ne: low, sw: low, se: low }), low).toEqual([
        { material: low, mask: 15 },
        { material: 'grass', mask: 1 },
      ]);
    }
  });

  it('draws nothing for a corner without terrain (void), so the materials around it edge over the background', () => {
    expect(terrainCellLayers({ nw: null, ne: null, sw: null, se: null })).toEqual([]);
    expect(terrainCellLayers({ nw: 'grass', ne: null, sw: null, se: null })).toEqual([{ material: 'grass', mask: 1 }]);
    // Water is not drawn under the void corner: no shore bleeds into the black.
    expect(terrainCellLayers({ nw: 'sand', ne: 'water', sw: null, se: 'water' })).toEqual([
      { material: 'water', mask: 1 | 2 | 8 },
      { material: 'sand', mask: 1 },
    ]);
  });

  it('names wood, tile and carpet the built floors', () => {
    expect(TERRAIN_BUILT_FLOORS).toEqual(['wood', 'tile', 'carpet']);
  });

  it('sinks water under the built floors: a bank right over the water, on the built-floor corners', () => {
    expect(terrainCellLayers({ nw: 'wood', ne: 'water', sw: 'water', se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { bank: true, mask: 1 },
      { material: 'wood', mask: 1 },
    ]);
    // Every built floor counts, and a natural material between them draws over the bank.
    expect(terrainCellLayers({ nw: 'tile', ne: 'grass', sw: 'water', se: 'carpet' })).toEqual([
      { material: 'water', mask: 15 },
      { bank: true, mask: 1 | 8 },
      { material: 'grass', mask: 1 | 2 | 8 },
      { material: 'tile', mask: 1 | 8 },
      { material: 'carpet', mask: 8 },
    ]);
    // A void corner keeps the bank: its shadow over the black background is invisible.
    expect(terrainCellLayers({ nw: 'wood', ne: 'water', sw: null, se: 'water' })).toEqual([
      { material: 'water', mask: 1 | 2 | 8 },
      { bank: true, mask: 1 },
      { material: 'wood', mask: 1 },
    ]);
  });

  it('draws no bank without water or without a built floor: floors cast no shadow on each other', () => {
    expect(terrainCellLayers({ nw: 'grass', ne: 'water', sw: 'sand', se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { material: 'sand', mask: 1 | 4 },
      { material: 'grass', mask: 1 },
    ]);
    expect(terrainCellLayers({ nw: 'wood', ne: 'carpet', sw: 'tile', se: 'wood' })).toEqual([
      { material: 'wood', mask: 15 },
      { material: 'tile', mask: 2 | 4 },
      { material: 'carpet', mask: 2 },
    ]);
    expect(terrainCellLayers({ nw: 'wood', ne: 'grass', sw: 'dirt', se: 'wood' })).toEqual([
      { material: 'dirt', mask: 15 },
      { material: 'grass', mask: 1 | 2 | 8 },
      { material: 'wood', mask: 1 | 8 },
    ]);
  });

  it('needs five layers at most: four corner materials plus the bank over water', () => {
    expect(TERRAIN_LAYER_COUNT).toBe(5);
  });

  it('picks the motif phase from the cell so the terrain lines up with floorFrameAt', () => {
    // Cell (1, 1) starts at world pixel (16, 16): motif pixel (16, 16).
    expect(terrainPhaseOrigin(terrainPhaseAt(1, 1))).toEqual({ x: 16, y: 16 });
    // Cell (0, 0) starts at world pixel (-16, -16), which wraps to (80, 80).
    expect(terrainPhaseOrigin(terrainPhaseAt(0, 0))).toEqual({ x: 80, y: 80 });
    for (let cx = -4; cx < 8; cx += 1) {
      const origin = terrainPhaseOrigin(terrainPhaseAt(cx, 2));
      expect(origin.x, `cell ${cx}`).toBe((((cx * ART_TILE + TERRAIN_LAYER_ORIGIN) % FLOOR_MOTIF_SIZE) + FLOOR_MOTIF_SIZE) % FLOOR_MOTIF_SIZE);
    }
  });

  it('indexes the tileset by material band, phase row and mask column, then the decal row and the bank row', () => {
    expect(TERRAIN_TILESET.columns).toBe(16);
    expect(TERRAIN_TILESET.rows).toBe(TERRAIN_MATERIALS.length * 9 + 2);
    expect(terrainTileIndex('water', 15, 0)).toBe(15);
    expect(terrainTileIndex('sand', 1, 0)).toBe(9 * 16 + 1);
    expect(terrainTileIndex('carpet', 15, 8)).toBe((7 * 9 + 8) * 16 + 15);
    expect(terrainDecalIndex(TERRAIN_DECALS[0]!)).toBe(TERRAIN_MATERIALS.length * 9 * 16);
    expect(TERRAIN_DECALS.length).toBeLessThanOrEqual(16);
    expect(() => terrainTileIndex('grass', 0, 0)).toThrow(/mask/);
    expect(() => terrainTileIndex('grass', 3, 9)).toThrow(/phase/);
    expect(terrainBankIndex(1)).toBe((TERRAIN_MATERIALS.length * 9 + 1) * 16 + 1);
    expect(terrainBankIndex(15)).toBe(TERRAIN_TILESET.rows * 16 - 1);
    expect(() => terrainBankIndex(0)).toThrow(/mask/);
    expect(() => terrainBankIndex(16)).toThrow(/mask/);
    const indices = [
      ...TERRAIN_MATERIALS.flatMap((material) =>
        Array.from({ length: 9 }, (_, phase) => Array.from({ length: 15 }, (_, i) => terrainTileIndex(material, i + 1, phase))).flat(),
      ),
      ...TERRAIN_DECALS.map(terrainDecalIndex),
      ...Array.from({ length: 15 }, (_, i) => terrainBankIndex(i + 1)),
    ];
    expect(new Set(indices).size).toBe(indices.length);
    expect(Math.max(...indices)).toBeLessThan(TERRAIN_TILESET.rows * TERRAIN_TILESET.columns);
  });

  it('builds the tile data of every layer for a map, -1 where a layer has nothing', () => {
    const at = grid(['GGW', 'GGW']);
    const layers = terrainLayerData(3, 2, at);
    expect(layers).toHaveLength(TERRAIN_LAYER_COUNT);
    for (const layer of layers) {
      expect(layer).toHaveLength(3);
      for (const row of layer) expect(row).toHaveLength(4);
    }
    // Cell (2, 1): corners grass, water, grass, water: water full, grass on the west corners.
    expect(layers[0]![1]![2]).toBe(terrainTileIndex('water', 15, terrainPhaseAt(2, 1)));
    expect(layers[1]![1]![2]).toBe(terrainTileIndex('grass', 1 | 4, terrainPhaseAt(2, 1)));
    expect(layers[2]![1]![2]).toBe(-1);
    // Cell (0, 0) is all grass: one layer.
    expect(layers[0]![0]![0]).toBe(terrainTileIndex('grass', 15, terrainPhaseAt(0, 0)));
    expect(layers[1]![0]![0]).toBe(-1);
  });

  it('puts the bank tile in the layer right over the water', () => {
    const layers = terrainLayerData(2, 1, grid(['OW']));
    // Cell (1, 0): wood on the west corners, water on the east ones.
    expect(layers[0]![0]![1]).toBe(terrainTileIndex('water', 15, terrainPhaseAt(1, 0)));
    expect(layers[1]![0]![1]).toBe(terrainBankIndex(1 | 4));
    expect(layers[2]![0]![1]).toBe(terrainTileIndex('wood', 1 | 4, terrainPhaseAt(1, 0)));
  });
});

describe('terrain dual grid over void', () => {
  it('leaves every layer empty where the four corners are void', () => {
    const layers = terrainLayerData(3, 2, (tx) => (tx === 0 ? 'grass' : null));
    // Cell (0, 0) is all grass (the corners outside the map clamp to the first column).
    expect(layers[0]![0]![0]).toBe(terrainTileIndex('grass', 15, terrainPhaseAt(0, 0)));
    // Cell (1, 1): grass on the west corners, void on the east ones.
    expect(layers[0]![1]![1]).toBe(terrainTileIndex('grass', 1 | 4, terrainPhaseAt(1, 1)));
    expect(layers[1]![1]![1]).toBe(-1);
    // Cell (3, 1) only sees void.
    for (const layer of layers) expect(layer[1]![3]).toBe(-1);
  });
});

describe('map props', () => {
  it('registers a piece kind for the tileset and each prop, with a fixed frame per image kind', () => {
    expect(ART_PIECE_KINDS).toEqual(['character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table']);
    expect(TREE.frame).toEqual({ width: 64, height: 96 });
    expect(PLANT.frame).toEqual({ width: 32, height: 48 });
    expect(sheetSize(BRIDGE)).toEqual({ width: 256, height: 128 });
    expect(sheetSize(HEDGE)).toEqual({ width: 512, height: 48 });
    expect(TABLE.frame).toEqual({ width: 256, height: 192 });
    expect(sheetSize(TERRAIN_TILESET)).toEqual({ width: 512, height: 74 * 32 });
  });

  it('anchors every prop on the floor at the bottom middle of its footprint, which is also its depth', () => {
    expect(TREE.anchor).toEqual({ x: 32, y: 90 });
    expect(TREE.footprint).toEqual({ w: 1, h: 1 });
    // A 3x3 bridge centered in its 128px cell.
    expect(BRIDGE.footprint).toEqual({ w: 3, h: 3 });
    expect(BRIDGE.anchor).toEqual({ x: 64, y: 112 });
    const placed = propPlacement({ anchor: TREE.anchor, footprint: { w: 1, h: 1 } }, 10, 4);
    expect(placed).toEqual({ x: 10 * 32 + 16 - 32, y: 5 * 32 - 90, depthY: 5 * 32 });
    const table = propPlacement({ anchor: TABLE.anchor, footprint: { w: 7, h: 5 } }, 53, 6);
    expect(table).toEqual({ x: 53 * 32 + 112 - 128, y: 11 * 32 - 180, depthY: 11 * 32 });
  });

  it('draws bridges on the ground and lets people walk their deck; everything else is solid and depth sorted', () => {
    expect([BRIDGE.layer, BRIDGE.collision]).toEqual(['ground', 'deck']);
    for (const spec of [TREE, PLANT, HEDGE, TABLE]) expect([spec.layer, spec.collision], spec.kind).toEqual(['sorted', 'solid']);
  });

  it('numbers bridge frames by orientation and hedge frames by connection mask', () => {
    expect(BRIDGE_ORIENTATIONS).toEqual(['north-south', 'east-west']);
    expect(bridgeFrameIndex('east-west')).toBe(1);
    expect(hedgeFrameIndex(0)).toBe(0);
    expect(hedgeFrameIndex(1 | 4)).toBe(5);
    expect(HEDGE.columns).toBe(16);
    expect(() => hedgeFrameIndex(16)).toThrow(/mask/);
  });

  it('fits the largest table footprint in its frame', () => {
    expect(TABLE.maxFootprint).toEqual({ w: 7, h: 5 });
    expect(TABLE.maxFootprint.w * ART_TILE).toBeLessThan(TABLE.frame.width);
    expect(TABLE.anchor.y - TABLE.maxFootprint.h * ART_TILE).toBeGreaterThan(16);
  });
});

describe('tileset color bands', () => {
  it('counts the color cap per material band, not over the whole tileset', () => {
    const image = validImage('terrain-tileset');
    const bandHeight = TERRAIN_TILESET.colorBandRows! * 32;
    // 100 colors in each of two bands: 200 in the file, under the cap in each band.
    for (let i = 0; i < 100; i += 1) {
      setPixel(image, i, 3, [i, 1, 0, 255]);
      setPixel(image, i, bandHeight + 3, [i, 2, 0, 255]);
    }
    expect(validateArtImage('terrain-tileset', image)).toEqual([]);
    for (let i = 100; i <= MAX_COLORS_PER_IMAGE; i += 1) setPixel(image, i, 4, [i, 1, 0, 255]);
    expect(validateArtImage('terrain-tileset', image).map((v) => v.code)).toEqual(['too-many-colors']);
  });
});
