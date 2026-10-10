import { describe, expect, it } from 'vitest';
import { collisionEditHoldsMap, layoutEditHoldsMap, terrainEditHoldsMap } from './editorMapHold';

describe('editorMapHold', () => {
  it('the layout editor holds the map only with an item selected or being placed', () => {
    expect(layoutEditHoldsMap(null)).toBe(false);
    expect(layoutEditHoldsMap({ pickable: [], selectedId: null, placing: null })).toBe(false);
    expect(layoutEditHoldsMap({ pickable: [], selectedId: 'desk-1', placing: null })).toBe(true);
    expect(layoutEditHoldsMap({ pickable: [], selectedId: null, placing: { w: 3, h: 3, obstacles: [] } })).toBe(true);
  });

  it('the terrain editor holds the map only with a brush picked', () => {
    expect(terrainEditHoldsMap(null)).toBe(false);
    expect(terrainEditHoldsMap({ brush: null })).toBe(false);
    expect(terrainEditHoldsMap({ brush: { kind: 'floor', material: 'wood' } })).toBe(true);
    expect(terrainEditHoldsMap({ brush: { kind: 'wall', piece: null } })).toBe(true);
    expect(terrainEditHoldsMap({ brush: { kind: 'chair', piece: null, facing: 'down' } })).toBe(true);
  });

  it('the collision editor holds the map only with a piece picked', () => {
    expect(collisionEditHoldsMap(null)).toBe(false);
    expect(collisionEditHoldsMap({ pieceId: null, draft: [], selectedRect: null, snap: 1 })).toBe(false);
    expect(collisionEditHoldsMap({ pieceId: 'tree-oak', draft: [], selectedRect: null, snap: 1 })).toBe(true);
  });
});
