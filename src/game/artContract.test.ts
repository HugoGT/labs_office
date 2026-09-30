import { describe, expect, it } from 'vitest';
import {
  ART_CONTRACT_VERSION,
  ART_IMAGE_KINDS,
  ART_IMAGE_SPECS,
  ART_TILE,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  FLOOR,
  FLOOR_MOTIF_SIZE,
  MAX_COLORS_PER_IMAGE,
  PACK_FACINGS,
  WALK_DIRECTIONS,
  WALL,
  assembleFloorMotif,
  countColors,
  floorFrameAt,
  seatedRowForFacing,
  sheetSize,
  splitFloorMotif,
  validateArtImage,
  walkRowForFacing,
  wallBodyRect,
  wallFrameIndex,
  wallJointRect,
  type ArtImageKind,
  type RgbaImage,
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
    expect(ART_CONTRACT_VERSION).toBe(1);
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
