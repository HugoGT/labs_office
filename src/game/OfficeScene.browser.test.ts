import Phaser from 'phaser';
import * as vitestBrowser from 'vitest/browser';
import type { BrowserCommands } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE, ZONE_LABELS } from './mapData';
import { TERRAIN_LAYER_COUNT } from './artContract';
import {
  LEGACY_LAYOUT as BASE_LAYOUT,
  LEGACY_SEATS as BASE_MAP_SEATS,
  LEGACY_SPACES as BUILT_IN_SPACES,
} from '../test/legacyOffice';
import { physicalBodyRect } from './avatarGeometry';
import { mapSeatId } from './seating';
import { artSheetKey } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { DEFAULT_NAME, DEFAULT_STATUS, type PresenceStatus } from './officeProtocol';
import { STATUS_COLOR } from './presence';
import { AVATAR_KEYS, PLAYER_TEXTURE } from './textures';
import {
  OfficeAccessDeniedError,
  connectOfficeRoom,
  type ConnectOfficeRoomOptions,
  type OfficeConnection,
} from './officeRoomClient';
import { OFFICE_SCENE_KEY, OfficeScene, decorObjectName } from './OfficeScene';
import type { AutoWalkState } from './autoWalk';
import {
  destroyOfficeGames,
  LOOP_WAIT,
  advanceGameClock,
  bootOfficeScene,
  findPlayer,
  KEY,
  dispatchKey,
  fakeConnector,
  remoteSnapshot,
  findRemoteAvatars,
  BUILT_IN_SPACES_VERSION,
} from '../test/officeScene';

afterEach(destroyOfficeGames);

describe('OfficeScene: identidad y construccion (D2/D5)', () => {
  it('se registra con la clave "office", no "boot"', () => {
    expect(OFFICE_SCENE_KEY).toBe('office');
    expect(new OfficeScene(createOfficeBridge()).sys.settings.key).toBe(OFFICE_SCENE_KEY);
  });

  it('el constructor acepta una instancia de OfficeBridge sin lanzar', () => {
    const bridge = createOfficeBridge();

    expect(() => new OfficeScene(bridge)).not.toThrow();
  });
});

describe('office entry art readiness', () => {
  it('waits for the replicated local character, not just a successful join', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await advanceGameClock(scene, 50);
    expect(entry).not.toHaveBeenCalled();
    connector.handlers()!.onLocalAvatar?.('character-p02-beige-blazer');
    expect(entry).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'ready' }), LOOP_WAIT);
    expect(findPlayer(scene).sprite.texture.key).toBe(artSheetKey('character-p02-beige-blazer', 'walk'));
  });

  it('enters with the pack default character when the own custom character cannot load', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect,
      artCustomCharactersUrl: 'assets/pack/missing-characters/' });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onLocalAvatar?.(`character-custom-${'a'.repeat(32)}`);

    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'ready' }), LOOP_WAIT);
    expect(entry).not.toHaveBeenCalledWith({ state: 'failed' });
    expect(findPlayer(scene).sprite.texture.key).toBe(artSheetKey('character-p01-burgundy-suit', 'walk'));
  });

  it.each([false, true])('settles the art of the decor layer before revealing (broken: %s) (#208)', async (broken) => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect, artUploadsUrl: null });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const art = (scene as unknown as { art: ArtPackLoader }).art;
    const manifest = art.manifest!;
    const ficus = manifest.pieces.find((piece) => piece.id === 'plant-ficus')!;
    const alias = { ...ficus, id: 'plant-ficus-entry', files: ficus.files.map((file) => ({ ...file, path: broken ? 'entry-missing.png' : file.path })) };
    art.adoptManifest({ ...manifest, pieces: [...manifest.pieces, alias] });
    const index = 40 * BASE_LAYOUT.width + 30;

    connector.handlers()!.onDecor?.([{ index, piece: alias.id, rotation: 0 }]);
    connector.handlers()!.onLocalAvatar?.('character-p01-burgundy-suit');

    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: broken ? 'failed' : 'ready' }), LOOP_WAIT);
    if (!broken) {
      expect(art.status(alias.id)).toBe('ready');
      const plant = scene.children.getByName(decorObjectName(index)) as Phaser.GameObjects.Image;
      expect(plant.texture.key).toBe(artSheetKey(alias.id, 'sheet'));
    }
  });

  it('never reveals after a denied join and removes its render listener when stopped', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake',
      connect: async () => { throw new OfficeAccessDeniedError('not-provisioned'); } });
    await advanceGameClock(scene, 100);
    expect(entry).not.toHaveBeenCalled();
    scene.scene.stop();
    await vi.waitFor(() => expect(scene.game.events.listenerCount(Phaser.Core.Events.POST_RENDER)).toBe(0), LOOP_WAIT);
    bridge.emitCommand('desks', { desks: [] });
    expect(entry).not.toHaveBeenCalled();
  });

  it('constructs the local body from current sheets rather than a procedural startup sprite', async () => {
    const sprite = vi.spyOn(Phaser.GameObjects.GameObjectFactory.prototype, 'sprite');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: null });
    expect(sprite.mock.calls.some((call) => String(call[2]).startsWith('avP-'))).toBe(false);
    expect(findPlayer(scene).sheets).not.toBeNull();
    sprite.mockRestore();
  });
  it('waits for initial served data and current character, then reports after rendering only once', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const { scene } = await bootOfficeScene(bridge, { endpoint: null, waitForOfficeData: true });
    expect(entry).not.toHaveBeenCalled();
    bridge.emitCommand('spacesconfig', { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION });
    expect(entry).not.toHaveBeenCalled();
    bridge.emitCommand('desks', { desks: [] });
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'ready' }), LOOP_WAIT);
    expect(findPlayer(scene).sprite.texture.key).toMatch(/^art:character-/);
    expect(scene.textures.exists(artSheetKey('tileset-terrain', 'sheet'))).toBe(true);
    await advanceGameClock(scene, 100);
    expect(entry).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable art as a failure, never a ready legacy office', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    await bootOfficeScene(bridge, { endpoint: null, artManifestUrl: null });
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'failed' }), LOOP_WAIT);
    expect(entry).not.toHaveBeenCalledWith({ state: 'ready' });
  });

  it('fails entry if a required static sheet downloads HTML instead of PNG', async () => {
    const originalPreload = ArtPackLoader.prototype.preload;
    const restore: (() => void)[] = [];
    const preload = vi.spyOn(ArtPackLoader.prototype, 'preload').mockImplementation(function (this: ArtPackLoader) {
      // Phaser installs file-type methods on each loader instance, not its prototype.
      const load = (this as unknown as { scene: Phaser.Scene }).scene.load;
      const original = load.spritesheet;
      const sheet = vi.spyOn(load, 'spritesheet').mockImplementation(function (this: Phaser.Loader.LoaderPlugin, key, url, config, xhr) {
        return original.call(this, key, key === artSheetKey('tileset-terrain', 'sheet') ? 'assets/pack/entry-missing.png' : url, config, xhr);
      });
      restore.push(() => sheet.mockRestore());
      originalPreload.call(this);
    });
    try {
      const bridge = createOfficeBridge();
      const entry = vi.fn();
      bridge.on('entry', entry);
      await bootOfficeScene(bridge, { endpoint: null });
      await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'failed' }), LOOP_WAIT);
      expect(entry).not.toHaveBeenCalledWith({ state: 'ready' });
    } finally {
      for (const restoreSheet of restore) restoreSheet();
      preload.mockRestore();
    }
  });
});

