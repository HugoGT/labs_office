/**
 * Helpers puros para la reconexion de voz al cambiar de espacio (#12, diseno
 * sec.6, D7). Sin efectos ni React: `useProximityAudio.ts` los consume para
 * decidir CUANDO reconectar LiveKit y CUANTO esperar entre reintentos.
 */

/** Objetivo actual de voz: sesion Colyseus + espacio, la clave del reconnect (D7). */
export interface VoiceTarget {
  sessionId: string;
  /** `null` = piso abierto (corredor). */
  spaceId: string | null;
}

/** Lo que trae el evento `voice` del puente: `sessionId: null` pide desconectar. */
export interface VoiceTargetCandidate {
  sessionId: string | null;
  spaceId: string | null;
}

export type VoiceTransition = 'teardown' | 'forward' | 'reconnect';

/**
 * `teardown`: proximo `sessionId` nulo, se pide desconectar. `forward`:
 * mismo objetivo (sessionId, spaceId), solo se reenvian los conjuntos
 * deseados. `reconnect`: cualquier otro caso (primera conexion incluida) --
 * D7: reconectar solo cuando el PAR cambia, sin debounce de tiempo.
 */
export function decideVoiceTransition(
  current: VoiceTarget | null,
  next: VoiceTargetCandidate,
): VoiceTransition {
  if (next.sessionId === null) return 'teardown';
  if (current !== null && current.sessionId === next.sessionId && current.spaceId === next.spaceId) {
    return 'forward';
  }
  return 'reconnect';
}

/** Demoras de reintento rapido tras un 403 `forbidden-space` (diseno sec.6): el throttle de movimiento (100ms) puede ir por detras del tick (250ms). */
const FAST_RETRY_DELAYS_MS: readonly number[] = [150, 300, 600];

/** `attempt` = intentos fallidos previos (0-indexado); agotados (indice 3), `null` pide caer al corredor y arrancar el reintento lento. */
export function tokenRetryDelay(attempt: number): number | null {
  return FAST_RETRY_DELAYS_MS[attempt] ?? null;
}

/** Cada cuanto se reintenta el token del espacio una vez caido al corredor. */
export const SLOW_RETRY_MS = 5000;

/** Tope de reintentos lentos antes de rendirse y quedarse en el corredor. */
export const MAX_SLOW_RETRIES = 6;

/** First step of the rebuild of a room LiveKit lost for good (#283). */
export const REBUILD_BASE_DELAY_MS = 2000;

/** No step waits longer than this, however long LiveKit stays down. */
export const REBUILD_MAX_DELAY_MS = 30000;

/**
 * Wait before rebuilding a lost room (#283). `attempt` = rebuilds already
 * failed (0-indexed), `random` in [0, 1) (`Math.random()` in production).
 * Each step doubles up to the cap and is drawn from its upper half: a LiveKit
 * outage drops the whole office at once, and a fixed or immediate retry would
 * bring every client back in the same instant. Never gives up: the target did
 * not change, so nothing else would try again.
 */
export function rebuildDelay(attempt: number, random: number): number {
  const step = Math.min(REBUILD_MAX_DELAY_MS, REBUILD_BASE_DELAY_MS * 2 ** Math.min(attempt, 30));
  return Math.floor(step / 2 + (random * step) / 2);
}
