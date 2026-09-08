/**
 * Regla pura de audibilidad y deltas de suscripcion para LiveKit (PRD 6.3).
 * Ver diseno D1: quien escucha a quien y que cambia entre tics son funciones
 * separadas -- un bug de membresia es un defecto de producto (te escucha
 * quien no debe), un bug de delta es un defecto de ciclo de vida (una
 * suscripcion que se queda pegada). Cero Phaser, cero `livekit-client`.
 */

import { nearbyIndices, type Point } from './proximity';

export interface AudioPeer {
  sessionId: string;
  x: number;
  y: number;
  /** Sala detectada para ESTE par, no la del jugador local. `null` = piso abierto. */
  room: string | null;
}

export interface AudibleInput {
  self: { sessionId: string | null; x: number; y: number; room: string | null };
  peers: readonly AudioPeer[];
  radius: number;
}

/**
 * Ordenado ascendente y sin duplicados: dos tics iguales dan la misma salida.
 *
 * Regla (diseno D-tabla, #321 decision 1): si `self.room` no es null, solo se
 * escucha a quien comparte esa MISMA sala -- el radio se ignora por completo
 * (un par a un pixel fuera de la sala queda en silencio). Si `self.room` es
 * null (piso abierto), solo se escucha a quien TAMBIEN esta en el piso abierto
 * y dentro del radio: un par dentro de cualquier sala nunca es audible desde
 * afuera. El aislamiento es mutuo -- protege a la sala de quien esta afuera y
 * protege a quien esta afuera de escuchar la sala; una audibilidad de un solo
 * sentido seria el bug de privacidad que este modulo existe para evitar.
 */
export function audiblePeers(input: AudibleInput): string[] {
  const { self, peers, radius } = input;
  if (self.sessionId === null) return [];

  const others = peers.filter((peer) => peer.sessionId !== self.sessionId);

  let audible: readonly AudioPeer[];
  if (self.room !== null) {
    audible = others.filter((peer) => peer.room === self.room);
  } else {
    const openFloor = others.filter((peer) => peer.room === null);
    const points: Point[] = openFloor.map((peer) => ({ x: peer.x, y: peer.y }));
    const indices = nearbyIndices({ x: self.x, y: self.y }, points, radius);
    audible = indices.map((i) => openFloor[i]);
  }

  return [...new Set(audible.map((peer) => peer.sessionId))].sort();
}

export interface SubscriptionDelta {
  subscribe: string[];
  unsubscribe: string[];
}

/**
 * `subscribe = desired \ current`, `unsubscribe = current \ desired`, ambos
 * ordenados. Conjuntos iguales dan deltas vacios (idempotente). Un par que ya
 * no existe en `desired` -- porque se desconecto o dejo de ser audible -- cae
 * en `unsubscribe` aunque ya no exista en ningun lado; sin esto una
 * suscripcion quedaria colgada indefinidamente (defecto de privacidad).
 */
export function reconcileSubscriptions(
  current: readonly string[],
  desired: readonly string[],
): SubscriptionDelta {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);

  return {
    subscribe: [...desiredSet].filter((id) => !currentSet.has(id)).sort(),
    unsubscribe: [...currentSet].filter((id) => !desiredSet.has(id)).sort(),
  };
}
