import { describe, expect, it } from 'vitest';
import {
  ART_TILE,
  FLOOR_MOTIF_SIZE,
  TERRAIN_BUILT_FLOORS,
  TERRAIN_CORNER_BITS,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  TERRAIN_PHASES,
  countColors,
  terrainPhaseOrigin,
  type TerrainMaterial,
} from '../../../src/game/artContract.ts';
import { decalTile, TERRAIN_EDGES, terrainBankTile, terrainEdgeTile, terrainField } from './terrainTiles.ts';
import { terrainTile } from './tiles.ts';

const LAST = ART_TILE - 1;

function has(mask: number, corner: keyof typeof TERRAIN_CORNER_BITS): boolean {
  return (mask & TERRAIN_CORNER_BITS[corner]) !== 0;
}

/** Whether cell `b` can sit right of (or below) cell `a`: the corners on their shared side agree. */
function sideMatches(a: number, b: number, direction: 'horizontal' | 'vertical'): boolean {
  return direction === 'horizontal'
    ? has(a, 'ne') === has(b, 'nw') && has(a, 'se') === has(b, 'sw')
    : has(a, 'sw') === has(b, 'nw') && has(a, 'se') === has(b, 'ne');
}

describe('terrain edge tiles', () => {
  it('draw the full mask as the floor motif itself, cut at the phase origin', () => {
    for (const material of TERRAIN_MATERIALS) {
      const motif = terrainTile(material);
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        const tile = terrainEdgeTile(material, 15, phase);
        const origin = terrainPhaseOrigin(phase);
        for (let y = 0; y < ART_TILE; y += 4) {
          for (let x = 0; x < ART_TILE; x += 4) {
            const expected = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
            expect(tile.getPixel(x, y), `${material} phase ${phase} (${x}, ${y})`).toEqual(expected);
          }
        }
      }
    }
  });

  it('meet the next cell without a seam: shared corners decide both sides of the edge', () => {
    // Organic edges: the coverage field is continuous across the cell side, so
    // an edge crossing it runs on (a seam would jump by about 0.5). Square
    // edges lie on the cell's middle lines, so both sides match pixel for pixel.
    for (const material of TERRAIN_MATERIALS) {
      const organic = TERRAIN_EDGES[material].style === 'organic';
      const tiles = new Map<number, ReturnType<typeof terrainEdgeTile>>();
      const tileAt = (mask: number, phase: number): ReturnType<typeof terrainEdgeTile> => {
        const key = phase * 16 + mask;
        if (!tiles.has(key)) tiles.set(key, terrainEdgeTile(material, mask, phase));
        return tiles.get(key)!;
      };
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        const right = Math.floor(phase / 3) * 3 + (((phase % 3) + 1) % 3);
        const below = ((Math.floor(phase / 3) + 1) % 3) * 3 + (phase % 3);
        for (let a = 1; a < 16; a += 1) {
          for (let b = 1; b < 16; b += 1) {
            type Side = [compatible: boolean, next: number, here: (i: number) => [number, number], there: (i: number) => [number, number]];
            const sides: Side[] = [
              [sideMatches(a, b, 'horizontal'), right, (i) => [LAST, i], (i) => [0, i]],
              [sideMatches(a, b, 'vertical'), below, (i) => [i, LAST], (i) => [i, 0]],
            ];
            for (const [compatible, next, here, there] of sides) {
              if (!compatible) continue;
              const first = tileAt(a, phase);
              const second = tileAt(b, next);
              let jump = 0;
              let alphaMismatch = 0;
              for (let i = 0; i < ART_TILE; i += 1) {
                const [x1, y1] = here(i);
                const [x2, y2] = there(i);
                jump = Math.max(jump, Math.abs(terrainField(material, a, phase, x1, y1) - terrainField(material, b, next, x2, y2)));
                if (first.alphaAt(x1, y1) !== second.alphaAt(x2, y2)) alphaMismatch += 1;
              }
              if (organic) expect(jump, `${material} ${a}-${b} phase ${phase}`).toBeLessThan(0.12);
              else expect(alphaMismatch, `${material} ${a}-${b} phase ${phase}`).toBe(0);
            }
          }
        }
      }
    }
  });

  it('give natural materials organic edges and built floors straight ones on the tile line', () => {
    // Where the north half is covered, the row the material ends at, per column, over every phase.
    const boundaryRows = (material: TerrainMaterial): Set<number> => {
      const rows = new Set<number>();
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw | TERRAIN_CORNER_BITS.ne, phase);
        for (let x = 0; x < ART_TILE; x += 1) {
          let y = 0;
          while (y < ART_TILE && tile.alphaAt(x, y) === 255) y += 1;
          rows.add(y);
        }
      }
      return rows;
    };
    for (const material of ['grass', 'dirt', 'sand'] as const) expect(boundaryRows(material).size, material).toBeGreaterThanOrEqual(6);
    for (const material of ['wood', 'tile', 'carpet'] as const) expect([...boundaryRows(material)], material).toEqual([ART_TILE / 2]);
    for (const material of TERRAIN_MATERIALS) expect(TERRAIN_EDGES[material].style, material).toBe(['wood', 'tile', 'carpet'].includes(material) ? 'square' : 'organic');
  });

  it('shade the edge: a darker rim inside and a translucent contact shadow outside', () => {
    const motif = terrainTile('grass');
    const tile = terrainEdgeTile('grass', TERRAIN_CORNER_BITS.nw, 0);
    const origin = terrainPhaseOrigin(0);
    let rim = 0;
    let shadow = 0;
    for (let y = 0; y < ART_TILE; y += 1) {
      for (let x = 0; x < ART_TILE; x += 1) {
        const pixel = tile.getPixel(x, y);
        if (pixel.a > 0 && pixel.a < 255) shadow += 1;
        const under = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
        if (pixel.a === 255 && (pixel.r !== under.r || pixel.g !== under.g || pixel.b !== under.b)) rim += 1;
      }
    }
    expect(rim).toBeGreaterThan(10);
    expect(shadow).toBeGreaterThan(10);
  });
  it('give built floors a one pixel rim, so their edge reads as floor and not as a wall', () => {
    for (const material of ['wood', 'tile', 'carpet'] as const) {
      const motif = terrainTile(material);
      const origin = terrainPhaseOrigin(0);
      // Mask nw covers the top-left quarter: rows 0-15, so row 15 is the edge and row 14 the next one in.
      const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw, 0);
      const differs = (x: number, y: number): boolean => {
        const pixel = tile.getPixel(x, y);
        const under = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
        return pixel.r !== under.r || pixel.g !== under.g || pixel.b !== under.b;
      };
      for (let x = 0; x < ART_TILE / 2 - 2; x += 1) {
        expect(differs(x, ART_TILE / 2 - 1), `${material} edge row, x ${x}`).toBe(true);
        expect(differs(x, ART_TILE / 2 - 2), `${material} row inside, x ${x}`).toBe(false);
      }
    }
  });
  it('draw no contact shadow outside built floors, so the drawn edge is the walkable tile line', () => {
    for (const material of ['wood', 'tile', 'carpet'] as const) {
      const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw, 0);
      for (let y = 0; y < ART_TILE; y += 1) {
        for (let x = 0; x < ART_TILE; x += 1) {
          const inside = x < ART_TILE / 2 && y < ART_TILE / 2;
          expect(tile.alphaAt(x, y), `${material} ${x},${y}`).toBe(inside ? 255 : 0);
        }
      }
    }
    for (const material of ['grass', 'dirt', 'sand', 'cobblestone', 'water'] as const) expect(TERRAIN_EDGES[material].shadow, material).toBe(true);
  });

  it('give the built floors of the contract, and only them, square shadowless edges', () => {
    for (const material of TERRAIN_MATERIALS) {
      const built = (TERRAIN_BUILT_FLOORS as readonly TerrainMaterial[]).includes(material);
      expect(TERRAIN_EDGES[material].style, material).toBe(built ? 'square' : 'organic');
      expect(TERRAIN_EDGES[material].shadow, material).toBe(!built);
    }
  });
});

