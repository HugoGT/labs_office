import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CHAIR, CHARACTER_SEATED, CHARACTER_WALK } from './artContract';
import { chairPlacement } from './artPlacement';
import {
  AVATAR_CONTAINER_SIZE,
  feetOf,
  physicalBodyRect,
  positionForFeet,
  seatedSpriteBox,
} from './avatarGeometry';
import { seatedFrame, walkFrame } from './characterAnimation';
import {
  animateCharacter,
  enableCharacterClicks,
  enablePeerBody,
  makeCharacter,
  setCharacterSheets,
  setCharacterStatus,
  spawnPlayer,
} from './characters';
import { avatarDepth, chairLayerDepth, worldAssetDepth } from './depthLayers';
import { TILE, WORLD_H } from './mapData';
import { DEFAULT_NAME, DEFAULT_STATUS } from './officeProtocol';
import { STATUS_COLOR } from './presence';
import { collisionWorld, isPositionBlocked, layoutPropInstances } from './pieceCollisions';
import { avatarTextureKey, createOfficeTextures } from './textures';

/**
 * Capa navegador: contenedores/sprites/fisica arcade necesitan Phaser real
 * (jsdom no implementa canvas/WebGL). Fisica arcade habilitada en la config
 * de prueba porque `spawnPlayer` requiere un cuerpo fisico.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

async function withScene<T>(run: (scene: Phaser.Scene) => T): Promise<T> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  let result!: T;
  class ProbeScene extends Phaser.Scene {
    constructor() {
      super('probe');
    }
    create(): void {
      createOfficeTextures(this);
      result = run(this);
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    physics: { default: 'arcade' },
    scene: [ProbeScene],
  });
  games.push(game);

  await waitForSceneRunning(game, 'probe');

  return result;
}

describe('spawnPlayer', () => {
  it('crea al jugador en su tile declarada con cuerpo fisico y limites de colision', async () => {
    const result = await withScene((scene) => {
      const player = spawnPlayer(scene, DEFAULT_NAME);
      const body = player.body as Phaser.Physics.Arcade.Body;
      return {
        x: player.x,
        y: player.y,
        hasArcadeBody: body instanceof Phaser.Physics.Arcade.Body,
        collideWorldBounds: body.collideWorldBounds,
      };
    });

    expect(result.x).toBe(67 * TILE + 16);
    expect(result.y).toBe(49 * TILE + 16);
    expect(result.hasArcadeBody).toBe(true);
    expect(result.collideWorldBounds).toBe(true);
  });

  it('etiqueta al jugador con el nombre recibido, no con uno propio (#6)', async () => {
    const nameText = await withScene((scene) => spawnPlayer(scene, 'Ana Torres').nameText);

    // El nombre entra por parametro porque esta fabrica no puede saberlo: lo
    // sabe la sesion verificada, varias capas mas arriba.
    expect(nameText).toBe('Ana Torres');
  });
});

describe('setCharacterStatus', () => {
  it('repinta el punto de la pildora con el color del estado nuevo', async () => {
    const colors = await withScene((scene) => {
      const character = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g');
      const before = character.statusDot.fillColor;
      setCharacterStatus(character, 'r');
      return { before, after: character.statusDot.fillColor, status: character.status };
    });

    expect(colors.before).toBe(STATUS_COLOR.g);
    expect(colors.after).toBe(STATUS_COLOR.r);
    expect(colors.status).toBe('r');
  });

  it('el estado nace en el contenedor, no hay que preguntarselo al punto pintado', async () => {
    // El contenedor es la fuente que lee `proximityTick` para decidir audio:
    // deducir el estado del color seria invertir la direccion del dato.
    const status = await withScene((scene) => makeCharacter(scene, 'Test', 6, 26, 'av0', 'y').status);

    expect(status).toBe('y');
  });

  it('sale pronto si el estado no cambia, sin tocar el objeto pintado', async () => {
    // Espeja `setCharacterFacing`: se llama desde cada mensaje remoto y
    // repintar lo mismo una y otra vez es trabajo tirado.
    const repaints = await withScene((scene) => {
      const character = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g');
      const spy = vi.spyOn(character.statusDot, 'setFillStyle');
      setCharacterStatus(character, 'g');
      return spy.mock.calls.length;
    });

    expect(repaints).toBe(0);
  });

  it('el jugador local arranca "En línea" (DEFAULT_STATUS), no con un color inventado', async () => {
    const player = await withScene((scene) => {
      const created = spawnPlayer(scene, DEFAULT_NAME);
      return { status: created.status, color: created.statusDot.fillColor };
    });

    expect(player.status).toBe(DEFAULT_STATUS);
    expect(player.color).toBe(STATUS_COLOR[DEFAULT_STATUS]);
  });
});

describe('makeCharacter: render band (#70)', () => {
  it('is born in the avatar band, above any normal asset, y-sorted by its feet', async () => {
    const depths = await withScene((scene) => ({
      top: makeCharacter(scene, 'Arriba', 5, 1, 'av1', DEFAULT_STATUS).depth,
      bottom: makeCharacter(scene, 'Abajo', 5, 40, 'av2', DEFAULT_STATUS).depth,
    }));

    expect(depths.top).toBe(avatarDepth(feetOf({ x: 0, y: 1 * TILE + 16 }).y));
    expect(depths.top).toBeGreaterThan(worldAssetDepth(WORLD_H));
    expect(depths.bottom).toBeGreaterThan(depths.top);
  });
});

/**
 * `enablePeerBody` (#59): da a un avatar remoto un cuerpo Arcade inmovible,
 * misma geometria que el jugador local (`spawnPlayer`) -- mismo colisionador
 * en `OfficeScene`, mismo tamano para todo el mundo.
 */
