import Phaser from 'phaser';
import { expect, vi } from 'vitest';
import { waitForSceneRunning } from './phaserScene';
import type { CharacterContainer } from '../game/characters';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE } from '../game/mapData';
import {
  LEGACY_LAYOUT as BASE_LAYOUT,
  LEGACY_SEATS as BASE_MAP_SEATS,
  LEGACY_SPACES as BUILT_IN_SPACES,
} from './legacyOffice';
import { buildTerrainGrid } from '../game/terrainGrid';
import { createOfficeBridge } from '../game/officeBridge';
import type { PresenceStatus } from '../game/officeProtocol';
import type { ConnectOfficeRoomOptions, OfficeConnection, OfficeRoomHandlers } from '../game/officeRoomClient';
import { OFFICE_SCENE_KEY, OfficeScene, type OfficeSceneOptions } from '../game/OfficeScene';
import type { AutoWalkState } from '../game/autoWalk';

/**
 * Shared harness for the `OfficeScene.*.browser.test.ts` files, split from one
 * file so Vitest can spread them across CI shards.
 */

/**
 * `OfficeScene` orquesta fisica, camaras, tweens y timers desde el slice 7 en
 * adelante: no se prueba con una superficie falsa (ver D5) sino siempre
 * dentro de un `Phaser.Game` real, igual que `createGame`/`mapBuilder`.
 */

export const BUILT_IN_SPACES_VERSION = 'a489c5da5efd7c68';

export const games: Phaser.Game[] = [];
export const hosts: HTMLElement[] = [];

// Deterministic render frames through the real SceneManager and Arcade world,
// not a reducer simulation or a mocked body. An empty arena isolates movement.
export async function movementArena(connector?: ReturnType<typeof fakeConnector>) {
  const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), connector
    ? { endpoint: 'ws://fake', connect: connector.connect, artManifestUrl: null, artUploadsUrl: null }
    : { endpoint: null, artManifestUrl: null, artUploadsUrl: null });
  if (connector) await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
  const player = findPlayer(scene);
  const body = player.body as Phaser.Physics.Arcade.Body;
  scene.game.loop.stop();
  for (const collider of scene.physics.world.colliders.update()) collider.active = false;
  for (const staticBody of scene.physics.world.staticBodies.getArray()) staticBody.gameObject.destroy();
  scene.physics.world.postUpdate();
  scene.physics.world.setBounds(0, 0, 100000, 100000);
  body.reset(300, 300);
  const movement = scene as unknown as {
    walkingMs: number;
    autoWalk?: AutoWalkState;
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    buildTerrainColliders(grid: ReturnType<typeof buildTerrainGrid>): void;
    buildPieceColliders(): void;
    collisionRects: { x: number; y: number; w: number; h: number }[];
    grid: ReturnType<typeof buildTerrainGrid>;
  };
  // One array for both: the planner reads the terrain, the tile helpers `solid`; a test's blocked tile is both.
  movement.grid.solid = movement.grid.terrainSolid = Array.from({ length: 100 }, (_, y) => Array.from({ length: 3200 }, () => y === 0));
  // The planner tests the office's walls and pieces like Arcade does: with their bodies gone, they go too.
  movement.grid.wallRects = [];
  movement.collisionRects = [];
  let time = scene.time.now;
  const frame = (delta = 20, gap = delta) => { time += gap; scene.game.step(time, delta); };
  const walk = (milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) frame();
  };
  /** Runs the game clock forward in frames the walk stall guard accepts (each gap <= 100 ms). */
  const wait = (milliseconds: number) => {
    for (let left = milliseconds; left > 0; left -= 100) frame(20, Math.min(left, 100));
  };
  /** One press and release. `screenDx` moves it on screen only: the double-click distance is in screen px. */
  const click = (x: number, y: number, distance = 0, over: Phaser.GameObjects.GameObject[] = [], screenDx = 0) => {
    const pointer = { button: 0, camera: scene.cameras.main, x: 10 + screenDx, y: 10,
      worldX: x, worldY: y, getDistance: () => distance };
    scene.input.emit('pointerdown', pointer, over);
    scene.input.emit('pointerup', pointer, over);
  };
  /**
   * Two clicks, the walk gesture. Both land on the same time and screen point unless `gapMs` (game clock,
   * advanced in real frames) or `screenDx` say otherwise. `distance`, `over` and `worldDx` shape the SECOND
   * press only, so a test proves that press is the ineligible one. No frame runs in between by default:
   * a frame with no input would reset the walking-speed clock, which some tests keep on purpose.
   */
  const doubleClick = (x: number, y: number, options: {
    gapMs?: number; screenDx?: number; worldDx?: number; distance?: number; over?: Phaser.GameObjects.GameObject[];
  } = {}) => {
    click(x, y);
    wait(options.gapMs ?? 0);
    click(x + (options.worldDx ?? 0), y, options.distance, options.over, options.screenDx);
  };
  return { scene, bridge, player, body, movement, frame, walk, wait, click, doubleClick };
}