describe('OfficeScene dentro de un Phaser.Game real: mapa y jugador', () => {
  it('draws the Tiled layout in create(): terrain tilemap, walls, props and zone labels from the pack', async () => {
    const { scene } = await bootOfficeScene();

    const images = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image => c.type === 'Image',
    );
    const texts = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Text => c.type === 'Text',
    );
    const ofPiece = (kind: string) => BASE_LAYOUT.props.filter((prop) => prop.kind === kind).length;

    // Art step 8: the floor is tilemap layers, not one image per tile.
    expect(scene.children.list.filter((c) => c.type === 'TilemapLayer')).toHaveLength(TERRAIN_LAYER_COUNT + 1);
    expect(images.filter((img) => img.texture.key === artSheetKey('desk-wood', 'sheet'))).toHaveLength(ofPiece('desk'));
    expect(images.filter((img) => img.texture.key.startsWith('art:tree-'))).toHaveLength(ofPiece('tree'));
    expect(images.filter((img) => img.texture.key.startsWith('art:table-'))).toHaveLength(ofPiece('table'));
    expect(images.filter((img) => img.texture.key.startsWith('art:wall-')).length).toBeGreaterThan(0);
    // The Kenney placeholder art is gone from the map.
    expect(scene.children.list.filter((c) => c.type === 'TileSprite')).toHaveLength(0);
    expect(texts).toHaveLength(ZONE_LABELS.length);
  });

  it('without the art pack it still draws the whole map, from its fallbacks', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { artManifestUrl: 'assets/pack/missing.json' });

    expect(scene.children.list.filter((c) => c.type === 'TilemapLayer')).toHaveLength(1);
    const placeholders = scene.children.list.filter((c) => c.type === 'Rectangle').length;
    expect(placeholders).toBeGreaterThanOrEqual(BASE_LAYOUT.props.length);
  });

  it('crea al jugador local y a nadie mas: la oficina arranca vacia de companeros', async () => {
    const { scene } = await bootOfficeScene();

    const containers = scene.children.list.filter((c) => c.type === 'Container');
    expect(containers).toHaveLength(1);
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });
});

describe('OfficeScene: input y movimiento del jugador (app.js:488-497)', () => {
  it('la flecha derecha mueve al jugador inactivo hacia la derecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      }, LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('la tecla D (WASD) mueve al jugador hacia la derecha, igual que la flecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.D);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      }, LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.D);
    }
  });

  it('#104: con el foco en un input de texto, WASD no mueve al jugador (queda para escribir)', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    try {
      dispatchKey('keydown', KEY.D);
      try {
        // No hay una condicion positiva que esperar (el punto es que NADA
        // pase): se le da tiempo real al loop de Phaser para correr varios
        // frames y luego se comprueba que el jugador no se movio ni una vez.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(player.x).toBe(startX);
      } finally {
        dispatchKey('keyup', KEY.D);
      }
    } finally {
      input.remove();
    }
  });

  it('#104: con el foco en un input de texto, WASD no le hace preventDefault al evento (la letra SI llega al campo)', async () => {
    // Reproduccion del bug real reportado tras cerrar #104: el bloqueo del
    // AVATAR (arriba) no prueba que la letra se pueda escribir. Phaser's
    // `KeyboardManager` llama a `event.preventDefault()` para cualquier
    // keyCode en captura (`addKeys('W,A,S,D')` captura por defecto) SIN mirar
    // `document.activeElement`, asi que el navegador nunca inserta el
    // caracter en el campo aunque el juego ya ignore el movimiento.
    await bootOfficeScene();

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    try {
      const event = dispatchKey('keydown', KEY.D);
      try {
        expect(event.defaultPrevented).toBe(false);
      } finally {
        dispatchKey('keyup', KEY.D);
      }
    } finally {
      input.remove();
    }
  });

  it('sin foco en un input, WASD sigue haciendo preventDefault (el juego conserva la captura global)', async () => {
    await bootOfficeScene();

    const event = dispatchKey('keydown', KEY.D);
    try {
      expect(event.defaultPrevented).toBe(true);
    } finally {
      dispatchKey('keyup', KEY.D);
    }
  });
});

describe('OfficeScene: colisiones (app.js: colisionador fusionado, D6)', () => {
  it('el jugador no atraviesa el seto solido del borde del mapa', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // A una tile del seto izquierdo (x=0, solido): intenta seguir hacia la izquierda.
    player.setPosition(1 * TILE + 16, 5 * TILE + 16);
    const startX = player.x;

    dispatchKey('keydown', KEY.LEFT);
    await new Promise((resolve) => setTimeout(resolve, 250));
    dispatchKey('keyup', KEY.LEFT);

    // El colisionador detiene al jugador antes de entrar a la tile solida (x=0).
    expect(player.x).toBeGreaterThanOrEqual(0 * TILE + TILE / 2);
    expect(player.x).toBeLessThanOrEqual(startX);
  });

  it('el jugador cruza un tile de puente sobre el rio', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // Al norte de uno de los dos puentes (x=13..15, y=19..21): cruza hacia el sur.
    player.setPosition(14 * TILE + 16, 18 * TILE + 16);
    const startY = player.y;

    dispatchKey('keydown', KEY.DOWN);
    try {
      await vi.waitFor(
        () => {
          expect(player.y).toBeGreaterThan(startY);
        },
        { timeout: 2000 },
      );
    } finally {
      dispatchKey('keyup', KEY.DOWN);
    }
  });
});

