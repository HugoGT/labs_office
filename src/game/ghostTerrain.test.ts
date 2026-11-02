import { describe, expect, it } from 'vitest';
import { BLOCK_TILES, LAYOUT_MATERIALS, terrainMaterialAt } from './officeLayout';
import { GHOST_LAYOUT, TERRAIN_GHOST_ALPHA, ghostTerrain } from './ghostTerrain';

describe('ghostTerrain', () => {
  it('is the picture of one block of the map, drawn nearly opaque so its color reads true', () => {
    expect(GHOST_LAYOUT.width).toBe(BLOCK_TILES);
    expect(GHOST_LAYOUT.height).toBe(BLOCK_TILES);
    expect(TERRAIN_GHOST_ALPHA).toBe(0.9);
  });

  it('lays every floor the editor paints over a single block, in its color when it has one', () => {
    for (const material of LAYOUT_MATERIALS.filter((candidate) => candidate !== 'void')) {
      const ghost = ghostTerrain({ material })!;
      expect(ghost.snapshot.width).toBe(BLOCK_TILES);
      expect(ghost.snapshot.blocks).toEqual([material]);
      expect(terrainMaterialAt(ghost.snapshot, 4, 4)).toBe(material);
      expect(ghost.colors.size).toBe(0);
      expect(ghost.floors.size).toBe(0);
    }
    const carpet = ghostTerrain({ material: 'carpet', color: '#c0392b' })!;
    expect([...carpet.colors]).toEqual([[0, '#c0392b']]);
  });

  it('keeps a color only on a colorable floor, and an uploaded floor only over wood', () => {
    expect(ghostTerrain({ material: 'grass', color: '#c0392b' })!.colors.size).toBe(0);
    const uploaded = ghostTerrain({ material: 'wood', floor: 'floor-upload-0123456789abcdef' })!;
    expect([...uploaded.floors]).toEqual([[0, 'floor-upload-0123456789abcdef']]);
    expect(ghostTerrain({ material: 'sand', floor: 'floor-upload-0123456789abcdef' })!.floors.size).toBe(0);
  });

  it('draws nothing for the void eraser: the box alone says what it takes', () => {
    expect(ghostTerrain({ material: 'void' })).toBeNull();
  });
});
