import { describe, expect, it } from 'vitest';
import { PLANT } from './artContract';
import { parseArtSheetKey } from './artPack';
import { physicalBodyRect } from './avatarGeometry';
import { deskSlotRect } from './deskLayout';
import { TILE } from './mapData';
import { BASE_MAP_CHAIR } from './mapBuilder';
import { AVATAR_BODY_CENTER_OFFSET, BASE_LAYOUT, type LayoutProp } from './officeLayout';
import { BASE_MAP_SEATS } from './seating';
import {
  BASE_CHAIR_PIECE,
  COLLISION_BODY_CENTER_OFFSET,
  COLLISION_COORD_LIMIT,
  COLLISION_TILE,
  DECOR_PLANT_FRAME,
  InvalidCollisionRectsError,
  MAX_COLLISION_RECTS,
  bodyBoxAt,
  boxOverlapsRects,
  collisionWorld,
  coveredTiles,
  decodeCollisionTable,
  deskInstances,
  encodeCollisionTable,
  isEditablePieceId,
  isPositionBlocked,
  layoutPropInstances,
  parseCollisionRects,
  pickInstance,
  pieceIdOfTextureKey,
  pieceRectsOf,
  rotateRect,
  rotationForFacing,
  seatInstances,
  staticCollisionInstances,
  toPieceRect,
  worldRectsOf,
  type CollisionInstance,
  type CollisionRect,
} from './pieceCollisions';

function prop(overrides: Partial<LayoutProp> & Pick<LayoutProp, 'piece' | 'kind'>): LayoutProp {
  return { tx: 0, ty: 0, w: 1, h: 1, collision: 'solid', orientation: null, facing: null, ...overrides };
}

const NO_EDITS = new Map<string, readonly CollisionRect[]>();

describe('pieceCollisions: shared constants', () => {
  it('shares the avatar body center and pins the tile and plant frame', () => {
    expect(COLLISION_TILE).toBe(TILE);
    expect(COLLISION_BODY_CENTER_OFFSET).toEqual(AVATAR_BODY_CENTER_OFFSET);
    expect(DECOR_PLANT_FRAME).toEqual({ width: PLANT.frame.width, height: PLANT.frame.height, anchor: PLANT.anchor });
  });

  it('puts the body box where avatarGeometry puts the Arcade body', () => {
    expect(bodyBoxAt({ x: 300, y: 200 })).toEqual(physicalBodyRect({ x: 300, y: 200 }));
  });

  it('reads the piece of an art sheet key the way artPack does, sheets only', () => {
    expect(pieceIdOfTextureKey('art:plant-upload-0123456789abcdef:sheet')).toBe('plant-upload-0123456789abcdef');
    expect(parseArtSheetKey('art:plant-fern:sheet')?.pieceId).toBe(pieceIdOfTextureKey('art:plant-fern:sheet'));
    expect(pieceIdOfTextureKey('art:character-x:walk')).toBeNull();
    expect(pieceIdOfTextureKey('decor-plant')).toBeNull();
  });
});

describe('pieceCollisions: validation', () => {
  it('accepts up to the cap of integer rectangles, empty included', () => {
    expect(parseCollisionRects([])).toEqual([]);
    expect(parseCollisionRects([{ x: -16, y: -32, w: 32, h: 32 }])).toEqual([{ x: -16, y: -32, w: 32, h: 32 }]);
    const many = Array.from({ length: MAX_COLLISION_RECTS }, (_, i) => ({ x: i, y: 0, w: 1, h: 1 }));
    expect(parseCollisionRects(many)).toHaveLength(MAX_COLLISION_RECTS);
  });

  it('keeps only the four numbers of each rectangle', () => {
    expect(parseCollisionRects([{ x: 1, y: 2, w: 3, h: 4, piece: 'x' }])).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
  });

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      {},
      'rects',
      [null],
      [{ x: 0, y: 0, w: 0, h: 4 }],
      [{ x: 0, y: 0, w: 4, h: -1 }],
      [{ x: 0.5, y: 0, w: 4, h: 4 }],
      [{ x: 0, y: '0', w: 4, h: 4 }],
      [{ x: Number.NaN, y: 0, w: 4, h: 4 }],
      [{ x: -COLLISION_COORD_LIMIT - 1, y: 0, w: 4, h: 4 }],
      [{ x: COLLISION_COORD_LIMIT - 2, y: 0, w: 4, h: 4 }],
      Array.from({ length: MAX_COLLISION_RECTS + 1 }, () => ({ x: 0, y: 0, w: 1, h: 1 })),
    ];
    for (const raw of bad) expect(() => parseCollisionRects(raw), JSON.stringify(raw)).toThrow(InvalidCollisionRectsError);
  });

  it('only edits pieces that stand in the world: trees, plants, tables, desks and chairs', () => {
    for (const id of ['tree-oak', 'plant-ficus', 'plant-upload-0123456789abcdef', 'table-meeting', 'desk-wood', 'chair-wood']) {
      expect(isEditablePieceId(id), id).toBe(true);
    }
    for (const id of ['bridge-wood', 'hedge-boxwood', 'wall-brick', 'floor-oak', 'character-p01', 'tree', 'tree-', 'Tree-oak', 'tree oak', 1, null]) {
      expect(isEditablePieceId(id), String(id)).toBe(false);
    }
    expect(isEditablePieceId(`tree-${'a'.repeat(200)}`)).toBe(false);
  });
});

