import { describe, expect, it } from 'vitest';
import { BLOCK_TILES, LAYOUT_MATERIALS, terrainMaterialAt } from './officeLayout';
import { GHOST_CENTER, GHOST_LAYOUT, TERRAIN_GHOST_ALPHA, ghostTerrain } from './ghostTerrain';

describe('ghostTerrain', () => {
  it('is the picture of one block of the map, drawn nearly opaque so its color reads true', () => {
    expect(TERRAIN_GHOST_ALPHA).toBe(0.9);
  });

  it('lays the block in the middle of a 3x3 of the same floor, so its own edges blend with nothing', () => {
    expect(GHOST_LAYOUT.width).toBe(3 * BLOCK_TILES);
    expect(GHOST_LAYOUT.height).toBe(3 * BLOCK_TILES);
    expect(GHOST_CENTER).toEqual({ x: BLOCK_TILES, y: BLOCK_TILES });
    const ghost = ghostTerrain({ material: 'grass' })!;
    expect(ghost.snapshot.blocks).toEqual(Array.from({ length: 9 }, () => 'grass'));
    // Every tile around the block is the same floor, so the display cells along its sides have no transition to draw.
    expect(terrainMaterialAt(ghost.snapshot, BLOCK_TILES - 1, BLOCK_TILES)).toBe('grass');
    expect(terrainMaterialAt(ghost.snapshot, 2 * BLOCK_TILES, 2 * BLOCK_TILES)).toBe('grass');
  });

  it('lays every floor the editor paints over a single block, in its color when it has one', () => {
    for (const material of LAYOUT_MATERIALS.filter((candidate) => candidate !== 'void')) {
      const ghost = ghostTerrain({ material })!;
      expect(ghost.snapshot.width).toBe(3 * BLOCK_TILES);
      expect(ghost.snapshot.blocks).toEqual(Array.from({ length: 9 }, () => material));
      expect(terrainMaterialAt(ghost.snapshot, BLOCK_TILES + 4, BLOCK_TILES + 4)).toBe(material);
      expect(ghost.colors.size).toBe(0);
      expect(ghost.floors.size).toBe(0);
    }
    const carpet = ghostTerrain({ material: 'carpet', color: '#c0392b' })!;
    expect([...carpet.colors]).toEqual(Array.from({ length: 9 }, (_, index) => [index, '#c0392b']));
  });

  it('keeps a color only on a colorable floor, and an uploaded floor only over wood', () => {
    expect(ghostTerrain({ material: 'grass', color: '#c0392b' })!.colors.size).toBe(0);
    const uploaded = ghostTerrain({ material: 'wood', floor: 'floor-upload-0123456789abcdef' })!;
    expect([...uploaded.floors]).toEqual(Array.from({ length: 9 }, (_, index) => [index, 'floor-upload-0123456789abcdef']));
    expect(ghostTerrain({ material: 'sand', floor: 'floor-upload-0123456789abcdef' })!.floors.size).toBe(0);
  });

  it('draws nothing for the void eraser: the box alone says what it takes', () => {
    expect(ghostTerrain({ material: 'void' })).toBeNull();
  });
});