/**
 * Avatars still y-sort AMONG THEMSELVES inside the avatar band (#70): two
 * overlapping avatars must read right. That they cover every normal asset is
 * pinned by the render layers describe below.
 */
describe('OfficeScene: depth-sorting por y (app.js:497-499)', () => {
  it('el contenedor con mayor y queda por delante del de menor y tras update()', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    const remote = findRemoteAvatars(scene)[0];

    // Se mueve al jugador SIN tocar su `depth`: quien reordena es `update()`,
    // y no la profundidad que cada contenedor recibio al crearse.
    player.setPosition(player.x, remote.y - 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeLessThan(remote.depth);
    }, LOOP_WAIT);

    player.setPosition(player.x, remote.y + 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(remote.depth);
    }, LOOP_WAIT);
  });
});

describe('OfficeScene: proximidad y salas (app.js:444-471, cada 250ms)', () => {
  it('emite "room" al entrar a una sala', async () => {
    const bridge = createOfficeBridge();
    const rooms: (string | null)[] = [];
    bridge.on('room', (payload) => rooms.push(payload.name));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms).toContain('Sala de Juntas');
    }, LOOP_WAIT);
  });

  it('el "room" emitido trae el id estable del espacio, no solo el nombre (#7, D2)', async () => {
    const bridge = createOfficeBridge();
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms.some((r) => r.name === 'Sala de Juntas')).toBe(true);
    }, LOOP_WAIT);
    const match = rooms.find((r) => r.name === 'Sala de Juntas');
    expect(match?.spaceId).toBe(BUILT_IN_SPACES[0].id);
  });
});

describe('OfficeScene: audio/video por proximidad (D3, issue #17)', () => {
  it('emite "voice" con los peers reales audibles (sessionId + nombre), sin repetir en tics identicos', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    const countAfterFirstNotification = voices.length;
    // Sin mover a nadie, los proximos tics (250ms cada uno) no deben repetir la
    // notificacion; la ventana se cuenta en reloj de juego, no de pared.
    await advanceGameClock(scene, 600);
    expect(voices.length).toBe(countAfterFirstNotification);
  });

  it('un cruce de sala reemite "voice" aunque el conjunto de pares audibles no cambie', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    // Un par lejano que nunca entra por radio ni por sala en ningun lado del cruce.
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'lejano', x: 5000, y: 5000 }));

    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    const countBeforeCrossing = voices.length;

    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(voices.at(-1)?.spaceId).toBe(BUILT_IN_SPACES[0].id);
    }, LOOP_WAIT);
    expect(voices.length).toBeGreaterThan(countBeforeCrossing);
    // El conjunto audible sigue vacio: la clave de dedupe cambio solo por la sala.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it(
    'D7 asimetria: un par fuera de la sala del jugador queda fuera de "voice" mientras un par ' +
      'DENTRO de la sala si aparece, con su nombre',
    async () => {
      const bridge = createOfficeBridge();
      const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
      bridge.on('voice', (payload) => voices.push(payload));
      const connector = fakeConnector('mi-sesion');

      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Jugador dentro de "Sala de Juntas" (tile (50,2) tamano 13x14 -> dentro en (52,4)).
      player.setPosition(52 * TILE, 4 * TILE);
      // Par legitimo: comparte la misma sala que el jugador -> audible.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'companera-en-sala',
          name: 'Compañera De Sala',
          x: 52 * TILE,
          y: 4 * TILE,
        }),
      );
      // Par excluido: un pixel al oeste del limite de la sala, dentro del radio pero fuera de ella.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'vecina-de-puerta',
          name: 'Vecina De Puerta',
          x: 50 * TILE - 1,
          y: 4 * TILE,
        }),
      );

      await vi.waitFor(() => {
        expect(
          voices.some((v) =>
            v.peers.some((peer) => peer.sessionId === 'companera-en-sala' && peer.name === 'Compañera De Sala'),
          ),
        ).toBe(true);
      }, LOOP_WAIT);

      expect(
        voices.some((v) => v.peers.some((peer) => peer.sessionId === 'vecina-de-puerta')),
      ).toBe(false);
    },
  );
});

describe('OfficeScene: a newcomer is heard as soon as it hears (#185)', () => {
  /** Far from the spawn, so a voice from the spawn position would miss it. */
  const RESTORED_SPACE = { id: 'id-restored-space', name: 'Restored', x: 10 * TILE, y: 10 * TILE, w: 6 * TILE, h: 6 * TILE };
  const insideRestoredSpace = () => remoteSnapshot({ sessionId: 'yo', x: 12 * TILE + 16, y: 12 * TILE + 16 });

  it('joins with the served spaces version when it was emitted before the scene started', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-servida' });

    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });

    await vi.waitFor(() => expect(connector.joinedSpacesVersion()).toBe('version-servida'), LOOP_WAIT);
    // Nothing to correct after the handshake: peers never saw another version.
    expect(connector.sentSpacesVersions).toEqual([]);
  });

  it('sends no voice with a session before the own position is adopted, then voices from the restored one', async () => {
    const connector = fakeConnector('yo', false);
    const bridge = createOfficeBridge();
    const voices: OfficeEventMap['voice'][] = [];
    bridge.on('voice', (voice) => voices.push(voice));
    bridge.emitCommand('spacesconfig', { spaces: [RESTORED_SPACE], version: 'version-servida' });

    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    await advanceGameClock(scene, 600);
    expect(voices.filter((voice) => voice.selfSessionId !== null)).toEqual([]);

    connector.handlers()!.onLocalPosition?.(insideRestoredSpace());

    await vi.waitFor(() => expect(voices.some((voice) => voice.selfSessionId === 'yo')).toBe(true), LOOP_WAIT);
    expect(voices.find((voice) => voice.selfSessionId === 'yo')?.spaceId).toBe(RESTORED_SPACE.id);
  });

  it('waits for the served spaces too when the office waits for its data', async () => {
    const connector = fakeConnector('yo');
    const bridge = createOfficeBridge();
    const voices: OfficeEventMap['voice'][] = [];
    bridge.on('voice', (voice) => voices.push(voice));

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake', connect: connector.connect, waitForOfficeData: true,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    await advanceGameClock(scene, 600);
    expect(voices.filter((voice) => voice.selfSessionId !== null)).toEqual([]);

    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-servida' });

    await vi.waitFor(() => expect(voices.some((voice) => voice.selfSessionId === 'yo')).toBe(true), LOOP_WAIT);
  });

  it('a position reset still voices from the reset position', async () => {
    const connector = fakeConnector('yo');
    const bridge = createOfficeBridge();
    const voices: OfficeEventMap['voice'][] = [];
    bridge.on('voice', (voice) => voices.push(voice));
    bridge.emitCommand('spacesconfig', { spaces: [RESTORED_SPACE], version: 'version-servida' });

    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(voices.some((voice) => voice.selfSessionId === 'yo')).toBe(true), LOOP_WAIT);
    expect(voices.at(-1)?.spaceId).toBeNull();

    connector.handlers()!.onPositionReset?.(remoteSnapshot({ ...insideRestoredSpace(), positionRevision: 1 }));

    expect(voices.at(-1)).toMatchObject({ selfSessionId: 'yo', spaceId: RESTORED_SPACE.id });
  });
});

