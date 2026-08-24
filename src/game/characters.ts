/**
 * Fabrica de personajes: NPCs, jugador y su comportamiento de deambular,
 * portados de `makeCharacter`, `spawnNPCs`, `scheduleWander` y `spawnPlayer`
 * (`prototype/js/app.js:325-390`). Depende de Phaser (`scene.add.container`,
 * `scene.physics`, `scene.time`, `scene.tweens`): se prueba en la capa
 * navegador.
 */

import Phaser from 'phaser';
import { TILE, WORLD_H, WORLD_W } from './mapData';
import { NPCS, STATUS_COLOR, STATUS_TXT, type NpcStatus } from './npcData';
import type { OfficeBridge } from './officeBridge';
import { isBlocked, type TerrainGrid } from './terrainGrid';

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
}

/** Contenedor de NPC: agrega metadata de roster necesaria para clic y wander. */
export interface NpcContainer extends CharacterContainer {
  npcId: number;
  status: NpcStatus;
  homeTx: number;
  homeTy: number;
  phase: number;
}

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
  const spr = scene.add.sprite(0, 0, texKey).setScale(2);

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
  return container;
}

/**
 * Crea los NPCs del roster, cablea clic -> `bridge.emit('npcmenu')` (en vez
 * de `document.dispatchEvent`, D1) y programa wander para los flagged
 * (app.js:349-368).
 */
export function spawnNpcs(
  scene: Phaser.Scene,
  grid: TerrainGrid,
  bridge: OfficeBridge,
): NpcContainer[] {
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

    if (npc.wander) scheduleWander(scene, grid, c);
    return c;
  });
}

/**
 * Reprograma un destino aleatorio dentro de bordes validos cada 2.5-6s
 * (app.js:370-382). Reusa `isBlocked` (D6) en vez de duplicar el predicado
 * solido-o-agua-o-fuera-de-rango.
 */
export function scheduleWander(scene: Phaser.Scene, grid: TerrainGrid, c: NpcContainer): void {
  scene.time.addEvent({
    delay: Phaser.Math.Between(2500, 6000),
    loop: true,
    callback: () => {
      const dx = Phaser.Math.Between(-2, 2);
      const dy = Phaser.Math.Between(-2, 2);
      const nx = c.homeTx + dx;
      const ny = c.homeTy + dy;
      if (isBlocked(grid, nx, ny)) return;
      scene.tweens.add({
        targets: c,
        x: nx * TILE + 16,
        y: ny * TILE + 16,
        duration: 900,
        ease: 'Sine.inOut',
      });
    },
  });
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
