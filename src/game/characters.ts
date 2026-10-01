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
 *
 * Art migration, step 6: once a character's sheets are loaded the body is
 * drawn from them (`setCharacterSheets`), walking in eight directions or
 * seated, frame by frame from `characterAnimation.ts`. The procedural texture
 * stays as the fallback while the sheets load or if they fail. Either way the
 * container position is the network position and the Arcade body keeps its
 * old geometry: only the sprite moves around it (`avatarGeometry.ts`).
 */

import type Phaser from 'phaser';
import { CHAIR, CHARACTER_SEATED, CHARACTER_WALK, type ArtFacing } from './artContract';
import {
  AVATAR_BODY_OFFSET,
  AVATAR_BODY_SIZE,
  AVATAR_CONTAINER_SIZE,
  AVATAR_FEET_OFFSET_Y,
  characterHitArea,
  feetOf,
  seatedSpriteBox,
  walkSpriteBox,
  type GeometryBox,
} from './avatarGeometry';
import {
  animationFrame,
  initialAnimation,
  stepAnimation,
  type CharacterAnimation,
} from './characterAnimation';
import { avatarDepth, seatedAvatarDepth } from './depthLayers';
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

/** Texture keys of a character's two sheets (`ArtTextures.sheet(id, 'walk' | 'seated')`). */
export interface CharacterSheets {
  readonly walk: string;
  readonly seated: string;
}

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
  /** Pack sheets of the character, or `null` to draw the procedural fallback. */
  sheets: CharacterSheets | null;
  /** Which walk or seated frame is due; never sent over the network. */
  animation: CharacterAnimation;
  /**
   * Facing of the seat the server has this avatar on, `null` standing. Set
   * from the replicated seat only, so a refused sit never shows.
   */
  seatFacing: ArtFacing | null;
  /** A facing the avatar turned to without moving, for the next frame. */
  turnTo?: Facing;
  /** Hit area object Phaser tests clicks against; reshaped with the sprite. */
  hitArea?: { x: number; y: number; width: number; height: number };
}

const PLAYER_TEXTURE = 'avP';

/** Every chair puts its seat this far from its ground point (`CHAIR`). */
const SEAT_ABOVE_GROUND = { x: CHAIR.anchor.x - CHAIR.ground.x, y: CHAIR.anchor.y - CHAIR.ground.y };
const WALK_BOX = walkSpriteBox(CHARACTER_WALK);
const SEATED_BOX = seatedSpriteBox(CHARACTER_SEATED, SEAT_ABOVE_GROUND);
/** The procedural texture is 16x22, drawn twice as large around the position. */
const PROCEDURAL_SCALE = 2;
const PROCEDURAL_BOX: GeometryBox = { x: -16, y: -22, width: 32, height: 44 };

const PILL_HEIGHT = 18;
/** The name pill sits just above the tallest pose, standing or seated. */
const LABEL_Y = Math.min(WALK_BOX.y, SEATED_BOX.y, PROCEDURAL_BOX.y) - PILL_HEIGHT / 2;

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

  // The ring marks the feet, whatever draws the body.
  const ring = scene.add.ellipse(0, AVATAR_FEET_OFFSET_Y, 34, 14).setStrokeStyle(2.5, 0x22c55e).setVisible(false);
  const spr = scene.add.sprite(0, 0, avatarTextureKey(texKey, DEFAULT_FACING)).setScale(PROCEDURAL_SCALE);

  const label = scene.add.text(0, 0, name, LABEL_STYLE).setOrigin(0, 0.5);
  const pillW = label.width + 24;
  const pill = scene.add.graphics();
  pill.fillStyle(0x111827, 0.85);
  pill.fillRoundedRect(-pillW / 2, LABEL_Y - PILL_HEIGHT / 2, pillW, PILL_HEIGHT, PILL_HEIGHT / 2);
  // Toma el estado y no un color ya resuelto: con dos parametros el punto
  // pintado y el estado que guarda el contenedor podrian discrepar.
  const dot = scene.add.circle(-pillW / 2 + 11, LABEL_Y, 3.5, STATUS_COLOR[status]);
  label.setPosition(-pillW / 2 + 19, LABEL_Y);

  const container = scene.add.container(px, py, [
    ring,
    spr,
    pill,
    dot,
    label,
  ]) as CharacterContainer;
  // Avatar band (#70): above every normal asset, y-sorted among avatars. The
  // ring, pill, dot and label are children, so they ride this depth.
  container.setDepth(avatarDepth(feetOf(container).y));
  // Not the sprite size: Arcade and input offset by half of it, so it keeps
  // the historic value (see `avatarGeometry.ts`).
  container.setSize(AVATAR_CONTAINER_SIZE.width, AVATAR_CONTAINER_SIZE.height);
  container.ring = ring;
  container.nameText = name;
  container.sprite = spr;
  container.baseTexture = texKey;
  container.facing = DEFAULT_FACING;
  container.statusDot = dot;
  container.status = status;
  container.sheets = null;
  container.animation = initialAnimation('S');
  container.seatFacing = null;
  return container;
}

