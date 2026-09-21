/**
 * Fabrica de personajes: el jugador local y el molde compartido que reusa el
 * sink de avatares remotos, portados de `makeCharacter` y `spawnPlayer`
 * (`prototype/js/app.js:325-390`). Depende de Phaser (`scene.add.container`,
 * `scene.physics`): se prueba en la capa navegador.
 *
 * El roster de NPCs simulados se retiro por completo: la oficina solo pinta
 * personas reales (el jugador local y los peers que llegan por Colyseus). Con
 * el se fueron `spawnNpcs`, `walkNpcTo` y `NpcContainer`, que no tenian otro
 * consumidor.
 */

import type Phaser from 'phaser';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE, WORLD_H, WORLD_W } from './mapData';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import { STATUS_COLOR } from './presence';
import { avatarTextureKey } from './textures';

const LABEL_STYLE = {
  fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
  fontSize: '11px',
  fontStyle: '600',
  color: '#f3f4f6',
} as const;

/** Contenedor de personaje con el anillo de habla y su nombre (app.js:341-346). */
export interface CharacterContainer extends Phaser.GameObjects.Container {
  ring: Phaser.GameObjects.Ellipse;
  nameText: string;
  /** Sprite del cuerpo, expuesto para poder cambiarle la orientacion. */
  sprite: Phaser.GameObjects.Sprite;
  /** Clave base (`av3`), sin el sufijo de orientacion. */
  baseTexture: string;
  facing: Facing;
  /** Punto de estado de la pildora de nombre, expuesto para poder repintarlo. */
  statusDot: Phaser.GameObjects.Arc;
  /**
   * Estado de presencia actual. Vive en el contenedor y no solo en el color
   * del punto porque `proximityTick` lo lee para decidir el audio: deducirlo
   * del pixel pintado invertiria la direccion del dato.
   */
  status: PresenceStatus;
}

const PLAYER_TEXTURE = 'avP';

/** Construye un personaje: anillo de habla + sprite + pildora de nombre (app.js:325-347). */
export function makeCharacter(
  scene: Phaser.Scene,
  name: string,
  tx: number,
  ty: number,
  texKey: string,
  status: PresenceStatus,
): CharacterContainer {
  const px = tx * TILE + 16;
  const py = ty * TILE + 16;

  const ring = scene.add.ellipse(0, 18, 34, 14).setStrokeStyle(2.5, 0x22c55e).setVisible(false);
  const spr = scene.add.sprite(0, 0, avatarTextureKey(texKey, DEFAULT_FACING)).setScale(2);

  const label = scene.add.text(0, 0, name, LABEL_STYLE).setOrigin(0, 0.5);
  const pillW = label.width + 24;
  const pill = scene.add.graphics();
  pill.fillStyle(0x111827, 0.85);
  pill.fillRoundedRect(-pillW / 2, -34 - 9, pillW, 18, 9);
  // Toma el estado y no un color ya resuelto: con dos parametros el punto
  // pintado y el estado que guarda el contenedor podrian discrepar.
  const dot = scene.add.circle(-pillW / 2 + 11, -34, 3.5, STATUS_COLOR[status]);
  label.setPosition(-pillW / 2 + 19, -34);

  const container = scene.add.container(px, py, [
    ring,
    spr,
    pill,
    dot,
    label,
  ]) as CharacterContainer;
  container.setDepth(py);
  container.setSize(32, 44);
  container.ring = ring;
  container.nameText = name;
  container.sprite = spr;
  container.baseTexture = texKey;
  container.facing = DEFAULT_FACING;
  container.statusDot = dot;
  container.status = status;
  return container;
}

/**
 * Cambia la orientacion visible de un personaje. Sale pronto si no cambia
 * nada: se llama en cada frame para el jugador local y en cada mensaje para
 * los remotos, y reasignar la misma textura 60 veces por segundo es trabajo
 * tirado.
 */
export function setCharacterFacing(character: CharacterContainer, facing: Facing): void {
  if (character.facing === facing) return;
  character.facing = facing;
  character.sprite.setTexture(avatarTextureKey(character.baseTexture, facing));
}

/**
 * Cambia el estado de presencia visible. Sale pronto si no cambia nada, por la
 * misma razon que `setCharacterFacing`: se llama en cada mensaje de un avatar
 * remoto, y casi ninguno trae un estado distinto del anterior.
 */
export function setCharacterStatus(character: CharacterContainer, status: PresenceStatus): void {
  if (character.status === status) return;
  character.status = status;
  character.statusDot.setFillStyle(STATUS_COLOR[status]);
}

/**
 * Crea al jugador con cuerpo fisico y limites de mundo (app.js:384-390).
 *
 * El nombre entra por parametro y no vive aqui (#6): quien lo conoce es la
 * sesion verificada, varias capas mas arriba. Cableado, la pildora del avatar
 * local mostraba el nombre de una persona concreta a todo el que entrase.
 */
export function spawnPlayer(scene: Phaser.Scene, name: string): CharacterContainer {
  const player = makeCharacter(
    scene,
    name,
    PLAYER_SPAWN_TX,
    PLAYER_SPAWN_TY,
    PLAYER_TEXTURE,
    DEFAULT_STATUS,
  );
  scene.physics.add.existing(player);
  const body = player.body as Phaser.Physics.Arcade.Body;
  body.setSize(22, 14).setOffset(-11, 6);
  body.setCollideWorldBounds(true);
  scene.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
  return player;
}
