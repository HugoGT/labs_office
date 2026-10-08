import { MAP_W, MAP_H, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from './mapData.ts';
import { BLOCK_TILES, isLayoutMaterial, type LayoutMaterial } from './officeLayout.ts';

export const MAP_BLOCK_COLUMNS = MAP_W / BLOCK_TILES;
export const MAP_BLOCK_ROWS = MAP_H / BLOCK_TILES;
export const SPAWN_BLOCK_INDEX = Math.floor(PLAYER_SPAWN_TY / BLOCK_TILES) * MAP_BLOCK_COLUMNS + Math.floor(PLAYER_SPAWN_TX / BLOCK_TILES);

export interface MapGeneration {
  seed: number;
  /** Includes the central spawn block. */
  landBlocks: number;
  material: Exclude<LayoutMaterial, 'water'>;
}

export function parseMapGeneration(raw: unknown): MapGeneration {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid generation parameters');
  const { seed, landBlocks, material } = raw as Record<string, unknown>;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      typeof landBlocks !== 'number' || !Number.isInteger(landBlocks) || landBlocks < 1 || landBlocks > MAP_BLOCK_COLUMNS * MAP_BLOCK_ROWS ||
      !isLayoutMaterial(material) || material === 'water') throw new Error('Invalid generation parameters');
  return { seed, landBlocks, material };
}

/** Connected frontier growth, entirely on the block grid; no tile jitter or overlays. */
export function generateMapBlocks(raw: MapGeneration): LayoutMaterial[] {
  const { seed, landBlocks, material } = parseMapGeneration(raw);
  let state = seed;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
  const blocks: LayoutMaterial[] = new Array(MAP_BLOCK_COLUMNS * MAP_BLOCK_ROWS).fill('water');
  const frontier = new Set<number>();
  const grow = (index: number): void => {
    blocks[index] = index === SPAWN_BLOCK_INDEX ? 'wood' : material;
    frontier.delete(index);
    const x = index % MAP_BLOCK_COLUMNS;
    const y = Math.floor(index / MAP_BLOCK_COLUMNS);
    for (const neighbor of [
      ...(x > 0 ? [index - 1] : []), ...(x < MAP_BLOCK_COLUMNS - 1 ? [index + 1] : []),
      ...(y > 0 ? [index - MAP_BLOCK_COLUMNS] : []), ...(y < MAP_BLOCK_ROWS - 1 ? [index + MAP_BLOCK_COLUMNS] : []),
    ]) if (blocks[neighbor] === 'water') frontier.add(neighbor);
  };
  grow(SPAWN_BLOCK_INDEX);
  for (let count = 1; count < landBlocks; count += 1) grow([...frontier][Math.floor(random() * frontier.size)]!);
  return blocks;
}