describe('enablePeerBody', () => {
  it('gives the peer the same feet-aligned 18x14 body as the local player', async () => {
    const geometry = await withScene((scene) => {
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const body = container.body as Phaser.Physics.Arcade.Body;
      return { width: body.width, height: body.height, offsetX: body.offset.x, offsetY: body.offset.y };
    });

    expect(geometry).toEqual({ width: 18, height: 14, offsetX: 7, offsetY: 26 });
  });

  it('el cuerpo es inmovible y no se mueve por su cuenta (moves=false)', async () => {
    const flags = await withScene((scene) => {
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const body = container.body as Phaser.Physics.Arcade.Body;
      return { immovable: body.immovable, moves: body.moves };
    });

    expect(flags).toEqual({ immovable: true, moves: false });
  });

  it('la geometria del cuerpo remoto es identica a la del jugador local (misma fabrica)', async () => {
    const { playerGeometry, peerGeometry } = await withScene((scene) => {
      const player = spawnPlayer(scene, 'Yo');
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const playerBody = player.body as Phaser.Physics.Arcade.Body;
      const peerBody = container.body as Phaser.Physics.Arcade.Body;
      return {
        playerGeometry: { w: playerBody.width, h: playerBody.height },
        peerGeometry: { w: peerBody.width, h: peerBody.height },
      };
    });

    expect(peerGeometry).toEqual(playerGeometry);
  });
});

/**
 * Art migration, step 6: the pack sprite is drawn around the network
 * position, never the other way round. These compare the shared numbers of
 * `avatarGeometry.ts` with what real Phaser does, so a visual change cannot
 * quietly move collisions, clicks or what proximity reads.
 */
const WALK_SHEET = 'test-walk';
const SEATED_SHEET = 'test-seated';
const SHEETS = { walk: WALK_SHEET, seated: SEATED_SHEET };
const SEAT_ABOVE_GROUND = { x: CHAIR.anchor.x - CHAIR.ground.x, y: CHAIR.anchor.y - CHAIR.ground.y };

async function bootWithSheets(): Promise<Phaser.Scene> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  class SheetScene extends Phaser.Scene {
    constructor() {
      super('sheets');
    }
    preload(): void {
      this.load.spritesheet(WALK_SHEET, 'assets/pack/character/p01-burgundy-suit-walk.png', {
        frameWidth: CHARACTER_WALK.frame.width,
        frameHeight: CHARACTER_WALK.frame.height,
      });
      this.load.spritesheet(SEATED_SHEET, 'assets/pack/character/p01-burgundy-suit-seated.png', {
        frameWidth: CHARACTER_SEATED.frame.width,
        frameHeight: CHARACTER_SEATED.frame.height,
      });
    }
    create(): void {
      createOfficeTextures(this);
    }
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    physics: { default: 'arcade' },
    scene: [SheetScene],
  });
  games.push(game);
  await waitForSceneRunning(game, 'sheets');
  return game.scene.getScene('sheets') as Phaser.Scene;
}

/** Lets Arcade run its own `preUpdate`, which is where a body follows its container. */
async function nextFrames(scene: Phaser.Scene, frames = 3): Promise<void> {
  const target = scene.game.getFrame() + frames;
  await vi.waitFor(() => expect(scene.game.getFrame()).toBeGreaterThanOrEqual(target), { timeout: 5000, interval: 16 });
}

