import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterContainer } from './characters';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE } from './mapData';
import {
  LEGACY_LAYOUT as BASE_LAYOUT,
  LEGACY_SEATS as BASE_MAP_SEATS,
  LEGACY_SPACES as BUILT_IN_SPACES,
} from '../test/legacyOffice';
import {
  DESK_ZONE_DEPTH,
  LAYOUT_OUTLINE_DEPTH,
  SPACE_SHADE_DEPTH,
  MINIMAP_MARKER_DEPTH,
  avatarDepth,
  worldAssetDepth,
} from './depthLayers';
import { feetOf } from './avatarGeometry';
import { mapSeatId } from './seating';
import { deskZoneName } from './deskLayout';
import { SPACE_SHADE_NAME } from './spaceFocus';
import { LAYOUT_OUTLINE_NAME, layoutPickName } from './LayoutEditLayer';
import { artSheetKey, recoloredSheetKey } from './artPack';
import type { DeskOccupant, OfficeDesk } from './desksPort';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { DEFAULT_NAME } from './officeProtocol';
import { OfficeScene } from './OfficeScene';
import { SIT_AGAIN_SAME_MS, SIT_IDLE_MS, SIT_LOCK_MS } from './autoSit';
import {
  destroyOfficeGames,
  movementArena,
  LOOP_WAIT,
  advanceGameClock,
  settleCamera,
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

describe('OfficeScene: nombre real del usuario local (#6)', () => {
  it('la pildora del jugador local lleva el nombre de la sesion', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { playerName: 'Ana Torres' });

    expect(findPlayer(scene).nameText).toBe('Ana Torres');
  });

  it('sin nombre de sesion el jugador local cae en DEFAULT_NAME, no en el de una persona', async () => {
    const { scene } = await bootOfficeScene();

    // Desarrollo local, e2e y la oficina sin autenticacion comparten este
    // camino: la escena llama al usuario como lo llama el servidor.
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('entra a la sala de Colyseus con ese mismo nombre', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
      playerName: 'Ana Torres',
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBe('Ana Torres'), LOOP_WAIT);
  });

  it('sin nombre de sesion entra a la sala con el de la pildora, no con undefined', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBeDefined(), LOOP_WAIT);
    expect(connector.joinedName()).toBe(findPlayer(scene).nameText);
  });

  it('el tile de video propio se etiqueta con el mismo nombre que la pildora', async () => {
    const bridge = createOfficeBridge();
    const voices: { selfName: string }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null, playerName: 'Ana Torres' });

    // `emitVoice` lee la pildora: si la pildora deja de ser la sesion, el tile
    // propio se va con ella. Se comprueban juntas para que no se separen.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    expect(voices.at(-1)?.selfName).toBe('Ana Torres');
    expect(voices.at(-1)?.selfName).toBe(findPlayer(scene).nameText);
  });
});

/**
 * La config servida llegando a la escena (#7, slice 3). Quien la LEE es
 * `spacesConfig.ts` y quien la resuelve es `useSpacesConfig`, ambos probados
 * sin Phaser. Lo que falta cubrir aqui es que, una vez dentro, gobierne de
 * verdad la pertenencia y se anuncie a los pares.
 *
 * Entra por COMANDO y no por opcion de construccion: llega despues de que
 * Phaser arranque, porque la escena no puede esperar a un viaje de red para
 * existir.
 */