/** Destroys every game and host the helpers created; each test file runs it after each test. */
export function destroyOfficeGames(): void {
  for (const game of games.splice(0)) {
    game.destroy(true);
    // destroy() is deferred to the next frame; deterministic arenas stop RAF.
    if (!game.loop.running) game.step(0, 0);
  }
  for (const host of hosts.splice(0)) host.remove();
}

/**
 * Margen unico para toda espera que dependa del bucle de Phaser. En el runner
 * de CI el hilo principal se atasca segundos enteros: una prueba con 2000ms de
 * margen tardo 8263ms de reloj de pared alli y fallo sin que la escena hubiese
 * hecho nada mal. El margen se fija holgado a proposito -- lo que decide la
 * prueba es la condicion, no el cronometro.
 */
export const LOOP_WAIT = { timeout: 20000, interval: 50 } as const;

/**
 * Espera avanzando el RELOJ DEL JUEGO, que solo corre cuando corren los frames.
 * Un `setTimeout` real puede vencer sin que la escena haya dado un solo tick de
 * proximidad (250ms de reloj de juego), y entonces la prueba mide la velocidad
 * del runner en vez de la regla que dice medir.
 */
export async function advanceGameClock(scene: Phaser.Scene, ms: number): Promise<void> {
  const target = scene.time.now + ms;
  await vi.waitFor(() => {
    expect(scene.time.now).toBeGreaterThanOrEqual(target);
  }, LOOP_WAIT);
}

/** Waits until the following camera stops moving, so a world point keeps its place on screen. */
export async function settleCamera(scene: Phaser.Scene): Promise<void> {
  let last = '';
  for (let i = 0; i < 40; i++) {
    await advanceGameClock(scene, 100);
    const view = scene.cameras.main.worldView;
    const now = `${view.x},${view.y},${scene.cameras.main.zoom}`;
    if (now === last) return;
    last = now;
  }
}

export async function bootOfficeScene(
  bridge = createOfficeBridge(),
  options: OfficeSceneOptions = {},
): Promise<{
  scene: Phaser.Scene;
  bridge: ReturnType<typeof createOfficeBridge>;
}> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    // The scene has no game sounds; visibility regressions must not enqueue
    // suspend/resume promises on AudioContexts that teardown then closes.
    audio: { noAudio: true },
    physics: { default: 'arcade' },
    scene: [new OfficeScene(bridge, { layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, fallbackSpaces: { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION }, ...options })],
  });
  games.push(game);

  await waitForSceneRunning(game, OFFICE_SCENE_KEY);

  return { scene: game.scene.getScene(OFFICE_SCENE_KEY) as Phaser.Scene, bridge };
}

/**
 * Desde #59 tanto el jugador como los peers remotos tienen cuerpo fisico:
 * `body !== null` dejo de distinguirlos. Lo que sigue distinguiendolos es
 * `moves` -- el cuerpo del jugador se mueve por velocidad (D-diseno,
 * `spawnPlayer`); el de un peer es `enablePeerBody` (`moves=false`, el tween
 * es la unica fuente de verdad de su posicion). Se busca asi y no por el
 * nombre porque el nombre es justo lo que varias pruebas miden (#6): atarlo
 * aqui haria que el helper dejase de encontrarlo en cuanto la sesion traiga
 * otro.
 */
export function findPlayer(scene: Phaser.Scene): CharacterContainer {
  const player = scene.children.list.find(
    (c): c is CharacterContainer =>
      c.type === 'Container' &&
      c.body !== null &&
      (c.body as Phaser.Physics.Arcade.Body).moves !== false,
  );
  if (!player) throw new Error('player container not found in scene');
  return player;
}

