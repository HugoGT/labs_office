import { describe, expect, it } from 'vitest';
import { TILE } from '../../../src/game/mapData.ts';
import { MAX_COLLISION_RECTS } from '../../../src/game/pieceCollisions.ts';
import type { OfficeDesk } from '../desks/desksPort.ts';
import { DESK_SIDE } from '../desks/deskRules.ts';
import {
  InvalidCollisionEditError,
  deskCollisionPlacements,
  parseCollisionEdit,
  parsePieceId,
  trapsPlayer,
} from './collisionRules.ts';

function officeDesk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
  return {
    id: 'desk-1',
    label: 'Mesa 1',
    x: 10,
    y: 5,
    occupantId: null,
    materialId: 'desk-oak',
    color: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    occupant: null,
    ...overrides,
  };
}

describe('parseCollisionEdit', () => {
  it('reads the piece of the path and the rectangles of the body', () => {
    expect(parseCollisionEdit('tree-oak', { rects: [{ x: -8, y: -12, w: 16, h: 12 }] })).toEqual({
      pieceId: 'tree-oak',
      rects: [{ x: -8, y: -12, w: 16, h: 12 }],
    });
    expect(parseCollisionEdit('desk-wood', { rects: [] })).toEqual({ pieceId: 'desk-wood', rects: [] });
  });

  it('refuses a piece that is not editable, a body without rects and invalid rectangles', () => {
    const bad: [unknown, unknown][] = [
      ['wall-brick', { rects: [] }],
      ['bridge-wood', { rects: [] }],
      [undefined, { rects: [] }],
      ['tree-oak', null],
      ['tree-oak', []],
      ['tree-oak', {}],
      ['tree-oak', { rects: [{ x: 0, y: 0, w: 0, h: 1 }] }],
      ['tree-oak', { rects: Array.from({ length: MAX_COLLISION_RECTS + 1 }, () => ({ x: 0, y: 0, w: 1, h: 1 })) }],
    ];
    for (const [piece, body] of bad) expect(() => parseCollisionEdit(piece, body), String(piece)).toThrow(InvalidCollisionEditError);
  });

  it('reads a piece id alone, for a reset', () => {
    expect(parsePieceId('chair-wood')).toBe('chair-wood');
    expect(() => parsePieceId('hedge-boxwood')).toThrow(InvalidCollisionEditError);
  });
});

describe('deskCollisionPlacements', () => {
  it('turns served desks into pixel areas with their material and the pieces of their decor', () => {
    const desks = [
      officeDesk({
        occupantId: 'u1',
        occupant: {
          id: 'u1',
          displayName: null,
          items: [
            { id: 'i1', assetId: 'a1', slot: 2, rotation: 90, textureKey: 'art:plant-upload-0123456789abcdef:sheet', w: 1, h: 1, name: 'Helecho', aboveAvatars: false, createdAt: new Date(0) },
            { id: 'i2', assetId: 'a2', slot: 3, rotation: 0, textureKey: 'decor-mug', w: 1, h: 1, name: 'Taza', aboveAvatars: false, createdAt: new Date(0) },
          ],
        },
      }),
    ];

    expect(deskCollisionPlacements(desks)).toEqual([
      {
        x: 10 * TILE,
        y: 5 * TILE,
        w: DESK_SIDE * TILE,
        h: DESK_SIDE * TILE,
        materialId: 'desk-oak',
        items: [
          { slot: 2, rotation: 90, pieceId: 'plant-upload-0123456789abcdef' },
          { slot: 3, rotation: 0, pieceId: null },
        ],
      },
    ]);
  });
});

describe('trapsPlayer', () => {
  // Ground feet (109, 114), with an 18x14 footprint at (100, 100).
  const player = { x: 109, y: 96 };

  it('protects the feet footprint, not the old torso-offset box, including edge-only overlap', () => {
    expect(trapsPlayer([], [{ x: 91, y: 217, w: 1, h: 1 }], [{ x: 100, y: 200 }])).toBe(true);
    expect(trapsPlayer([], [{ x: 73, y: 184, w: 1, h: 1 }], [{ x: 100, y: 200 }])).toBe(false);
    expect(trapsPlayer([], [{ x: 109, y: 204, w: 1, h: 1 }], [{ x: 100, y: 200 }])).toBe(false);
  });

  it('names a player whose body a new rectangle would overlap', () => {
    expect(trapsPlayer([], [{ x: 110, y: 105, w: 4, h: 4 }], [player])).toBe(true);
    expect(trapsPlayer([], [{ x: 0, y: 0, w: 4, h: 4 }], [player])).toBe(false);
  });

  it('lets an edit through when the player already stood in that piece rectangle', () => {
    expect(trapsPlayer([{ x: 100, y: 100, w: 20, h: 20 }], [{ x: 105, y: 105, w: 20, h: 20 }], [player])).toBe(false);
  });
});