describe('pieceCollisions: orientation', () => {
  it('keeps down and up as drawn and turns the long side for left and right', () => {
    expect(rotationForFacing('down')).toBe(0);
    expect(rotationForFacing('up')).toBe(0);
    expect(rotationForFacing('right')).toBe(90);
    expect(rotationForFacing('left')).toBe(270);
  });

  it('rotates a rectangle clockwise about the anchor, as Phaser angles go', () => {
    const rect = { x: 2, y: -10, w: 6, h: 4 };
    expect(rotateRect(rect, 0)).toEqual(rect);
    // (x, y) -> (-y, x)
    expect(rotateRect(rect, 90)).toEqual({ x: 6, y: 2, w: 4, h: 6 });
    expect(rotateRect(rect, 180)).toEqual({ x: -8, y: 6, w: 6, h: 4 });
    // (x, y) -> (y, -x)
    expect(rotateRect(rect, 270)).toEqual({ x: -10, y: -8, w: 4, h: 6 });
  });
});

describe('pieceCollisions: instances', () => {
  it('measures a tree, plant or table from the bottom middle of its footprint and defaults to the whole footprint', () => {
    const [table] = layoutPropInstances([prop({ piece: 'table-meeting', kind: 'table', tx: 10, ty: 4, w: 3, h: 2 })]);

    expect(table).toMatchObject({ piece: 'table-meeting', pivot: { x: 10 * 32 + 48, y: 6 * 32 }, rotation: 0 });
    expect(worldRectsOf(table!, NO_EDITS)).toEqual([{ x: 320, y: 128, w: 96, h: 64 }]);
  });

  it('measures a desk from its middle, in its facing, and leaves bridges to the terrain', () => {
    const instances = layoutPropInstances([
      prop({ piece: 'desk-wood', kind: 'desk', tx: 4, ty: 2, w: 1, h: 2, facing: 'left' }),
      prop({ piece: 'bridge-wood', kind: 'bridge', tx: 0, ty: 0, w: 3, h: 3, collision: 'deck', orientation: 'north-south' }),
    ]);

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ pivot: { x: 4 * 32 + 16, y: 2 * 32 + 32 }, rotation: 270 });
    // Defaults are the footprint as placed: no second rotation.
    expect(worldRectsOf(instances[0]!, NO_EDITS)).toEqual([{ x: 128, y: 64, w: 32, h: 64 }]);
  });

  it('applies the saved rectangles of a piece to every instance, turned with it', () => {
    const instances = layoutPropInstances([
      prop({ piece: 'desk-wood', kind: 'desk', tx: 0, ty: 0, w: 2, h: 1, facing: 'down' }),
      prop({ piece: 'desk-wood', kind: 'desk', tx: 10, ty: 10, w: 1, h: 2, facing: 'right' }),
    ]);
    const table = new Map([['desk-wood', [{ x: -20, y: -8, w: 40, h: 10 }]]]);

    expect(worldRectsOf(instances[0]!, table)).toEqual([{ x: 32 - 20, y: 16 - 8, w: 40, h: 10 }]);
    // Right: (x, y) -> (-y, x) about the middle of a 1x2 desk at (336, 352).
    expect(worldRectsOf(instances[1]!, table)).toEqual([{ x: 336 - 2, y: 352 - 20, w: 10, h: 40 }]);
  });

  it('treats an empty saved list as walk-through', () => {
    const instances = layoutPropInstances([prop({ piece: 'tree-oak', kind: 'tree', tx: 1, ty: 1 })]);
    expect(worldRectsOf(instances[0]!, new Map([['tree-oak', []]]))).toEqual([]);
  });

  it('puts a chair on its ground point, turned by its facing, with no collision by default', () => {
    const [seat] = seatInstances([{ tx: 3, ty: 5, facing: 'right' }], 'chair-wood');

    expect(seat).toMatchObject({ piece: 'chair-wood', pivot: { x: 3 * 32 + 16, y: 5 * 32 + 16 }, rotation: 90 });
    expect(worldRectsOf(seat!, NO_EDITS)).toEqual([]);
    expect(worldRectsOf(seat!, new Map([['chair-wood', [{ x: -4, y: -6, w: 8, h: 4 }]]]))).toEqual([{ x: 114, y: 172, w: 4, h: 8 }]);
  });

  it('puts a served desk in the middle of its area and its decor plants in their slot boxes', () => {
    const desk = { x: 320, y: 160, w: 96, h: 96, materialId: 'desk-oak', items: [{ slot: 4, rotation: 0, pieceId: 'plant-upload-0123456789abcdef' }, { slot: 9, rotation: 0, pieceId: 'plant-ficus' }, { slot: 0, rotation: 0, pieceId: null }] };
    const instances = deskInstances([desk]);

    expect(instances.map((instance) => instance.piece)).toEqual(['desk-oak', 'plant-upload-0123456789abcdef']);
    expect(instances[0]).toMatchObject({ pivot: { x: 368, y: 208 }, rotation: 0 });
    expect(instances.every((instance) => worldRectsOf(instance, NO_EDITS).length === 0)).toBe(true);

    // A 32x48 plant squeezed into its 32x32 slot: its anchor lands on the bottom middle of the box.
    const box = deskSlotRect(desk, 4)!;
    const plant = instances[1]!;
    const table = new Map([['plant-upload-0123456789abcdef', [{ x: -8, y: -12, w: 16, h: 12 }]]]);
    const [rect] = worldRectsOf(plant, table);
    expect(rect!.x).toBeCloseTo(box.x + 8);
    expect(rect!.w).toBeCloseTo(16);
    expect(rect!.y + rect!.h).toBeCloseTo(box.y + (46 * 32) / 48);
    expect(rect!.h).toBeCloseTo(8);
  });

  it('gathers the static office: every solid prop of the layout and every base chair', () => {
    const instances = staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS);
    const solid = BASE_LAYOUT.props.filter((p) => p.collision === 'solid');

    expect(BASE_CHAIR_PIECE).toBe(BASE_MAP_CHAIR);
    expect(instances).toHaveLength(solid.length + BASE_MAP_SEATS.length);
    expect(instances.filter((instance) => instance.piece === BASE_CHAIR_PIECE)).toHaveLength(BASE_MAP_SEATS.length);
  });

  it('skips a desk without a material', () => {
    expect(deskInstances([{ x: 0, y: 0, w: 96, h: 96, materialId: null, items: [] }])).toEqual([]);
  });
});

