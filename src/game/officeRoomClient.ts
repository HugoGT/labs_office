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
import { MOVE_INTERVAL_MS, OFFICE_ROOM_NAME, type Facing } from './officeProtocol';
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
}

export interface OfficeConnection {
  sessionId: string;
  sendMove(x: number, y: number, facing: Facing): void;
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
}: ConnectOfficeRoomOptions): Promise<OfficeConnection> {
  const client = new Client(endpoint);
  const room: Room<OfficeRoomState> = await client.joinOrCreate(OFFICE_ROOM_NAME, { name });

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
    async leave() {
      throttle.dispose();
      await room.leave();
    },
  };
}