describe('OfficeScene: config de espacios servida (#7, slice 3)', () => {
  /** Un espacio que NO existe en `BUILT_IN_SPACES`, en pixeles y sobre el spawn. */
  const SERVIDO = {
    id: 'id-espacio-servido',
    name: 'Espacio Servido',
    x: (PLAYER_SPAWN_TX - 2) * TILE,
    y: (PLAYER_SPAWN_TY - 2) * TILE,
    w: 6 * TILE,
    h: 6 * TILE,
  };

  it('tras el comando deriva la pertenencia de los espacios servidos', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    // El jugador nace dentro de `SERVIDO`, que no es ninguna de las dos salas
    // incorporadas: sin adoptar la config, el spawn caeria en piso abierto y
    // este evento no llegaria nunca.
    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)?.spaceId).toBe(SERVIDO.id), LOOP_WAIT);
  });

  function visibleShade(scene: Phaser.Scene): Phaser.GameObjects.Rectangle[] {
    return scene.children.list.filter(
      (child) => child.name === SPACE_SHADE_NAME && (child as Phaser.GameObjects.Rectangle).visible,
    ) as Phaser.GameObjects.Rectangle[];
  }

  it('shades everything outside the space the player stands in, never the space itself', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'sombra' });
    await advanceGameClock(scene, 100);

    const shade = await vi.waitFor(() => {
      const rects = visibleShade(scene);
      expect(rects.length).toBeGreaterThan(0);
      return rects;
    }, LOOP_WAIT);
    for (const rect of shade) {
      expect(rect.depth).toBe(SPACE_SHADE_DEPTH);
      expect(rect.fillAlpha).toBeGreaterThan(0);
      expect(rect.fillAlpha).toBeLessThan(0.5);
      const bounds = rect.getBounds();
      const overlapsSpace = bounds.x < SERVIDO.x + SERVIDO.w && bounds.right > SERVIDO.x &&
        bounds.y < SERVIDO.y + SERVIDO.h && bounds.bottom > SERVIDO.y;
      expect(overlapsSpace).toBe(false);
    }
  });

  it('draws no shade on the open floor', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('spacesconfig', { spaces: [{ ...SERVIDO, x: SERVIDO.x + 40 * TILE }], version: 'lejos' });
    await advanceGameClock(scene, 100);

    expect(visibleShade(scene)).toEqual([]);
  });

  it('names the cubicle of an empty desk "Escritorio": it has no label (Editar espacios)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    bridge.emitCommand('spacesconfig', { spaces: [{ ...SERVIDO, name: '' }], version: 'cubiculo' });

    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)).toEqual({ spaceId: SERVIDO.id, name: 'Escritorio' }), LOOP_WAIT);
  });

  it('adopts a config that arrived before the scene finished loading (#144)', async () => {
    // React emits the served config as soon as `/spaces` answers, which can
    // be before `preload()` is done with the art pack. Lost, the scene kept the
    // built-in rooms for the whole session and every space token was refused.
    const bridge = createOfficeBridge();
    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    const { scene } = await bootOfficeScene(bridge);

    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)?.spaceId).toBe(SERVIDO.id), LOOP_WAIT);
  });

  it('anuncia la version nueva a los pares con sendSpacesVersion', async () => {
    // Es la mitad que hace util al predicado mutuo: un cliente que cambia de
    // config tiene que DECIRLO, o el resto seguira creyendo que coinciden.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION), LOOP_WAIT);

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    await vi.waitFor(() => expect(connector.sentSpacesVersions).toContain('version-servida'), LOOP_WAIT);
  });

  it('una config cuya version ya es la vigente no se reenvia', async () => {
    // El caso normal de un despliegue sin editar: lo servido coincide con lo
    // incorporado. Un mensaje por sesion que no dice nada nuevo es ruido.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );

    bridge.emitCommand('spacesconfig', {
      spaces: BUILT_IN_SPACES,
      version: BUILT_IN_SPACES_VERSION,
    });
    await advanceGameClock(scene, 400);

    expect(connector.sentSpacesVersions).toEqual([]);
  });

  it('a served space, a desk cubicle included, leaves the painted terrain visible: no floor tiles nor veil (#182)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    // An older server still serves the floor columns; the scene draws none of them.
    const withFloor = { ...SERVIDO, floor: { materialId: 'floor-plain', color: '#2c3e50' } } as typeof SERVIDO;
    const cubicle = { ...withFloor, id: 'cubiculo', x: 0, floor: { materialId: 'floor-wood', color: null } } as typeof SERVIDO;
    // The shade outside the player's space is drawn around it, never on it (`spaceFocus.ts`).
    const drawn = () => scene.children.list.filter((child) => child.name !== SPACE_SHADE_NAME).length;
    const before = drawn();

    bridge.emitCommand('spacesconfig', { spaces: [withFloor, cubicle], version: 'version-servida' });
    await advanceGameClock(scene, 100);

    const floorKeys = [recoloredSheetKey('floor-plain', 'sheet', '#2c3e50'), artSheetKey('floor-wood', 'sheet')];
    expect(scene.children.list.filter((c) => c.type === 'Image'
      && floorKeys.includes((c as Phaser.GameObjects.Image).texture.key))).toHaveLength(0);
    expect(drawn()).toBe(before);
  });

  it('una lista servida vacia deja al jugador en piso abierto', async () => {
    // Un despliegue con la tabla vacia es legitimo. La escena no puede
    // degradar a los incorporados: derivaria pertenencia de rectangulos que el
    // servidor no tiene.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-vacia' });
    const rooms: { spaceId: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    // Varios tics de proximidad (250ms cada uno) de reloj de JUEGO.
    await advanceGameClock(scene, 800);

    expect(rooms.every((room) => room.spaceId === null)).toBe(true);
  });
});

/**
 * Los escritorios asignables llegando a la escena (#7, slice 5). Quien los LEE
 * es `desksClient.ts` y quien los resuelve es `useDesks`, ambos probados sin
 * Phaser. Lo que falta cubrir aqui es el DIBUJO y el clic: que cada zona de
 * 3x3 aparece donde toca, que la decoracion de su ocupante cae en su caja, que
 * el propio se distingue del ajeno y que solo se puede clicar lo que es de uno
 * o lo que esta libre.
 *
 * Entran por COMANDO y no por opcion de construccion, misma razon que
 * `spacesconfig`: llegan despues de que Phaser arranque, porque la escena no
 * puede esperar a un viaje de red para existir.
 */