describe('water bank tiles', () => {
  /** Chebyshev distance in pixels from the covered quarter of mask 1 (nw), 0 inside it. */
  const fromNorthWest = (x: number, y: number): number => Math.max(0, x - 15, y - 15);

  it('cast the old square-floor contact shadow outside the covered corners: 2px, near then far', () => {
    const tile = terrainBankTile(TERRAIN_CORNER_BITS.nw);
    for (let y = 0; y < ART_TILE; y += 1) {
      for (let x = 0; x < ART_TILE; x += 1) {
        const distance = fromNorthWest(x, y);
        const alpha = distance === 1 ? 72 : distance === 2 ? 36 : 0;
        expect(tile.alphaAt(x, y), `${x},${y}`).toBe(alpha);
        if (alpha > 0) expect(tile.getPixel(x, y), `${x},${y}`).toEqual({ r: 28, g: 18, b: 44, a: alpha });
      }
    }
    // A straight north edge: the two rows below the tile line, the whole width.
    const north = terrainBankTile(TERRAIN_CORNER_BITS.nw | TERRAIN_CORNER_BITS.ne);
    for (let x = 0; x < ART_TILE; x += 1) {
      expect([north.alphaAt(x, 15), north.alphaAt(x, 16), north.alphaAt(x, 17), north.alphaAt(x, 18)], `${x}`).toEqual([0, 72, 36, 0]);
    }
  });

  it('draw nothing on the covered corners, where the floor goes, and nothing at all for the full mask', () => {
    for (let mask = 1; mask < 16; mask += 1) {
      const bank = terrainBankTile(mask);
      const floor = terrainEdgeTile('wood', mask, 0);
      for (let y = 0; y < ART_TILE; y += 1) {
        for (let x = 0; x < ART_TILE; x += 1) {
          if (floor.alphaAt(x, y) > 0) expect(bank.alphaAt(x, y), `${mask} ${x},${y}`).toBe(0);
        }
      }
      expect(countColors(bank), `${mask}`).toBeLessThanOrEqual(2);
    }
    expect(terrainBankTile(15).countOpaque()).toBe(0);
  });
});

describe('terrain decals', () => {
  it('are small transparent details with no background', () => {
    for (const decal of TERRAIN_DECALS) {
      const tile = decalTile(decal);
      expect([tile.width, tile.height]).toEqual([ART_TILE, ART_TILE]);
      for (const [x, y] of [
        [0, 0],
        [LAST, 0],
        [0, LAST],
        [LAST, LAST],
      ] as const) {
        expect(tile.alphaAt(x, y), decal).toBe(0);
      }
      const opaque = tile.countOpaque();
      expect(opaque, decal).toBeGreaterThan(6);
      expect(opaque, decal).toBeLessThan(ART_TILE * ART_TILE * 0.4);
      expect(countColors(tile), decal).toBeLessThanOrEqual(16);
    }
  });
});
