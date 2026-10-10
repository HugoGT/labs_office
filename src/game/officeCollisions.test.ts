import { describe, expect, it } from 'vitest';
import type { OfficeDesk } from './desksPort';
import { BASE_LAYOUT } from './officeLayout';
import { BASE_COLLISION_RECTS, STATIC_COLLISION_INSTANCES, officeCollisionInstances, officeDeskPlacements } from './officeCollisions';
import { collisionWorld, staticCollisionInstances } from './pieceCollisions';
import { BASE_MAP_SEATS } from './seating';

function desk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
  return { id: 'd1', label: 'Mesa 1', x: 320, y: 160, w: 96, h: 96, occupant: null, mine: false, appearance: { materialId: 'desk-oak', color: null }, ...overrides };
}

describe('officeCollisions', () => {
  it('starts from the static office with every piece at its default', () => {
    expect(STATIC_COLLISION_INSTANCES).toEqual(staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS));
    expect(BASE_COLLISION_RECTS).toEqual(collisionWorld(STATIC_COLLISION_INSTANCES, new Map()));
  });

  it('places the served desks as the server does: pixels, material, and the pieces of the decor', () => {
    const served = desk({
      occupant: {
        id: 'u1',
        displayName: null,
        items: [
          { id: 'i1', slot: 4, rotation: 90, textureKey: 'art:plant-ficus:sheet', aboveAvatars: false },
          { id: 'i2', slot: 1, rotation: 0, textureKey: 'decor-mug', aboveAvatars: false },
        ],
      },
    });

    expect(officeDeskPlacements([served, desk({ id: 'd2', appearance: undefined })])).toEqual([
      {
        x: 320,
        y: 160,
        w: 96,
        h: 96,
        materialId: 'desk-oak',
        items: [
          { slot: 4, rotation: 90, pieceId: 'plant-ficus' },
          { slot: 1, rotation: 0, pieceId: null },
        ],
      },
      { x: 320, y: 160, w: 96, h: 96, materialId: null, items: [] },
    ]);
  });

  it('adds the desk instances after the static ones', () => {
    const instances = officeCollisionInstances([desk()]);

    expect(instances.slice(0, STATIC_COLLISION_INSTANCES.length)).toEqual(STATIC_COLLISION_INSTANCES);
    expect(instances.at(-1)?.piece).toBe('desk-oak');
  });

  it('adds the placed chairs last, each as its own piece', () => {
    const instances = officeCollisionInstances([desk()], undefined, undefined, [{ index: 5, piece: 'chair-gamer', facing: 'up' }]);

    expect(instances.at(-2)?.piece).toBe('desk-oak');
    expect(instances.at(-1)).toMatchObject({ piece: 'chair-gamer', pivot: { x: 5 * 32 + 16, y: 16 } });
  });
});
