/**
 * Reductor puro de auto-caminata (issue #2, D9/D10): steering por velocidad,
 * sin Phaser. `OfficeScene.update()` llama a `stepAutoWalk` cada cuadro,
 * despues de leer el teclado y antes de `body.setVelocity` -- todo lo que
 * viene despues de la fisica (facing, throttle de red, minimapa, audio de
 * proximidad) sigue leyendo `this.player.x/y` sin enterarse de este modulo.
 *
 * El estado de estancamiento vive DENTRO de `AutoWalkState`, no en una
 * variable de instancia: es lo que mantiene la funcion pura y comprobable
 * con `pnpm test`, sin levantar Phaser.
 */

export interface AutoWalkState {
  goal: { x: number; y: number };
  /** Menor distancia alcanzada hasta ahora al objetivo (para detectar bloqueo). */
  bestDistance: number;
  /** Milisegundos continuos sin mejorar `bestDistance` en al menos STALL_PROGRESS_PX. */
  stalledMs: number;
}

export type AutoWalkStep =
  | { kind: 'walking'; vx: number; vy: number; state: AutoWalkState }
  | { kind: 'arrived' }
  // D10: sin canal de mensaje/toast -- un bloqueo silencioso es una decision
  // de producto (el toast "no pude llegar" seria ruido si la tarjeta ya se fue).
  | { kind: 'cancelled'; reason: 'input' | 'blocked' };

/** Distancia para considerar "llegado" y detener el steering (D10). */
export const ARRIVE_EPSILON_PX = 2;
/** Mejora minima de distancia para no contar como estancamiento (D10). */
export const STALL_PROGRESS_PX = 1;
/** Tiempo continuo sin progreso antes de cancelar por bloqueo (D10). */
export const STALL_TIMEOUT_MS = 600;

function distanceTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function beginAutoWalk(
  goal: { x: number; y: number },
  from: { x: number; y: number },
): AutoWalkState {
  return { goal, bestDistance: distanceTo(from, goal), stalledMs: 0 };
}

export function stepAutoWalk(input: {
  state: AutoWalkState;
  position: { x: number; y: number };
  /** Par -1|0|1 ya calculado por update(); cualquier valor no nulo cancela. */
  keyboard: { vx: number; vy: number };
  deltaMs: number;
  speed: number;
}): AutoWalkStep {
  const { state, position, keyboard, deltaMs, speed } = input;
  const distance = distanceTo(position, state.goal);

  if (distance <= ARRIVE_EPSILON_PX) return { kind: 'arrived' };

  // D10: cualquier tecla de movimiento en el mismo cuadro cancela -- ese
  // cuadro ya se mueve bajo la velocidad del teclado, no hace falta un
  // listener aparte, la lectura que ya hace update() ES la cancelacion.
  if (keyboard.vx !== 0 || keyboard.vy !== 0) return { kind: 'cancelled', reason: 'input' };

  const improved = state.bestDistance - distance >= STALL_PROGRESS_PX;
  const bestDistance = improved ? distance : state.bestDistance;
  const stalledMs = improved ? 0 : state.stalledMs + Math.max(0, deltaMs);

  if (stalledMs >= STALL_TIMEOUT_MS) return { kind: 'cancelled', reason: 'blocked' };

  // Sin overshoot: la velocidad de este cuadro nunca cubre mas que la
  // distancia restante. `deltaMs <= 0` (primer cuadro, o un frame de 0ms)
  // usa la velocidad nominal completa, sin dividir por cero.
  const frameSpeed = deltaMs > 0 ? Math.min(speed, distance / (deltaMs / 1000)) : speed;
  const vx = ((state.goal.x - position.x) / distance) * frameSpeed;
  const vy = ((state.goal.y - position.y) / distance) * frameSpeed;

  return { kind: 'walking', vx, vy, state: { goal: state.goal, bestDistance, stalledMs } };
}
