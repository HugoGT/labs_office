/**
 * Reductor puro del pan de camara (#53): `idle -> armed -> panning`, sin
 * Phaser -- lo mismo que `autoWalk.ts`, para poder probarlo con `pnpm test`
 * sin levantar un `Phaser.Game`. `CameraPanLayer` es la unica que lo llama
 * con eventos reales de puntero y aplica el efecto devuelto sobre
 * `cameras.main`.
 *
 * Regla (decision de usuario 2026-09-24, ver design.md): un left-drag sobre
 * mapa vacio se vuelve pan solo al cruzar 6px; por debajo sigue siendo un
 * click plano. `eligible` (calculado por la capa, no aqui) ya descarta
 * clics sobre un peer/escritorio/pick o con el editor de layout activo --
 * el reductor no sabe nada de eso, solo arma o no arma.
 */

/** Umbral en pixeles de pantalla que separa un click de un drag. */
export const PAN_THRESHOLD_PX = 6;

export type CameraPanState =
  | { kind: 'idle' }
  | { kind: 'armed'; originX: number; originY: number }
  | { kind: 'panning'; lastX: number; lastY: number };

export type CameraPanEvent =
  | { kind: 'down'; x: number; y: number; eligible: boolean }
  | { kind: 'move'; x: number; y: number }
  // `pointerup` en el canvas Y `pointerupoutside` (soltar fuera) terminan el
  // pan igual: ninguno de los dos trae coordenadas que el reductor necesite.
  | { kind: 'up' };

export type CameraPanEffect =
  | { kind: 'none' }
  // Delta COMPLETO desde el origen del armado, no desde el ultimo move: es
  // el primer movimiento de camara del gesto, y `armed` nunca aplico nada.
  | { kind: 'beginPan'; dx: number; dy: number }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'resumeFollow' };

const NONE: CameraPanEffect = { kind: 'none' };

export function reduceCameraPan(
  state: CameraPanState,
  event: CameraPanEvent,
): { state: CameraPanState; effect: CameraPanEffect } {
  switch (state.kind) {
    case 'idle':
      if (event.kind === 'down' && event.eligible) {
        return {
          state: { kind: 'armed', originX: event.x, originY: event.y },
          effect: NONE,
        };
      }
      return { state, effect: NONE };

    case 'armed':
      // Un segundo down (cualquier elegibilidad) no reinicia el origen: el
      // primer boton sigue siendo el que decide.
      if (event.kind === 'down') return { state, effect: NONE };

      if (event.kind === 'move') {
        const dx = event.x - state.originX;
        const dy = event.y - state.originY;
        if (Math.hypot(dx, dy) > PAN_THRESHOLD_PX) {
          return {
            state: { kind: 'panning', lastX: event.x, lastY: event.y },
            effect: { kind: 'beginPan', dx, dy },
          };
        }
        return { state, effect: NONE };
      }

      // up antes de cruzar el umbral: el click plano de siempre, sin efecto
      // de camara -- quien escucha `pointerdown` global (closemenu) ya
      // corrio en su propio momento.
      return { state: { kind: 'idle' }, effect: NONE };

    case 'panning':
      if (event.kind === 'down') return { state, effect: NONE };

      if (event.kind === 'move') {
        const dx = event.x - state.lastX;
        const dy = event.y - state.lastY;
        return {
          state: { kind: 'panning', lastX: event.x, lastY: event.y },
          effect: { kind: 'scroll', dx, dy },
        };
      }

      return { state: { kind: 'idle' }, effect: { kind: 'resumeFollow' } };
  }
}