describe('pieceCollisions: the world', () => {
  const instances = layoutPropInstances([
    prop({ piece: 'tree-oak', kind: 'tree', tx: 2, ty: 2 }),
    prop({ piece: 'table-meeting', kind: 'table', tx: 10, ty: 4, w: 3, h: 2 }),
  ]);

  it('collects every rectangle with its piece', () => {
    expect(collisionWorld(instances, NO_EDITS)).toEqual([
      { piece: 'tree-oak', x: 64, y: 64, w: 32, h: 32 },
      { piece: 'table-meeting', x: 320, y: 128, w: 96, h: 64 },
    ]);
  });

  it('blocks a position whose body center falls inside a rectangle, half open like tiles', () => {
    const world = collisionWorld(instances, NO_EDITS);
    // Body center = position + (0, 11); the server deliberately checks only this point.
    expect(isPositionBlocked(world, 64, 64 - 11)).toBe(true);
    expect(isPositionBlocked(world, 95, 95 - 11)).toBe(true);
    expect(isPositionBlocked(world, 96, 64 - 11)).toBe(false);
    expect(isPositionBlocked(world, 63, 64 - 11)).toBe(false);
    expect(isPositionBlocked(world, Number.NaN, 0)).toBe(true);
  });

  it('matches the tile rule exactly while a piece keeps its default footprint', () => {
    const world = collisionWorld(layoutPropInstances(BASE_LAYOUT.props), NO_EDITS);
    const solid = new Set<number>();
    for (const p of BASE_LAYOUT.props) {
      if (p.collision !== 'solid') continue;
      for (let ty = p.ty; ty < p.ty + p.h; ty += 1) for (let tx = p.tx; tx < p.tx + p.w; tx += 1) solid.add(ty * BASE_LAYOUT.width + tx);
    }
    for (let y = 20; y < 60 * 32; y += 7) {
      for (let x = 20; x < 64 * 32; x += 13) {
        const tile = Math.floor((y + 11) / 32) * BASE_LAYOUT.width + Math.floor(x / 32);
        expect(isPositionBlocked(world, x, y), `${x},${y}`).toBe(solid.has(tile));
      }
    }
  });

  it('tells which tiles a rectangle touches, for the tile helpers', () => {
    const tiles = coveredTiles([{ x: 40, y: 32, w: 30, h: 1 }], 4, 3);
    expect(tiles).toEqual([false, false, false, false, false, true, true, false, false, false, false, false]);
    // Touching an edge is not covering.
    expect(coveredTiles([{ x: 32, y: 0, w: 32, h: 32 }], 3, 1)).toEqual([false, true, false]);
  });

  it('says when a box overlaps a rectangle, edges excluded', () => {
    const rects = [{ x: 10, y: 10, w: 10, h: 10 }];
    expect(boxOverlapsRects(rects, { x: 19, y: 19, width: 5, height: 5 })).toBe(true);
    expect(boxOverlapsRects(rects, { x: 20, y: 10, width: 5, height: 5 })).toBe(false);
  });
});