describe('OfficeScene: escritorios asignables (#7, slice 5)', () => {
  function servedDesk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
    return {
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
      ...overrides,
    };
  }

  function occupant(displayName: string | null): DeskOccupant {
    return { id: `id-${displayName ?? 'anonimo'}`, displayName };
  }

  function findZone(scene: Phaser.Scene, deskId: string): Phaser.GameObjects.Rectangle | null {
    return scene.children.getByName(deskZoneName(deskId)) as Phaser.GameObjects.Rectangle | null;
  }

  /**
   * A free desk at the bottom left of the main camera's view. The test canvas
   * is small and the minimap covers most of it: only the bottom rows of the
   * desk (`bottomOf`) are under the main camera alone.
   */
  async function deskInView(scene: Phaser.Scene): Promise<OfficeDesk> {
    await settleCamera(scene);
    const view = scene.cameras.main.worldView;
    return servedDesk({ x: Math.round(view.x + 8), y: Math.round(view.bottom - 3 * TILE - 4) });
  }

  function bottomOf(desk: OfficeDesk, dx = 4): { x: number; y: number } {
    return { x: desk.x + dx, y: desk.y + desk.h - 4 };
  }

  /** Moves the mouse over the main camera to a world point, as Phaser would. */
  function pointAt(scene: Phaser.Scene, world: { x: number; y: number }): void {
    const camera = scene.cameras.main;
    scene.input.activePointer.position.set(
      camera.x + (world.x - camera.worldView.x) * camera.zoom,
      camera.y + (world.y - camera.worldView.y) * camera.zoom,
    );
    scene.input.emit('pointermove', scene.input.activePointer);
  }

  function countZones(scene: Phaser.Scene): number {
    return scene.children.list.filter((child) => child.name.startsWith('desk:')).length;
  }

  it('arranca sin ningun escritorio asignable: nadie espera a la red', async () => {
    // La escena existe antes que la respuesta de `/desks`, igual que existe
    // antes que la de `/spaces`.
    const { scene } = await bootOfficeScene();

    expect(countZones(scene)).toBe(0);
  });

  it('tras el comando dibuja la zona de 3x3 de cada escritorio, en pixeles del mundo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const zone = findZone(scene, 'id-mesa');
    expect(zone).not.toBeNull();
    // Origen arriba a la izquierda, 96x96: el rectangulo de Phaser se ancla en
    // su centro, asi que la esquina es centro menos medio lado.
    expect(zone!.x - zone!.width / 2).toBe(10 * TILE);
    expect(zone!.y - zone!.height / 2).toBe(12 * TILE);
    expect(zone!.width).toBe(3 * TILE);
    expect(zone!.height).toBe(3 * TILE);
  });

  it('no toca los 39 escritorios del mapa base: son mobiliario, no sitios que se cojan', async () => {
    // The base desks are 2x1 props of the layout. Un escritorio asignable se
    // dibuja ENCIMA: es config servida, no parte del mapa base.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const deskCount = BASE_LAYOUT.props.filter((prop) => prop.kind === 'desk').length;

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const baseDesks = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image =>
        c.type === 'Image' &&
        (c as Phaser.GameObjects.Image).texture.key === artSheetKey('desk-wood', 'sheet') &&
        !c.name.startsWith('desk-furniture:'),
    );
    expect(baseDesks).toHaveLength(deskCount);
  });

  it('an empty desk is just its zone marker: no built-in table, no fixed chair (Editar espacios)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const before = new Set(scene.children.list);

    bridge.emitCommand('desks', { desks: [servedDesk({ label: '' })] });

    const added = scene.children.list.filter((child) => !before.has(child));
    expect(added.filter((child) => child.name !== '').map((child) => child.name)).toEqual([deskZoneName('id-mesa')]);
    const furniture = added.filter(
      (child) => child.type === 'Image' && /^art:(desk|chair)-/.test((child as Phaser.GameObjects.Image).texture.key),
    );
    expect(furniture).toEqual([]);
    expect(added.filter((child) => child.type === 'Text')).toEqual([]);
  });

  it('an older desk keeps drawing its label', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const before = new Set(scene.children.list);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const texts = scene.children.list.filter((child) => !before.has(child) && child.type === 'Text') as Phaser.GameObjects.Text[];
    expect(texts.map((text) => text.text)).toEqual(['Mesa 4']);
  });

  it('no desk carries a tint: free, own or someone else\'s', async () => {
    // Cual es el propio lo dice el SERVIDOR (`mine`), que es quien sabe quien
    // pregunta. La escena lo lee, no lo deduce.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'mia', occupant: occupant('Ana Torres'), mine: true }),
        servedDesk({ id: 'ajena', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    // Being inside a desk shades the rest, and hovering it says whose it is.
    for (const id of ['mia', 'ajena']) {
      expect(findZone(scene, id)!.isFilled).toBe(false);
      expect(findZone(scene, id)!.isStroked).toBe(false);
    }
  });

  it('a free desk and a taken one both draw without a tint', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'libre' }),
        servedDesk({ id: 'ocupada', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    // Its hover banner says it is free.
    for (const id of ['libre', 'ocupada']) {
      expect(findZone(scene, id)!.isFilled).toBe(false);
      expect(findZone(scene, id)!.isStroked).toBe(false);
    }
  });

  it('la profundidad es el borde inferior, misma convencion que el mobiliario del mapa', async () => {
    // `placeFurniture` uses `(y + h) * TILE` for every piece, so the desk
    // y-sorts against the furniture around it inside the world band. Avatars
    // no longer depend on this: they live in their own band above it (#70).
    // The zone itself is a floor marker since step 6, so it never veils the
    // desk's sitter.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const label = scene.children.list.find((child) => child.type === 'Text' && (child as Phaser.GameObjects.Text).text === 'Mesa 4')!;
    expect((label as Phaser.GameObjects.Text).depth).toBe(12 * TILE + 3 * TILE);
    expect(findZone(scene, 'id-mesa')!.depth).toBe(DESK_ZONE_DEPTH);
  });

  it('no zone takes the pointer, so a double click still walks onto any desk', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'libre' }),
        servedDesk({ id: 'mia', x: 20 * TILE, occupant: occupant('Ana Torres'), mine: true }),
        servedDesk({ id: 'ajena', x: 30 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    for (const id of ['libre', 'mia', 'ajena']) expect(findZone(scene, id)!.input).toBeNull();
  });

  it('with the pointer over a desk, says which one and where its top edge is on the page', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const hovers: OfficeEventMap['deskhover'][] = [];
    bridge.on('deskhover', (payload) => hovers.push(payload));
    const desk = await deskInView(scene);
    bridge.emitCommand('desks', { desks: [desk] });

    pointAt(scene, bottomOf(desk));
    await advanceGameClock(scene, 50);

    const hover = hovers.at(-1)!;
    expect(hover?.deskId).toBe(desk.id);
    const camera = scene.cameras.main;
    const canvas = scene.game.canvas.getBoundingClientRect();
    expect(hover!.x).toBe(Math.round(canvas.left + (desk.x + desk.w / 2 - camera.worldView.x) * camera.zoom));
    expect(hover!.y).toBe(Math.round(canvas.top + (desk.y - camera.worldView.y) * camera.zoom));
  });

  it('says null once the pointer leaves the desk, and only once', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const hovers: OfficeEventMap['deskhover'][] = [];
    bridge.on('deskhover', (payload) => hovers.push(payload));
    const desk = await deskInView(scene);
    bridge.emitCommand('desks', { desks: [desk] });
    pointAt(scene, bottomOf(desk));
    await advanceGameClock(scene, 50);

    pointAt(scene, bottomOf(desk, desk.w + 4));
    await advanceGameClock(scene, 100);

    expect(hovers.filter((hover) => hover === null)).toHaveLength(1);
    expect(hovers.at(-1)).toBeNull();
  });

  it('a pointer over the minimap hovers no desk (#98)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const hovers: OfficeEventMap['deskhover'][] = [];
    bridge.on('deskhover', (payload) => hovers.push(payload));
    const minimap = scene.cameras.cameras[1];
    const camera = scene.cameras.main;
    // A desk under the middle of the minimap, in the main camera's world.
    const under = camera.getWorldPoint(minimap.x + minimap.width / 2, minimap.y + minimap.height / 2);
    bridge.emitCommand('desks', { desks: [servedDesk({ x: under.x - 48, y: under.y - 48 })] });

    scene.input.activePointer.position.set(minimap.x + minimap.width / 2, minimap.y + minimap.height / 2);
    scene.input.emit('pointermove', scene.input.activePointer);
    await advanceGameClock(scene, 50);

    expect(hovers).toEqual([]);
  });

  it('hovers nothing until the pointer moves onto the map, and nothing once it leaves the canvas', async () => {
    // Phaser starts the pointer at (0, 0) and calls it "over" the canvas: a
    // desk under that corner must not show its banner on load.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const hovers: OfficeEventMap['deskhover'][] = [];
    bridge.on('deskhover', (payload) => hovers.push(payload));
    await settleCamera(scene);
    const view = scene.cameras.main.worldView;
    const corner = servedDesk({ x: Math.floor(view.x) - 8, y: Math.floor(view.y) - 8 });
    bridge.emitCommand('desks', { desks: [corner] });

    await advanceGameClock(scene, 50);
    expect(hovers).toEqual([]);

    scene.input.emit('pointermove', scene.input.activePointer);
    await advanceGameClock(scene, 50);
    expect(hovers.at(-1)?.deskId).toBe(corner.id);

    scene.input.emit('gameout');
    await advanceGameClock(scene, 50);
    expect(hovers.at(-1)).toBeNull();
  });

  it('una lista nueva reemplaza a la anterior en vez de acumularse encima', async () => {
    // Cada refresco trae el estado COMPLETO, no un delta: quien solto su sitio
    // tiene que dejar de verse ocupado, y dibujar encima lo dejaria pintado.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'primera' })] });
    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'segunda' })] });

    expect(countZones(scene)).toBe(1);
    expect(findZone(scene, 'primera')).toBeNull();
    expect(findZone(scene, 'segunda')).not.toBeNull();
  });

  it('una lista vacia deja la oficina sin escritorios asignables y sin tocar nada mas', async () => {
    // Es el despliegue sin directorio configurado, donde `/desks` responde 503
    // y el cliente degrada a no pintar ninguno. Todo lo demas sigue igual.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    bridge.emitCommand('desks', { desks: [] });

    expect(countZones(scene)).toBe(0);
    expect(findPlayer(scene)).toBeDefined();
  });

  it('desuscribe el handler de desks al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(countZones(scene)).toBe(0);
  });
});