describe('OfficeScene: authoritative initial position (#148)', () => {
  it('keeps the latest authoritative reset while initial connection completion is delayed', async () => {
    const connector = fakeConnector('yo', false);
    let finish!: () => void;
    const bridge = createOfficeBridge();
    const voices = vi.fn();
    bridge.on('voice', voices);
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => connector.connect(options).then((connection) => new Promise((resolve) => { finish = () => resolve(connection); })),
    });
    await vi.waitFor(() => expect(finish).toBeDefined(), LOOP_WAIT);
    const handlers = connector.handlers()!;
    const latest = remoteSnapshot({ sessionId: 'yo', x: 67 * TILE + 16, y: 49 * TILE + 16, positionRevision: 2 });
    handlers.onPositionReset?.(remoteSnapshot({ ...latest, x: latest.x - TILE, positionRevision: 1 }));
    handlers.onPositionReset?.(latest);
    handlers.onLocalPosition?.(remoteSnapshot({ sessionId: 'yo', x: 300, y: 400 }));
    finish();
    await vi.waitFor(() => expect(findPlayer(scene).x).toBe(latest.x), LOOP_WAIT);
    expect(findPlayer(scene).y).toBe(latest.y);
    expect(voices).toHaveBeenCalled();
  });

  it('publishes a served spaces version that arrives while the initial join is in flight', async () => {
    const connector = fakeConnector();
    let finish!: () => void;
    const { bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => connector.connect(options).then((connection) => new Promise((resolve) => { finish = () => resolve(connection); })),
    });
    await vi.waitFor(() => expect(finish).toBeDefined(), LOOP_WAIT);
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'served-while-joining' });
    expect(connector.sentSpacesVersions).toEqual([]);
    finish();
    await vi.waitFor(() => expect(connector.sentSpacesVersions).toEqual(['served-while-joining']), LOOP_WAIT);
  });
  const restored = () => remoteSnapshot({ sessionId: 'yo', x: 300.5, y: 400.25, facing: 'left' });
  async function boot() {
    const connector = fakeConnector('yo', false);
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', connect: connector.connect, artManifestUrl: null, artUploadsUrl: null,
    });
    scene.game.loop.stop();
    const player = findPlayer(scene);
    const body = player.body as Phaser.Physics.Arcade.Body;
    const movement = scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys; autoWalk?: AutoWalkState };
    let time = scene.time.now;
    const frame = () => scene.game.step(time += 20, 20);
    return { scene, bridge, connector, player, body, movement, frame };
  }

  it('reveals current art only after the authoritative position is rendered (#157)', async () => {
    const connector = fakeConnector('yo', false);
    const bridge = createOfficeBridge();
    const revealed: { x: number; y: number }[] = [];
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake', connect: connector.connect, waitForOfficeData: true, artUploadsUrl: null,
    });
    const player = findPlayer(scene);
    bridge.on('entry', ({ state }) => { if (state === 'ready') revealed.push({ x: player.x, y: player.y }); });
    bridge.emitCommand('spacesconfig', { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION });
    bridge.emitCommand('desks', { desks: [] });
    connector.handlers()!.onLocalAvatar?.('character-p02-beige-blazer');
    await vi.waitFor(() => expect(player.sprite.texture.key).toBe(artSheetKey('character-p02-beige-blazer', 'walk')), LOOP_WAIT);
    await advanceGameClock(scene, 50);
    expect(revealed).toEqual([]);
    expect(connector.sent).toEqual([]);
    connector.handlers()!.onLocalPosition?.(restored());
    await vi.waitFor(() => expect(revealed).toEqual([{ x: 300.5, y: 400.25 }]), LOOP_WAIT);
    expect(connector.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
  });

  it('waits for delayed own state, resets the real body and camera, then publishes from the restored point', async () => {
    const { scene, bridge, connector, player, body, movement, frame } = await boot();
    const spawn = { x: player.x, y: player.y };
    movement.cursors.right.isDown = true;
    bridge.emitCommand('toggleSeat', undefined);
    frame();
    expect({ x: player.x, y: player.y }).toEqual(spawn);
    expect(connector.sent).toEqual([]);
    movement.cursors.right.isDown = false;
    connector.handlers()!.onAdd(remoteSnapshot()); // A peer is not initialization.
    bridge.emitCommand('walkToPeer', { sessionId: 'remota-1' });
    const pointer = { button: 0, camera: scene.cameras.main, x: 10, y: 10,
      worldX: 300, worldY: 400, getDistance: () => 0 };
    scene.input.emit('pointerdown', pointer, []);
    scene.input.emit('pointerup', pointer, []);
    expect(movement.autoWalk).toBeUndefined();
    frame();
    expect(connector.sent).toEqual([]);
    connector.handlers()!.onLocalPosition?.(restored());
    expect({ x: player.x, y: player.y }).toEqual({ x: 300.5, y: 400.25 });
    expect({ x: body.x, y: body.y }).toEqual({ x: physicalBodyRect(player).x, y: physicalBodyRect(player).y });
    expect(body.velocity.length()).toBe(0);
    expect(player.facing).toBe('left');
    expect(scene.cameras.main.scrollX).toBeCloseTo(player.x - scene.cameras.main.width / 2);
    frame();
    expect(connector.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
    movement.cursors.right.isDown = true;
    frame();
    expect(player.x).toBeGreaterThan(300.5);
    expect(player.x).toBeLessThan(310);
    const moved = player.x;
    connector.handlers()!.onLocalPosition?.(restored());
    connector.handlers()!.onChange(restored());
    expect(player.x).toBe(moved);
  });

  it('reinitializes a manual join and ignores delayed callbacks from the previous join', async () => {
    const { scene, bridge, connector, player, movement, frame } = await boot();
    const old = connector.handlers()!;
    old.onLocalPosition?.(restored());
    movement.cursors.right.isDown = true;
    frame();
    scene.input.emit('pointerdown', { button: 0, camera: scene.cameras.cameras[1], x: 5, y: 5 }, []);
    bridge.emitCommand('reconnect', undefined);
    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    const before = connector.sent.length;
    frame();
    expect(connector.sent).toHaveLength(before);
    old.onLocalPosition?.(remoteSnapshot({ x: 900, y: 900 }));
    old.onConnectionState?.('offline');
    connector.handlers()!.onLocalPosition?.(restored());
    expect(player.x).toBe(300.5);
    frame();
    expect(player.x).toBeGreaterThan(300.5);
    expect(scene.cameras.main.scrollX).toBeCloseTo(player.x - scene.cameras.main.width / 2, -1);
  });

  it('leaves an older in-flight join when a newer manual join wins', async () => {
    const first = fakeConnector('old', false);
    const next = fakeConnector('new', false);
    let finishFirst!: () => void;
    let joiningFirst = true;
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => {
        if (!joiningFirst) return next.connect(options);
        joiningFirst = false;
        return first.connect(options).then((connection) => new Promise((resolve) => {
          finishFirst = () => resolve(connection);
        }));
      },
    });
    scene.game.loop.stop();
    bridge.emitCommand('reconnect', undefined);
    await vi.waitFor(() => expect(next.handlers()).toBeDefined(), LOOP_WAIT);
    next.handlers()!.onLocalPosition?.(restored());
    first.handlers()!.onLocalPosition?.(remoteSnapshot({ x: 900, y: 900 }));
    finishFirst();
    await vi.waitFor(() => expect(first.hasLeft()).toBe(true), LOOP_WAIT);
    scene.game.step(scene.time.now + 20, 20);
    expect(findPlayer(scene).x).toBe(300.5);
    expect(first.sent).toEqual([]);
    expect(next.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
  });

  it('waits through automatic reconnect and restores a confirmed seat without an unsolicited stand', async () => {
    const { connector, player, body, movement, frame } = await boot();
    const handlers = connector.handlers()!;
    handlers.onLocalPosition?.(restored());
    handlers.onConnectionState?.('reconnecting');
    movement.cursors.right.isDown = true;
    const before = connector.sent.length;
    frame();
    expect(player.x).toBe(300.5);
    expect(connector.sent).toHaveLength(before);
    movement.cursors.right.isDown = false;
    handlers.onResync?.();
    handlers.onConnectionState?.('connected'); // JOIN_ROOM precedes ROOM_STATE.
    frame();
    expect(connector.sent).toHaveLength(before);
    const seat = BASE_MAP_SEATS[0]!;
    const position = { x: (seat.tx + 0.5) * TILE, y: (seat.ty + 0.5) * TILE - 18 };
    handlers.onLocalPosition?.(remoteSnapshot({ ...position, seat: mapSeatId(0), facing: seat.facing }));
    handlers.onLocalSeat?.(mapSeatId(0));
    frame();
    expect({ x: player.x, y: player.y }).toEqual(position);
    expect(body.checkCollision.none).toBe(true);
    expect(player.seatFacing).toBe(seat.facing);
    expect(connector.stands()).toBe(0);
    expect(connector.sent.at(-1)).toEqual({ ...position, facing: seat.facing });
  });

  it('keeps offline play available after an initial transport failure', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: async () => { throw new Error('unavailable'); },
    });
    scene.game.loop.stop();
    const player = findPlayer(scene);
    const x = player.x;
    (scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys }).cursors.right.isDown = true;
    scene.game.step(scene.time.now + 20, 20);
    expect(player.x).toBeGreaterThan(x);
  });

  it('adopts a restored position from a real Colyseus client before any scene move reaches the server', async () => {
    const commands = (vitestBrowser as unknown as { commands: BrowserCommands }).commands;
    let connection: OfficeConnection | undefined;
    let adopt: (() => void) | undefined;
    try {
      const { endpoint } = await commands.authoritativePositionServer('start');
      const { scene } = await bootOfficeScene(createOfficeBridge(), {
        endpoint, getIdToken: async () => 'verified', artManifestUrl: null, artUploadsUrl: null,
        connect: async (options) => {
          connection = await connectOfficeRoom({ ...options, handlers: {
            ...options.handlers,
            onLocalPosition: (snapshot) => { adopt = () => options.handlers.onLocalPosition?.(snapshot); },
          } });
          return connection;
        },
      });
      await vi.waitFor(() => expect(adopt).toBeDefined(), LOOP_WAIT);
      scene.game.loop.stop();
      const player = findPlayer(scene);
      let time = scene.time.now;
      scene.game.step(time += 20, 20);
      expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position)
        .toEqual({ x: 300.5, y: 400.25 });
      adopt!();
      scene.game.step(time += 20, 20);
      expect({ x: player.x, y: player.y }).toEqual({ x: 300.5, y: 400.25 });
      expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position)
        .toEqual({ x: 300.5, y: 400.25 });
      (scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys }).cursors.right.isDown = true;
      scene.game.step(time += 20, 20);
      await vi.waitFor(async () => expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position?.x)
        .toBeCloseTo(player.x), LOOP_WAIT);
      expect(player.x).toBeGreaterThan(300.5);
      expect(player.x).toBeLessThan(310);
    } finally {
      try { await connection?.leave(); }
      finally { await commands.authoritativePositionServer('stop'); }
    }
  });
});