describe('pieceCollisions: wire form', () => {
  it('round-trips the table, sorted by piece', () => {
    const table = new Map<string, readonly CollisionRect[]>([
      ['tree-oak', [{ x: -8, y: -12, w: 16, h: 12 }]],
      ['desk-wood', []],
    ]);
    const encoded = encodeCollisionTable(table);

    expect(encoded).toBe('{"desk-wood":[],"tree-oak":[[-8,-12,16,12]]}');
    expect(decodeCollisionTable(encoded)).toEqual(table);
    expect(decodeCollisionTable(encodeCollisionTable(new Map()))).toEqual(new Map());
  });

  it('reads nothing from a broken value and drops bad entries', () => {
    expect(decodeCollisionTable('')).toBeNull();
    expect(decodeCollisionTable('nope')).toBeNull();
    expect(decodeCollisionTable('[]')).toBeNull();
    expect(decodeCollisionTable(42)).toBeNull();
    expect(decodeCollisionTable('{"tree-oak":[[1,2,3,4]],"wall-x":[[1,2,3,4]],"plant-a":[[0,0,0,0]],"table-b":"x"}')).toEqual(
      new Map([['tree-oak', [{ x: 1, y: 2, w: 3, h: 4 }]]]),
    );
  });
});

describe('pieceCollisions: editing support', () => {
  const [desk] = layoutPropInstances([prop({ piece: 'desk-wood', kind: 'desk', tx: 10, ty: 10, w: 1, h: 2, facing: 'right' })]);

  it('gives the editor the saved rectangles, or the defaults turned back into piece space', () => {
    expect(pieceRectsOf(desk!, new Map([['desk-wood', [{ x: 1, y: 2, w: 3, h: 4 }]]]))).toEqual({ rects: [{ x: 1, y: 2, w: 3, h: 4 }], saved: true });
    // The 1x2 default footprint of a right-facing desk is a 64x32 rectangle in its down-facing space.
    expect(pieceRectsOf(desk!, NO_EDITS)).toEqual({ rects: [{ x: -32, y: -16, w: 64, h: 32 }], saved: false });
  });

  it('turns a world rectangle into piece space and back', () => {
    const world = { x: 330, y: 340, w: 10, h: 40 };
    const piece = toPieceRect(desk!, world);
    expect(worldRectsOf(desk!, new Map([['desk-wood', [piece]]]))).toEqual([world]);
  });

  it('picks the smallest thing under a point, so decor wins over its desk', () => {
    const instances: CollisionInstance[] = deskInstances([
      { x: 0, y: 0, w: 96, h: 96, materialId: 'desk-oak', items: [{ slot: 4, rotation: 0, pieceId: 'plant-ficus' }] },
    ]);
    expect(pickInstance(instances, NO_EDITS, { x: 48, y: 48 })?.piece).toBe('plant-ficus');
    expect(pickInstance(instances, NO_EDITS, { x: 5, y: 5 })?.piece).toBe('desk-oak');
    expect(pickInstance(instances, NO_EDITS, { x: 500, y: 5 })).toBeNull();
  });
});
