/**
 * Fabrica de personajes: NPCs, jugador y la caminata de los NPCs simulados,
 * portados de `makeCharacter`, `spawnNPCs` y `spawnPlayer`
 * (`prototype/js/app.js:325-390`). Depende de Phaser (`scene.add.container`,
 * `scene.physics`, `scene.tweens`): se prueba en la capa navegador.
 *
 * `scheduleWander` del prototipo se retiro: los NPCs ya no deambulan por su
 * cuenta. Se quedan en su escritorio para que la oficina no se vea vacia y
 * solo se mueven cuando se les llama, via `walkNpcTo`.
 */

import Phaser from 'phaser';
import { TILE, WORLD_H, WORLD_W } from './mapData';
import { NPCS, STATUS_COLOR, STATUS_TXT, type NpcStatus } from './npcData';
import type { OfficeBridge } from './officeBridge';
import { DEFAULT_FACING, type Facing } from './officeProtocol';
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
}

/** Contenedor de NPC: agrega la metadata de roster que usan el clic y la llamada. */
export interface NpcContainer extends CharacterContainer {
  npcId: number;
  status: NpcStatus;
  homeTx: number;
  homeTy: number;
  phase: number;
  /** Caminata en curso, si la hay. Se cancela al recibir una llamada nueva. */
  walkTween?: Phaser.Tweens.Tween;
}

/**
 * Ritmo de caminata de un NPC llamado. La duracion se deriva de la distancia
 * (no es fija) para que la velocidad aparente sea la misma tanto si cruza la
 * oficina como si da un paso.
 */
export const NPC_WALK_MS_PER_TILE = 260;

const PLAYER_NAME = 'HugoGT';
const PLAYER_SPAWN_TX = 22;
const PLAYER_SPAWN_TY = 28;
const PLAYER_TEXTURE = 'avP';

/** Construye un personaje: anillo de habla + sprite + pildora de nombre (app.js:325-347). */
export function makeCharacter(
  scene: Phaser.Scene,
  name: string,
  tx: number,
  ty: number,
  texKey: string,
  statusColor: number,
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
  const dot = scene.add.circle(-pillW / 2 + 11, -34, 3.5, statusColor);
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
 * Crea los NPCs del roster y cablea clic -> `bridge.emit('npcmenu')` (en vez
 * de `document.dispatchEvent`, D1). Ya no programa temporizadores: el unico
 * comportamiento de un NPC es reactivo (`walkNpcTo` al ser llamado).
 */
export function spawnNpcs(scene: Phaser.Scene, bridge: OfficeBridge): NpcContainer[] {
  return NPCS.map((npc, i) => {
    const c = makeCharacter(
      scene,
      npc.name,
      npc.tx,
      npc.ty,
      `av${i % 10}`,
      STATUS_COLOR[npc.status],
    ) as NpcContainer;
    c.npcId = i;
    c.status = npc.status;
    c.homeTx = npc.tx;
    c.homeTy = npc.ty;
    c.phase = (i * 777) % 4000;
    c.setInteractive(new Phaser.Geom.Rectangle(-16, -22, 32, 44), Phaser.Geom.Rectangle.Contains);
    c.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      bridge.emit('npcmenu', {
        id: i,
        name: npc.name,
        status: STATUS_TXT[npc.status],
        statusCode: npc.status,
        x: (pointer.event as MouseEvent).clientX,
        y: (pointer.event as MouseEvent).clientY,
      });
    });

    return c;
  });
}

/**
 * Camina al NPC hasta el centro de la tile `(tx, ty)`. Cancela cualquier
 * caminata en curso: sin eso, dos llamadas seguidas dejarian dos tweens
 * peleando por `x`/`y` del mismo contenedor y el NPC vibraria entre destinos.
 *
 * Quien llama elige la tile (ver `findFreeAdjacentTile`); aqui solo se anima.
 */
export function walkNpcTo(
  scene: Phaser.Scene,
  npc: NpcContainer,
  tx: number,
  ty: number,
): Phaser.Tweens.Tween {
  const x = tx * TILE + 16;
  const y = ty * TILE + 16;

  npc.walkTween?.stop();

  const tiles = Math.hypot(x - npc.x, y - npc.y) / TILE;
  const tween = scene.tweens.add({
    targets: npc,
    x,
    y,
    duration: Math.max(NPC_WALK_MS_PER_TILE, tiles * NPC_WALK_MS_PER_TILE),
    ease: 'Sine.inOut',
    onComplete: () => {
      npc.walkTween = undefined;
    },
  });
  npc.walkTween = tween;
  return tween;
}

/** Crea al jugador con cuerpo fisico y limites de mundo (app.js:384-390). */
export function spawnPlayer(scene: Phaser.Scene): CharacterContainer {
  const player = makeCharacter(
    scene,
    PLAYER_NAME,
    PLAYER_SPAWN_TX,
    PLAYER_SPAWN_TY,
    PLAYER_TEXTURE,
    STATUS_COLOR.g,
  );
  scene.physics.add.existing(player);
  const body = player.body as Phaser.Physics.Arcade.Body;
  body.setSize(22, 14).setOffset(-11, 6);
  body.setCollideWorldBounds(true);
  scene.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
  return player;
}