describe('OfficeScene: avatares reales por Colyseus (PRD 6.2)', () => {
  it('sin endpoint corre en solitario y lo anuncia por el puente', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null });

    // Sin endpoint no hay nada que reintentar, y por eso `canRetry` es falso:
    // ofrecer un boton de reintento en modo solitario seria ofrecer un boton que
    // no puede hacer nada.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: false,
      }),
      LOOP_WAIT,
    );
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('un alta remota dibuja un avatar nuevo en las coordenadas del servidor', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ x: 500, y: 600 }));

    const avatars = findRemoteAvatars(scene);
    expect(avatars).toHaveLength(1);
    expect({ x: avatars[0].x, y: avatars[0].y }).toEqual({ x: 500, y: 600 });
    expect(avatars[0].nameText).toBe('Ana Remota');
  });

  it('no dibuja un clon del jugador local aunque el servidor lo incluya', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: DEFAULT_NAME }));

    // El jugador local ya responde al teclado al instante; su copia remota
    // llegaria con el retardo de la red y se veria como un doble pisandole.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('una baja remota retira el avatar de la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-va' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onRemove('se-va');

    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('emite presence con el numero de companeros conectados', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'a' }));
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'b' }));

    expect(presence.at(-1)).toEqual({
      online: true,
      peers: 2,
      state: 'connected',
      canRetry: true,
    });
  });

  it('si el servidor no responde, la oficina sigue jugable en solitario', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    // Lo que se prueba es que un servidor caido no deja la pantalla en negro:
    // en desarrollo eso seria la mitad del tiempo.
    // Con endpoint configurado SI hay algo que reintentar, aunque el primer
    // intento fallase: el servidor puede estar solo arrancando.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: true,
      }),
      LOOP_WAIT,
    );
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('a refused join is "denied" with its reason, never "offline" (#129)', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new OfficeAccessDeniedError('expired');
      },
    });

    await vi.waitFor(() =>
      expect(presence.at(-1)).toEqual({
        online: false,
        peers: 0,
        state: 'denied',
        reason: 'expired',
        canRetry: true,
      }),
      LOOP_WAIT,
    );
    // "Sin servidor" would send the person to retry against a server that is
    // up and has already said no.
    expect(presence.some((p) => p.state === 'offline' && p.canRetry)).toBe(false);
  });

  it('publica la posicion del jugador local en cada frame', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // El agrupado decide que sale por el cable; la escena publica siempre.
    await vi.waitFor(() => expect(connector.sent.length).toBeGreaterThan(0), LOOP_WAIT);
    expect(connector.sent[0]).toMatchObject({ facing: 'down' });
  });

  it('cierra la conexion al apagar la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);

    // Sin esto, cada remonte de StrictMode dejaria un socket vivo publicando la
    // posicion de un jugador ya destruido.
    await vi.waitFor(() => expect(connector.hasLeft()).toBe(true), LOOP_WAIT);
  });
});

