/**
 * Reglas de proximidad y deteccion de sala, portadas de `proximityTick`
 * (`prototype/js/app.js:444-471`). Puro: sin Phaser, sin efectos.
 */

import type { SpaceArea } from './mapData';

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

/**
 * Limites semi-abiertos: `x0 <= x < x0+w`, `y0 <= y < y0+h` (app.js:465).
 * Devuelve el espacio ENTERO, no solo el nombre (#7, D2): la clave de
 * pertenencia (`id`) y la etiqueta del HUD (`name`) salen de UNA sola
 * busqueda, para que nunca puedan desacordar por venir de dos lookups
 * distintos.
 */
export function detectSpace(player: Point, spaces: readonly SpaceArea[]): SpaceArea | null {
  for (const space of spaces) {
    const inside =
      player.x >= space.x &&
      player.x < space.x + space.w &&
      player.y >= space.y &&
      player.y < space.y + space.h;
    if (inside) return space;
  }
  return null;
}
