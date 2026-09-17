/**
 * Envoltorio del cliente Colyseus (PRD 6.2). Traduce el estado sincronizado a
 * `RemotePlayerSnapshot`, que es lo unico que la escena necesita saber, y
 * regula la frecuencia de publicacion con `createMoveThrottle`.
 *
 * Solo importa `colyseus.js`, nunca `@colyseus/core`: el paquete de servidor
 * arrastraria Node al bundle del navegador.
 *
 * No captura los fallos de conexion. Rechaza, y quien llama decide: la oficina
 * tiene que seguir siendo jugable en solitario si el servidor no esta.
 */

import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { createMoveThrottle } from './moveThrottle';
import {
  DEFAULT_STATUS,
  MOVE_INTERVAL_MS,
  OFFICE_ROOM_NAME,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import type { RemotePlayerSnapshot } from './remoteAvatars';

/**
 * Forma del jugador tal y como llega por el cable. El cliente no declara el
 * schema: Colyseus lo refleja desde el servidor, asi que aqui solo se describe
 * lo que se lee.
 */
interface RemotePlayer {
  name: string;
  x: number;
  y: number;
  status: string;
  facing: string;
}

interface OfficeRoomState {
  players: {
    get(sessionId: string): RemotePlayer | undefined;
  };
}

/**
 * Superficie de los callbacks de estado que este modulo usa. Se declara a mano
 * porque el cliente NO define el schema -- Colyseus lo refleja del servidor en
 * tiempo de ejecucion -- y los genericos de `getStateCallbacks` esperan clases
 * `Schema` concretas que aqui no existen. Declarar solo lo que se consume, y
 * afirmarlo en un unico punto, es preferible a un `any` suelto.
 */
interface PlayersCallbacks {
  onAdd(handler: (player: RemotePlayer, sessionId: string) => void): () => void;
  onRemove(handler: (player: RemotePlayer, sessionId: string) => void): () => void;
}

interface PlayerCallbacks {
  onChange(handler: () => void): () => void;
}

export interface OfficeRoomHandlers {
  onAdd(snapshot: RemotePlayerSnapshot): void;
  onChange(snapshot: RemotePlayerSnapshot): void;
  onRemove(sessionId: string): void;
}

export interface ConnectOfficeRoomOptions {
  endpoint: string;
  name: string;
  handlers: OfficeRoomHandlers;
  moveIntervalMs?: number;
  /** Estado con el que se entra, para no aparecer "En linea" sin haberlo pedido. */
  status?: PresenceStatus;
  /**
   * ID token de la sesion (#8), pedido justo antes de entrar para que viaje
   * fresco. Ausente cuando no hay autenticacion configurada, que es el modo en
   * el que el servidor sigue abriendo la puerta a cualquiera.
   */
  getIdToken?: () => Promise<string | null>;
}

/** Lo que viaja en el `joinOrCreate`; ver `buildJoinOptions`. */
export interface OfficeJoinOptions {
  name: string;
  status: PresenceStatus;
  token?: string;
}

/**
 * Compone las opciones del join (#8). Separada y pura porque es un contrato
 * con el servidor, no un detalle: con autenticacion encendida `OfficeRoom`
 * exige `token` e IGNORA `name` (deriva el nombre del token verificado), y con
 * autenticacion apagada `name` es lo unico que tiene. Mandar siempre `name` y
 * anadir `token` solo cuando existe es lo que hace que un mismo cliente sirva
 * para los dos modos.
 *
 * Un token vacio no es un token: viajaria como un intento de autenticacion
 * fallido en vez de como la ausencia de sesion que es.
 */
export function buildJoinOptions({
  name,
  status,
  token,
}: {
  name: string;
  status: PresenceStatus;
  token?: string | null;
}): OfficeJoinOptions {
  if (!token) return { name, status };
  return { name, status, token };
}

export interface OfficeConnection {
  sessionId: string;
  sendMove(x: number, y: number, facing: Facing): void;
  sendStatus(status: PresenceStatus): void;
  leave(): Promise<void>;
}

function toSnapshot(sessionId: string, player: RemotePlayer): RemotePlayerSnapshot {
  return {
    sessionId,
    name: player.name,
    x: player.x,
    y: player.y,
    status: player.status,
    facing: player.facing,
  };
}

export async function connectOfficeRoom({
  endpoint,
  name,
  handlers,
  moveIntervalMs = MOVE_INTERVAL_MS,
  status = DEFAULT_STATUS,
  getIdToken,
}: ConnectOfficeRoomOptions): Promise<OfficeConnection> {
  const client = new Client(endpoint);
  // El token se pide aqui y no antes: entre elegir estado y llegar a este
  // punto puede haber pasado tiempo, y el que importa es el del momento del
  // join. Un fallo al pedirlo no se traga: la escena ya degrada a solitario
  // cuando este `connect` rechaza.
  const token = getIdToken ? await getIdToken() : null;
  const room: Room<OfficeRoomState> = await client.joinOrCreate(
    OFFICE_ROOM_NAME,
    buildJoinOptions({ name, status, token }),
  );

  const $ = getStateCallbacks(room) as unknown as {
    (target: OfficeRoomState): { players: PlayersCallbacks };
    (target: RemotePlayer): PlayerCallbacks;
  };

  $(room.state).players.onAdd((player, sessionId) => {
    handlers.onAdd(toSnapshot(sessionId, player));
    // La suscripcion por jugador se registra dentro del alta: `onChange` a
    // nivel de mapa solo avisa de altas y bajas, no de campos que mutan.
    $(player).onChange(() => handlers.onChange(toSnapshot(sessionId, player)));
  });

  $(room.state).players.onRemove((_player, sessionId) => {
    handlers.onRemove(sessionId);
  });

  const throttle = createMoveThrottle({
    intervalMs: moveIntervalMs,
    send: (move) => room.send('move', move),
  });

  return {
    sessionId: room.sessionId,
    sendMove(x, y, facing) {
      throttle.push({ x, y, facing });
    },
    // Sin agrupar, al contrario que `sendMove`: cambiar de estado es un gesto
    // humano y raro, y agrupar podria tragarse justo el que aisla a alguien.
    sendStatus(next) {
      room.send('status', { status: next });
    },
    async leave() {
      throttle.dispose();
      await room.leave();
    },
  };
}