describe('OfficeScene: roster de personas conectadas via el puente (#74)', () => {
  it('un alta remota emite "roster" con ese par', async () => {
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }));

    expect(roster.at(-1)).toEqual({
      peers: [{ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }],
    });
  });

  it('no incluye al propio jugador aunque el servidor lo repita en el estado (mismo ignoreSessionId que los avatares)', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: DEFAULT_NAME }));

    expect(roster).toHaveLength(0);
  });

  it('una baja remota emite "roster" sin ese par', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-va', name: 'Se Va' }));
    await vi.waitFor(() => expect(roster.at(-1)?.peers).toHaveLength(1), LOOP_WAIT);

    connector.handlers()!.onRemove('se-va');

    expect(roster.at(-1)).toEqual({ peers: [] });
  });

  it('un onChange de solo posicion no reemite "roster"', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }));
    const emissionsAfterAdd = roster.length;

    connector.handlers()!.onChange(
      remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g', x: 999, y: 999 }),
    );

    expect(roster).toHaveLength(emissionsAfterAdd);
  });
});

describe('OfficeScene: drift de spacesVersion entre pares (#74, PR3a)', () => {
  it('un alta con una version distinta de la mia emite "spacesstale" con esa version', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });

  it('la MISMA version que la mia no emite nada: nadie esta desacompasado', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    // `remoteSnapshot()` por defecto ya lleva `BUILT_IN_SPACES_VERSION`, la
    // misma con la que arranca la escena.
    connector.handlers()!.onAdd(remoteSnapshot());

    expect(stale).toHaveLength(0);
  });

  it('un onChange con version distinta TAMBIEN emite: cubre la edicion de un par ya conectado', async () => {
    // Una edicion desde /dashboard o desde el editor en oficina desacompasa a
    // un par YA conectado -- su alta ya paso, asi que solo un onChange puede
    // avisar de esto.
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));

    connector.handlers()!.onChange(remoteSnapshot({ sessionId: 'par-1', spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });

  it('una version ya vista no vuelve a emitir, la reporte el mismo par o uno distinto', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', spacesVersion: 'version-editada' }));

    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'par-2', spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });
});

