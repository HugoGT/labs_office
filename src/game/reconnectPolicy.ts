/**
 * Decide si una sesion caida se reintenta, cuando, y cuando hay que rendirse
 * (issue #52).
 *
 * Vive aparte de `officeRoomClient.ts` por la misma razon que `moveThrottle.ts`
 * y `autoWalk.ts`: la regla se puede equivocar de mil formas sutiles -- se
 * reintenta una salida voluntaria, se reintenta para siempre, la escalera se
 * pasa de la ventana del servidor -- y ninguna de esas necesita un socket para
 * probarse. Aqui entran un codigo de cierre y un contador; sale una decision.
 *
 * Puro respecto a la red y a los temporizadores: no espera, solo dice cuanto
 * hay que esperar. Quien llama es el dueno del `setTimeout`, que es tambien
 * quien puede cancelarlo al apagarse.
 */

import { SERVER_RESTART_CLOSE_CODE, SESSION_REPLACED_CLOSE_CODE, SESSION_REVOKED_CLOSE_CODE } from './officeProtocol';

/**
 * Cierre voluntario: alguien llamo a `room.leave()` o cerro la pestana.
 *
 * Se declara aqui en vez de importarse porque `colyseus.js` NO exporta
 * `CloseCode` desde su indice (solo Client, Protocol, ErrorCode, Room, Auth,
 * ServerError y los serializadores). El valor es el de
 * `node_modules/colyseus.js/lib/errors/Errors.d.ts`, y es el mismo que el
 * servidor usa para decidir `consented` en `onLeave`
 * (`Protocol.WS_CLOSE_CONSENTED`).
 */
export const CONSENTED_CLOSE_CODE = 4000;

/**
 * Reinicio en caliente del servidor de desarrollo, del mismo enumerado y por
 * la misma via. NO es una salida: es el servidor avisando de que vuelve. Se
 * nombra para dejar constancia de que se considero y se decidio reintentarlo
 * -- tratarlo como un cierre voluntario dejaria la oficina muda tras cada
 * recarga en caliente, sin que nada lo explicase.
 */
export const DEVMODE_RESTART_CLOSE_CODE = 4010;

/**
 * Escalera de espera entre reintentos, un retardo por intento. Crece para no
 * martillear un servidor que quiza esta reiniciando, y empieza corta porque el
 * caso comun -- un parpadeo de wifi o una NAT que reabre -- se recupera en el
 * primer escalon.
 *
 * Suma acumulada: 15,5 s. Tiene que caber HOLGADA dentro de
 * `RECONNECTION_WINDOW_SECONDS` (30 s, `server/src/OfficeRoom.ts`), que es el
 * tiempo que el servidor guarda el asiento y el avatar. Una escalera mas larga
 * que esa ventana gastaria sus ultimos intentos contra un asiento que el
 * servidor ya solto: el reintento tendria exito a nivel de socket y fallaria a
 * nivel de sala, que es la peor forma de fallar.
 *
 * #283: cada escalon suma ademas hasta la mitad de si mismo al azar, para que
 * los clientes caidos a la vez no vuelvan a la vez; el peor caso suma 23,25 s
 * y sigue cabiendo en la ventana.
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];

/**
 * Las unicas salidas, discriminadas para que quien llama no pueda tratar
 * "no reintentes porque se fue" igual que "no reintentes porque ya no queda":
 * la primera es normal y la segunda es la que tiene que ofrecer un boton.
 */
export type ReconnectDecision =
  | { kind: 'stop'; reason: 'consented' }
  // #78: the same account joined elsewhere and took over. Not a drop, and
  // unlike `give-up` nothing to offer a retry for.
  | { kind: 'stop'; reason: 'replaced' }
  // #93: an admin took the access away. The directory refuses the join, so a
  // retry could only fail.
  | { kind: 'stop'; reason: 'revoked' }
  | { kind: 'retry'; delayMs: number }
  // #276: the server process is going away with its rooms, so the
  // reconnection token dies with it. Only a fresh join can bring the session
  // back, and that is the scene's job (`decideRejoin` paces it).
  | { kind: 'rejoin' }
  | { kind: 'give-up' };

export interface ReconnectInput {
  /** Codigo del cierre del WebSocket, tal cual lo entrega `room.onLeave`. */
  closeCode: number;
  /** Reintentos ya fallidos; 0 es el primero, justo despues de la caida. */
  attempt: number;
  /**
   * A number in [0, 1), `Math.random()` in production (#283): a network blip
   * drops many clients at once, and a fixed ladder would bring them back in
   * the same instant.
   */
  random: number;
}

/**
 * Cualquier codigo que no sea el cierre voluntario cuenta como caida, incluido
 * el 1006 que manda un socket que se muere sin decir nada -- que es justo el de
 * la issue #52. La lista de codigos "recuperables" seria imposible de cerrar:
 * la pregunta que importa no es por que se cayo, sino si alguien lo pidio.
 */
export function decideReconnect({ closeCode, attempt, random }: ReconnectInput): ReconnectDecision {
  if (closeCode === CONSENTED_CLOSE_CODE) return { kind: 'stop', reason: 'consented' };
  if (closeCode === SESSION_REPLACED_CLOSE_CODE) return { kind: 'stop', reason: 'replaced' };
  if (closeCode === SESSION_REVOKED_CLOSE_CODE) return { kind: 'stop', reason: 'revoked' };
  if (closeCode === SERVER_RESTART_CLOSE_CODE) return { kind: 'rejoin' };

  const base = RECONNECT_DELAYS_MS[attempt];
  if (base === undefined) return { kind: 'give-up' };

  return { kind: 'retry', delayMs: base + Math.floor((random * base) / 2) };
}

/**
 * Steps between fresh joins after a server restart (#276). The first one
 * leaves the new container time to boot (migrations and terrain load run
 * before it listens); a join that still finds no server spends a step.
 */
export const REJOIN_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];

/**
 * Random extra wait added to every step. A deploy drops the whole office at
 * the same instant; without it every client would hit the new server in the
 * same millisecond, each join reading the directory and the saved position.
 */
export const REJOIN_JITTER_MS = 4000;

export type RejoinDecision = { kind: 'retry'; delayMs: number } | { kind: 'give-up' };

export interface RejoinInput {
  /** Fresh joins already failed; 0 is the first, right after the restart. */
  attempt: number;
  /** A number in [0, 1), `Math.random()` in production. */
  random: number;
}

/** When to try the next fresh join after a restart, or that it is time to stop. */
export function decideRejoin({ attempt, random }: RejoinInput): RejoinDecision {
  const base = REJOIN_DELAYS_MS[attempt];
  if (base === undefined) return { kind: 'give-up' };
  return { kind: 'retry', delayMs: base + Math.floor(random * REJOIN_JITTER_MS) };
}
