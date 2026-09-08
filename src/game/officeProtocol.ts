/**
 * Contrato compartido entre el cliente y el servidor Colyseus. Vive en `src/`
 * y no en `server/` a proposito: el cliente es quien no puede importar del
 * servidor (arrastraria `@colyseus/core` al bundle del navegador), asi que la
 * dependencia va en el unico sentido que no rompe nada.
 *
 * Sin dependencias de Phaser ni de Node: lo cargan los dos lados.
 */

export const OFFICE_ROOM_NAME = 'office';

/**
 * Nombre de la sala LiveKit (PRD 6.3). Distinta constante de
 * `OFFICE_ROOM_NAME` a proposito aunque hoy compartan valor conceptual: una
 * es el nombre de sala de Colyseus, la otra el "room" del grant de LiveKit, y
 * nada obliga a que coincidan si algun dia hay varias oficinas Colyseus
 * compartiendo una sola sala de audio, o al reves.
 */
export const LIVEKIT_ROOM_NAME = 'office-livekit';

/** Cada cuanto publica el jugador local su posicion (ver `createMoveThrottle`). */
export const MOVE_INTERVAL_MS = 100;

export type Facing = 'down' | 'up' | 'left' | 'right';

export const FACINGS: readonly Facing[] = ['down', 'up', 'left', 'right'];
export const DEFAULT_FACING: Facing = 'down';

/** Tope de nombre visible. Recortar es preferible a rechazar: no expulsa a nadie. */
export const MAX_NAME_LENGTH = 24;
export const DEFAULT_NAME = 'Invitado';

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