describe('OfficeScene: comando setStatus via el puente (#1)', () => {
  it('repinta el punto de estado del jugador local', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR[DEFAULT_STATUS]);

    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe('r');
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR.r);
  });

  it('publica el estado nuevo al servidor', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'y' });

    expect(connector.statuses).toEqual(['y']);
  });

  it('corta el audio al instante, sin esperar al siguiente tic de proximidad', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });

    // Sin esperar nada: un "No molestar" que tarda un cuarto de segundo en
    // cortar el audio no es un corte, es un retraso.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it('un par que pasa a "No molestar" deja de ser audible en el siguiente tic', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    connector
      .handlers()!
      .onChange(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y, status: 'r' }));

    await vi.waitFor(() => {
      expect(voices.at(-1)?.peers).toEqual([]);
    }, LOOP_WAIT);
  });

  it('el mismo estado dos veces no vuelve a publicarlo', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(connector.statuses).toEqual(['r']);
  });

  it('el join lleva el estado actual del jugador, no un valor fijo', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedWith()).toBe(DEFAULT_STATUS), LOOP_WAIT);
  });

  it('el join lleva la version de config de espacios fallback (#7, D4)', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // Sin `spacesVersion` en las opciones la escena publica la constante
    // fallback, que es el camino de la oficina en solitario y el de un
    // despliegue sin `DATABASE_URL`: todos sus clientes caen en el mismo valor
    // y por tanto siguen de acuerdo.
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );
  });

  it('un cambio de estado mientras la conexion esta en vuelo no se pierde', async () => {
    const bridge = createOfficeBridge();
    const statuses: PresenceStatus[] = [];
    let joinedWith: PresenceStatus | undefined;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const connection: OfficeConnection = {
      sessionId: 'mi-sesion',
      sendMove: () => {},
      sendStatus: (status) => statuses.push(status),
      sendSpacesVersion: () => {},
      sendCall: () => {},
      sendCallRespond: () => {},
      sendSit: () => {},
      sendStand: () => {},
      sendLock: () => {},
      sendUnlock: () => {},
      leave: async () => {},
    };

    await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async (options: ConnectOfficeRoomOptions) => {
        joinedWith = options.status;
        await gate;
        return connection;
      },
    });

    bridge.emitCommand('setStatus', { status: 'r' });
    openGate();

    // El join ya habia salido con el estado viejo: si nadie reconcilia al
    // aterrizar, el servidor nos publica "En linea" habiendo pedido "No
    // molestar", y el aislamiento local no se nota desde fuera.
    await vi.waitFor(() => expect(statuses).toEqual(['r']), LOOP_WAIT);
    expect(joinedWith).toBe(DEFAULT_STATUS);
  });

  it('desuscribe el handler de setStatus al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe(DEFAULT_STATUS);
  });
});

describe('OfficeScene: comando speakers via el puente (issue #17, D7 -- habla real enciende el anillo)', () => {
  it('enciende el anillo de un avatar remoto real cuando su sessionId reporta estar hablando', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    expect(avatar.ring.visible).toBe(false);

    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(true);
  });

  it('apaga el anillo cuando su sessionId deja de aparecer en el conjunto reportado', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });
    expect(avatar.ring.visible).toBe(true);

    bridge.emitCommand('speakers', { sessionIds: [] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('un sessionId ajeno en el comando no enciende avatares que no coinciden', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    bridge.emitCommand('speakers', { sessionIds: ['alguien-mas'] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('desuscribe el handler de speakers al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(false);
  });

  // #181: the local player's own ring lights up while they speak, like a peer's.
  it('lights the local player ring when its own sessionId is speaking, and turns it off with an empty set', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    expect(player.ring.visible).toBe(false);

    bridge.emitCommand('speakers', { sessionIds: ['mi-sesion'] });
    expect(player.ring.visible).toBe(true);

    bridge.emitCommand('speakers', { sessionIds: [] });
    expect(player.ring.visible).toBe(false);
  });

  it('keeps the local player ring off when only a peer is speaking', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));

    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(findPlayer(scene).ring.visible).toBe(false);
  });
});

describe('OfficeScene: retratos fieles exportados una vez desde create() (issue #17, D1)', () => {
  it('emite "portraits" una sola vez con una URL de datos PNG decodificable por cada clave base', async () => {
    const bridge = createOfficeBridge();
    const events: { byKey: Record<string, string> }[] = [];
    bridge.on('portraits', (payload) => events.push(payload));

    await bootOfficeScene(bridge);

    expect(events).toHaveLength(1);
    const { byKey } = events[0];
    const expectedKeys = [...AVATAR_KEYS, PLAYER_TEXTURE].sort();
    expect(Object.keys(byKey).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      const dataUrl = byKey[key];
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(atob(dataUrl.split(',')[1]).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Issue #2, unit 12 (kill switch final de la cadena, D3/D9/D10). Como el
 * resto de este archivo, **no puede ejecutarse en este entorno**
 * (`chrome-headless-shell` sin `libglib-2.0.so.0`, mismo fallo que arrastra
 * toda la cadena desde PR3). Escrito y verificado a mano contra la
 * implementacion, no contra una corrida verde -- mismo precedente que la
 * unit 8 en PR3.
 */
describe('OfficeScene: comandos de llamada via el puente (issue #2, D3)', () => {
  it('el comando callPeer reenvia el sessionId al transporte (connection.sendCall)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual(['peer-1']);
  });

  it('el comando respondCall reenvia {from,accept} al transporte (connection.sendCallRespond)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });

    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: false }]);
  });

  it('sin conexion activa, los comandos de llamada no lanzan (oficina en solitario)', async () => {
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: null });

    expect(() => bridge.emitCommand('callPeer', { sessionId: 'peer-1' })).not.toThrow();
    expect(() => bridge.emitCommand('respondCall', { from: 'x', accept: true })).not.toThrow();
    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' })).not.toThrow();
  });

  it('desuscribe los tres handlers de llamada al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });
    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual([]);
    expect(connector.respondedCalls).toEqual([]);
  });
});