/**
 * Cableado de la reconexion en la escena (issue #52). El viaje por cable ya lo
 * cubre `officeRoomClient.node.test.ts` contra un Colyseus real; lo que se
 * prueba aqui es lo que la escena TIENE que hacer cuando ese viaje termina
 * bien: tirar los avatares viejos y, sobre todo, dejar que el audio vuelva.
 */
describe('OfficeScene: reconexion (issue #52)', () => {
  it('un resync vacia el registro: el replay de la sala nueva es quien repuebla', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-fue-durante-la-caida' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onResync!();

    // Quien se haya ido mientras duraba la caida no tiene `onRemove` que lo
    // retire: ese borrado ocurrio en una sala que ya no existe. Si no se vacia
    // aqui, se queda pintado para siempre.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('tras un resync el audio vuelve a emitirse aunque el conjunto de pares sea identico', async () => {
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
    const audible = () => remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y });
    connector.handlers()!.onAdd(audible());

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);
    const emitidosAntes = voices.length;

    // Resync y replay en la MISMA vuelta, sin tic por medio: asi el conjunto de
    // pares que ve el siguiente tic es identico al de antes, y lo unico que
    // puede hacer que se reemita es haber borrado la clave de dedupe.
    connector.handlers()!.onResync!();
    connector.handlers()!.onAdd(audible());
    // The recovered room replays the own player too, as `officeRoomClient`
    // does: no voice goes out before it places us again (#185).
    connector.handlers()!.onLocalPosition?.(remoteSnapshot({ sessionId: 'mi-sesion', x: player.x, y: player.y }));

    // Esta es la trampa de la issue #41 vuelta a pisar: `emitVoice` deduplica
    // por `lastVoiceKey`, asi que sin invalidarla el par recuperado se veria y
    // no se oiria -- nadie volveria a pedirle a LiveKit que lo suscriba.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(emitidosAntes), LOOP_WAIT);
    expect(voices.at(-1)?.peers.map((peer) => peer.sessionId)).toEqual(['par-1']);
  });

  it('el estado de conexion viaja por "presence" sin cambiarle el significado a `online`', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onConnectionState!('reconnecting');

    // `online` sigue significando lo mismo que siempre (hay sesion viva), para
    // que nada rio abajo cambie de sentido en silencio al ensancharse el evento.
    expect(presence.at(-1)).toEqual({
      online: false,
      peers: 0,
      state: 'reconnecting',
      canRetry: true,
    });
  });

  it('el comando "reconnect" tira la sesion muerta, limpia la oficina y vuelve a entrar', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'de-la-sesion-vieja' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    bridge.emitCommand('reconnect', undefined);

    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    expect(connector.hasLeft()).toBe(true);
    // Los avatares de la sesion anterior no pueden sobrevivir a la nueva: el
    // join reparte los suyos, y mezclarlos dejaria fantasmas.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('deja de escuchar "reconnect" al apagarse la escena', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('reconnect', undefined);

    // Un comando tardio del HUD no puede resucitar una escena destruida: seria
    // el mismo socket huerfano que la guarda `alive` lleva evitando desde el
    // principio, entrando por otra puerta. El doble cuenta la entrada de forma
    // sincrona, asi que no hace falta esperar a nada para afirmarlo.
    expect(connector.connectCount()).toBe(1);
  });

  it('el reintento manual se anuncia como "reconectando" antes de esperar al servidor', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onConnectionState!('offline');
    bridge.on('presence', (p) => presence.push(p));

    bridge.emitCommand('reconnect', undefined);

    // El aviso sale ANTES del `await` del join, no despues: entrar tarda lo que
    // tarde la red, y durante ese rato el HUD seguiria pintando "Sin servidor"
    // con su boton al lado -- o sea, sin acuse de recibo de un clic que SI hizo
    // algo. Es el mismo sintoma que esta issue viene a quitar, en pequeno.
    expect(presence.at(-1)?.state).toBe('reconnecting');
  });

  it('dos clics seguidos en Reintentar no abren dos sesiones', async () => {
    const connector = fakeConnector();
    const { bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('reconnect', undefined);
    bridge.emitCommand('reconnect', undefined);

    // Entrar es asincrono, asi que sin guarda el segundo clic arranca un join
    // mientras el primero sigue en vuelo: gana el que resuelva el ultimo y el
    // otro queda huerfano, vivo y publicando la posicion del jugador. Dos
    // sesiones para una persona son DOS avatares suyos en la oficina de los
    // demas -- justo la clase de fantasma que esta issue viene a quitar.
    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connector.connectCount()).toBe(2);
  });
});