/**
 * Cambia la orientacion visible de un personaje. Sale pronto si no cambia
 * nada: se llama en cada frame para el jugador local y en cada mensaje para
 * los remotos, y reasignar la misma textura 60 veces por segundo es trabajo
 * tirado.
 *
 * With pack sheets the walk direction comes from movement; a facing change
 * still turns an avatar that stands still (a peer turning in place).
 */
export function setCharacterFacing(character: CharacterContainer, facing: Facing): void {
  if (character.facing === facing) return;
  character.facing = facing;
  character.turnTo = facing;
  if (character.sheets === null) character.sprite.setTexture(avatarTextureKey(character.baseTexture, facing));
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
 * Draws the character from its pack sheets, or back from the procedural
 * texture with `null` (a character whose sheets failed, or that changed).
 */
export function setCharacterSheets(character: CharacterContainer, sheets: CharacterSheets | null): void {
  if (character.sheets?.walk === sheets?.walk && character.sheets?.seated === sheets?.seated) return;
  character.sheets = sheets;
  renderCharacter(character);
}

/**
 * One frame of animation: how far the avatar moved since the last one (its
 * velocity for the local player, its interpolated position for a peer) and
 * how long that took. Also re-sorts it: standing in the avatar band by its
 * feet, seated in the world band on its chair (`depthLayers.ts`).
 */
export function animateCharacter(
  character: CharacterContainer,
  motion: { dx: number; dy: number; dtMs: number },
): void {
  character.animation = stepAnimation(character.animation, {
    ...motion,
    seatFacing: character.seatFacing,
    turnTo: character.turnTo,
  });
  character.turnTo = undefined;
  renderCharacter(character);
  const feetY = feetOf(character).y;
  character.setDepth(character.animation.seat === null ? avatarDepth(feetY) : seatedAvatarDepth(feetY));
}

/** Copies the due frame into the sprite, and the hit area to the drawn box. */
function renderCharacter(character: CharacterContainer): void {
  const { sprite, sheets } = character;
  let box: GeometryBox;
  if (sheets === null) {
    box = PROCEDURAL_BOX;
    const key = avatarTextureKey(character.baseTexture, character.facing);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    sprite.setOrigin(0.5).setScale(PROCEDURAL_SCALE).setPosition(0, 0);
  } else {
    const { sheet, frame } = animationFrame(character.animation);
    box = sheet === 'walk' ? WALK_BOX : SEATED_BOX;
    const key = sheet === 'walk' ? sheets.walk : sheets.seated;
    if (sprite.texture.key !== key || sprite.frame.name !== String(frame)) sprite.setTexture(key, frame);
    sprite.setOrigin(0).setScale(1).setPosition(box.x, box.y);
  }
  if (character.hitArea !== undefined) Object.assign(character.hitArea, characterHitArea(box));
}

/** Makes the drawn body clickable (peers, issue #2); the area follows the sprite. */
export function enableCharacterClicks(character: CharacterContainer): void {
  const area = { ...characterHitArea(PROCEDURAL_BOX) };
  character.hitArea = area;
  // The config form: a plain object as the first argument would be read as
  // a config itself and replaced by a container-sized rectangle.
  character.setInteractive({
    hitArea: area,
    hitAreaCallback: (shape: typeof area, x: number, y: number) =>
      x >= shape.x && x < shape.x + shape.width && y >= shape.y && y < shape.y + shape.height,
  });
  renderCharacter(character);
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
  body.setSize(AVATAR_BODY_SIZE.width, AVATAR_BODY_SIZE.height).setOffset(AVATAR_BODY_OFFSET.x, AVATAR_BODY_OFFSET.y);
  body.setCollideWorldBounds(true);
  scene.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
  return player;
}

/**
 * Da a un avatar remoto un cuerpo Arcade inmovible (#59): el jugador no
 * puede atravesarlo, pero el peer nunca se desplaza por la separacion --
 * `moves=false` deja el tween de `remoteAvatarSink` como unica fuente de
 * verdad de su posicion (design.md, "Peer collision"). Phaser resincroniza
 * `updateFromGameObject()` en cada `preUpdate` de un cuerpo DYNAMIC, asi que
 * el cuerpo sigue al contenedor tween sin sincronizacion manual.
 */
export function enablePeerBody(scene: Phaser.Scene, container: CharacterContainer): void {
  scene.physics.add.existing(container);
  const body = container.body as Phaser.Physics.Arcade.Body;
  body
    .setSize(AVATAR_BODY_SIZE.width, AVATAR_BODY_SIZE.height)
    .setOffset(AVATAR_BODY_OFFSET.x, AVATAR_BODY_OFFSET.y)
    .setImmovable(true);
  body.moves = false;
}
