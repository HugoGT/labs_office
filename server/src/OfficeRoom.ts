/**
 * Sala Colyseus de la oficina (PRD 6.2): sincroniza por WebSocket la posicion
 * de los avatares REALES. Los NPCs simulados del cliente no pasan por aqui.
 *
 * Regla que gobierna todo el fichero: el cliente no es de fiar. Cada mensaje
 * `move` se valida y se recorta contra los limites del mundo antes de tocar el
 * estado, porque cualquiera puede abrir una consola y mandar
 * `{ x: 1e9, y: -1 }`. Lo mismo con el nombre y con los enumerados.
 */

import { Room, type Client } from '@colyseus/core';
import {
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  TILE,
  WORLD_H,
  WORLD_W,
} from '../../src/game/mapData.ts';
import {
  DEFAULT_FACING,
  DEFAULT_NAME,
  FACINGS,
  MAX_NAME_LENGTH,
  OFFICE_ROOM_NAME,
} from '../../src/game/officeProtocol.ts';
import type { LiveSessionRegistry } from './liveSessions.ts';
import { OfficeState, createPlayerState } from './schema.ts';

export { DEFAULT_NAME, MAX_NAME_LENGTH, OFFICE_ROOM_NAME };

const FACING_SET = new Set<string>(FACINGS);
const STATUSES = new Set(['g', 'y', 'r']);
const DEFAULT_STATUS = 'g';

/**
 * Reparte a los que entran alrededor de la tile de spawn en vez de apilarlos
 * todos en el mismo pixel, que haria ilegible una entrada de varias personas.
 */
const SPAWN_RING: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

export interface MoveMessage {
  x: number;
  y: number;
  facing: string;
}

/** Recorta un numero al rango, descartando NaN/Infinity del cliente. */
export function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_NAME;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

export function sanitizeFacing(raw: unknown): string {
  return typeof raw === 'string' && FACING_SET.has(raw) ? raw : DEFAULT_FACING;
}

export function sanitizeStatus(raw: unknown): string {
  return typeof raw === 'string' && STATUSES.has(raw) ? raw : DEFAULT_STATUS;
}

export interface OfficeRoomOptions {
  /**
   * Registro de sesiones vivas para LiveKit (D4), inyectado por
   * `createOfficeServer.ts` via `gameServer.define(name, Room, { sessions })`.
   * `OfficeRoom` no crea su propio registro: si lo hiciera como singleton de
   * modulo, los tests quedarian acoplados al orden de ejecucion.
   */
  sessions?: LiveSessionRegistry;
}

export class OfficeRoom extends Room<OfficeState> {
  private joinCount = 0;
  private sessions?: LiveSessionRegistry;

  onCreate(options?: OfficeRoomOptions): void {
    this.state = new OfficeState();
    this.sessions = options?.sessions;

    this.onMessage('move', (client: Client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const x = clamp(message?.x, 0, WORLD_W);
      const y = clamp(message?.y, 0, WORLD_H);
      // Un `move` invalido se ignora entero: aplicar solo el eje valido dejaria
      // al avatar en una posicion que el cliente nunca pidio.
      if (x === null || y === null) return;

      player.x = x;
      player.y = y;
      player.facing = sanitizeFacing(message?.facing);
    });
  }

  onJoin(client: Client, options?: { name?: unknown; status?: unknown }): void {
    const [dx, dy] = SPAWN_RING[this.joinCount % SPAWN_RING.length];
    this.joinCount++;

    this.state.players.set(
      client.sessionId,
      createPlayerState({
        name: sanitizeName(options?.name),
        x: (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2,
        y: (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2,
        status: sanitizeStatus(options?.status),
        facing: DEFAULT_FACING,
      }),
    );

    this.sessions?.add(client.sessionId);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.sessions?.remove(client.sessionId);
  }
}
