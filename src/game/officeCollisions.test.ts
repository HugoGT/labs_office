import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import type { ArtPackManifest } from './artContract';
import { BASE_LAYOUT } from './officeLayout';
import { BASE_COLLISION_RECTS, STATIC_COLLISION_INSTANCES, decorInfoFromManifest, officeCollisionInstances } from './officeCollisions';
import { collisionWorld, staticCollisionInstances } from './pieceCollisions';
import { BASE_MAP_SEATS } from './seating';

const PACK = JSON.parse(exportedManifest) as ArtPackManifest;

describe('officeCollisions', () => {
  it('starts from the static office with every piece at its default', () => {
    expect(STATIC_COLLISION_INSTANCES).toEqual(staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS));
    expect(BASE_COLLISION_RECTS).toEqual(collisionWorld(STATIC_COLLISION_INSTANCES, new Map()));
    expect(officeCollisionInstances()).toEqual(STATIC_COLLISION_INSTANCES);
  });

  it('resolves decor pieces from the manifest, falling back on the id while it is not loaded', () => {
    const infoOf = decorInfoFromManifest(PACK);
    expect(infoOf('table-meeting')).toEqual({ kind: 'table', footprint: { w: 7, h: 5 } });
    expect(infoOf('chair-wood')).toEqual({ kind: 'chair', footprint: { w: 1, h: 1 } });
    expect(infoOf('tree-oak')).toBeNull();
    expect(decorInfoFromManifest(null)('desk-upload-0123456789abcdef')).toEqual({ kind: 'desk', footprint: { w: 3, h: 1 } });
    expect(decorInfoFromManifest(null)('table-meeting')).toBeNull();
  });

  it('adds the decor layer last, each item as its own piece, as the room does', () => {
    const instances = officeCollisionInstances(BASE_LAYOUT, BASE_MAP_SEATS, [{ index: 5, piece: 'chair-gamer', rotation: 180 }], decorInfoFromManifest(PACK));

    expect(instances).toHaveLength(STATIC_COLLISION_INSTANCES.length + 1);
    expect(instances.at(-1)).toMatchObject({ piece: 'chair-gamer', pivot: { x: 5 * 32 + 16, y: 16 } });
    expect(collisionWorld(instances.slice(-1), new Map())).toEqual([]);
  });
});