/**
 * Modo edicion de layout (#74, PR3b): la escena solo sabe SI se esta
 * editando (para suspender claim/release) y delega el resto -- overlays,
 * ghost, pick/place -- en `LayoutEditLayer`, ya probado por su cuenta en
 * `LayoutEditLayer.browser.test.ts`. Lo que falta cubrir aqui es la
 * integracion: que el flag realmente gatea el clic de escritorio, y que el
 * `pointerdown` global de la escena de verdad llega a la capa.
 */
describe('OfficeScene: modo edicion de layout (#74, PR3b)', () => {
  function fakePointer(worldX = 0, worldY = 0): Phaser.Input.Pointer {
    return { worldX, worldY, event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
  }

  function editableDesk(): OfficeDesk {
    return {
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
    };
  }

  it('mientras se edita, pasar sobre un escritorio no lo ofrece, y el que estaba ofrecido se retira', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const hovers: OfficeEventMap['deskhover'][] = [];
    bridge.on('deskhover', (payload) => hovers.push(payload));
    await settleCamera(scene);
    const view = scene.cameras.main.worldView;
    // The bottom rows of the view: the minimap covers the rest of the small test canvas.
    const desk = { ...editableDesk(), x: Math.round(view.x + 8), y: Math.round(view.bottom - 3 * TILE - 4) };
    bridge.emitCommand('desks', { desks: [desk] });
    const camera = scene.cameras.main;
    scene.input.activePointer.position.set(
      (desk.x + 4 - camera.worldView.x) * camera.zoom,
      (desk.y + desk.h - 4 - camera.worldView.y) * camera.zoom,
    );
    scene.input.emit('pointermove', scene.input.activePointer);
    await advanceGameClock(scene, 50);
    expect(hovers.at(-1)?.deskId).toBe('id-mesa');

    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    await advanceGameClock(scene, 50);

    expect(hovers.at(-1)).toBeNull();
  });

  it('draws the pickable and the context outlines above walls and avatars, only the pickable ones clickable', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [{ id: 'sala', x0: 10, y0: 10, x1: 14, y1: 14 }],
      selectedId: null,
      placing: null,
      outlines: [{ x0: 2, y0: 2, x1: 4, y1: 4 }],
    });

    const pick = scene.children.getByName(layoutPickName('sala')) as Phaser.GameObjects.Rectangle;
    const outlines = scene.children.list.filter((child) => child.name === LAYOUT_OUTLINE_NAME) as Phaser.GameObjects.Rectangle[];
    expect(outlines).toHaveLength(1);
    for (const rect of [pick, ...outlines]) {
      expect(rect.depth).toBe(LAYOUT_OUTLINE_DEPTH);
      expect(rect.isStroked).toBe(true);
      expect(rect.isFilled).toBe(false);
    }
    expect(outlines[0]!.strokeColor).toBe(pick.strokeColor);
    expect(outlines[0]!.getBounds()).toMatchObject({ x: 2 * TILE, y: 2 * TILE, width: 3 * TILE, height: 3 * TILE });
    expect(pick.input).not.toBeNull();
    expect(outlines[0]!.input).toBeNull();

    bridge.emitCommand('layoutedit', null);
    expect(scene.children.list.filter((child) => child.name === LAYOUT_OUTLINE_NAME)).toEqual([]);
  });

  it('un clic en el mapa mientras se coloca emite layoutplace con la posicion encajada', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const placements: unknown[] = [];
    bridge.on('layoutplace', (payload) => placements.push(payload));

    bridge.emitCommand('layoutedit', {
      pickable: [],
      selectedId: null,
      placing: { w: 3, h: 3, obstacles: [] },
    });
    scene.input.emit('pointerdown', fakePointer(10 * TILE, 10 * TILE));

    expect(placements).toEqual([{ tx: 9, ty: 9, valid: true }]);
  });
});

/**
 * Render layers (#70, #71). The bands themselves are pinned by
 * `depthLayers.test.ts`; what is covered here is that the scene actually puts
 * each object in its band, for both the local player and remote peers.
 */