function bodyRect(container: Phaser.GameObjects.Container) {
  const body = container.body as Phaser.Physics.Arcade.Body;
  return { x: body.x, y: body.y, width: body.width, height: body.height };
}

describe('avatar geometry against real Phaser (art migration, step 6)', () => {
  it('the Arcade body of the local player and of a peer is where avatarGeometry says, sheets or not', async () => {
    const scene = await bootWithSheets();
    const player = spawnPlayer(scene, 'Yo');
    const peer = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
    peer.setPosition(300, 420);
    enablePeerBody(scene, peer);
    await nextFrames(scene);
    const before = { player: bodyRect(player), peer: bodyRect(peer) };

    setCharacterSheets(player, SHEETS);
    setCharacterSheets(peer, SHEETS);
    animateCharacter(player, { dx: 0, dy: 0, dtMs: 16 });
    await nextFrames(scene);

    expect(before.player).toEqual(physicalBodyRect(player));
    expect(before.peer).toEqual(physicalBodyRect(peer));
    expect(bodyRect(player)).toEqual(before.player);
    expect(bodyRect(peer)).toEqual(before.peer);
    for (const character of [player, peer]) {
      const rect = bodyRect(character);
      const sprite = character.sprite.getBounds();
      const drawnFeet = { x: sprite.x + CHARACTER_WALK.anchor.x, y: sprite.y + CHARACTER_WALK.anchor.y };
      expect({ x: rect.x + rect.width / 2, y: rect.y + rect.height }).toEqual(drawnFeet);
    }
    expect(player.width).toBe(AVATAR_CONTAINER_SIZE.width);
    expect(player.height).toBe(AVATAR_CONTAINER_SIZE.height);
  });

  it.each([
    { side: 'left', feet: { x: 197, y: 249 }, velocity: { x: 60, y: 0 }, contact: { x: 216, y: 249 } },
    { side: 'right', feet: { x: 253, y: 249 }, velocity: { x: -60, y: 0 }, contact: { x: 243, y: 249 } },
    { side: 'above', feet: { x: 225, y: 224 }, velocity: { x: 0, y: 60 }, contact: { x: 225, y: 244 } },
    { side: 'below', feet: { x: 225, y: 288 }, velocity: { x: 0, y: -60 }, contact: { x: 225, y: 269 } },
  ])('contacts an asymmetric saved trunk from $side at the ground footprint, not the torso', async ({ feet, velocity, contact }) => {
    const scene = await bootWithSheets();
    const instances = layoutPropInstances([{ piece: 'tree-oak', kind: 'tree', tx: 6, ty: 6, w: 2, h: 2, collision: 'solid', facing: null }]);
    const rects = collisionWorld(instances, new Map([['tree-oak', [{ x: 1, y: -12, w: 9, h: 11 }]]]));
    expect(rects[0]).toMatchObject({ x: 225, y: 244, w: 9, h: 11 });
    const trunk = rects[0]!;
    const obstacle = scene.add.rectangle(trunk.x + trunk.w / 2, trunk.y + trunk.h / 2, trunk.w, trunk.h);
    scene.physics.add.existing(obstacle, true);
    const player = spawnPlayer(scene, 'Test', SHEETS);
    const body = player.body as Phaser.Physics.Arcade.Body;
    const position = positionForFeet(feet);
    body.reset(position.x, position.y);
    let collided = false;
    scene.physics.add.collider(player, obstacle, () => { collided = true; });
    body.setVelocity(velocity.x, velocity.y);
    await vi.waitFor(() => expect(collided).toBe(true), { timeout: 5000, interval: 16 });
    body.setVelocity(0, 0);
    await nextFrames(scene);
    const bounds = player.sprite.getBounds();
    expect(bounds.x + CHARACTER_WALK.anchor.x).toBeCloseTo(contact.x);
    expect(bounds.y + CHARACTER_WALK.anchor.y).toBeCloseTo(contact.y);
    expect(bodyRect(player)).toEqual(physicalBodyRect(player));
    expect(isPositionBlocked(rects, player.x, player.y)).toBe(false);
  });

  it('draws the walk frame with its anchor on the feet, and leaves the position alone', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 10, 10, 'av1', 'g');
    const position = { x: character.x, y: character.y };

    setCharacterSheets(character, SHEETS);
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });

    const bounds = character.sprite.getBounds();
    expect({ x: bounds.x + CHARACTER_WALK.anchor.x, y: bounds.y + CHARACTER_WALK.anchor.y }).toEqual(feetOf(position));
    expect({ width: bounds.width, height: bounds.height }).toEqual(CHARACTER_WALK.frame);
    expect(character.sprite.texture.key).toBe(WALK_SHEET);
    expect(Number(character.sprite.frame.name)).toBe(walkFrame('S', 'idle'));
    expect({ x: character.x, y: character.y }).toEqual(position);
  });

  it('walks in the direction of movement and goes idle when it stops', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 10, 10, 'av1', 'g');
    setCharacterSheets(character, SHEETS);

    animateCharacter(character, { dx: -2, dy: 2, dtMs: 16 });
    expect(Number(character.sprite.frame.name)).toBe(walkFrame('SW', 0));
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 1000 });
    expect(Number(character.sprite.frame.name)).toBe(walkFrame('SW', 'idle'));
  });

  it('a sitter on a chair has its seated anchor on the chair seat, between the chair layers', async () => {
    const scene = await bootWithSheets();
    const ground = { x: 400, y: 300 };
    const chair = chairPlacement(
      { anchors: { seat: CHAIR.anchor, ground: CHAIR.ground } } as Parameters<typeof chairPlacement>[0],
      'left',
      ground,
    );
    const chairSeat = { x: chair.back.x + CHAIR.anchor.x, y: chair.back.y + CHAIR.anchor.y };
    const character = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
    const stand = positionForFeet(ground);
    character.setPosition(stand.x, stand.y);
    setCharacterSheets(character, SHEETS);

    character.seatFacing = 'left';
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });

    const bounds = character.sprite.getBounds();
    expect({ x: bounds.x + CHARACTER_SEATED.anchor.x, y: bounds.y + CHARACTER_SEATED.anchor.y }).toEqual(chairSeat);
    expect(seatedSpriteBox(CHARACTER_SEATED, SEAT_ABOVE_GROUND).width).toBe(bounds.width);
    expect(character.sprite.texture.key).toBe(SEATED_SHEET);
    expect(Number(character.sprite.frame.name)).toBe(seatedFrame('left', 0));
    expect(character.depth).toBeGreaterThan(chairLayerDepth(ground.y, 'back'));
    expect(character.depth).toBeLessThan(chairLayerDepth(ground.y, 'front'));
  });

  it('a standing avatar sorts in the avatar band by its feet', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 10, 10, 'av1', 'g');

    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });

    expect(character.depth).toBe(avatarDepth(feetOf(character).y));
  });

  it('keeps the procedural avatar while there are no sheets, and goes back to it if they are dropped', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 10, 10, 'av1', 'g');
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });
    expect(character.sprite.texture.key).toBe(avatarTextureKey('av1', 'down'));

    setCharacterSheets(character, SHEETS);
    setCharacterSheets(character, null);

    expect(character.sprite.texture.key).toBe(avatarTextureKey('av1', 'down'));
    expect(character.sprite.scale).toBe(2);
  });

  it('the name pill clears the head, standing and seated', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 10, 10, 'av1', 'g');
    setCharacterSheets(character, SHEETS);
    const pillBottom = () => character.statusDot.y + 9;

    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });
    expect(pillBottom()).toBeLessThanOrEqual(character.sprite.y);
    character.seatFacing = 'down';
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });
    expect(pillBottom()).toBeLessThanOrEqual(character.sprite.y);
  });

  it('a click on the drawn body hits the peer, wherever the sprite is', async () => {
    const scene = await bootWithSheets();
    const character = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
    character.setPosition(160, 120);
    enableCharacterClicks(character);
    setCharacterSheets(character, SHEETS);
    const hits = (worldX: number, worldY: number) =>
      scene.input.manager.pointWithinHitArea(character, worldX - character.x, worldY - character.y);

    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });
    const walk = character.sprite.getBounds();
    expect(hits(walk.centerX, walk.centerY)).toBe(true);
    expect(hits(walk.x + 1, walk.y + 1)).toBe(true);
    expect(hits(walk.right + 2, walk.centerY)).toBe(false);
    expect(hits(walk.centerX, walk.bottom + 2)).toBe(false);

    character.seatFacing = 'right';
    animateCharacter(character, { dx: 0, dy: 0, dtMs: 16 });
    const seated = character.sprite.getBounds();
    expect(hits(seated.right - 1, seated.centerY)).toBe(true);
    expect(hits(seated.right + 2, seated.centerY)).toBe(false);
  });
});
