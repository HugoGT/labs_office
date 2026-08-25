/**
 * Orientacion de un personaje y como derivarla del movimiento.
 *
 * Sin dependencias de Phaser: es logica pura y se prueba en jsdom, aunque
 * quien la consume (`textures.ts`, `characters.ts`) viva en la capa navegador.
 */

export type Facing = 'down' | 'up' | 'left' | 'right';

export const FACINGS: readonly Facing[] = ['down', 'up', 'left', 'right'];
export const DEFAULT_FACING: Facing = 'down';


/**
 * Orientacion a partir del vector de movimiento. En diagonal manda el eje
 * horizontal: cualquier criterio vale mientras sea estable, porque alternar
 * entre ejes haria parpadear el sprite mientras se anda en diagonal.
 *
 * Quieto conserva la orientacion previa; volver a `down` al soltar la tecla
 * giraria al personaje de golpe.
 */
export function facingFrom(vx: number, vy: number, previous: Facing): Facing {
  if (vx < 0) return 'left';
  if (vx > 0) return 'right';
  if (vy < 0) return 'up';
  if (vy > 0) return 'down';
  return previous;
}
