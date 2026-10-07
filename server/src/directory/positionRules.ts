import { WORLD_H, WORLD_W } from '../../../src/game/mapData.ts';
import type { LastPosition } from './directoryPort.ts';

/** Storage bounds only: current terrain and piece collisions belong to the room. */
export function isPositionInMap(position: LastPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
    && position.x >= 0 && position.x < WORLD_W && position.y >= 0 && position.y < WORLD_H;
}

export function assertLastPosition(position: LastPosition): void {
  if (!isPositionInMap(position)) throw new Error('Invalid last position');
}