describe('OfficeScene: mensajes de llamada del servidor se relanzan al puente (issue #2, D4)', () => {
  it('onCallInvite del transporte se relanza como "callinvite"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string; name: string }[] = [];
    bridge.on('callinvite', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallInvite?.({ from: 'caller-1', name: 'Diego Soto' });

    expect(events).toEqual([{ from: 'caller-1', name: 'Diego Soto' }]);
  });

  it('forwards transport desk invalidation to the bridge without changing geometry', async () => {
    const bridge = createOfficeBridge();
    const changed = vi.fn();
    bridge.on('deskschanged', changed);
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://office', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onDesksChanged?.();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('forwards transport space invalidation to the bridge (#183)', async () => {
    const bridge = createOfficeBridge();
    const changed = vi.fn();
    bridge.on('spaceschanged', changed);
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://office', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onSpacesChanged?.();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('onCallerLeft del transporte se relanza como "callerleft"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string }[] = [];
    bridge.on('callerleft', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallerLeft?.({ from: 'caller-1' });

    expect(events).toEqual([{ from: 'caller-1' }]);
  });

  it('onCallAccepted del transporte se relanza como "callaccepted"', async () => {
    const bridge = createOfficeBridge();
    const events: { by: string; name: string }[] = [];
    bridge.on('callaccepted', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallAccepted?.({ by: 'peer-1', name: 'Marta Ríos' });

    expect(events).toEqual([{ by: 'peer-1', name: 'Marta Ríos' }]);
  });

  it('onRecordings and onRecordingReady are forwarded as "recordings" and "recordingready" (#5, #58)', async () => {
    const bridge = createOfficeBridge();
    const events: unknown[] = [];
    bridge.on('recordings', (payload) => events.push(payload));
    bridge.on('recordingready', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onRecordings?.({ sala: { startedBy: 'ses-1', startedAt: 1 } });
    connector.handlers()!.onRecordingReady?.({ recordingId: 'rec-1', spaceId: 'sala', availableUntil: 2 });

    expect(events).toEqual([
      { active: { sala: { startedBy: 'ses-1', startedAt: 1 } } },
      { recordingId: 'rec-1', spaceId: 'sala', availableUntil: 2 },
    ]);
  });
});

describe('OfficeScene: auto-caminata al aceptar una llamada (issue #2, D9/D10)', () => {
  it(
    'walkToPeer mueve al jugador junto al peer y LO DEJA QUIETO ahi -- regresion ' +
      'directa de la trampa de renormalizar la velocidad del reductor (ver discovery ' +
      '"update() renormaliza la velocidad del reductor"): normalize().scale() la ' +
      'reescala a una magnitud constante y el jugador oscilaria alrededor del ' +
      'destino sin llegar nunca. Si alguien reintroduce esa renormalizacion en el ' +
      'camino de autoWalk, la velocidad jamas se asienta en (0,0) y esta prueba no ' +
      'converge (timeout en el primer `vi.waitFor`, o la posicion sigue derivando en ' +
      'el segundo chequeo).',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Zona abierta del cesped, lejos del jugador y de cualquier colisionador.
      (player.body as Phaser.Physics.Arcade.Body).reset(22 * TILE + 16, 28 * TILE + 16);
      const peerX = 30 * TILE;
      const peerY = 30 * TILE;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      await vi.waitFor(() => {
        const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
        expect(d).toBeLessThanOrEqual(TILE * 1.5);
      }, LOOP_WAIT);

      const body = player.body as Phaser.Physics.Arcade.Body;
      await vi.waitFor(() => {
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      // Asentado de verdad, no solo un cruce momentaneo de la ventana de
      // ARRIVE_EPSILON_PX: la posicion no debe seguir derivando cuadros despues.
      const settledX = player.x;
      const settledY = player.y;
      await advanceGameClock(scene, 300);
      expect(player.x).toBe(settledX);
      expect(player.y).toBe(settledY);
    },
    20000,
  );

  it('un toque de WASD durante la auto-caminata cancela y devuelve el control al instante', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 30 * TILE, y: 30 * TILE }));
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    // Deja que la auto-caminata arranque de verdad antes de interrumpirla.
    await vi.waitFor(() => {
      const body = player.body as Phaser.Physics.Arcade.Body;
      expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
    }, LOOP_WAIT);

    dispatchKey('keydown', KEY.RIGHT);
    try {
      // D10: el mismo cuadro que lee la tecla ya se mueve bajo velocidad de
      // teclado -- esa lectura ES la cancelacion, sin listener aparte.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBeGreaterThan(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('aceptar una llamada (respondCall accept:true) dispara la misma auto-caminata que walkToPeer', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const peerX = 30 * TILE;
    const peerY = 30 * TILE;
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: peerX, y: peerY }));
    const startDistance = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });

    await vi.waitFor(() => {
      const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
      expect(d).toBeLessThan(startDistance);
    }, LOOP_WAIT);
    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: true }]);
  });

  it('pasar una llamada (respondCall accept:false) NO mueve al jugador', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: 30 * TILE, y: 30 * TILE }));
    const startX = player.x;
    const startY = player.y;

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it('walkToPeer sobre un sessionId desconocido no hace nada (peer ya desconectado)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const startX = player.x;
    const startY = player.y;

    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'fantasma' })).not.toThrow();
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it(
    'el destino respeta el espacio de quien llama (issue #10, S2 3.2): el jugador aterriza ' +
      'DENTRO del rectangulo servido, no solo cerca del peer -- regresion directa de usar ' +
      'findFreeAdjacentTile sin el rectangulo, que aterrizaria fuera de un espacio cuando el ' +
      'primer offset del peer cae al otro lado del borde',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);

      // Cubiculo 3x3 en cesped abierto, lejos de cualquier colisionador del
      (player.body as Phaser.Physics.Arcade.Body).reset(22 * TILE + 16, 28 * TILE + 16);
      // mapa base (mismas tiles que `terrainGrid.test.ts`).
      const rect = { x0: 30, y0: 30, x1: 32, y1: 32 };
      const cubiculo = {
        id: 'desk-borde',
        name: 'Escritorio de Borde',
        x: rect.x0 * TILE,
        y: rect.y0 * TILE,
        w: (rect.x1 - rect.x0 + 1) * TILE,
        h: (rect.y1 - rect.y0 + 1) * TILE,
      };
      bridge.emitCommand('spacesconfig', { spaces: [cubiculo], version: 'version-cubiculo' });

      // El peer esta en el borde DERECHO del cubiculo: su primer
      // ADJACENT_OFFSETS ([1,0]) cae en (33,31), fuera del rectangulo. Sin la
      // restriccion de espacio, `findFreeAdjacentTile` aterrizaria ahi mismo.
      const peerX = rect.x1 * TILE + 16;
      const peerY = 31 * TILE + 16;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      // Primero confirma que la auto-caminata REALMENTE arranco (velocidad
      // distinta de cero en algun momento) antes de esperar a que se asiente:
      // sin este chequeo intermedio, un `walkToPeer` que aborta temprano
      // (peer no encontrado, destino null) pasaria el chequeo de asentado de
      // forma trivial -- la velocidad ya es (0,0) en reposo desde el inicio.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
      }, LOOP_WAIT);

      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      const landedTx = Math.floor(player.x / TILE);
      const landedTy = Math.floor(player.y / TILE);
      expect(landedTx).toBeGreaterThanOrEqual(rect.x0);
      expect(landedTx).toBeLessThanOrEqual(rect.x1);
      expect(landedTy).toBeGreaterThanOrEqual(rect.y0);
      expect(landedTy).toBeLessThanOrEqual(rect.y1);
    },
    20000,
  );
});
