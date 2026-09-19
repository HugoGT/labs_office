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
  return player;
}

export interface OfficeState {
  players: MapSchema<PlayerState>;
}

export class OfficeState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
  }
}

defineTypes(OfficeState, { players: { map: PlayerState } });
