/**
 * Smooth value noise that wraps around a square period, for organic shapes that must stay
 * seamless when a 96px motif repeats: terrain edges and leafy masses. Values sit on a coarse
 * lattice and are blended with smoothstep, so the result reads as soft blobs rather than the
 * per-pixel static the first terrain iteration of #123 was rejected for.
 */
import { createRng } from './random.ts';

export type Noise = (x: number, y: number) => number;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** `cells` lattice cells per period; a larger number gives smaller blobs. */
export function periodicNoise(seed: number, period: number, cells: number): Noise {
  if (period % cells !== 0) throw new Error(`${cells} cells must divide the period ${period}`);
  const rng = createRng(seed);
  const lattice = Array.from({ length: cells * cells }, () => rng());
  const size = period / cells;
  const at = (i: number, j: number): number => lattice[wrap(j, cells) * cells + wrap(i, cells)] as number;
  return (x, y) => {
    const gx = wrap(x, period) / size;
    const gy = wrap(y, period) / size;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const tx = smoothstep(gx - i);
    const ty = smoothstep(gy - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}
