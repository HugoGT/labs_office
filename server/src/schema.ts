/**
 * Estado sincronizado de la oficina (PRD 6.2). Es la unica fuente de verdad
 * de donde esta cada avatar real; los NPCs simulados del cliente NO viven
 * aqui, son decorado local.
 *
 * Los campos se declaran con `interface` fusionada con la clase en vez de con
 * campos de clase. No es estilo: `@colyseus/schema` instala accesores en el
 * prototipo, y un campo de clase real (que es lo que emiten tanto
 * `useDefineForClassFields` como el borrado de tipos de Node) crearia una
 * propiedad propia que los tapa y rompe la serializacion en silencio. Una
 * interfaz no emite nada, asi que los accesores sobreviven.
 */

import { MapSchema, Schema, defineTypes } from '@colyseus/schema';

export interface PlayerSeed {
  name: string;
  x: number;
  y: number;
  status: string;
  facing: string;
  /** Version de config de espacios con la que este jugador deriva su sala (#7, D4). */
  spacesVersion: string;
  /**
   * Character the account chose, an art pack id (art migration, step 5).
   * Always the persisted one: `OfficeRoom` never takes it from the client.
   */
  avatarId: string;
  /**
   * Seat the player is sitting on (art migration, step 6): a `seating.ts`
   * reference, or '' standing. Only `OfficeRoom` writes it, after checking
   * the seat; having a desk assigned does not set it.
   */
  seat: string;
}

export interface PlayerState extends PlayerSeed {}

export class PlayerState extends Schema {}

defineTypes(PlayerState, {
  name: 'string',
  x: 'number',
  y: 'number',
  status: 'string',
  facing: 'string',
  spacesVersion: 'string',
  avatarId: 'string',
  seat: 'string',
});

/**
 * Alta de un jugador. Es una factoria y no un constructor con parametros a
 * proposito: `defineTypes` exige que la clase siga siendo instanciable sin
 * argumentos, porque Colyseus la construye el mismo al decodificar.
 */
export function createPlayerState(seed: PlayerSeed): PlayerState {
  const player = new PlayerState();
  player.name = seed.name;
  player.x = seed.x;
  player.y = seed.y;
  player.status = seed.status;
  player.facing = seed.facing;
  player.spacesVersion = seed.spacesVersion;
  player.avatarId = seed.avatarId;
  player.seat = seed.seat;
  return player;
}

/**
 * Active recording of a space (#5), keyed by spaceId in `OfficeState.recordings`.
 * A mirror of `RecordingRegistry` for clients: the egress id stays on the
 * server, nobody else has a use for it.
 */
export interface RecordingState {
  startedBy: string;
  startedAt: number;
}

export class RecordingState extends Schema {}

defineTypes(RecordingState, { startedBy: 'string', startedAt: 'number' });

export function createRecordingState(seed: { startedBy: string; startedAt: number }): RecordingState {
  const recording = new RecordingState();
  recording.startedBy = seed.startedBy;
  recording.startedAt = seed.startedAt;
  return recording;
}

export interface OfficeState {
  players: MapSchema<PlayerState>;
  recordings: MapSchema<RecordingState>;
  /**
   * The live terrain blocks (#123 phase 2), in the wire form of
   * `encodeTerrainBlocks`. The whole list, a few hundred bytes, so a joiner
   * or a reconnected client gets the current terrain with the first sync.
   */
  terrainBlocks: string;
}

export class OfficeState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.recordings = new MapSchema<RecordingState>();
    this.terrainBlocks = '';
  }
}

defineTypes(OfficeState, { players: { map: PlayerState }, recordings: { map: RecordingState }, terrainBlocks: 'string' });