describe('OfficeScene: render layers (#70, #71)', () => {
  function renderDesk(): OfficeDesk {
    return {
      id: 'id-mesa-capas',
      label: 'Mesa 9',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-ocupante', displayName: 'Ana Torres' },
      mine: false,
    };
  }

  function depthOf(object: Phaser.GameObjects.GameObject): number {
    return (object as unknown as Phaser.GameObjects.Components.Depth).depth;
  }

  /** Everything drawn in the world that is neither an avatar nor a HUD overlay. */
  function normalWorldObjects(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
    return scene.children.list.filter(
      (c) => c.type !== 'Container' && depthOf(c) < MINIMAP_MARKER_DEPTH,
    );
  }

  function maxDepth(objects: readonly Phaser.GameObjects.GameObject[]): number {
    return Math.max(...objects.map(depthOf));
  }

  /** Whether `depth` sorts between the world objects drawn behind feet at `feetY` and those drawn in front of them. */
  function sortsAtFeet(scene: Phaser.Scene, depth: number, feetY: number): void {
    const world = normalWorldObjects(scene);
    const behind = world.filter((object) => depthOf(object) <= worldAssetDepth(feetY));
    const inFront = world.filter((object) => depthOf(object) >= worldAssetDepth(feetY + 1));
    expect(behind.length).toBeGreaterThan(0);
    expect(inFront.length).toBeGreaterThan(0);
    expect(depth).toBeGreaterThan(maxDepth(behind));
    expect(depth).toBeLessThan(Math.min(...inFront.map(depthOf)));
  }

  it('the local player y-sorts with the world: assets south of its feet cover it, the rest do not (#213)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    bridge.emitCommand('desks', { desks: [renderDesk()] });
    const player = findPlayer(scene);

    // Near the top of the map: almost every tree, desk and chair has a larger
    // bottom edge and is drawn over the player (#70 kept it above them all).
    player.setPosition(player.x, 3 * TILE + 16);

    await vi.waitFor(() => expect(player.depth).toBe(avatarDepth(feetOf(player).y)), LOOP_WAIT);
    sortsAtFeet(scene, player.depth, feetOf(player).y);
  });

  it('a remote peer y-sorts with the world too, from its creation (#213)', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-arriba', x: 20 * TILE, y: 2 * TILE }));
    const remote = findRemoteAvatars(scene)[0];

    // Right after creation, before any `update()` re-sorts it.
    sortsAtFeet(scene, remote.depth, feetOf(remote).y);
    await advanceGameClock(scene, 100);
    sortsAtFeet(scene, remote.depth, feetOf(remote).y);
  });

});

describe('OfficeScene: integracion camera pan y colision de peers (#53, #59)', () => {
  function screenPointer(
    x: number,
    y: number,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): Phaser.Input.Pointer {
    return { x, y, button: 0, camera } as unknown as Phaser.Input.Pointer;
  }

  it('walkToPeer aterriza en la tile al OESTE del peer cuando el jugador se acerca desde el oeste (#59)', async () => {
    // Fixed 20ms frames, not the real loop: a CI stall over MAX_WALK_FRAME_MS
    // used to cancel the walk on its first steps, leaving the player where it
    // started (tile 20 instead of 29).
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const peerTx = 30;
    const peerTy = 30;
    // Bien al oeste del peer, misma fila, en campo abierto.
    arena.body.reset((peerTx - 10) * TILE + 16, peerTy * TILE + 16);
    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerTx * TILE + 16, y: peerTy * TILE + 16 }));

    arena.bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    expect(arena.movement.autoWalk, 'walkToPeer starts a walk').toBeDefined();
    for (let i = 0; i < 1500 && arena.movement.autoWalk !== undefined; i++) arena.frame();

    expect(arena.movement.autoWalk).toBeUndefined();
    // Antes de #59 el primer ADJACENT_OFFSETS ([1,0], ver terrainGrid.ts) lo
    // habria aterrizado al ESTE del peer, sin enterarse de que el jugador
    // venia del oeste.
    expect(Math.floor(arena.player.x / TILE)).toBe(peerTx - 1);
    expect(Math.floor(arena.player.y / TILE)).toBe(peerTy);
  });

  it('el colisionador vivo del peer bloquea al jugador (#59): no es solo la prueba aislada de remoteAvatarSink', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    // Cesped abierto, una tile al oeste del peer: un solo paso lo solaparia
    // si no hubiese colisionador.
    player.setPosition(29 * TILE + 16, 30 * TILE + 16);
    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 30 * TILE + 16, y: 30 * TILE + 16 }));

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await advanceGameClock(scene, 300);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }

    expect(player.x).toBeLessThan(30 * TILE + 16);
  });

  it('un drag por encima del umbral panea SOLO cameras.main; el minimapa queda intacto (#53)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const minimap = scene.cameras.cameras[1];
    const minimapScrollX = minimap.scrollX;
    const startScrollX = mainCam.scrollX;

    scene.input.emit('pointerdown', screenPointer(50, 50, mainCam), []);
    scene.input.emit('pointermove', screenPointer(70, 50, mainCam));

    expect(mainCam.scrollX).not.toBe(startScrollX);
    expect(minimap.scrollX).toBe(minimapScrollX);

    scene.input.emit('pointerup', screenPointer(70, 50, mainCam));
  });

  it('un clic en el minimapa planea cameras.main hasta ese punto del mundo sin mover al jugador (#98)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const minimap = scene.cameras.cameras[1];
    const player = findPlayer(scene);
    const playerStart = { x: player.x, y: player.y };
    // Cerca del centro, no de una esquina: el ancho del minimapa ya no
    // coincide con el ratio del mundo (#86, RAIL_WIDTH), asi que una esquina
    // puede caer en el margen sin contenido; un punto centrado siempre mapea
    // dentro de los bounds del mundo, sin depender del tamano del minimapa.
    const clickX = minimap.x + minimap.width / 2 + 20;
    const clickY = minimap.y + minimap.height / 2 + 15;
    const worldPoint = minimap.getWorldPoint(clickX, clickY);

    scene.input.emit('pointerdown', screenPointer(clickX, clickY, minimap), []);
    scene.input.emit('pointerup', screenPointer(clickX, clickY, minimap));

    // Hasta 1px de diferencia: la oficina es pixel art y la camara redondea
    // el scroll (`roundPixels`).
    await vi.waitFor(() => {
      expect(Math.abs(mainCam.midPoint.x - worldPoint.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mainCam.midPoint.y - worldPoint.y)).toBeLessThanOrEqual(1);
    }, LOOP_WAIT);
    expect({ x: player.x, y: player.y }).toEqual(playerStart);
  });

  it('con el pan activo, las teclas de movimiento siguen moviendo al jugador y la camara no retoma el seguimiento (#53)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const player = findPlayer(scene);
    const startX = player.x;

    scene.input.emit('pointerdown', screenPointer(50, 50, mainCam), []);
    scene.input.emit('pointermove', screenPointer(70, 50, mainCam));
    const pannedScrollX = mainCam.scrollX;
    expect(pannedScrollX).not.toBe(0);

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await advanceGameClock(scene, 500);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }

    // El jugador se sigue moviendo por teclado aunque el pan siga activo...
    expect(player.x).toBeGreaterThan(startX);
    // ...y la camara se queda donde el drag la dejo: no retoma el seguimiento
    // hasta soltar el pan (CameraPanLayer no comparte estado con el teclado).
    expect(mainCam.scrollX).toBe(pannedScrollX);

    scene.input.emit('pointerup', screenPointer(70, 50, mainCam));
  });
});

