/**
 * Regla pura de audibilidad y deltas de suscripcion para LiveKit (PRD 6.3).
 * Ver diseno D1: quien escucha a quien y que cambia entre tics son funciones
 * separadas -- un bug de membresia es un defecto de producto (te escucha
 * quien no debe), un bug de delta es un defecto de ciclo de vida (una
 * suscripcion que se queda pegada). Cero Phaser, cero `livekit-client`.
 */

import { DO_NOT_DISTURB, type PresenceStatus } from './officeProtocol';
import { nearbyIndices, type Point } from './proximity';

export interface AudioPeer {
  sessionId: string;
  x: number;
  y: number;
  /** Espacio detectado para ESTE par, no el del jugador local. `null` = piso abierto (#7, D2). */
  spaceId: string | null;
  /** Version de config con la que ESTE par deriva su propia sala (#7, D4). */
  spacesVersion: string;
  status: PresenceStatus;
}

export interface AudibleInput {
  self: {
    sessionId: string | null;
    x: number;
    y: number;
    spaceId: string | null;
    spacesVersion: string;
    status: PresenceStatus;
  };
  peers: readonly AudioPeer[];
  radius: number;
}

/**
 * Ordenado ascendente y sin duplicados: dos tics iguales dan la misma salida.
 *
 * Regla (diseno D-tabla, #321 decision 1): si `self.spaceId` no es null, solo
 * se escucha a quien comparte ESE MISMO espacio -- el radio se ignora por
 * completo (un par a un pixel fuera del espacio queda en silencio). Si
 * `self.spaceId` es null (piso abierto), solo se escucha a quien TAMBIEN esta
 * en el piso abierto y dentro del radio: un par dentro de cualquier espacio
 * nunca es audible desde afuera. El aislamiento es mutuo -- protege al espacio
 * de quien esta afuera y protege a quien esta afuera de escuchar el espacio;
 * una audibilidad de un solo sentido seria el bug de privacidad que este
 * modulo existe para evitar.
 *
 * "No molestar" (#1) aisla con la misma regla y por la misma razon: ni oye a
 * la oficina ni la oficina lo oye. Se decide aqui, y no en la escena ni en el
 * hook de LiveKit, para que los chips de cercania y las suscripciones queden
 * de acuerdo por construccion -- la escena deriva ambos de esta salida.
 * "Ocupado" no aparece en esta funcion a proposito: es senal social y no
 * promete nada sobre el audio.
 *
 * Predicado mutuo de `spacesVersion` (#7, D4): va en el filtro `others`,
 * ANTES de las dos ramas de arriba. LiveKit es unilateral y direccional
 * (`publication.setSubscribed(true)` lo llama quien escucha sobre la
 * publicacion de quien es escuchado, que no puede negarse), asi que una
 * regla evaluada solo desde la copia de config propia no basta: un lado
 * puede tener razon mientras el otro esta desactualizado, y eso produce
 * audibilidad de un solo sentido. Configs distintas = dos opiniones
 * distintas sobre quien esta donde. Simetrico por construccion: ambos lados
 * evaluan la MISMA comparacion, asi que ninguno puede oir a quien no le oye.
 * Va antes de AMBAS ramas a proposito: gatear solo la regla de sala dejaria
 * expuesta la rama de piso abierto, y esa es justamente la rama por la que
 * un espacio borrado filtra a su antiguo ocupante. NO sobrevive ninguna
 * version de la guarda `spacesStale` que proponia r2 -- este predicado la
 * reemplaza por completo (ver diseno D4): mantenerla enmascararia la
 * propiedad de disponibilidad que este diseno promete (dos versiones viejas
 * pero IGUALES deben seguir siendo mutuamente audibles).
 */
export function audiblePeers(input: AudibleInput): string[] {
  const { self, peers, radius } = input;
  if (self.sessionId === null) return [];
  if (self.status === DO_NOT_DISTURB) return [];

  const others = peers.filter(
    (peer) =>
      peer.sessionId !== self.sessionId &&
      peer.status !== DO_NOT_DISTURB &&
      peer.spacesVersion === self.spacesVersion,
  );

  let audible: readonly AudioPeer[];
  if (self.spaceId !== null) {
    audible = others.filter((peer) => peer.spaceId === self.spaceId);
  } else {
    const openFloor = others.filter((peer) => peer.spaceId === null);
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