/** Codigos de tecla legacy (`keyCode`), que es lo que Phaser's Key matching usa internamente. */
export const KEY = { RIGHT: 39, LEFT: 37, DOWN: 40, D: 68, E: 69 } as const;

export function dispatchKey(type: 'keydown' | 'keyup', keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true } as KeyboardEventInit);
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  window.dispatchEvent(event);
  return event;
}

/**
 * Doble de conexion: captura los handlers que la escena registra para poder
 * simular altas, cambios y bajas remotas sin levantar un Colyseus. El
 * protocolo real ya se prueba contra un servidor de verdad en la capa node
 * (`officeRoomClient.node.test.ts`); lo que se prueba aqui es el cableado.
 */
export function fakeConnector(sessionId = 'yo', initialState = true) {
  const sent: { x: number; y: number; facing: string }[] = [];
  const statuses: PresenceStatus[] = [];
  // Issue #2, unit 12: ahora si se registran -- antes eran no-ops porque
  // ninguna unit emitia comandos de llamada todavia.
  const calls: string[] = [];
  const respondedCalls: { from: string; accept: boolean }[] = [];
  const sentSpacesVersions: string[] = [];
  const sits: string[] = [];
  let stands = 0;
  let locks = 0;
  let unlocks = 0;
  let captured: OfficeRoomHandlers | undefined;
  let joinedWith: PresenceStatus | undefined;
  let joinedName: string | undefined;
  let joinedSpacesVersion: string | undefined;
  let left = false;
  // Issue #52: el comando `reconnect` se prueba contando entradas, no
  // inspeccionando la conexion -- lo que tiene que pasar es que la escena
  // vuelva a entrar, no como quede por dentro el doble.
  let connectCount = 0;

  const connection: OfficeConnection = {
    sessionId,
    sendMove: (x, y, facing) => sent.push({ x, y, facing }),
    sendStatus: (status) => statuses.push(status),
    sendSpacesVersion: (version) => sentSpacesVersions.push(version),
    sendCall: (to) => calls.push(to),
    sendCallRespond: (from, accept) => respondedCalls.push({ from, accept }),
    sendSit: (seat) => sits.push(seat),
    sendStand: () => {
      stands++;
    },
    sendLock: () => {
      locks++;
    },
    sendUnlock: () => {
      unlocks++;
    },
    leave: async () => {
      left = true;
    },
  };

  return {
    sent,
    statuses,
    calls,
    respondedCalls,
    sentSpacesVersions,
    sits,
    stands: () => stands,
    locks: () => locks,
    unlocks: () => unlocks,
    handlers: () => captured,
    joinedWith: () => joinedWith,
    joinedName: () => joinedName,
    joinedSpacesVersion: () => joinedSpacesVersion,
    hasLeft: () => left,
    connectCount: () => connectCount,
    connect: async (options: ConnectOfficeRoomOptions) => {
      connectCount++;
      captured = options.handlers;
      joinedWith = options.status;
      joinedName = options.name;
      joinedSpacesVersion = options.spacesVersion;
      if (initialState) options.handlers.onLocalPosition?.(remoteSnapshot({
        sessionId, x: PLAYER_SPAWN_TX * TILE + 16, y: PLAYER_SPAWN_TY * TILE + 16,
      }));
      return connection;
    },
  };
}

export function remoteSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'remota-1',
    name: 'Ana Remota',
    x: 500,
    y: 600,
    status: 'g',
    facing: 'down',
    spacesVersion: BUILT_IN_SPACES_VERSION,
    avatarId: null,
    seat: null,
    ...overrides,
  } as Parameters<OfficeRoomHandlers['onAdd']>[0];
}

export function findRemoteAvatars(scene: Phaser.Scene): CharacterContainer[] {
  // Complemento exacto de `findPlayer` (ver su comentario, #59): un peer
  // remoto o no tiene cuerpo (sin `peerGroup`, no deberia pasar en
  // produccion) o lo tiene con `moves=false`.
  return scene.children.list.filter(
    (c): c is CharacterContainer =>
      c.type === 'Container' &&
      (c.body === null || (c.body as Phaser.Physics.Arcade.Body).moves === false),
  );
}
