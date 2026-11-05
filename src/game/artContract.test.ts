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
  DOOR,
  DOOR_HINGES,
  DOOR_VARIANTS,
  DOOR_STEPS,
  DOOR_FRONT,
  DOOR_WALL_TOP,
  VERTICAL_DOOR,
  WINDOW_FRONT,
  doorAxisOf,
  verticalDoorFeet,
  verticalDoorLeaves,
  doorFrameIndex,
  doorFrontInset,
  doorHingeOf,
  doorSpanOf,
  doorVariantOf,
  doorPlacement,
  doorSlices,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  FLOOR,
  FLOOR_MOTIF_SIZE,
  HEDGE,
  MAX_COLORS_PER_IMAGE,
  PACK_FACINGS,
  PLANT,
  SOFA,
  sofaSeatsOf,
  TABLE,
  TABLE_FACINGS,
  tableFrameIndex,
  TERRAIN_BUILT_FLOORS,
  TERRAIN_DECALS,
  TERRAIN_LAYER_COUNT,
  TERRAIN_LAYER_ORIGIN,
  TERRAIN_MATERIALS,
  TERRAIN_MASKS,
  TERRAIN_PHASES,
  TERRAIN_TILESET,
  TERRAIN_ORGANIC_MATERIALS,
  TERRAIN_VARIANTS,
  TERRAIN_VOID_COLOR,
  TERRAIN_VOID_EDGE_COMBOS,
  TERRAIN_WALKABLE,
  TREE,
  WALK_DIRECTIONS,
  WALL,
  WALL_FRAMES,
  WALL_TOP_COLOR,
  WALL_VARIANTS,
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
  terrainVariantAt,
  terrainVoidCapIndex,
  terrainVoidEdgeIndex,
  terrainVoidMask,
  validateArtImage,
  walkRowForFacing,
  wallFrameIndex,
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
    // Version 3 grew the door frame (S14): a version 2 reader would cut the new door sheet wrong.
    expect(ART_CONTRACT_VERSION).toBe(3);
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
    // A desk (a decor table) is about 2.5 tiles long and spans a 3-tile desk edge.
    expect(ART_IMAGE_SPECS.desk.frame).toEqual({ width: 96, height: 104 });
    expect(ART_IMAGE_SPECS.desk.footprintByFacing).toEqual({
      up: { w: 3, h: 1 },
      down: { w: 3, h: 1 },
      left: { w: 1, h: 3 },
      right: { w: 1, h: 3 },
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

  it('lays sofas out like chairs, facings by layers, the floor under the middle of the sofa on one anchor', () => {
    expect(ART_IMAGE_KINDS).toContain('sofa');
    expect(ART_PIECE_KINDS).toContain('sofa');
    const sofa = ART_IMAGE_SPECS.sofa;
    expect(sofa).toBe(SOFA);
    expect(sofa.columns).toBe(PACK_FACINGS.length);
    expect(sofa.columnOrder).toEqual(PACK_FACINGS);
    expect(sofa.rows).toBe(CHAIR_LAYERS.length);
    expect(sofa.rowOrder).toEqual(CHAIR_LAYERS);
    expect(sofa.maxSeats).toBe(3);
    // A three-seat sofa spans three tiles across, or down when it is turned sideways.
    expect(sofa.frame.width).toBeGreaterThanOrEqual(sofa.maxSeats * ART_TILE);
    expect(sofa.frame.height).toBeGreaterThanOrEqual(sofa.maxSeats * ART_TILE);
    expect(sofa.alpha).toBe('partial');
    expect(sofa.transparentCorners).toBe(true);
  });

  it('reads the seats of a sofa from its id, and none from an id that states no seat count it knows', () => {
    expect(sofaSeatsOf('sofa-leather-2')).toBe(2);
    expect(sofaSeatsOf('sofa-fabric-3')).toBe(3);
    expect(sofaSeatsOf('sofa-fabric-1')).toBeNull();
    expect(sofaSeatsOf('sofa-fabric-4')).toBeNull();
    expect(sofaSeatsOf('sofa-upload-0123456789abcdef')).toBeNull();
    expect(sofaSeatsOf('chair-leather')).toBeNull();
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

describe('tile walls', () => {
  it('draws a wall as a column one tile wide and three tall: 32x32 frames, 7 per variant row, a 19px top band', () => {
    expect(WALL.frame).toEqual({ width: ART_TILE, height: ART_TILE });
    expect(WALL.heightTiles).toBe(3);
    expect(WALL.topHeight).toBe(19);
    expect(WALL.columns).toBe(Object.keys(WALL_FRAMES).length);
    expect(WALL.rows).toBe(WALL_VARIANTS);
    expect(WALL_VARIANTS).toBe(3);
    expect(sheetSize(WALL)).toEqual({ width: 7 * ART_TILE, height: 3 * ART_TILE });
    expect(WALL_TOP_COLOR).toBe('#1b1a2b');
  });

  it('numbers frames across in WALL_FRAMES order, one row per variant picked by the tile column modulo 3', () => {
    expect(WALL_FRAMES).toEqual({ cap: 0, crown: 1, face: 2, base: 3, crownEnd: 4, faceEnd: 5, baseEnd: 6 });
    expect(wallFrameIndex('cap', 0)).toBe(0);
    expect(wallFrameIndex('face', 0)).toBe(2);
    expect(wallFrameIndex('baseEnd', 0)).toBe(6);
    expect(wallFrameIndex('crown', 1)).toBe(7 + 1);
    expect(wallFrameIndex('base', 2)).toBe(2 * 7 + 3);
    // Column 3 starts the pattern over; negative columns wrap instead of giving a negative frame.
    expect(wallFrameIndex('face', 3)).toBe(wallFrameIndex('face', 0));
    expect(wallFrameIndex('face', -1)).toBe(wallFrameIndex('face', 2));
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

  it('runs every material under the void corners and caps them with a square void tile on top', () => {
    expect(terrainCellLayers({ nw: null, ne: null, sw: null, se: null })).toEqual([]);
    expect(terrainCellLayers({ nw: 'grass', ne: null, sw: null, se: null })).toEqual([
      { material: 'grass', mask: 15 },
      { void: true, mask: 2 | 4 | 8 },
    ]);
    // Void ranks above every material for the masks: water stays full and the sand
    // shore runs on under the void corner, then the cap draws the straight tile line.
    expect(terrainCellLayers({ nw: 'sand', ne: 'water', sw: null, se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { material: 'sand', mask: 1 | 4 },
      { void: true, mask: 4 },
    ]);
    expect(terrainCellLayers({ nw: 'carpet', ne: 'grass', sw: null, se: 'dirt' })).toEqual([
      { material: 'dirt', mask: 15 },
      { material: 'grass', mask: 1 | 2 | 4 },
      { material: 'carpet', mask: 1 | 4 },
      { void: true, mask: 4 },
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
    // A void corner keeps the bank under the cap, which hides whatever falls on the void quarter.
    expect(terrainCellLayers({ nw: 'wood', ne: 'water', sw: null, se: 'water' })).toEqual([
      { material: 'water', mask: 15 },
      { bank: true, mask: 1 },
      { material: 'wood', mask: 1 | 4 },
      { void: true, mask: 4 },
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

  it('needs five layers at most: four corner materials plus the bank, or three plus the bank and the void cap', () => {
    expect(TERRAIN_LAYER_COUNT).toBe(5);
    const values = [...TERRAIN_MATERIALS, null];
    let most = 0;
    for (const nw of values) for (const ne of values) for (const sw of values) for (const se of values) {
      most = Math.max(most, terrainCellLayers({ nw, ne, sw, se }).length);
    }
    expect(most).toBe(TERRAIN_LAYER_COUNT);
  });

  it('splits a material by group, one tile per group over only its own corners (#259)', () => {
    const corners = { nw: 'carpet', ne: 'carpet', sw: 'carpet', se: 'carpet' } as const;
    const groups = { nw: '#aa0000', ne: '#00bb00', sw: '#aa0000', se: null };

    expect(terrainCellLayers(corners, groups)).toEqual([
      { material: 'carpet', mask: 1 | 4, group: '#aa0000' },
      { material: 'carpet', mask: 2, group: '#00bb00' },
      { material: 'carpet', mask: 8 },
    ]);
  });

  it('keeps higher corners in every tile of a split material and never splits on equal groups', () => {
    expect(terrainCellLayers({ nw: 'wood', ne: 'wood', sw: 'carpet', se: 'carpet' }, { nw: null, ne: null, sw: 'a', se: 'b' })).toEqual([
      { material: 'wood', mask: 15 },
      { material: 'carpet', mask: 4, group: 'a' },
      { material: 'carpet', mask: 8, group: 'b' },
    ]);
    expect(terrainCellLayers({ nw: 'carpet', ne: 'carpet', sw: 'grass', se: 'grass' }, { nw: 'a', ne: 'a', sw: null, se: null })).toEqual([
      { material: 'grass', mask: 15 },
      { material: 'carpet', mask: 1 | 2, group: 'a' },
    ]);
  });

  it('still fits the layers when every carpet corner has its own group', () => {
    const values = [...TERRAIN_MATERIALS, null];
    const keys = ['a', 'b', 'c', null] as const;
    let most = 0;
    for (const nw of values) for (const ne of values) for (const sw of values) for (const se of values) {
      for (const [gn, ge, gs, gv] of [keys, [...keys].reverse(), ['a', 'a', 'b', 'b'], [null, null, null, null]] as const) {
        most = Math.max(most, terrainCellLayers({ nw, ne, sw, se }, { nw: gn, ne: ge, sw: gs, se: gv }).length);
      }
    }
    expect(most).toBe(TERRAIN_LAYER_COUNT);
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

  it('indexes the tileset by material band, phase row and variant then mask column, then the decal row and the bank and void cap row', () => {
    expect(TERRAIN_VARIANTS).toBe(3);
    expect(TERRAIN_TILESET.columns).toBe(16 * 3);
    expect(TERRAIN_TILESET.variants).toBe(3);
    expect(TERRAIN_TILESET.rows).toBe(TERRAIN_MATERIALS.length * 9 + 2 + 34);
    const columns = 48;
    expect(terrainTileIndex('water', 15, 0)).toBe(15);
    expect(terrainTileIndex('water', 15, 0, 2)).toBe(2 * 16 + 15);
    expect(terrainTileIndex('sand', 1, 0)).toBe(9 * columns + 1);
    expect(terrainTileIndex('sand', 1, 1, 1)).toBe(10 * columns + 16 + 1);
    expect(terrainTileIndex('carpet', 15, 8)).toBe((7 * 9 + 8) * columns + 15);
    expect(terrainDecalIndex(TERRAIN_DECALS[0]!)).toBe(TERRAIN_MATERIALS.length * 9 * columns);
    expect(TERRAIN_DECALS.length).toBeLessThanOrEqual(16);
    expect(() => terrainTileIndex('grass', 0, 0)).toThrow(/mask/);
    expect(() => terrainTileIndex('grass', 3, 9)).toThrow(/phase/);
    expect(() => terrainTileIndex('grass', 3, 0, 3)).toThrow(/variant/);
    expect(() => terrainTileIndex('grass', 3, 0, -1)).toThrow(/variant/);
    expect(() => terrainTileIndex('grass', 3, 0, 0.5)).toThrow(/variant/);
    expect(terrainBankIndex(1)).toBe((TERRAIN_MATERIALS.length * 9 + 1) * columns + 1);
    expect(terrainBankIndex(15)).toBe((TERRAIN_MATERIALS.length * 9 + 1) * columns + 15);
    expect(() => terrainBankIndex(0)).toThrow(/mask/);
    expect(() => terrainBankIndex(16)).toThrow(/mask/);
    // The void caps share the bank row, right after its 16 columns.
    expect(terrainVoidCapIndex(1)).toBe((TERRAIN_MATERIALS.length * 9 + 1) * columns + 16 + 1);
    expect(terrainVoidCapIndex(15)).toBe((TERRAIN_MATERIALS.length * 9 + 2) * columns - 16 - 1);
    expect(() => terrainVoidCapIndex(0)).toThrow(/mask/);
    expect(() => terrainVoidCapIndex(16)).toThrow(/mask/);
    const indices = [
      ...TERRAIN_MATERIALS.flatMap((material) =>
        Array.from({ length: 9 }, (_, phase) =>
          Array.from({ length: 3 }, (_, variant) => Array.from({ length: 15 }, (_, i) => terrainTileIndex(material, i + 1, phase, variant))).flat(),
        ).flat(),
      ),
      ...TERRAIN_DECALS.map(terrainDecalIndex),
      ...Array.from({ length: 15 }, (_, i) => terrainBankIndex(i + 1)),
      ...Array.from({ length: 15 }, (_, i) => terrainVoidCapIndex(i + 1)),
      ...TERRAIN_ORGANIC_MATERIALS.flatMap((material) =>
        Array.from({ length: 9 }, (_, phase) => TERRAIN_VOID_EDGE_COMBOS.map(({ mask, voidMask }) => terrainVoidEdgeIndex(material, mask, voidMask, phase))).flat(),
      ),
    ];
    expect(new Set(indices).size).toBe(indices.length);
    expect(Math.max(...indices)).toBeLessThan(TERRAIN_TILESET.rows * TERRAIN_TILESET.columns);
  });

  it('lists the 36 mask and void mask pairs an organic edge can have next to the void', () => {
    expect(TERRAIN_ORGANIC_MATERIALS).toEqual(['water', 'sand', 'dirt', 'cobblestone', 'grass']);
    expect(TERRAIN_VOID_EDGE_COMBOS).toHaveLength(36);
    const keys = TERRAIN_VOID_EDGE_COMBOS.map(({ mask, voidMask }) => mask * 16 + voidMask);
    // Every pair once, in (mask, voidMask) order.
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(new Set(keys).size).toBe(36);
    for (const { mask, voidMask } of TERRAIN_VOID_EDGE_COMBOS) {
      // Void counts as covered, the material still owns a corner, and the layer has an edge.
      expect(voidMask & ~mask, `${mask}/${voidMask}`).toBe(0);
      expect(voidMask, `${mask}/${voidMask}`).toBeGreaterThan(0);
      expect(mask & ~voidMask, `${mask}/${voidMask}`).toBeGreaterThan(0);
      expect(mask, `${mask}/${voidMask}`).toBeLessThan(15);
    }
    // Every organic layer of a cell with void corners and an edge is one of them.
    const values = [...TERRAIN_MATERIALS, null];
    for (const nw of values) for (const ne of values) for (const sw of values) for (const se of values) {
      const corners = { nw, ne, sw, se };
      const voidMask = terrainVoidMask(corners);
      if (voidMask === 0) continue;
      for (const tile of terrainCellLayers(corners)) {
        if (!('material' in tile) || tile.mask === 15 || TERRAIN_BUILT_FLOORS.includes(tile.material as never)) continue;
        expect(TERRAIN_VOID_EDGE_COMBOS.some((combo) => combo.mask === tile.mask && combo.voidMask === voidMask), `${tile.mask}/${voidMask}`).toBe(true);
      }
    }
  });

  it('indexes the void edge tiles after the bank row: organic material, phase, then pair', () => {
    const start = (TERRAIN_MATERIALS.length * 9 + 2) * 48;
    const first = TERRAIN_VOID_EDGE_COMBOS[0]!;
    const last = TERRAIN_VOID_EDGE_COMBOS[35]!;
    expect(terrainVoidEdgeIndex('water', first.mask, first.voidMask, 0)).toBe(start);
    expect(terrainVoidEdgeIndex('water', last.mask, last.voidMask, 0)).toBe(start + 35);
    expect(terrainVoidEdgeIndex('sand', first.mask, first.voidMask, 1)).toBe(start + (1 * 9 + 1) * 36);
    expect(terrainVoidEdgeIndex('grass', last.mask, last.voidMask, 8)).toBe(start + 5 * 9 * 36 - 1);
    expect(Math.ceil((5 * 9 * 36) / 48)).toBe(34);
    expect(() => terrainVoidEdgeIndex('wood', 1 | 2, 1, 0)).toThrow(/organic/);
    expect(() => terrainVoidEdgeIndex('grass', 1 | 2, 4, 0)).toThrow(/void edge/);
    expect(() => terrainVoidEdgeIndex('grass', 15, 1, 0)).toThrow(/void edge/);
    expect(() => terrainVoidEdgeIndex('grass', 1 | 2, 1, 9)).toThrow(/phase/);
    expect(terrainVoidMask({ nw: null, ne: 'grass', sw: 'wood', se: null })).toBe(1 | 8);
  });

  it('picks an edge variant per display cell from a hash that no block or motif repeat lines up with', () => {
    const variants = (cell: (i: number) => [number, number]): number[] => Array.from({ length: 30 }, (_, i) => terrainVariantAt(...cell(i)));
    for (let line = -2; line < 12; line += 1) {
      for (const run of [variants((i) => [i, line]), variants((i) => [line, i])]) {
        for (const variant of run) expect(Number.isInteger(variant) && variant >= 0 && variant < TERRAIN_VARIANTS).toBe(true);
        expect(new Set(run).size, `line ${line}`).toBe(TERRAIN_VARIANTS);
        // Neither the motif repeat (3 cells) nor a terrain block (9 cells) brings the same variants back.
        for (const period of [3, 9]) expect(run.slice(period).some((variant, i) => variant !== run[i]), `line ${line} period ${period}`).toBe(true);
      }
    }
    expect(terrainVariantAt(5, 7)).toBe(terrainVariantAt(5, 7));
  });

  it('shares the void color with the client, so the caps match the camera background', () => {
    expect(TERRAIN_VOID_COLOR).toBe(0x000000);
    expect(TERRAIN_MASKS * TERRAIN_VARIANTS).toBe(TERRAIN_TILESET.columns);
    expect(TERRAIN_PHASES).toBe(9);
  });

  it('builds the tile data of every layer for a map, -1 where a layer has nothing', () => {
    const at = grid(['GGW', 'GGW']);
    const layers = terrainLayerData(3, 2, at);
    expect(layers).toHaveLength(TERRAIN_LAYER_COUNT);
    for (const layer of layers) {
      expect(layer).toHaveLength(3);
      for (const row of layer) expect(row).toHaveLength(4);
    }
    // Cell (2, 1): corners grass, water, grass, water: water full, grass on the west corners,
    // both in the cell's edge variant.
    const variant = terrainVariantAt(2, 1);
    expect(layers[0]![1]![2]).toBe(terrainTileIndex('water', 15, terrainPhaseAt(2, 1), variant));
    expect(layers[1]![1]![2]).toBe(terrainTileIndex('grass', 1 | 4, terrainPhaseAt(2, 1), variant));
    expect(layers[2]![1]![2]).toBe(-1);
    // Cell (0, 0) is all grass: one layer.
    expect(layers[0]![0]![0]).toBe(terrainTileIndex('grass', 15, terrainPhaseAt(0, 0), terrainVariantAt(0, 0)));
    expect(layers[1]![0]![0]).toBe(-1);
  });

  it('puts the bank tile in the layer right over the water', () => {
    const layers = terrainLayerData(2, 1, grid(['OW']));
    // Cell (1, 0): wood on the west corners, water on the east ones.
    expect(layers[0]![0]![1]).toBe(terrainTileIndex('water', 15, terrainPhaseAt(1, 0), terrainVariantAt(1, 0)));
    expect(layers[1]![0]![1]).toBe(terrainBankIndex(1 | 4));
    // Built floors have square edges, so they only come in variant 0.
    expect(layers[2]![0]![1]).toBe(terrainTileIndex('wood', 1 | 4, terrainPhaseAt(1, 0)));
  });

  it('only ever uses variant 0 for the built floors, and every variant for the natural materials', () => {
    const variantOf = (index: number): number => Math.floor((index % TERRAIN_TILESET.columns) / TERRAIN_MASKS);
    const seen = { wood: new Set<number>(), grass: new Set<number>() };
    const layers = terrainLayerData(30, 30, (tx, ty) => ((tx + ty) % 2 === 0 ? 'wood' : 'grass'));
    for (const layer of layers) {
      for (const row of layer) {
        for (const index of row) {
          if (index < 0) continue;
          const band = Math.floor(Math.floor(index / TERRAIN_TILESET.columns) / TERRAIN_PHASES);
          const material = TERRAIN_MATERIALS[band];
          if (material === 'wood' || material === 'grass') seen[material].add(variantOf(index));
        }
      }
    }
    expect([...seen.wood]).toEqual([0]);
    expect([...seen.grass].sort()).toEqual([0, 1, 2]);
  });
});

describe('terrain dual grid over void', () => {
  const keyed = (rows: readonly string[]): ((tx: number, ty: number) => TerrainMaterial | null) => {
    const key: Record<string, TerrainMaterial | null> = { W: 'water', G: 'grass', S: 'sand', O: 'wood', V: null };
    return (tx, ty) => key[rows[ty]![tx]!]!;
  };

  it('draws organic layers with an edge next to the void from the void edge tiles, everything else as before', () => {
    // Cell (1, 1): nw void, ne water, sw grass, se wood.
    let layers = terrainLayerData(2, 2, keyed(['VW', 'GO']));
    const phase = terrainPhaseAt(1, 1);
    expect(layers.map((layer) => layer[1]![1])).toEqual([
      // Water is full: no edge, so its usual variant tile.
      terrainTileIndex('water', 15, phase, terrainVariantAt(1, 1)),
      terrainBankIndex(8),
      terrainVoidEdgeIndex('grass', 1 | 4 | 8, 1, phase),
      // Built floors keep their square variant 0 tile.
      terrainTileIndex('wood', 1 | 8, phase),
      terrainVoidCapIndex(1),
    ]);
    // Cell (1, 1): nw grass, ne wood, sw void, se water.
    layers = terrainLayerData(2, 2, keyed(['GO', 'VW']));
    expect(layers.map((layer) => layer[1]![1])).toEqual([
      terrainTileIndex('water', 15, phase, terrainVariantAt(1, 1)),
      terrainBankIndex(2),
      terrainVoidEdgeIndex('grass', 1 | 2 | 4, 4, phase),
      terrainTileIndex('wood', 2 | 4, phase),
      terrainVoidCapIndex(4),
    ]);
    // Without void the same shore uses the variant tiles.
    layers = terrainLayerData(2, 2, keyed(['GW', 'GW']));
    expect(layers[1]![1]![1]).toBe(terrainTileIndex('grass', 1 | 4, phase, terrainVariantAt(1, 1)));
  });

  it('leaves every layer empty where the four corners are void, and caps the void quarters next to terrain', () => {
    const layers = terrainLayerData(3, 2, (tx) => (tx === 0 ? 'grass' : null));
    // Cell (0, 0) is all grass (the corners outside the map clamp to the first column).
    expect(layers[0]![0]![0]).toBe(terrainTileIndex('grass', 15, terrainPhaseAt(0, 0), terrainVariantAt(0, 0)));
    // Cell (1, 1): grass on the west corners, void on the east ones: grass runs on under
    // the void, then the cap covers the east half on the tile line.
    expect(layers[0]![1]![1]).toBe(terrainTileIndex('grass', 15, terrainPhaseAt(1, 1), terrainVariantAt(1, 1)));
    expect(layers[1]![1]![1]).toBe(terrainVoidCapIndex(2 | 8));
    expect(layers[2]![1]![1]).toBe(-1);
    // Cell (3, 1) only sees void.
    for (const layer of layers) expect(layer[1]![3]).toBe(-1);
  });
});

describe('map props', () => {
  it('registers a piece kind for the tileset and each prop, with a fixed frame per image kind', () => {
    expect(ART_PIECE_KINDS).toEqual(['character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table', 'door', 'sofa']);
    expect(TREE.frame).toEqual({ width: 64, height: 96 });
    expect(PLANT.frame).toEqual({ width: 32, height: 48 });
    expect(sheetSize(BRIDGE)).toEqual({ width: 256, height: 128 });
    expect(sheetSize(HEDGE)).toEqual({ width: 512, height: 48 });
    // Two frames: horizontal, then the same table standing vertical (#208).
    expect(TABLE.frame).toEqual({ width: 256, height: 256 });
    expect(TABLE_FACINGS).toEqual(['horizontal', 'vertical']);
    expect(TABLE.columnOrder).toEqual(TABLE_FACINGS);
    expect(sheetSize(TABLE)).toEqual({ width: 512, height: 256 });
    expect(sheetSize(TERRAIN_TILESET)).toEqual({ width: 1536, height: 108 * 32 });
    // Larger textures do not load on every GPU.
    expect(sheetSize(TERRAIN_TILESET).height).toBeLessThanOrEqual(4096);
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
    expect(table).toEqual({ x: 53 * 32 + 112 - 128, y: 11 * 32 - 244, depthY: 11 * 32 });
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

  it('fits the largest table footprint in its frame, horizontal and vertical', () => {
    expect(TABLE.maxFootprint).toEqual({ w: 7, h: 5 });
    expect(TABLE.anchor).toEqual({ x: 128, y: 244 });
    expect(TABLE.maxFootprint.w * ART_TILE).toBeLessThan(TABLE.frame.width);
    // Standing vertical, its long side runs along the floor depth: 7 tiles under a lifted top.
    expect(TABLE.anchor.y - TABLE.maxFootprint.w * ART_TILE).toBeGreaterThan(16);
    expect(TABLE.frame.height - TABLE.anchor.y).toBe(12);
  });

  it('numbers table frames by rotation: 0 horizontal, 90 vertical, and the symmetric 180 and 270 alike', () => {
    expect(tableFrameIndex(0)).toBe(0);
    expect(tableFrameIndex(90)).toBe(1);
    expect(tableFrameIndex(180)).toBe(0);
    expect(tableFrameIndex(270)).toBe(1);
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

describe('doors (#223, #233)', () => {
  it('lays a door sheet out as one column per rotation and four rows per hinge, closed to open', () => {
    expect(ART_IMAGE_KINDS).toContain('door');
    expect(ART_IMAGE_SPECS.door).toBe(DOOR);
    // Tall enough for a vertical door's frame over its span and its lower leaf past it, wide enough for a leaf swung out (S14).
    expect(DOOR.frame).toEqual({ width: 160, height: 256 });
    expect(DOOR_STEPS).toBe(4);
    expect(DOOR.rows).toBe(8);
    expect(sheetSize(DOOR)).toEqual({ width: 640, height: 2048 });
    expect(DOOR.anchor).toEqual({ x: 80, y: 128 });
    expect(DOOR_HINGES).toEqual(['start', 'end']);
    expect(doorFrameIndex(0, 'start', 0)).toBe(0);
    expect(doorFrameIndex(270, 'start', 0)).toBe(3);
    expect(doorFrameIndex(0, 'start', 1)).toBe(4);
    expect(doorFrameIndex(0, 'start', 2)).toBe(8);
    expect(doorFrameIndex(0, 'start', 3)).toBe(12);
    expect(doorFrameIndex(90, 'end', 0)).toBe(17);
    expect(doorFrameIndex(180, 'end', 3)).toBe(30);
  });

  it('states the three variants: 1.4 tiles of leaf and 0.3 of jamb each side, 2.2 and 0.4 for the double door, a window 1.4 wide in 2 tiles', () => {
    expect(DOOR_VARIANTS).toEqual(['single', 'double', 'window']);
    expect(DOOR.variants).toEqual({
      single: { span: 2, leafLength: 44, jamb: 10, frontWidth: 44 },
      double: { span: 3, leafLength: 70, jamb: 13, frontWidth: 96 },
      window: { span: 2, leafLength: 44, jamb: 10, frontWidth: 44 },
    });
    // Leaf and both jambs fill the span, in pixels.
    for (const { span, leafLength, jamb } of Object.values(DOOR.variants)) expect(leafLength + 2 * jamb).toBe(span * ART_TILE);
  });

  it('shows a single door 1.4 tiles wide from the front: 0.1 of frame each side of a 1.2 doorway, the wall on the rest', () => {
    const { frontWidth } = DOOR.variants.single;
    expect(frontWidth / ART_TILE).toBeCloseTo(1.4, 1);
    expect((frontWidth - 2 * DOOR_FRONT.frame) / ART_TILE).toBeCloseTo(1.2, 1);
    expect(doorFrontInset('door-wood')).toBe(10);
    // The double door and the window keep their own: the double fills its span.
    expect(doorFrontInset('door-wood-double')).toBe(0);
    // A window is as wide as a single door's frame in its two tiles (L24).
    expect(doorFrontInset('door-glass-window')).toBe(10);
  });

  it('tells the double door from the single one by the piece id: 2 and 3 tiles of wall', () => {
    expect(doorVariantOf('door-wood')).toBe('single');
    expect(doorVariantOf('door-wood-double')).toBe('double');
    expect(doorSpanOf('door-wood')).toBe(2);
    expect(doorSpanOf('door-wood-double')).toBe(3);
    expect(doorVariantOf('door-glass-window')).toBe('window');
    expect(doorSpanOf('door-glass-window')).toBe(2);
  });

  it('stands a door in a horizontal run for 0 and 180 and in a vertical one for 90 and 270 (tile walls)', () => {
    expect(([0, 90, 180, 270] as const).map(doorAxisOf)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  it('fills the bottom two tiles of the wall with a front door, and its face from the dark band down to the bottom tile with a window (S10, S11)', () => {
    // Frame pixels: the top of the wall is two tiles over the anchor. The wall is 96px tall, its dark band 19px.
    expect(DOOR_WALL_TOP).toBe(DOOR.anchor.y - 2 * ART_TILE);
    expect(DOOR_FRONT).toEqual({ top: DOOR_WALL_TOP + 32, bottom: DOOR_WALL_TOP + 96, frame: 3 });
    expect(WINDOW_FRONT).toEqual({ top: DOOR_WALL_TOP + 31, bottom: DOOR_WALL_TOP + 64 });
    // 0.4 tiles under the band, the wall between them (L22, L23), and over the bottom tile, which stays the wall's.
    expect((WINDOW_FRONT.top - DOOR_WALL_TOP - WALL.topHeight) / ART_TILE).toBeCloseTo(0.4, 1);
    expect(WINDOW_FRONT.bottom - DOOR_WALL_TOP).toBe(WALL.frame.height * 2);
  });

  it('hinges a single door at the end its turn puts it at, going round clockwise from the west end, and a double door at its start', () => {
    // Down (0) hinges west, then left (270) north, up (180) east and right (90) south: the door turns as a whole.
    expect([0, 270, 180, 90].map((rotation) => doorHingeOf('door-wood', rotation as 0 | 90 | 180 | 270))).toEqual(['start', 'start', 'end', 'end']);
    for (const rotation of [0, 90, 180, 270] as const) expect(doorHingeOf('door-wood-double', rotation)).toBe('start');
  });

  it('draws a door with its anchor on the middle of its span: on the top of the bottom tile of the wall in a horizontal run, the middle of the column in a vertical one', () => {
    for (const span of [2, 3]) {
      expect(doorPlacement('horizontal', 4, 6, span)).toEqual({ x: 4 * 32 + (span * 32) / 2 - DOOR.anchor.x, y: 7 * 32 - DOOR.anchor.y });
      expect(doorPlacement('vertical', 4, 6, span)).toEqual({ x: 4 * 32 + 16 - DOOR.anchor.x, y: 6 * 32 + (span * 32) / 2 - DOOR.anchor.y });
    }
  });

  it('keeps a horizontal door and a window on the same world pixels the 128px frame drew them on (S14e)', () => {
    // The wall of row 6 covers rows 5 to 7: its top is at 5 tiles, a door fills rows 6 and 7, a window 0.4 tiles under the band down to row 6.
    for (const span of [2, 3]) {
      const { y } = doorPlacement('horizontal', 4, 6, span);
      expect(y + DOOR_WALL_TOP).toBe(5 * 32);
      expect([y + DOOR_FRONT.top, y + DOOR_FRONT.bottom]).toEqual([6 * 32, 8 * 32]);
      expect([y + WINDOW_FRONT.top, y + WINDOW_FRONT.bottom]).toEqual([5 * 32 + 31, 7 * 32]);
    }
  });

  it('stands the posts of a door in a vertical run on the floor: the upper one at the span top, the lower one under the wall below, 2px of it showing (S14b, S14d)', () => {
    expect(VERTICAL_DOOR).toEqual({ leafThickness: 10, height: 64, stubShows: 2, hidesWallBase: 2 });
    expect(VERTICAL_DOOR.height).toBe(DOOR_FRONT.bottom - DOOR_FRONT.top);
    // The span is a tile shorter than in a horizontal run (L41): 1 tile for a single door, 2 for a double.
    expect(verticalDoorFeet('single', 192)).toEqual({ upper: 192, lower: 192 + 32 - 2 + 64 });
    expect(verticalDoorFeet('double', 192)).toEqual({ upper: 192, lower: 192 + 64 - 2 + 64 });
  });

  it('hangs a single leaf from the upper post, half the post-to-post length, and the lower leaf of a double door from the lower post (S14d)', () => {
    expect(verticalDoorLeaves('single', 192)).toEqual([{ hingeY: 192, down: 1, length: 47 }]);
    expect(verticalDoorLeaves('double', 192)).toEqual([
      { hingeY: 192, down: 1, length: 63 },
      { hingeY: 192 + 126, down: -1, length: 63 },
    ]);
  });

  it('cuts a door in a vertical run into the column over its span, the column along it and the leaves beside it, each sorted where it stands (S14)', () => {
    const col = { x: DOOR.anchor.x - 16, width: 32 };
    const right = { x: DOOR.anchor.x + 16, width: DOOR.frame.width - DOOR.anchor.x - 16 };
    for (const step of [0, 1, 2, 3]) {
      const angle = (step / 3) * (Math.PI / 2);
      // A single door from row 6, 1 tile (L41): frame rows 112..144 are the span.
      const single = doorSlices(6, 'door-wood', step);
      const leaf = 6 * 32 + 47 * Math.cos(angle) + 5 * Math.sin(angle);
      expect(single.map(({ crop }) => crop)).toEqual([
        { ...col, y: 0, height: 112 },
        { ...col, y: 112, height: 32 },
        { x: 0, width: col.x, y: 0, height: DOOR.frame.height },
        { ...right, y: 0, height: DOOR.frame.height },
      ]);
      // Over the run-end face above (its depth is the span top), under avatars crossing; the column over them; the leaf by its lowest floor pixel.
      expect(single[0]!.depthY).toBe(6 * 32 + 1);
      expect(single[1]!.depthY).toBe(7 * 32);
      expect(single[2]!.depthY).toBeCloseTo(leaf);
      expect(single[3]!.depthY).toBeCloseTo(leaf);
      // A double door from row 6, 2 tiles (L41): frame rows 96..160, cut beside the column at the floor midpoint between its hinges.
      const double = doorSlices(6, 'door-wood-double', step);
      const middle = 96 + 63;
      expect(double.map(({ crop }) => crop)).toEqual([
        { ...col, y: 0, height: 96 },
        { ...col, y: 96, height: 64 },
        { x: 0, width: col.x, y: 0, height: middle },
        { ...right, y: 0, height: middle },
        { x: 0, width: col.x, y: middle, height: DOOR.frame.height - middle },
        { ...right, y: middle, height: DOOR.frame.height - middle },
      ]);
      expect(double.map(({ depthY }) => depthY)).toEqual([
        6 * 32 + 1,
        8 * 32,
        ...Array(2).fill(6 * 32 + 63 * Math.cos(angle) + 5 * Math.sin(angle)),
        ...Array(2).fill(6 * 32 + 126 + 5 * Math.sin(angle)),
      ]);
    }
  });

});
