/**
 * Reglas de proximidad y deteccion de sala, portadas de `proximityTick`
 * (`prototype/js/app.js:444-471`). Puro: sin Phaser, sin efectos.
 */

import type { Room } from './mapData';

export interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Indices (no nombres) de los puntos estrictamente dentro del radio (`d < radius`, app.js:451). */
export function nearbyIndices(player: Point, others: readonly Point[], radius: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < others.length; i++) {
    if (distance(player, others[i]) < radius) indices.push(i);
  }
  return indices;
}

/** `((now + phase) % 4000) < 1800` (app.js:452). */
export function isSpeaking(now: number, phase: number): boolean {
  return ((now + phase) % 4000) < 1800;
}

/** Clave de dedupe para el conjunto de cercanos (app.js:456). */
export function nearbyKey(names: readonly string[]): string {
  return names.join('|');
}

/** Limites semi-abiertos: `x0 <= x < x0+w`, `y0 <= y < y0+h` (app.js:465). */
export function detectRoom(player: Point, rooms: readonly Room[]): string | null {
  for (const room of rooms) {
    const inside =
      player.x >= room.x &&
      player.x < room.x + room.w &&
      player.y >= room.y &&
      player.y < room.y + room.h;
    if (inside) return room.name;
  }
  return null;
}