describe('OfficeScene: persisted character ids (art migration, step 5)', () => {
  it('loads the sheets of the own character the server replicates, keeping the procedural body', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const texture = player.baseTexture;

    connector.handlers()!.onLocalAvatar?.('character-p07-green-suit');

    await vi.waitFor(() => {
      expect(scene.textures.exists(artSheetKey('character-p07-green-suit', 'walk'))).toBe(true);
      expect(scene.textures.exists(artSheetKey('character-p07-green-suit', 'seated'))).toBe(true);
    }, LOOP_WAIT);
    expect((scene as OfficeScene).playerAvatarId).toBe('character-p07-green-suit');
    expect(player.baseTexture).toBe(texture);
  });

  it('a peer avatar carries its persisted character and its sheets get loaded', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p12-mint-blazer' }));

    await vi.waitFor(() => {
      expect(scene.textures.exists(artSheetKey('character-p12-mint-blazer', 'walk'))).toBe(true);
    }, LOOP_WAIT);
    const [peer] = findRemoteAvatars(scene) as (CharacterContainer & { avatarId?: string | null })[];
    expect(peer.avatarId).toBe('character-p12-mint-blazer');
  });
});

/**
 * Push-to-sit: walking into a free chair from right next to it sits the
 * player, then movement is locked for `SIT_LOCK_MS`; after that the held key
 * stands the player up without sitting again at once. Standing still next to
 * one for `SIT_IDLE_MS` sits too, with no lock. There is no E key.
 */
