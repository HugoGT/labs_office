import { describe, expect, it } from 'vitest';
import {
  ART_TILE,
  FLOOR_MOTIF_SIZE,
  TERRAIN_BUILT_FLOORS,
  TERRAIN_CORNER_BITS,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  TERRAIN_ORGANIC_MATERIALS,
  TERRAIN_PHASES,
  TERRAIN_VARIANTS,
  TERRAIN_VOID_COLOR,
  TERRAIN_VOID_EDGE_COMBOS,
  countColors,
  terrainPhaseOrigin,
  type TerrainMaterial,
} from '../../../src/game/artContract.ts';
import { OUTLINE_INK } from '../../../src/game/artColor.ts';
import {
  decalTile,
  TERRAIN_EDGES,
  terrainBankTile,
  terrainEdgeTile,
  terrainField,
  terrainVoidCapTile,
  terrainVoidEdgeField,
  terrainVoidEdgeTile,
  terrainVoidWeight,
} from './terrainTiles.ts';
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
        for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
          const tile = terrainEdgeTile(material, 15, phase, variant);
          const origin = terrainPhaseOrigin(phase);
          for (let y = 0; y < ART_TILE; y += 4) {
            for (let x = 0; x < ART_TILE; x += 4) {
              const expected = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
              expect(tile.getPixel(x, y), `${material} phase ${phase} variant ${variant} (${x}, ${y})`).toEqual(expected);
            }
          }
        }
      }
    }
  });

  it('meet the next cell without a seam: shared corners decide both sides of the edge, whatever variant each cell picks', () => {
    // Organic edges: the coverage field is continuous across the cell side, so
    // an edge crossing it runs on (a seam would jump by about 0.5). Square
    // edges lie on the cell's middle lines, so both sides match pixel for pixel.
    for (const material of TERRAIN_MATERIALS) {
      const organic = TERRAIN_EDGES[material].style === 'organic';
      const tiles = new Map<number, ReturnType<typeof terrainEdgeTile>>();
      const tileAt = (mask: number, phase: number, variant: number): ReturnType<typeof terrainEdgeTile> => {
        const key = (variant * TERRAIN_PHASES + phase) * 16 + mask;
        if (!tiles.has(key)) tiles.set(key, terrainEdgeTile(material, mask, phase, variant));
        return tiles.get(key)!;
      };
      // Square edges ignore the variant, so one pair of variants is enough for them.
      const variants = organic ? Array.from({ length: TERRAIN_VARIANTS }, (_, v) => v) : [0, 1];
      // The worst side of the material, asserted once: an expect per side made this slow.
      let worst = { jump: 0, alphaMismatch: 0, label: material as string };
      // Each tile's field along one row or column, computed once for every pair that uses it.
      const lines = new Map<string, number[]>();
      const lineAt = (mask: number, phase: number, variant: number, at: (i: number) => [number, number], name: string): number[] => {
        const key = `${mask}:${phase}:${variant}:${name}`;
        if (!lines.has(key)) lines.set(key, Array.from({ length: ART_TILE }, (_, i) => terrainField(material, mask, phase, variant, ...at(i))));
        return lines.get(key)!;
      };
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        const right = Math.floor(phase / 3) * 3 + (((phase % 3) + 1) % 3);
        const below = ((Math.floor(phase / 3) + 1) % 3) * 3 + (phase % 3);
        for (let a = 1; a < 16; a += 1) {
          for (let b = 1; b < 16; b += 1) {
            type Side = [compatible: boolean, next: number, here: (i: number) => [number, number], there: (i: number) => [number, number], names: [string, string]];
            const sides: Side[] = [
              [sideMatches(a, b, 'horizontal'), right, (i) => [LAST, i], (i) => [0, i], ['east', 'west']],
              [sideMatches(a, b, 'vertical'), below, (i) => [i, LAST], (i) => [i, 0], ['south', 'north']],
            ];
            for (const [compatible, next, here, there, names] of sides) {
              if (!compatible) continue;
              for (const va of variants) {
                for (const vb of variants) {
                  const first = tileAt(a, phase, va);
                  const second = tileAt(b, next, vb);
                  const fieldsA = lineAt(a, phase, va, here, names[0]);
                  const fieldsB = lineAt(b, next, vb, there, names[1]);
                  let jump = 0;
                  let alphaMismatch = 0;
                  for (let i = 0; i < ART_TILE; i += 1) {
                    const [x1, y1] = here(i);
                    const [x2, y2] = there(i);
                    jump = Math.max(jump, Math.abs(fieldsA[i]! - fieldsB[i]!));
                    if (first.alphaAt(x1, y1) !== second.alphaAt(x2, y2)) alphaMismatch += 1;
                  }
                  if (jump > worst.jump || alphaMismatch > worst.alphaMismatch) {
                    worst = { jump: Math.max(jump, worst.jump), alphaMismatch: Math.max(alphaMismatch, worst.alphaMismatch), label: `${material} ${a}/${va}-${b}/${vb} phase ${phase}` };
                  }
                }
              }
            }
          }
        }
      }
      if (organic) expect(worst.jump, worst.label).toBeLessThan(0.12);
      else expect(worst.alphaMismatch, worst.label).toBe(0);
    }
  });

  it('vary organic edges only inside the cell: on its four sides every variant has the field of variant 0', () => {
    // u or v = 0 or 1 is the cell side itself (pixel coordinates -0.5 and 31.5).
    const sides: readonly ((t: number) => [number, number])[] = [
      (t) => [-0.5, t],
      (t) => [ART_TILE - 0.5, t],
      (t) => [t, -0.5],
      (t) => [t, ART_TILE - 0.5],
    ];
    for (const material of TERRAIN_MATERIALS) {
      if (TERRAIN_EDGES[material].style !== 'organic') continue;
      for (let mask = 1; mask < 16; mask += 1) {
        for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
          for (let variant = 1; variant < TERRAIN_VARIANTS; variant += 1) {
            for (const side of sides) {
              let gap = 0;
              for (let t = -0.5; t <= ART_TILE - 0.5; t += 0.5) {
                const [x, y] = side(t);
                gap = Math.max(gap, Math.abs(terrainField(material, mask, phase, variant, x, y) - terrainField(material, mask, phase, 0, x, y)));
              }
              expect(gap, `${material} ${mask} ${phase} ${variant} ${side(0)}`).toBeLessThan(1e-9);
            }
          }
        }
      }
    }
  });

  it('draw visibly different organic edges per variant, and the same square ones', () => {
    const coverage = (material: TerrainMaterial, mask: number, phase: number, variant: number): number[] => {
      const tile = terrainEdgeTile(material, mask, phase, variant);
      return Array.from({ length: ART_TILE * ART_TILE }, (_, i) => tile.alphaAt(i % ART_TILE, Math.floor(i / ART_TILE)) === 255 ? 1 : 0);
    };
    for (const material of TERRAIN_MATERIALS) {
      const organic = TERRAIN_EDGES[material].style === 'organic';
      for (let mask = 1; mask < 15; mask += 1) {
        const shapes = Array.from({ length: TERRAIN_VARIANTS }, (_, variant) => coverage(material, mask, 0, variant));
        for (let a = 0; a < TERRAIN_VARIANTS; a += 1) {
          for (let b = a + 1; b < TERRAIN_VARIANTS; b += 1) {
            const differing = shapes[a]!.filter((covered, i) => covered !== shapes[b]![i]).length;
            if (organic) expect(differing, `${material} mask ${mask} variants ${a}-${b}`).toBeGreaterThanOrEqual(6);
            else expect(differing, `${material} mask ${mask} variants ${a}-${b}`).toBe(0);
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
        const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw | TERRAIN_CORNER_BITS.ne, phase, 0);
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
    const tile = terrainEdgeTile('grass', TERRAIN_CORNER_BITS.nw, 0, 0);
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
      const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw, 0, 0);
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
      const tile = terrainEdgeTile(material, TERRAIN_CORNER_BITS.nw, 0, 0);
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
      const floor = terrainEdgeTile('wood', mask, 0, 0);
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

describe('void edge tiles', () => {
  type Corner = keyof typeof TERRAIN_CORNER_BITS;
  /** A cell side: its two corners, the pixel point at position t along it, and the side across in the next cell. */
  interface Side {
    readonly corners: readonly [Corner, Corner];
    readonly at: (t: number) => [number, number];
    readonly across: 'west' | 'east' | 'north' | 'south';
  }
  const EDGE = ART_TILE - 0.5;
  const SIDES: Readonly<Record<'west' | 'east' | 'north' | 'south', Side>> = {
    west: { corners: ['nw', 'sw'], at: (t) => [-0.5, t], across: 'east' },
    east: { corners: ['ne', 'se'], at: (t) => [EDGE, t], across: 'west' },
    north: { corners: ['nw', 'ne'], at: (t) => [t, -0.5], across: 'south' },
    south: { corners: ['sw', 'se'], at: (t) => [t, EDGE], across: 'north' },
  };
  // The neighbor across a side sits one motif tile further: its phase.
  const nextPhase = (phase: number, side: 'west' | 'east' | 'north' | 'south'): number => {
    const [col, row] = [phase % 3, Math.floor(phase / 3)];
    const shift = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }[side];
    return (((row + shift[1]!) % 3) + 3) % 3 * 3 + ((((col + shift[0]!) % 3) + 3) % 3);
  };
  /** The bits of `mask` on a side, moved onto the side across (the two corners the cells share). */
  const sideBits = (mask: number, side: Side): readonly boolean[] => side.corners.map((corner) => (mask & TERRAIN_CORNER_BITS[corner]) !== 0);
  const points = Array.from({ length: ART_TILE + 1 }, (_, i) => i - 0.5);

  it('weigh the noise 1 on every side away from the void, 0 on the void quarters', () => {
    for (const { voidMask } of TERRAIN_VOID_EDGE_COMBOS) {
      for (const side of Object.values(SIDES)) {
        if (sideBits(voidMask, side).some(Boolean)) continue;
        for (const t of points) expect(terrainVoidWeight(voidMask, ...side.at(t)), `${voidMask} ${side.corners}`).toBe(1);
      }
      for (let y = 0; y < ART_TILE; y += 1) {
        for (let x = 0; x < ART_TILE; x += 1) {
          const corner: Corner = y < ART_TILE / 2 ? (x < ART_TILE / 2 ? 'nw' : 'ne') : x < ART_TILE / 2 ? 'sw' : 'se';
          if ((voidMask & TERRAIN_CORNER_BITS[corner]) !== 0) expect(terrainVoidWeight(voidMask, x, y)).toBe(0);
        }
      }
    }
  });

  it('meet every neighbor that can share a side without a seam', () => {
    for (const material of TERRAIN_ORGANIC_MATERIALS) {
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        for (const { mask, voidMask } of TERRAIN_VOID_EDGE_COMBOS) {
          const field = (x: number, y: number): number => terrainVoidEdgeField(material, mask, voidMask, phase, x, y);
          for (const [name, side] of Object.entries(SIDES) as ['west' | 'east' | 'north' | 'south', Side][]) {
            const across = SIDES[side.across];
            const next = nextPhase(phase, name);
            const label = `${material} ${mask}/${voidMask} phase ${phase} ${name}`;
            const covered = sideBits(mask, side);
            const voids = sideBits(voidMask, side);
            // One assertion per side keeps this exhaustive check fast: the largest gap, and its label.
            const here = points.map((t) => field(...side.at(t)));
            if (!voids.some(Boolean)) {
              // Away from the void the neighbor may be any cell: the side has the plain field,
              // which the plain tiles already join seamlessly.
              const gap = Math.max(...points.map((t, i) => Math.abs(here[i]! - terrainField(material, mask, phase, 0, ...side.at(t)))));
              expect(gap, label).toBeLessThan(1e-9);
              continue;
            }
            // Next to the void the neighbor shares the void corner: another void edge tile...
            for (const other of TERRAIN_VOID_EDGE_COMBOS) {
              if (sideBits(other.mask, across).join() !== covered.join() || sideBits(other.voidMask, across).join() !== voids.join()) continue;
              const gap = Math.max(...points.map((t, i) => Math.abs(here[i]! - terrainVoidEdgeField(material, other.mask, other.voidMask, next, ...across.at(t)))));
              expect(gap, `${label} vs ${other.mask}/${other.voidMask}`).toBeLessThan(1e-9);
            }
            // ...a full tile, when both corners are covered: no edge and no rim on the side...
            if (covered.every(Boolean)) expect(Math.min(...here), label).toBeGreaterThanOrEqual(0.5 + 2 / ART_TILE);
            // ...or no tile of this material, when its only covered corner there is the void:
            // then nothing of it reaches the side outside the void quarter.
            if (covered.join() === voids.join()) {
              const outside = here.filter((_, i) => terrainVoidWeight(voidMask, ...side.at(points[i]!)) > 0);
              expect(Math.max(...outside), label).toBeLessThan(0.5);
            }
          }
        }
      }
    }
  });

  it('draw no contact shadow in the two pixels next to a void quarter, where the cap draws its own rim', () => {
    for (const material of TERRAIN_ORGANIC_MATERIALS) {
      for (const { mask, voidMask } of TERRAIN_VOID_EDGE_COMBOS) {
        const tile = terrainVoidEdgeTile(material, mask, voidMask, 0);
        for (let y = 0; y < ART_TILE; y += 1) {
          for (let x = 0; x < ART_TILE; x += 1) {
            const alpha = tile.alphaAt(x, y);
            if (alpha > 0 && alpha < 255) expect(terrainVoidWeight(voidMask, x, y), `${material} ${mask}/${voidMask} ${x},${y}`).toBeGreaterThanOrEqual(4 / ART_TILE);
          }
        }
      }
    }
  });

  it('only exist for organic materials and the listed pairs', () => {
    expect(() => terrainVoidEdgeTile('wood', 1 | 2, 1, 0)).toThrow(/organic/);
    expect(() => terrainVoidEdgeTile('grass', 1 | 2, 4, 0)).toThrow(/void edge/);
  });
});

describe('void cap tiles', () => {
  const VOID = { r: (TERRAIN_VOID_COLOR >> 16) & 0xff, g: (TERRAIN_VOID_COLOR >> 8) & 0xff, b: TERRAIN_VOID_COLOR & 0xff, a: 255 };
  const RIM = { ...OUTLINE_INK, a: Math.round(0.38 * 255) };

  it('paint the void quarters opaque in the void color, with a 1px translucent rim just outside them', () => {
    const tile = terrainVoidCapTile(TERRAIN_CORNER_BITS.nw);
    for (let y = 0; y < ART_TILE; y += 1) {
      for (let x = 0; x < ART_TILE; x += 1) {
        // Chebyshev distance in pixels from the nw quarter (rows and columns 0-15).
        const distance = Math.max(0, x - 15, y - 15);
        const expected = distance === 0 ? VOID : distance === 1 ? RIM : null;
        if (expected === null) expect(tile.alphaAt(x, y), `${x},${y}`).toBe(0);
        else expect(tile.getPixel(x, y), `${x},${y}`).toEqual(expected);
      }
    }
    // A straight south edge: the rim is the row above the tile line, the whole width.
    const south = terrainVoidCapTile(TERRAIN_CORNER_BITS.sw | TERRAIN_CORNER_BITS.se);
    for (let x = 0; x < ART_TILE; x += 1) {
      expect([south.alphaAt(x, 14), south.getPixel(x, 15), south.getPixel(x, 16)], `${x}`).toEqual([0, RIM, VOID]);
    }
  });

  it('cover exactly the square quarters of their corners, for every mask, and the whole tile for mask 15', () => {
    for (let mask = 1; mask < 16; mask += 1) {
      const tile = terrainVoidCapTile(mask);
      for (let y = 0; y < ART_TILE; y += 1) {
        for (let x = 0; x < ART_TILE; x += 1) {
          const corner = (y < ART_TILE / 2 ? 0 : 2) + (x < ART_TILE / 2 ? 0 : 1);
          const voided = (mask & [TERRAIN_CORNER_BITS.nw, TERRAIN_CORNER_BITS.ne, TERRAIN_CORNER_BITS.sw, TERRAIN_CORNER_BITS.se][corner]!) !== 0;
          if (voided) expect(tile.getPixel(x, y), `${mask} ${x},${y}`).toEqual(VOID);
          else expect(tile.alphaAt(x, y), `${mask} ${x},${y}`).toBeLessThan(255);
        }
      }
      expect(countColors(tile), `${mask}`).toBeLessThanOrEqual(2);
    }
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
