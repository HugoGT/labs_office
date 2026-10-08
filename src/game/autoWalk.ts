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
  /** Final destination, the one callers and arrival always refer to. */
  goal: { x: number; y: number };
  /**
   * Stops to pass on the way to `goal`, in order (pathfinding, #2). The key is
   * omitted when there are none, so a straight walk keeps its original shape.
   */
  waypoints?: readonly { x: number; y: number }[];
  /** Menor distancia alcanzada hasta ahora al objetivo actual (para detectar bloqueo). */
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

type Point = { x: number; y: number };

/** Builds a state with `waypoints` set, or without the key when none remain. */
function buildState(
  goal: Point,
  waypoints: readonly Point[],
  bestDistance: number,
  stalledMs: number,
): AutoWalkState {
  return waypoints.length > 0
    ? { goal, waypoints, bestDistance, stalledMs }
    : { goal, bestDistance, stalledMs };
}

export function beginAutoWalk(
  goal: Point,
  from: Point,
  waypoints: readonly Point[] = [],
): AutoWalkState {
  const target = waypoints[0] ?? goal;
  return buildState(goal, waypoints, distanceTo(from, target), 0);
}

/**
 * Arrival is judged on the final goal only: a walk with stops left is never
 * done, so passing (or standing next to) one of them cannot end it early.
 */
export function isAutoWalkArrived(state: AutoWalkState, position: Point): boolean {
  return (state.waypoints?.length ?? 0) === 0 && distanceTo(position, state.goal) <= ARRIVE_EPSILON_PX;
}

export function stepAutoWalk(input: {
  state: AutoWalkState;
  position: { x: number; y: number };
  /** Par -1|0|1 ya calculado por update(); cualquier valor no nulo cancela. */
  keyboard: { vx: number; vy: number };
  deltaMs: number;
  speed: number;
}): AutoWalkStep {
  const { position, keyboard, deltaMs, speed } = input;
  let state = input.state;

  // Pass every stop already within reach, restarting the stall measure from the
  // next target: the stall is judged per target, not along the whole route (#2).
  const pending = state.waypoints ?? [];
  let passed = 0;
  while (passed < pending.length && distanceTo(position, pending[passed]) <= ARRIVE_EPSILON_PX) passed++;
  if (passed > 0) {
    const remaining = pending.slice(passed);
    state = buildState(state.goal, remaining, distanceTo(position, remaining[0] ?? state.goal), 0);
  }

  if (isAutoWalkArrived(state, position)) return { kind: 'arrived' };

  // D10: cualquier tecla de movimiento en el mismo cuadro cancela -- ese
  // cuadro ya se mueve bajo la velocidad del teclado, no hace falta un
  // listener aparte, la lectura que ya hace update() ES la cancelacion.
  if (keyboard.vx !== 0 || keyboard.vy !== 0) return { kind: 'cancelled', reason: 'input' };

  const target = state.waypoints?.[0] ?? state.goal;
  const distance = distanceTo(position, target);
  const improved = state.bestDistance - distance >= STALL_PROGRESS_PX;
  const bestDistance = improved ? distance : state.bestDistance;
  const stalledMs = improved ? 0 : state.stalledMs + Math.max(0, deltaMs);

  if (stalledMs >= STALL_TIMEOUT_MS) return { kind: 'cancelled', reason: 'blocked' };

  // Sin overshoot: la velocidad de este cuadro nunca cubre mas que la
  // distancia restante al objetivo actual (un waypoint tambien se pisa sin
  // pasarse, o cortaria la esquina). `deltaMs <= 0` (primer cuadro, o un
  // frame de 0ms) usa la velocidad nominal completa, sin dividir por cero.
  const frameSpeed = deltaMs > 0 ? Math.min(speed, distance / (deltaMs / 1000)) : speed;
  const vx = ((target.x - position.x) / distance) * frameSpeed;
  const vy = ((target.y - position.y) / distance) * frameSpeed;

  return { kind: 'walking', vx, vy, state: buildState(state.goal, state.waypoints ?? [], bestDistance, stalledMs) };
}