describe('OfficeScene: push-to-sit', () => {
  type Arena = Awaited<ReturnType<typeof movementArena>>;
  const SEAT = BASE_MAP_SEATS[0]!;
  const GROUND = { x: (SEAT.tx + 0.5) * TILE, y: (SEAT.ty + 0.5) * TILE };
  const sitLock = (arena: Arena) => (arena.scene as unknown as { sitLockUntil: number | null }).sitLockUntil;

  /** On the tile north of the chair, its feet 14 px above the chair ground point. */
  function besideChair(arena: Arena) {
    arena.body.reset(GROUND.x, GROUND.y - TILE);
  }

  /** Holds the down arrow (toward the chair) until the player sits, at most a few frames. */
  function pushIntoChair(arena: Arena) {
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && arena.player.seatFacing === null; i++) arena.frame();
  }

  it('pushing into a free chair from the next tile sits on it and stops the walk', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);

    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect(feetOf(arena.player)).toEqual(GROUND);
    expect(arena.body.velocity.length()).toBe(0);
    expect(arena.movement.walkingMs).toBe(0);
  });

  it('E next to a chair does nothing any more', async () => {
    const arena = await movementArena();
    besideChair(arena);
    dispatchKey('keydown', KEY.E);
    try {
      arena.walk(200);
    } finally {
      dispatchKey('keyup', KEY.E);
    }
    expect(arena.player.seatFacing).toBeNull();
  });

  it('walking past a row of chairs, next to them, does not sit', async () => {
    const arena = await movementArena();
    besideChair(arena);
    arena.movement.cursors.right.isDown = true;
    arena.walk(400);

    expect(arena.player.seatFacing).toBeNull();
    expect(arena.player.x).toBeGreaterThan(GROUND.x + 2 * TILE);
  });

  it('double-click walking onto a chair does not sit on arrival, then sits once still for SIT_IDLE_MS', async () => {
    const arena = await movementArena();
    arena.body.reset(GROUND.x, GROUND.y - 3 * TILE);
    arena.doubleClick(GROUND.x, GROUND.y - 18);
    for (let i = 0; i < 200 && arena.movement.autoWalk !== undefined; i++) arena.frame();

    expect(arena.movement.autoWalk).toBeUndefined();
    expect(arena.player.seatFacing).toBeNull();
    arena.walk(SIT_IDLE_MS - 40);
    expect(arena.player.seatFacing).toBeNull();
    arena.walk(60);
    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect(sitLock(arena)).toBeNull();
  });

  it('standing still next to a free chair for SIT_IDLE_MS sits on it, not before', async () => {
    const arena = await movementArena();
    besideChair(arena);
    arena.walk(SIT_IDLE_MS - 40);
    expect(arena.player.seatFacing).toBeNull();

    arena.walk(60);
    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect(feetOf(arena.player)).toEqual(GROUND);
  });

  it('an idle sit sets no lock: the first key stands up and walks at once', async () => {
    const arena = await movementArena();
    besideChair(arena);
    arena.walk(SIT_IDLE_MS + 20);
    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect(sitLock(arena)).toBeNull();
    const seated = arena.player.y;

    arena.movement.cursors.down.isDown = true;
    arena.frame();
    expect(arena.player.seatFacing).toBeNull();
    expect(arena.player.y).toBeGreaterThan(seated);
  });

  it('standing up and staying put waits SIT_AGAIN_SAME_MS for the same chair, never taking the one beside it', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.walk(SIT_IDLE_MS + 20);
    connector.handlers()!.onLocalSeat?.(mapSeatId(0));
    expect(arena.player.seatFacing).toBe(SEAT.facing);

    arena.bridge.emitCommand('toggleSeat', undefined);
    expect(arena.player.seatFacing).toBeNull();
    arena.walk(SIT_AGAIN_SAME_MS + SIT_IDLE_MS - 60);
    expect(connector.sits).toEqual([mapSeatId(0)]);
    arena.walk(100);
    expect(connector.sits).toEqual([mapSeatId(0), mapSeatId(0)]);
  });

  it('the room standing a seated player up never idle-sits them straight back down', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.walk(SIT_IDLE_MS + 20);
    connector.handlers()!.onLocalSeat?.(mapSeatId(0));
    expect(arena.player.seatFacing).toBe(SEAT.facing);

    connector.handlers()!.onLocalSeat?.(null);
    arena.walk(SIT_IDLE_MS * 3);
    expect(connector.sits.filter((id) => id === mapSeatId(0))).toEqual([mapSeatId(0)]);
  });

  it('an idle request the room never answers is not asked again while still beside the chair', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.walk(SIT_IDLE_MS + 20);
    expect(connector.sits).toEqual([mapSeatId(0)]);

    // Past the scene's answer timeout (2 s) and another idle dwell.
    arena.walk(2000 + SIT_IDLE_MS * 2);
    expect(connector.sits.filter((id) => id === mapSeatId(0))).toEqual([mapSeatId(0)]);
    expect(arena.player.seatFacing).toBeNull();
  });

  it('locks movement for SIT_LOCK_MS, then the held key stands up and walks away without sitting again', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);
    const seated = { x: arena.player.x, y: arena.player.y };

    arena.walk(SIT_LOCK_MS - 100);
    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect({ x: arena.player.x, y: arena.player.y }).toEqual(seated);

    arena.walk(200);
    expect(arena.player.seatFacing).toBeNull();
    expect(arena.player.y).toBeGreaterThan(seated.y);
    expect(sitLock(arena)).toBeNull();

    // Still held: the chair just left is ignored, not sat on again.
    arena.walk(60);
    expect(arena.player.seatFacing).toBeNull();
  });

  it('a released key lifts the re-sit guard: a fresh push into the chair sits again', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);
    arena.walk(SIT_LOCK_MS + 60);
    expect(arena.player.seatFacing).toBeNull();

    arena.movement.cursors.down.isDown = false;
    arena.frame();
    arena.movement.cursors.up.isDown = true;
    for (let i = 0; i < 10 && arena.player.seatFacing === null; i++) arena.frame();
    expect(arena.player.seatFacing).toBe(SEAT.facing);
  });

  it('asks the room for the seat once and only its confirmation seats the player', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && connector.sits.length === 0; i++) arena.frame();
    expect(connector.sits).toEqual([mapSeatId(0)]);
    expect(arena.player.seatFacing).toBeNull();

    // Locked while the answer is on its way: the held key moves nothing.
    const asked = { x: arena.player.x, y: arena.player.y };
    arena.walk(200);
    expect({ x: arena.player.x, y: arena.player.y }).toEqual(asked);
    expect(connector.sits).toEqual([mapSeatId(0)]);

    connector.handlers()!.onLocalSeat?.(mapSeatId(0));
    expect(feetOf(arena.player)).toEqual(GROUND);
  });

  it('a refused request never locks longer than SIT_LOCK_MS', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && connector.sits.length === 0; i++) arena.frame();
    const asked = arena.player.y;

    arena.walk(SIT_LOCK_MS + 60);
    expect(arena.player.y).toBeGreaterThan(asked);
    expect(connector.stands()).toBe(1);
    expect(connector.sits).toEqual([mapSeatId(0)]);
  });

  it('the room standing the player up, or a position reset, ends the lock at once', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const handlers = connector.handlers()!;
    pushIntoChair(arena);
    handlers.onLocalSeat?.(mapSeatId(0));
    expect(sitLock(arena)).not.toBeNull();
    handlers.onLocalSeat?.(null);
    expect(sitLock(arena)).toBeNull();
    const stoodAt = arena.player.y;
    arena.frame();
    expect(arena.player.y).toBeGreaterThan(stoodAt);

    // Far from the chair, then a fresh push into it, and a reset during the lock.
    arena.movement.cursors.down.isDown = false;
    arena.frame();
    pushIntoChair(arena);
    expect(sitLock(arena)).not.toBeNull();
    handlers.onPositionReset?.(remoteSnapshot({ sessionId: 'mi-sesion', x: 500, y: 600 }));
    expect(sitLock(arena)).toBeNull();
    arena.movement.cursors.down.isDown = true;
    arena.frame();
    expect(arena.player.y).toBeGreaterThan(600);
  });
});
