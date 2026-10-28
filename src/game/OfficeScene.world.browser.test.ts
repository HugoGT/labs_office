import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterContainer } from './characters';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, SPAWN_BLOCK_INDEX, TILE } from './mapData';
import { DOOR, DOOR_STEPS, doorFrameIndex, doorLeafDepthYs } from './artContract';
import { DOOR_HOLD_MS } from './officeDoors';
import { withBlock, withWalls } from './officeLayout';
import { CHAIR_OBJECT_NAME, WALL_OBJECT_NAME } from './mapBuilder';
import {
  LEGACY_LAYOUT as BASE_LAYOUT,
  LEGACY_SEATS as BASE_MAP_SEATS,
  LEGACY_SPACES as BUILT_IN_SPACES,
} from '../test/legacyOffice';
import { avatarDepth, chairLayerDepth, worldAssetDepth } from './depthLayers';
import { feetOf, positionForFeet } from './avatarGeometry';
import { chairSeatId, mapSeatId } from './seating';
import { artSheetKey, recoloredSheetKey } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import { VOID_COLOR } from './terrainRender';
import type { OfficeDesk } from './desksPort';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { PLAYER_TEXTURE } from './textures';
import { decorObjectName, type OfficeSceneOptions } from './OfficeScene';
import type { AutoWalkState } from './autoWalk';
import { regionBounds } from './cameraBounds';
import { zoomView, type ZoomStore, type ZoomView } from './mapZoom';
import {
  destroyOfficeGames,
  games,
  movementArena,
  LOOP_WAIT,
  advanceGameClock,
  bootOfficeScene,
  findPlayer,
  KEY,
  dispatchKey,
  fakeConnector,
  remoteSnapshot,
  findRemoteAvatars,
} from '../test/officeScene';

afterEach(destroyOfficeGames);

describe('OfficeScene: pack characters, walking and seats (art migration, step 6)', () => {
  const CHAIR_INDEX = 0;
  const CHAIR = BASE_MAP_SEATS[CHAIR_INDEX];
  const CHAIR_GROUND = { x: (CHAIR.tx + 0.5) * TILE, y: (CHAIR.ty + 0.5) * TILE };

  async function connected(sessionId = 'mi-sesion', bridge = createOfficeBridge()) {
    const connector = fakeConnector(sessionId);
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { connector, scene, bridge, player: findPlayer(scene) };
  }

  /** Next to the first meeting room chair, on the tile north of it. */
  function nextToChair(player: CharacterContainer): void {
    player.setPosition(CHAIR.tx * TILE + 16, (CHAIR.ty - 1) * TILE + 16);
  }

  it('draws the local player from the character the server replicates, once its sheets load', async () => {
    const { connector, player } = await connected();

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');

    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p03-forest-suit', 'walk'));
    }, LOOP_WAIT);
  });

  it('draws a peer from its character, and keeps it procedural without the pack', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit' }));

    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    const offline = await bootOfficeScene(createOfficeBridge(), { artManifestUrl: null });
    expect(findPlayer(offline.scene).sprite.texture.key).toBe(`${PLAYER_TEXTURE}-down`);
  });

  it('a peer whose character is retired mid-session is redrawn with the new one (#122)', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit' }));
    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    connector.handlers()!.onChange(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p09-mint-shirt' }));

    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p09-mint-shirt', 'walk'));
    }, LOOP_WAIT);
  });

  it('draws the pack default, never the previous character, while a new own character loads', async () => {
    const { connector, scene } = await connected();
    const player = findPlayer(scene);
    connector.handlers()!.onLocalAvatar?.('character-p07-green-suit');
    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p07-green-suit', 'walk'));
    }, LOOP_WAIT);

    connector.handlers()!.onLocalAvatar?.('character-p12-mint-blazer');

    expect(player.sprite.texture.key).toBe(artSheetKey('character-p01-burgundy-suit', 'walk'));
    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p12-mint-blazer', 'walk'));
    }, LOOP_WAIT);
  });

  it('draws a peer whose character cannot load as the pack default, not the procedural body', async () => {
    const { connector, scene } = await connected();

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: `character-custom-${'b'.repeat(32)}` }));

    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p01-burgundy-suit', 'walk'));
    }, LOOP_WAIT);
  });

  it('a player without a replicated character is the pack default', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: null });
    const player = findPlayer(scene);

    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p01-burgundy-suit', 'walk'));
    }, LOOP_WAIT);
  });

  it('drawing the pack sprite does not move what the network, proximity and spaces read', async () => {
    const { connector, scene, player } = await connected();
    const rooms: OfficeEventMap['room'][] = [];
    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.on('room', (room) => rooms.push(room));
    const meeting = BUILT_IN_SPACES[0];
    player.setPosition(meeting.x + 2 * TILE + 16, meeting.y + 2 * TILE + 16);
    const position = { x: player.x, y: player.y };

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');
    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p03-forest-suit', 'walk'));
      expect(rooms.at(-1)?.name).toBe(meeting.name);
    }, LOOP_WAIT);

    expect({ x: player.x, y: player.y }).toEqual(position);
    expect(connector.sent.at(-1)).toMatchObject(position);
  });

  it('toggleSeat next to a free chair asks the room to sit; only the confirmation seats the player on it', async () => {
    const { connector, scene, player } = await connected();
    nextToChair(player);
    await advanceGameClock(scene, 50);

    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([mapSeatId(CHAIR_INDEX)]);
    await advanceGameClock(scene, 100);
    expect(player.seatFacing).toBeNull();

    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    expect(feetOf(player)).toEqual(CHAIR_GROUND);
    expect(player.seatFacing).toBe(CHAIR.facing);
    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(chairLayerDepth(CHAIR_GROUND.y, 'back'));
      expect(player.depth).toBeLessThan(chairLayerDepth(CHAIR_GROUND.y, 'front'));
      expect(connector.sent.at(-1)).toMatchObject({ x: player.x, y: player.y, facing: CHAIR.facing });
    }, LOOP_WAIT);
  });

  it('offers a placed chair the room sends, seats the player on its tile facing its way, and stands them up when it goes', async () => {
    const { connector, scene, player } = await connected();
    // On the open lawn, far from every base chair.
    const chairIndex = 22 * BASE_LAYOUT.width + 67;
    const ground = { x: 67.5 * TILE, y: 22.5 * TILE };
    const chairObjects = () => scene.children.list.filter((child) => child.name === CHAIR_OBJECT_NAME);
    connector.handlers()!.onDecor?.([{ index: chairIndex, piece: 'chair-gamer', rotation: 270 }]);
    expect(chairObjects().length).toBeGreaterThan(0);
    player.setPosition(ground.x, ground.y - TILE);
    await advanceGameClock(scene, 50);

    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([chairSeatId(chairIndex)]);
    connector.handlers()!.onLocalSeat?.(chairSeatId(chairIndex));
    expect(feetOf(player)).toEqual(ground);
    expect(player.seatFacing).toBe('left');

    connector.handlers()!.onDecor?.([]);
    expect(player.seatFacing).toBeNull();
    expect(chairObjects()).toHaveLength(0);
  });

  it('toggleSeat again stands up; walking stands up too', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    nextToChair(player);
    bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.stands()).toBe(1);
    expect(player.seatFacing).toBeNull();

    bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));
    dispatchKey('keydown', KEY.LEFT);
    try {
      await vi.waitFor(() => expect(connector.stands()).toBe(2), LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.LEFT);
    }
    expect(player.seatFacing).toBeNull();
    await vi.waitFor(() => expect(player.depth).toBe(avatarDepth(feetOf(player).y)), LOOP_WAIT);
  });

  it('the room standing the player up (for example after a move away) shows it standing', async () => {
    const { connector, player } = await connected();
    nextToChair(player);
    (player.scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    connector.handlers()!.onLocalSeat?.(null);

    expect(player.seatFacing).toBeNull();
  });

  it('a seat confirmation nobody asked for is answered by standing up', async () => {
    const { connector } = await connected();

    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    expect(connector.stands()).toBe(1);
  });

  it('never offers a seat out of reach or one a peer sits on', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;

    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([]);

    connector.handlers()!.onAdd(
      remoteSnapshot({ sessionId: 'par-1', x: CHAIR.tx * TILE + 16, y: CHAIR.ty * TILE - 2, seat: mapSeatId(CHAIR_INDEX), facing: CHAIR.facing }),
    );
    nextToChair(player);
    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).not.toContain(mapSeatId(CHAIR_INDEX));
  });

  it('shows a seated peer between the layers of its chair, facing the way the room says', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(
      remoteSnapshot({ sessionId: 'par-1', x: CHAIR_GROUND.x, y: CHAIR_GROUND.y - 18, seat: mapSeatId(CHAIR_INDEX), facing: CHAIR.facing }),
    );
    const peer = findRemoteAvatars(scene)[0];

    expect(peer.seatFacing).toBe(CHAIR.facing);
    await vi.waitFor(() => {
      expect(peer.depth).toBeGreaterThan(worldAssetDepth(CHAIR_GROUND.y));
      expect(peer.depth).toBeLessThan(chairLayerDepth(CHAIR_GROUND.y, 'front'));
    }, LOOP_WAIT);
  });

  it('a peer walks in the direction its position moves', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit', x: 500, y: 600 }));
    const peer = findRemoteAvatars(scene)[0];
    await vi.waitFor(() => {
      expect(peer.sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    connector.handlers()!.onChange(
      remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit', x: 500, y: 520, facing: 'up' }),
    );

    await vi.waitFor(() => expect(peer.animation.direction).toBe('N'), LOOP_WAIT);
    expect(peer.animation.walkMs).toBeGreaterThan(0);
  });

  it('never offers a desk itself as a seat: it has no fixed chair, even when free or its own', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const chairs = () =>
      scene.children.list.filter(
        (c) => c.type === 'Image' && (c as Phaser.GameObjects.Image).texture.key === artSheetKey('chair-wood', 'sheet'),
      ).length;
    const baseChairs = chairs();
    for (const mine of [false, true]) {
      const desk: OfficeDesk = {
        id: 'id-mesa-libre',
        label: '',
        x: 10 * TILE,
        y: 30 * TILE,
        w: 3 * TILE,
        h: 3 * TILE,
        occupant: mine ? { id: 'id-yo', displayName: 'Yo' } : null,
        mine,
      };
      bridge.emitCommand('desks', { desks: [desk] });
      await advanceGameClock(scene, 50);
      expect(chairs()).toBe(baseChairs);

      player.setPosition(desk.x + desk.w / 2, desk.y + desk.h / 2);
      bridge.emitCommand('toggleSeat', undefined);
      expect(connector.sits).toEqual([]);
    }
  });

  it('never offers a desk someone else claimed', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const desk: OfficeDesk = {
      id: 'id-mesa-ajena',
      label: 'Mesa 2',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-otra', displayName: 'Otra' },
      mine: false,
    };
    bridge.emitCommand('desks', { desks: [desk] });

    player.setPosition(desk.x + desk.w / 2, desk.y + desk.h / 2);
    bridge.emitCommand('toggleSeat', undefined);

    expect(connector.sits).toEqual([]);
  });

  it('offers a decor chair standing on a desk someone else claimed as a guest seat, and stands up when it goes (#208)', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const desk: OfficeDesk = {
      id: 'id-mesa-ajena',
      label: 'Mesa 2',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-otra', displayName: 'Otra' },
      mine: false,
    };
    // The bottom right tile of the desk: (12, 32), a chair turned right.
    const chairIndex = 32 * BASE_LAYOUT.width + 12;
    const ground = { x: 12.5 * TILE, y: 32.5 * TILE };
    const gamerLayers = () =>
      scene.children.list.filter(
        (c) => c.type === 'Image' && (c as Phaser.GameObjects.Image).texture.key === artSheetKey('chair-gamer', 'sheet'),
      ) as Phaser.GameObjects.Image[];
    bridge.emitCommand('desks', { desks: [desk] });
    connector.handlers()!.onDecor?.([{ index: chairIndex, piece: 'chair-gamer', rotation: 90 }]);
    await vi.waitFor(() => expect(gamerLayers()).toHaveLength(2), LOOP_WAIT);
    // Both layers around the chair ground, like any other chair.
    expect(gamerLayers().map((layer) => layer.depth).sort((a, b) => a - b)).toEqual([
      chairLayerDepth(ground.y, 'back'),
      chairLayerDepth(ground.y, 'front'),
    ]);

    player.setPosition(ground.x, ground.y - TILE);
    await advanceGameClock(scene, 50);
    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([chairSeatId(chairIndex)]);
    connector.handlers()!.onLocalSeat?.(chairSeatId(chairIndex));
    expect(feetOf(player)).toEqual(ground);
    expect(player.seatFacing).toBe('right');

    connector.handlers()!.onDecor?.([]);
    expect(player.seatFacing).toBeNull();
    expect(gamerLayers()).toHaveLength(0);
  });

  it('publishes the pack portrait of the own session for the video tiles', async () => {
    const bridge = createOfficeBridge();
    const portraits: OfficeEventMap['characterportraits'][] = [];
    bridge.on('characterportraits', (payload) => portraits.push(payload));
    const { connector } = await connected('mi-sesion', bridge);

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');

    await vi.waitFor(() => expect(portraits.at(-1)?.bySession['mi-sesion']).toMatch(/^data:image\/png/), LOOP_WAIT);
  });
});

/**
 * Edited terrain (#123 phase 2): the room replicates the blocks and the scene
 * follows them live, tilemap and colliders alike; the editor's preview only
 * repaints.
 */
describe('OfficeScene: edited terrain', () => {
  it('renders the empty production default and a pending paint without changing walkability until replication', async () => {
    const { BASE_LAYOUT: empty } = await import('./officeLayout');
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), { layout: empty, seats: [], endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    // The middle of the block west of the entrance, void by default.
    const west = { tx: PLAYER_SPAWN_TX - 9, ty: PLAYER_SPAWN_TY };
    const before = terrainTilesAt(scene, west.tx, west.ty);
    const draft = withBlock(empty.blocks, SPAWN_BLOCK_INDEX - 1, 'wood');
    const point = { x: west.tx * TILE + 16, y: west.ty * TILE + 16 };
    expect(solidAt(scene, point.x, point.y)).toBe(true);
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'wood' }, previewBlocks: draft });
    expect(terrainTilesAt(scene, west.tx, west.ty)).not.toEqual(before);
    expect(solidAt(scene, point.x, point.y)).toBe(true);
    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, west.tx, west.ty)).toEqual(before);
    connector.handlers()!.onTerrain!(draft);
    await vi.waitFor(() => expect(solidAt(scene, point.x, point.y)).toBe(false), LOOP_WAIT);
    expect(terrainTilesAt(scene, west.tx, west.ty)).not.toEqual(before);
  });
  it('bounds the main camera to the painted terrain plus three tiles and grows them with a replicated block (#179)', async () => {
    const { BASE_LAYOUT: empty } = await import('./officeLayout');
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), { layout: empty, seats: [], endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const cam = scene.cameras.main;
    const block = 9 * TILE;
    const margin = 3 * TILE;
    // Only the spawn block (column 10, row 7) is painted; the default zoom 2 shows less than it.
    const spawnRegion = { x: 10 * block - margin, y: 7 * block - margin, width: block + 2 * margin, height: block + 2 * margin };
    await vi.waitFor(() => expect(cam.getBounds()).toMatchObject(spawnRegion), LOOP_WAIT);

    connector.handlers()!.onTerrain!(withBlock(empty.blocks, SPAWN_BLOCK_INDEX - 1, 'wood'));

    await vi.waitFor(
      () => expect(cam.getBounds()).toMatchObject({ ...spawnRegion, x: 9 * block - margin, width: 2 * block + 2 * margin }),
      LOOP_WAIT,
    );
  });
  const LAWN = 35;
  /** The middle of the lawn block: its own material whatever the borders do. */
  const lawn = { x: 67 * TILE + 16, y: 22 * TILE + 16 };
  /** Dual-grid cell whose four corners are tiles inside the lawn block. */
  const lawnCell = { cx: 67, cy: 22 };

  function terrainTilesAt(scene: Phaser.Scene, cx: number, cy: number): (number | undefined)[] {
    return scene.children.list
      .filter((child): child is Phaser.Tilemaps.TilemapLayer => child.type === 'TilemapLayer')
      .filter((layer) => layer.layer.name.startsWith('terrain'))
      .map((layer) => layer.getTileAt(cx, cy, true)?.index);
  }

  function solidAt(scene: Phaser.Scene, x: number, y: number): boolean {
    return scene.physics.world.staticBodies.getArray().some((body) => body.hitTest(x, y));
  }

  async function bootConnected() {
    const connector = fakeConnector();
    const booted = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { ...booted, handlers: connector.handlers()! };
  }

  it('redraws the terrain and rebuilds the colliders from the blocks the room sends, and tells React', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));
    const grass = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);

    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    handlers.onTerrain!(watered);

    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(grass);
    expect(seen).toEqual([{ blocks: watered, walls: BASE_LAYOUT.walls, colors: new Map() }]);

    handlers.onTerrain!(BASE_LAYOUT.blocks);
    // Arcade drops a destroyed static body on its next step.
    await vi.waitFor(() => expect(solidAt(scene, lawn.x, lawn.y)).toBe(false), LOOP_WAIT);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
    // The base map's own solids survive every rebuild.
    expect(solidAt(scene, 20 * TILE + 16, 20 * TILE + 16)).toBe(true);
  });

  it('paints pending blocks for the editor without changing collisions, and drops them when the editor closes', async () => {
    const { scene, bridge } = await bootConnected();
    const grass = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'water' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'water') });

    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(grass);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'water' } });
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'sand' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'sand') });
    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
  });

  it('keeps pending paints over an edit that arrives meanwhile, then shows the edit', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'sand' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'sand') });
    const sand = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);

    handlers.onTerrain!(withBlock(BASE_LAYOUT.blocks, LAWN, 'water'));
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(sand);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);

    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(sand);
  });

  it('draws void as nothing over a black background, on the map and the minimap, and collides with it', async () => {
    const { scene, handlers } = await bootConnected();

    handlers.onTerrain!(withBlock(BASE_LAYOUT.blocks, LAWN, 'void'));

    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy).every((index) => index === undefined || index === -1)).toBe(true);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);
    expect(scene.cameras.cameras.length).toBeGreaterThanOrEqual(2);
    for (const camera of scene.cameras.cameras) {
      expect(camera.backgroundColor.color).toBe(VOID_COLOR);
      expect(camera.transparent).toBe(false);
    }
  });

  it('tells the editor the current blocks when it opens', async () => {
    const { bridge, handlers } = await bootConnected();
    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    handlers.onTerrain!(watered);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));

    bridge.emitCommand('terrainedit', { brush: null });
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });

    expect(seen).toEqual([{ blocks: watered, walls: BASE_LAYOUT.walls, colors: new Map() }]);
  });

  const RED = '#aa0000';
  const GREEN = '#00bb00';

  it('draws the block colors the room sends, repaints a color-only change and tells React (#222)', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const carpeted = withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet');
    handlers.onTerrain!(carpeted);
    const plain = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));

    handlers.onTerrainColors!(new Map([[LAWN, RED]]));

    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(plain);
    expect(seen).toEqual([{ blocks: carpeted, walls: BASE_LAYOUT.walls, colors: new Map([[LAWN, RED]]) }]);

    handlers.onTerrainColors!(new Map());
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(plain);
  });

  it("draws the editor's pending colors with its pending blocks, and the live colors once it has none (#222)", async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const carpeted = withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet');
    handlers.onTerrain!(carpeted);
    const plain = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);
    const brush = { kind: 'floor', material: 'carpet' } as const;

    bridge.emitCommand('terrainedit', { brush, previewBlocks: carpeted, previewColors: new Map([[LAWN, RED]]) });
    const red = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);
    expect(red).not.toEqual(plain);
    // Only the pending color changes: still a repaint.
    bridge.emitCommand('terrainedit', { brush, previewBlocks: carpeted, previewColors: new Map([[LAWN, GREEN]]) });
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(red);
    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(plain);

    // Pending blocks without pending colors draw with the live ones.
    handlers.onTerrainColors!(new Map([[LAWN, RED]]));
    bridge.emitCommand('terrainedit', { brush, previewBlocks: carpeted });
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(red);
  });

  it('a click on the map picks a block instead of closing menus while the editor is open', async () => {
    const { scene, bridge } = await bootConnected();
    const events: string[] = [];
    bridge.on('closemenu', () => events.push('closemenu'));
    bridge.on('terrainpick', ({ index }) => events.push(`pick:${index}`));

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });
    scene.input.emit('pointerdown', { worldX: lawn.x, worldY: lawn.y, button: 0, event: { stopPropagation() {} } }, []);

    expect(events).toEqual([`pick:${LAWN}`]);
  });

  const lawnTile = 22 * BASE_LAYOUT.width + 67;
  /** The grid vertex a post on `lawnTile` stands on: the tile's top-left corner. */
  const lawnVertex = { x: 67 * TILE, y: 22 * TILE };
  const wallObjects = (scene: Phaser.Scene) => scene.children.list.filter((child) => child.name === WALL_OBJECT_NAME);

  it('draws and collides with the walls the room sends, rebuilding both on every change, and tells React', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));
    const before = wallObjects(scene).length;
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false);

    const walled = withWalls(BASE_LAYOUT.walls, [{ index: lawnTile, piece: 'wall-brick' }, { index: lawnTile + 1, piece: 'wall-brick' }]);
    handlers.onWalls!(walled);

    // The posts stand on the tiles' top-left vertices: the wall runs along the grid line between them, not through the tile.
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y - 7)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y + 9)).toBe(false);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);
    expect(wallObjects(scene).length).toBeGreaterThan(before);
    expect(seen).toEqual([{ blocks: BASE_LAYOUT.blocks, walls: walled, colors: new Map() }]);

    handlers.onWalls!(BASE_LAYOUT.walls);
    await vi.waitFor(() => expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false), LOOP_WAIT);
    expect(wallObjects(scene)).toHaveLength(before);
    // Walls of another map size are not this layout's: ignored.
    handlers.onWalls!([]);
    expect(wallObjects(scene)).toHaveLength(before);
  });

  it('lays the wall placed last over the other where two materials meet, and redraws when only the order changes (#223)', async () => {
    const { scene, handlers } = await bootConnected();
    const walled = withWalls(BASE_LAYOUT.walls, [{ index: lawnTile, piece: 'wall-brick' }, { index: lawnTile + 1, piece: 'wall-glass' }]);
    // Pieces laid over another material add a fraction of a pixel to their depth: the later joint and the body between the posts.
    const laidOver = () =>
      wallObjects(scene)
        .filter((child) => !Number.isInteger((child as Phaser.GameObjects.Image).depth))
        .map((child) => (child as Phaser.GameObjects.Image).x)
        .sort((a, b) => a - b);

    handlers.onWalls!(walled, [lawnTile, lawnTile + 1]);
    // The glass post (the east one) and the body between the posts.
    expect(laidOver()).toEqual([lawnVertex.x + 8, lawnVertex.x + TILE - 8]);

    // Only the order changes: the west post is now the latest, so its joint is laid over the body.
    handlers.onWalls!(walled, [lawnTile + 1, lawnTile]);
    expect(laidOver()).toEqual([lawnVertex.x - 8, lawnVertex.x + 8]);

    // A wall of one material is never laid over anything.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))), [lawnTile]);
    expect(laidOver()).toHaveLength(0);
  });

  it('opens the wall edges a door spans for Arcade and the tile helpers, and closes them when the door goes (#223, #233)', async () => {
    const { scene, handlers } = await bootConnected();
    const grid = () => (scene as unknown as { grid: { solid: boolean[][] } }).grid;
    // Posts on vertices 67, 68 and 69 of row 22: two segments of brick wall, the span of one door.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    // Past the 16px hinge stop of the west post (`doorHingeStops`).
    const doorways = [lawnVertex.x + TILE / 2 + 4, lawnVertex.x + TILE + TILE / 2].map((x) => ({ x, y: lawnVertex.y }));
    for (const doorway of doorways) expect(solidAt(scene, doorway.x, doorway.y)).toBe(true);
    const walled = wallObjects(scene).length;

    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);

    // Destroyed static bodies leave the world on its next step.
    await vi.waitFor(() => expect(solidAt(scene, doorways[1]!.x, doorways[1]!.y)).toBe(false), LOOP_WAIT);
    for (const doorway of doorways) expect(solidAt(scene, doorway.x, doorway.y)).toBe(false);
    // The 18px body fits: the passage runs from 16px past the hinge post (west, rotation 0) to the vertex of the other end post.
    expect(solidAt(scene, lawnVertex.x + 15, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + 17, lawnVertex.y)).toBe(false);
    expect(solidAt(scene, lawnVertex.x + 2 * TILE - 1, lawnVertex.y)).toBe(false);
    // The outer halves of the end posts stay, the jambs of the door merge with them.
    expect(solidAt(scene, lawnVertex.x - 1, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + 2 * TILE + 1, lawnVertex.y)).toBe(true);
    expect([grid().solid[21]![67], grid().solid[22]![67], grid().solid[22]![68], grid().solid[22]![69]]).toEqual([false, false, false, true]);
    // The two bodies under the door are not drawn, nor the middle post, which only the open edges meet.
    expect(wallObjects(scene)).toHaveLength(walled - 3);

    handlers.onDecor!([]);
    for (const doorway of doorways) expect(solidAt(scene, doorway.x, doorway.y)).toBe(true);
    expect(grid().solid[22]![67]).toBe(true);
    expect(wallObjects(scene)).toHaveLength(walled);
  });

  it('opens a door in a gap between two posts with no wall between them, and only there (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    // Posts at both ends of the span and none between: a corner or the end of a wall on each side.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    // The frame is anchored on the middle of the 2-tile span, sorted like the wall body.
    expect(leaf().x).toBe(lawnVertex.x + TILE - 64);
    expect(leaf().y).toBe(lawnVertex.y - 64);
    expect(solidAt(scene, lawnVertex.x + TILE, lawnVertex.y)).toBe(false);
    expect(solidAt(scene, lawnVertex.x - 1, lawnVertex.y)).toBe(true);
  });

  it('draws the walls over a door, shut or open, horizontal or vertical: its jambs sort under the posts they merge with (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    // A horizontal door on row 22 between posts 67 and 69, and a vertical one down from vertex (67, 24) to (67, 26).
    const posts = [lawnTile, lawnTile + 2, lawnTile + 2 * BASE_LAYOUT.width, lawnTile + 4 * BASE_LAYOUT.width];
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, posts.map((index) => ({ index, piece: 'wall-brick' as const }))));
    handlers.onDecor!([
      { index: lawnTile, piece: 'door-wood', rotation: 0 },
      { index: lawnTile + 2 * BASE_LAYOUT.width, piece: 'door-wood', rotation: 90 },
    ]);
    const jambs = (index: number) => scene.children.list.filter((child) => child.name === `${decorObjectName(index)}:jamb`) as Phaser.GameObjects.Image[];
    await vi.waitFor(() => expect(jambs(lawnTile)).toHaveLength(2), LOOP_WAIT);
    const jointDepth = (ty: number) => worldAssetDepth(ty * TILE + 8);
    const check = () => {
      // Under the joint at each end of its span, so the post is drawn over the jamb.
      expect(jambs(lawnTile).map((jamb) => jamb.depth)).toEqual([jointDepth(22) - 1, jointDepth(22) - 1]);
      expect(jambs(lawnTile + 2 * BASE_LAYOUT.width).map((jamb) => jamb.depth)).toEqual([jointDepth(24) - 1, jointDepth(26) - 1]);
    };
    check();

    // Swung wide open for someone from the north, nothing about the jambs changes.
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    body.reset(lawnVertex.x + TILE, lawnVertex.y - TILE / 2 - 11);
    await vi.waitFor(() => expect(Number(leaf().frame.name)).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    check();
    // The joint of the end post is one of the wall pieces, and it sorts over the jamb whatever the swing.
    const joints = wallObjects(scene).filter((wall) => (wall as Phaser.GameObjects.Image).x === lawnVertex.x - 8 && (wall as Phaser.GameObjects.Image).y === lawnVertex.y - 8) as Phaser.GameObjects.Image[];
    expect(joints).toHaveLength(1);
    expect(joints[0]!.depth).toBeGreaterThan(jambs(lawnTile)[0]!.depth);
  });

  it('opens a door only for whoever is about to cross it, swinging away from where they come from, and keeps the swing mid-crossing (#223, S14)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const frame = () => Number(leaf().frame.name);
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    const middle = lawnVertex.x + TILE;
    // Body centers sit 11px below the network position (`AVATAR_BODY_CENTER_OFFSET`).
    const at = (x: number, centerY: number) => body.reset(x, centerY - 11);

    // Walking along the wall past either end of the span, on the door's own rows, opens nothing.
    at(lawnVertex.x + 2 * TILE + TILE / 2 + 2, lawnVertex.y - 10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame()).toBe(doorFrameIndex(0, 'start', 0));
    at(lawnVertex.x - TILE / 2, lawnVertex.y + 10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame()).toBe(doorFrameIndex(0, 'start', 0));

    // Lined up from the north: it swings south, and stays so while the walker crosses the line and goes in.
    at(middle, lawnVertex.y - 10);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    at(middle, lawnVertex.y + 10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame()).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1));
    at(middle, lawnVertex.y + 4 * TILE);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(0, 'start', 0)), LOOP_WAIT);

    // Coming from the south it swings north, not into the walker.
    at(middle, lawnVertex.y + 10);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(180, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    at(middle, lawnVertex.y - 10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame()).toBe(doorFrameIndex(180, 'start', DOOR_STEPS - 1));
  });

  it('blocks 16px past the hinge post of a door into its opening, and moves the stop when the door turns its hinge (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    // Hinged at its west end (rotation 0), on vertex 67; the east end post is on vertex 69.
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const east = lawnVertex.x + 2 * TILE;
    // Destroyed static bodies leave the world on its next step.
    await vi.waitFor(() => expect(solidAt(scene, lawnVertex.x + 17, lawnVertex.y)).toBe(false), LOOP_WAIT);
    expect(solidAt(scene, lawnVertex.x + 15, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, east - 2, lawnVertex.y)).toBe(false);

    // Turned up (180) it hinges at the east end: the stop goes with it.
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 180 }]);
    await vi.waitFor(() => expect(solidAt(scene, lawnVertex.x + 2, lawnVertex.y)).toBe(false), LOOP_WAIT);
    expect(solidAt(scene, east - 15, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, east - 17, lawnVertex.y)).toBe(false);
  });

  it('keeps the door of a locked space shut for whoever is outside it, and opens it for whoever is inside', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const frame = () => Number(leaf().frame.name);
    // The room the door leads into, north of its line, locked by someone else.
    bridge.emitCommand('spacesconfig', { spaces: [{ id: 'sala', name: 'Sala 1', x: lawnVertex.x, y: lawnVertex.y - 4 * TILE, w: 2 * TILE, h: 4 * TILE }], version: 'v1' });
    handlers.onLockedSpaces!(new Map([['sala', 'otra-sesion']]));
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    const middle = lawnVertex.x + TILE;
    // Body centers sit 11px below the network position (`AVATAR_BODY_CENTER_OFFSET`).
    const at = (x: number, centerY: number) => body.reset(x, centerY - 11);

    // The local player and a peer, both outside and lined up with the door: it stays shut.
    at(middle, lawnVertex.y + 20);
    handlers.onAdd(remoteSnapshot({ sessionId: 'peer-door', x: middle - 8, y: lawnVertex.y + 9 }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(frame()).toBe(doorFrameIndex(0, 'start', 0));

    // Whoever is inside opens it on the way out, swung south, away from them.
    at(middle, lawnVertex.y - 10);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
  });

  it('draws a double door from the pack as one item over its 3-tile span, opening while an avatar passes and closing after (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    // End posts on vertices 67 and 70 of row 22, the wall between them.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2, 3].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood-double', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood-double', 'sheet')), LOOP_WAIT);
    const frame = () => Number(leaf().frame.name);
    const closed = doorFrameIndex(0, 'start', 0);
    // Anchored on the middle of the 3-tile span, sorted like the wall body.
    expect(leaf().x).toBe(lawnVertex.x + (3 * TILE) / 2 - 64);
    expect(leaf().y).toBe(lawnVertex.y - 64);
    await vi.waitFor(() => expect(frame()).toBe(closed), LOOP_WAIT);
    // The last tile of the span, short of the 16px stop of the east hinge.
    await vi.waitFor(() => expect(solidAt(scene, lawnVertex.x + 2 * TILE + 8, lawnVertex.y)).toBe(false), LOOP_WAIT);

    // A remote avatar in the doorway of the last tile of the span opens the whole door, swung south for whoever comes from the north.
    handlers.onAdd(remoteSnapshot({ sessionId: 'peer-door', x: lawnVertex.x + 2 * TILE + TILE / 2, y: lawnVertex.y - 11 }));
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    handlers.onRemove('peer-door');
    await vi.waitFor(() => expect(frame()).toBe(closed), LOOP_WAIT);

    // So does the local player from the south (swung north), and stepping away closes it again.
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    body.reset(lawnVertex.x + TILE / 2, lawnVertex.y + TILE / 2 - 11);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(180, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    body.reset(lawnVertex.x + TILE / 2, lawnVertex.y + 5 * TILE);
    await vi.waitFor(() => expect(frame()).toBe(closed), LOOP_WAIT);
  });

  it('swings a door through the frames between closed and open, each sorted by the lowest pixel of its leaf (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const edge = { col: lawnVertex.x / TILE, row: lawnVertex.y / TILE, axis: 'horizontal' } as const;
    const depthAt = (step: number) => worldAssetDepth(doorLeafDepthYs(edge, 'door-wood', 0, 'start', step)[0]);
    // Shut, it sorts by its closed leaf.
    expect(leaf().depth).toBeCloseTo(depthAt(0));

    // Every frame of the swing, as drawn: its image and the depth it carries.
    const drawn: { frame: number; depth: number }[] = [];
    const record = () => drawn.push({ frame: Number(leaf().frame.name), depth: leaf().depth });
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, record);
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    body.reset(lawnVertex.x + TILE, lawnVertex.y - TILE / 2 - 11);
    await vi.waitFor(() => expect(Number(leaf().frame.name)).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, record);

    // It went through both frames in between, in order, never back.
    const steps = drawn.map(({ frame }) => frame / DOOR.columns).filter((step, i, all) => i === 0 || step !== all[i - 1]);
    expect(steps).toEqual(expect.arrayContaining([1, 2]));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    // And each frame sorts by the leaf it shows: it grows as the leaf swings down.
    for (const { frame, depth } of drawn) expect(depth, `frame ${frame}`).toBeCloseTo(depthAt(frame / DOOR.columns));
  });

  it('hinges a single door at the end its turn puts it at, shut and swung, whichever side it opens to (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    // Turned up (180): hinged at the east end.
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 180 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    expect(Number(leaf().frame.name)).toBe(doorFrameIndex(180, 'end', 0));
    // For someone from the north it swings south, still hinged at the east end.
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    body.reset(lawnVertex.x + TILE, lawnVertex.y - TILE / 2 - 11);
    await vi.waitFor(() => expect(Number(leaf().frame.name)).toBe(doorFrameIndex(0, 'end', DOOR_STEPS - 1)), LOOP_WAIT);
  });

  it('keeps a fully open door open for a moment after the avatar leaves, then closes it through the frames between (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const frame = () => Number(leaf().frame.name);
    const open = doorFrameIndex(0, 'start', DOOR_STEPS - 1);
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    body.reset(lawnVertex.x + TILE, lawnVertex.y - TILE / 2 - 11);
    await vi.waitFor(() => expect(frame()).toBe(open), LOOP_WAIT);

    // Out of range: it stays wide open while the hold runs (well under DOOR_HOLD_MS), and only then starts to close.
    body.reset(lawnVertex.x + TILE, lawnVertex.y + 5 * TILE);
    await new Promise((resolve) => setTimeout(resolve, DOOR_HOLD_MS / 3));
    expect(frame()).toBe(open);
    await vi.waitFor(() => expect(frame()).toBe(doorFrameIndex(0, 'start', 0)), LOOP_WAIT);
  });

  it('draws an avatar standing past a swung leaf in front of it, even inside the span of a vertical door (#233)', async () => {
    const { scene, handlers } = await bootConnected();
    // A vertical door of 2 tiles on the line through the lawn vertex: its posts at the vertex and two rows below.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 2 * BASE_LAYOUT.width].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 270 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const player = findPlayer(scene);
    const body = player.body as Phaser.Physics.Arcade.Body;
    const south = lawnVertex.y + 40;

    // Comes from the west, so the leaf swings east; then crosses the line and stands in the doorway, below the leaf's hinge.
    body.reset(lawnVertex.x - TILE / 2, south - 11);
    await vi.waitFor(() => expect(Number(leaf().frame.name)).toBe(doorFrameIndex(90, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    body.reset(lawnVertex.x + TILE / 2, south - 11);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Number(leaf().frame.name)).toBe(doorFrameIndex(90, 'start', DOOR_STEPS - 1));

    const edge = { col: lawnVertex.x / TILE, row: lawnVertex.y / TILE, axis: 'vertical' } as const;
    // The leaf hangs from the hinge at the north end: it sorts there, well above the avatar's feet, so the avatar is drawn over it.
    expect(leaf().depth).toBeCloseTo(worldAssetDepth(doorLeafDepthYs(edge, 'door-wood', 90, 'start', DOOR_STEPS - 1)[0]));
    expect(leaf().depth).toBeLessThan(player.depth);
  });

  it('sorts the two leaves of a vertical double door apart, so the north one never covers an avatar standing below it', async () => {
    const { scene, handlers } = await bootConnected();
    // A vertical double door of 3 tiles on the line through the lawn vertex: its posts at the vertex and three rows below.
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 3 * BASE_LAYOUT.width].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood-double', rotation: 270 }]);
    const leaves = () => scene.children.list.filter((child) => child.name === decorObjectName(lawnTile)) as Phaser.GameObjects.Image[];
    await vi.waitFor(() => expect(leaves().map((leaf) => leaf.texture.key)).toEqual([artSheetKey('door-wood-double', 'sheet'), artSheetKey('door-wood-double', 'sheet')]), LOOP_WAIT);
    const player = findPlayer(scene);
    const body = player.body as Phaser.Physics.Arcade.Body;
    const south = lawnVertex.y + 40;

    // Comes from the west, so both leaves swing east; then stands in the doorway just below the north leaf.
    body.reset(lawnVertex.x - TILE / 2, south - 11);
    await vi.waitFor(() => expect(Number(leaves()[0].frame.name)).toBe(doorFrameIndex(90, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    body.reset(lawnVertex.x + TILE / 2, south - 11);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const edge = { col: lawnVertex.x / TILE, row: lawnVertex.y / TILE, axis: 'vertical' } as const;
    const [north, southLeaf] = doorLeafDepthYs(edge, 'door-wood-double', 90, 'start', DOOR_STEPS - 1).map(worldAssetDepth);
    expect(leaves().map((leaf) => leaf.depth)).toEqual([north, southLeaf]);
    // The north leaf hangs from its hinge above the avatar's feet; the south one, from the far end of the span, below them.
    expect(leaves()[0].depth).toBeLessThan(player.depth);
    expect(leaves()[1].depth).toBeGreaterThan(player.depth);
  });

  it('never bars a door: the body and the path walk through it, open or shut (#223, #233)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onWalls!(withWalls(BASE_LAYOUT.walls, [0, 1, 2].map((dx) => ({ index: lawnTile + dx, piece: 'wall-brick' as const }))));
    handlers.onDecor!([{ index: lawnTile, piece: 'door-wood', rotation: 0 }]);
    const leaf = () => scene.children.getByName(decorObjectName(lawnTile)) as Phaser.GameObjects.Image;
    await vi.waitFor(() => expect(leaf().texture.key).toBe(artSheetKey('door-wood', 'sheet')), LOOP_WAIT);
    const walk = scene as unknown as { startWalk(goal: { x: number; y: number }): boolean; autoWalk?: unknown; walkWorld(): { rects: readonly { x: number; y: number; w: number; h: number }[] } };
    const body = findPlayer(scene).body as Phaser.Physics.Arcade.Body;
    const doorway = { x: lawnVertex.x + TILE, y: lawnVertex.y };
    const north = { x: doorway.x, y: lawnVertex.y - TILE / 2 - 11 };
    const south = { x: doorway.x, y: lawnVertex.y + TILE / 2 - 11 };

    // Shut: nobody is next to it, and the span is open ground.
    await vi.waitFor(() => expect(solidAt(scene, doorway.x, doorway.y)).toBe(false), LOOP_WAIT);
    expect(leaf().isTinted).toBe(false);
    // Open, for the one next to it: still open ground, and the path plans through it.
    body.reset(north.x, north.y);
    await vi.waitFor(() => expect(Number(leaf().frame.name)).toBe(doorFrameIndex(0, 'start', DOOR_STEPS - 1)), LOOP_WAIT);
    expect(solidAt(scene, doorway.x, doorway.y)).toBe(false);
    expect(walk.startWalk(south)).toBe(true);
    walk.autoWalk = undefined;
    // The only rectangles in the path's world are the walls' own: none spans the door.
    expect(walk.walkWorld().rects.some((rect) => rect.x <= doorway.x && doorway.x < rect.x + rect.w && rect.y <= doorway.y && doorway.y < rect.y + rect.h)).toBe(false);
  });

  it('draws pending walls for the editor without colliding with them, and drops them when it closes', async () => {
    const { scene, bridge } = await bootConnected();
    const before = wallObjects(scene).length;

    bridge.emitCommand('terrainedit', { brush: { kind: 'wall', piece: 'wall-glass' }, previewWalls: [{ index: lawnTile, piece: 'wall-glass' }, { index: lawnTile + 1, piece: 'wall-glass' }] });

    expect(wallObjects(scene).length).toBeGreaterThan(before);
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false);

    bridge.emitCommand('terrainedit', null);
    expect(wallObjects(scene)).toHaveLength(before);
  });

  it('draws pending decor edits for the editor over the live layer, never collided with, and tells it the live layer (#208)', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const chairObjects = () => scene.children.list.filter((child) => child.name === CHAIR_OBJECT_NAME);
    const seen: OfficeEventMap['decor'][] = [];
    bridge.on('decor', (payload) => seen.push(payload));
    const live = [{ index: lawnTile, piece: 'chair-wood', rotation: 0 as const }];
    handlers.onDecor!(live);
    const one = chairObjects().length;
    expect(one).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ items: live });

    // Opening an editor hands it the live layer again.
    bridge.emitCommand('decoredit', { brush: null, area: null });
    expect(seen).toHaveLength(2);
    bridge.emitCommand('decoredit', { brush: null, area: null, preview: [{ index: lawnTile + 1, item: { piece: 'chair-metal', rotation: 180 } }, { index: lawnTile, item: null }] });
    expect(chairObjects()).toHaveLength(one);
    bridge.emitCommand('decoredit', { brush: null, area: null, preview: [{ index: lawnTile + 1, item: { piece: 'chair-metal', rotation: 180 } }] });
    expect(chairObjects()).toHaveLength(2 * one);
    expect((scene as unknown as { collisionInstances: unknown[] }).collisionInstances.filter((instance) => JSON.stringify(instance).includes('chair-metal'))).toEqual([]);

    bridge.emitCommand('decoredit', null);
    expect(chairObjects()).toHaveLength(one);
    expect(seen).toHaveLength(2);
  });

  it('selects a live decor item on a click with nothing picked, from the layer and catalog it draws (#208)', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const selected: (number | null)[] = [];
    bridge.on('decorselect', ({ index }) => selected.push(index));
    handlers.onDecor!([{ index: lawnTile, piece: 'chair-wood', rotation: 0 }]);
    bridge.emitCommand('decoredit', { brush: null, area: null });
    const click = (tile: number): void => {
      const pointer = {
        worldX: (tile % BASE_LAYOUT.width) * TILE + TILE / 2,
        worldY: Math.floor(tile / BASE_LAYOUT.width) * TILE + TILE / 2,
        button: 0,
        camera: scene.cameras.main,
        getDistance: () => 0,
      } as unknown as Phaser.Input.Pointer;
      scene.input.emit('pointerdown', pointer, []);
      scene.input.emit('pointerup', pointer, []);
    };

    click(lawnTile);
    click(lawnTile + 2);

    expect(selected).toEqual([lawnTile, null]);
  });

  it('tells the editor the current walls when it opens', async () => {
    const { bridge, handlers } = await bootConnected();
    const walled = withWalls(BASE_LAYOUT.walls, [{ index: lawnTile, piece: 'wall-stone' }]);
    handlers.onWalls!(walled);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));

    bridge.emitCommand('terrainedit', { brush: null });

    expect(seen).toEqual([{ blocks: BASE_LAYOUT.blocks, walls: walled, colors: new Map() }]);
  });
});


/**
 * Collision areas per piece: the scene collides the player with one static
 * body per rectangle of the room's table and of the served desks, and the
 * terrain tiles apart, so an edit moves exactly what it says.
 */
describe('OfficeScene: piece collisions', () => {
  /** The middle of the first Tiled tree's tile, (2, 2): a tree-oak. */
  const treeTile = { x: 2 * TILE + 16, y: 2 * TILE + 16 };
  /** A decor chair on the open lawn, tile (22, 51), and the middle of that tile. */
  const lawnChair = { index: 51 * BASE_LAYOUT.width + 22, piece: 'chair-gamer', rotation: 0 } as const;
  const deskMiddle = { x: 22 * TILE + 16, y: 51 * TILE + 16 };

  function solidAt(scene: Phaser.Scene, x: number, y: number): boolean {
    return scene.physics.world.staticBodies.getArray().some((body) => body.hitTest(x, y));
  }

  async function bootConnected() {
    const connector = fakeConnector();
    const booted = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { ...booted, handlers: connector.handlers()! };
  }

  it('blocks a layout prop by its default rectangle and frees it when the room says it is walk-through', async () => {
    const { scene, handlers } = await bootConnected();
    expect(solidAt(scene, treeTile.x, treeTile.y)).toBe(true);

    handlers.onCollisions!(new Map([['tree-oak', []]]));

    await vi.waitFor(() => expect(solidAt(scene, treeTile.x, treeTile.y)).toBe(false), LOOP_WAIT);
    // The terrain colliders stay: the border hedge is still there.
    expect(solidAt(scene, 20 * TILE + 16, 16)).toBe(true);
  });

  it('collides with a decor item once its piece has rectangles, wherever the decor layer puts it (#208)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([lawnChair]);
    expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(false);

    handlers.onCollisions!(new Map([['chair-gamer', [{ x: -20, y: -12, w: 40, h: 16 }]]]));
    expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(true);
    expect(solidAt(scene, deskMiddle.x + 21, deskMiddle.y)).toBe(false);

    handlers.onDecor!([]);
    await vi.waitFor(() => expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(false), LOOP_WAIT);
  });

  it('a click on the map picks a piece instead of closing menus while the collision editor is open', async () => {
    const { scene, bridge } = await bootConnected();
    const events: string[] = [];
    bridge.on('closemenu', () => events.push('closemenu'));
    bridge.on('collisionpick', ({ pieceId }) => events.push(`pick:${pieceId}`));

    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 });
    scene.input.emit('pointerdown', { worldX: treeTile.x, worldY: treeTile.y, isDown: true, event: { stopPropagation() {} } }, []);
    scene.input.emit('pointerup', { worldX: treeTile.x, worldY: treeTile.y, isDown: false, event: { stopPropagation() {} } }, []);

    expect(events).toEqual(['pick:tree-oak']);

    bridge.emitCommand('collisionedit', null);
    scene.input.emit('pointerdown', { worldX: treeTile.x, worldY: treeTile.y, isDown: true, event: { stopPropagation() {} } }, []);
    expect(events).toEqual(['pick:tree-oak', 'closemenu']);
  });

  it('a desk table in front of a walking avatar covers it, and one behind it does not (#213)', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([{ index: lawnChair.index, piece: 'desk-glass', rotation: 0 }]);
    const player = findPlayer(scene);
    const body = player.body as Phaser.Physics.Arcade.Body;
    await vi.waitFor(() => expect((scene.children.getByName(decorObjectName(lawnChair.index)) as Phaser.GameObjects.Image | null)?.texture.key).toBe(artSheetKey('desk-glass', 'sheet')), LOOP_WAIT);
    const desk = () => scene.children.getByName(decorObjectName(lawnChair.index)) as Phaser.GameObjects.Image;

    const behind = positionForFeet({ x: deskMiddle.x, y: deskMiddle.y - 20 });
    body.reset(behind.x, behind.y);
    await vi.waitFor(() => expect(player.depth).toBe(avatarDepth(feetOf(player).y)), LOOP_WAIT);
    expect(player.depth).toBeLessThan(desk().depth);

    const inFront = positionForFeet({ x: deskMiddle.x, y: deskMiddle.y + 24 });
    body.reset(inFront.x, inFront.y);
    await vi.waitFor(() => expect(feetOf(player).y).toBe(deskMiddle.y + 24), LOOP_WAIT);
    await vi.waitFor(() => expect(player.depth).toBe(avatarDepth(feetOf(player).y)), LOOP_WAIT);
    expect(player.depth).toBeGreaterThan(desk().depth);
  });

  it('keeps the tile helpers off a tile a rectangle touches', async () => {
    const { scene, handlers } = await bootConnected();
    const lawn = { tx: 67, ty: 22 };
    handlers.onCollisions!(new Map([['tree-oak', []]]));
    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[2]![2]).toBe(false);

    handlers.onCollisions!(new Map([['tree-oak', [{ x: -2, y: -4, w: 4, h: 4 }]]]));

    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[2]![2]).toBe(true);
    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[lawn.ty]![lawn.tx]).toBe(false);
  });
});

describe('OfficeScene: map zoom (map-zoom)', () => {
  const offline = { endpoint: null, artManifestUrl: null, artUploadsUrl: null } as const;
  /** The legacy 14x10-block layout is painted everywhere: its region is the grid plus three tiles a side (#179). */
  const REGION = { x: -3 * TILE, y: -3 * TILE, width: 14 * 9 * TILE + 6 * TILE, height: 10 * 9 * TILE + 6 * TILE };
  const memoryStore = (zoom: number) => ({ load: () => zoom, save: vi.fn() }) satisfies ZoomStore;

  async function zoomScene(zoomStore?: ZoomStore) {
    const bridge = createOfficeBridge();
    const views: ZoomView[] = [];
    bridge.on('zoomchanged', (view) => views.push(view));
    const { scene } = await bootOfficeScene(bridge, { ...offline, zoomStore });
    scene.game.loop.stop();
    return { scene, bridge, views, cam: scene.cameras.main, minimap: scene.cameras.cameras[1] };
  }

  function frames(scene: Phaser.Scene, count = 60): void {
    for (let frame = 0; frame < count; frame++) scene.game.step(scene.time.now + 16, 16);
  }

  /** A real mouse event on the canvas, at a point in canvas pixels. */
  function mouse(scene: Phaser.Scene, type: string, x: number, y: number): void {
    const rect = scene.game.canvas.getBoundingClientRect();
    scene.game.canvas.dispatchEvent(new MouseEvent(type, {
      clientX: rect.left + x, clientY: rect.top + y, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      bubbles: true, cancelable: true,
    }));
  }

  it('starts at the stored zoom with the terrain region bounds, announces it once and does not save it back', async () => {
    const store = memoryStore(1);
    const { scene, views, cam } = await zoomScene(store);
    frames(scene, 2);

    expect(cam.zoom).toBe(1);
    expect(cam.getBounds()).toMatchObject(regionBounds(REGION, cam, 1));
    expect(views).toEqual([zoomView(1)]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([
    ['a store that throws', { load: () => { throw new Error('blocked'); }, save: vi.fn() }],
    ['a value that is not a stop', memoryStore(1.3)],
    ['the retired 1.5 stop', memoryStore(1.5)],
    ['zero', memoryStore(0)],
  ])('starts at the default with %s', async (_name, store) => {
    const { scene, views, cam } = await zoomScene(store);
    frames(scene, 2);

    expect(cam.zoom).toBe(2);
    expect(cam.getBounds()).toMatchObject(regionBounds(REGION, cam, 2));
    expect(views).toEqual([zoomView(2)]);
  });

  it('without a store the office starts at the default zoom 2 (2x)', async () => {
    const { scene, views, cam } = await zoomScene();
    frames(scene, 2);

    expect(cam.zoom).toBe(2);
    expect(views).toEqual([zoomView(2)]);
  });

  it.each([
    ['no edit tool', () => undefined],
    ['the layout editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null })],
    ['the terrain editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('terrainedit', { brush: null })],
    ['the collision editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 })],
  ])('the zoom command eases the main camera only and saves the stop, with %s open', async (_name, open) => {
    const store = memoryStore(2);
    const { scene, bridge, cam, minimap } = await zoomScene(store);
    open(bridge);
    const minimapView = { zoom: minimap.zoom, x: minimap.scrollX, y: minimap.scrollY };

    bridge.emitCommand('zoom', { action: 'in' });
    frames(scene);

    expect(cam.zoom).toBe(3);
    expect(store.save).toHaveBeenCalledExactlyOnceWith(3);
    expect({ zoom: minimap.zoom, x: minimap.scrollX, y: minimap.scrollY }).toEqual(minimapView);
  });

  it('a real ctrl+wheel over the map zooms it and is default-prevented, so the page does not zoom', async () => {
    const { scene, views } = await zoomScene();
    const rect = scene.game.canvas.getBoundingClientRect();
    // Below the minimap, which covers the top of this small canvas.
    const wheel = new WheelEvent('wheel', {
      deltaY: -100, ctrlKey: true, clientX: rect.left + 50, clientY: rect.top + 200, bubbles: true, cancelable: true,
    });

    scene.game.canvas.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(views.at(-1)).toEqual(zoomView(3));
  });

  it('with a chair picked in the decor editor the wheel turns it and does not zoom; with a plant it zooms again (#207)', async () => {
    const { scene, bridge, views } = await zoomScene();
    const turns: number[] = [];
    bridge.on('decorrotate', ({ step }) => turns.push(step));
    const rect = scene.game.canvas.getBoundingClientRect();
    const spin = (): void => {
      scene.game.canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -100, ctrlKey: true, clientX: rect.left + 50, clientY: rect.top + 200, bubbles: true, cancelable: true,
      }));
    };
    const chair = { kind: 'chair', footprint: { w: 1, h: 1 } } as const;
    const plant = { kind: 'plant', footprint: { w: 1, h: 1 } } as const;

    bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'chair-wood', info: chair, rotation: 0 }, area: null });
    spin();
    expect(turns).toEqual([-1]);
    expect(views).toEqual([zoomView(2)]);

    bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'plant-ficus', info: plant, rotation: 0 }, area: null });
    spin();
    expect(turns).toEqual([-1]);
    expect(views.at(-1)).toEqual(zoomView(3));
  });

  it('with a room table picked the wheel turns it too and does not zoom (#207, #208)', async () => {
    const { scene, bridge, views } = await zoomScene();
    const turns: number[] = [];
    bridge.on('decorrotate', ({ step }) => turns.push(step));
    const rect = scene.game.canvas.getBoundingClientRect();
    const spin = (): void => {
      scene.game.canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -100, ctrlKey: true, clientX: rect.left + 50, clientY: rect.top + 200, bubbles: true, cancelable: true,
      }));
    };

    bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'table-meeting', info: { kind: 'table', footprint: { w: 7, h: 5 } }, rotation: 0 }, area: null });
    spin();
    expect(turns).toEqual([-1]);
    expect(views).toEqual([zoomView(2)]);
  });

  it.each([
    { zoom: 1, tile: { tx: PLAYER_SPAWN_TX + 2, ty: PLAYER_SPAWN_TY + 2 } },
    { zoom: 3, tile: { tx: PLAYER_SPAWN_TX + 1, ty: PLAYER_SPAWN_TY + 1 } },
  ])('double-click-to-walk at $zoom targets the world tile under the pointer', async ({ zoom, tile }) => {
    const { scene } = await zoomScene(memoryStore(zoom));
    frames(scene, 3);
    const player = findPlayer(scene);
    const cam = scene.cameras.main;

    // 64 canvas px right and down of the center, where the camera holds the player.
    mouse(scene, 'mousemove', cam.width / 2 + 64, cam.height / 2 + 64);
    // Two real press and release pairs on the same point: the double click that walks.
    for (let pair = 0; pair < 2; pair++) {
      mouse(scene, 'mousedown', cam.width / 2 + 64, cam.height / 2 + 64);
      mouse(scene, 'mouseup', cam.width / 2 + 64, cam.height / 2 + 64);
      if (pair === 0) expect((scene as unknown as { autoWalk?: AutoWalkState }).autoWalk).toBeUndefined();
    }

    const goal = (scene as unknown as { autoWalk?: AutoWalkState }).autoWalk?.goal;
    expect(goal).toBeDefined();
    expect(goal!.x).toBeCloseTo(player.x + 64 / zoom, -1);
    expect(goal!.y).toBeCloseTo(player.y + 64 / zoom, -1);
    expect({ tx: Math.floor(goal!.x / TILE), ty: Math.floor(goal!.y / TILE) }).toEqual(tile);
  });

  it.each(['SHUTDOWN', 'game.destroy'])('%s releases the zoom subscription', async (how) => {
    const { scene, bridge, views } = await zoomScene();
    bridge.emitCommand('zoom', { action: 'in' });
    expect(views.at(-1)).toEqual(zoomView(3));

    if (how === 'SHUTDOWN') {
      scene.scene.stop();
      frames(scene, 2);
    } else {
      scene.game.destroy(true);
      scene.game.step(0, 0);
      games.splice(games.indexOf(scene.game), 1);
    }
    bridge.emitCommand('zoom', { action: 'out' });

    expect(views.at(-1)).toEqual(zoomView(3));
  });
});

/**
 * The office decor layer (#208): every item the room replicates is drawn on
 * its anchor tile by its kind, whoever's desk it stands on, and collides by
 * its piece's rectangles.
 */
describe('OfficeScene: the office decor layer (#208)', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number): number => ty * W + tx;

  async function bootConnected(options: OfficeSceneOptions = {}) {
    const connector = fakeConnector();
    const booted = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://test', connect: connector.connect, ...options });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { ...booted, handlers: connector.handlers()! };
  }

  function image(scene: Phaser.Scene, index: number): Phaser.GameObjects.Image | null {
    const found = scene.children.getByName(decorObjectName(index));
    return found?.type === 'Image' ? (found as Phaser.GameObjects.Image) : null;
  }

  function solidAt(scene: Phaser.Scene, x: number, y: number): boolean {
    return scene.physics.world.staticBodies.getArray().some((body) => body.hitTest(x, y));
  }

  it('draws a desk table 1:1 centered on its middle tile, in the column of its facing', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([
      { index: at(11, 12), piece: 'desk-wood', rotation: 180 },
      { index: at(22, 13), piece: 'desk-glass', rotation: 90 },
    ]);

    await vi.waitFor(() => {
      const top = image(scene, at(11, 12));
      // The anchor (48, 60) of a 96x104 cell on the middle of tile (11, 12).
      expect({ x: top?.x, y: top?.y, w: top?.displayWidth, h: top?.displayHeight, frame: Number(top?.frame.name) }).toEqual({
        x: 11.5 * TILE - 48,
        y: 12.5 * TILE - 60,
        w: 96,
        h: 104,
        frame: 0,
      });
      const side = image(scene, at(22, 13));
      expect(side?.texture.key).toBe(artSheetKey('desk-glass', 'sheet'));
      // Turned right: the pack's fourth column.
      expect({ x: side?.x, y: side?.y, frame: Number(side?.frame.name) }).toEqual({ x: 22.5 * TILE - 48, y: 13.5 * TILE - 60, frame: 3 });
    }, LOOP_WAIT);
  });

  it('draws a plant and a room table 1:1 on the bottom middle of their footprint, centered on the anchor', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([
      { index: at(30, 20), piece: 'plant-ficus', rotation: 0 },
      { index: at(40, 40), piece: 'table-meeting', rotation: 0 },
    ]);

    await vi.waitFor(() => {
      const plant = image(scene, at(30, 20));
      // A 32x48 frame anchored at (16, 46) on the bottom middle of tile (30, 20).
      expect({ x: plant?.x, y: plant?.y, key: plant?.texture.key }).toEqual({ x: 30 * TILE, y: 21 * TILE - 46, key: artSheetKey('plant-ficus', 'sheet') });
      expect(plant!.depth).toBe(worldAssetDepth(21 * TILE));
      const table = image(scene, at(40, 40));
      // The 7x5 footprint runs from tile (37, 38); its bottom middle is (40.5, 43) tiles, the frame's anchor (128, 244).
      expect({ x: table?.x, y: table?.y, frame: Number(table?.frame.name) }).toEqual({ x: 40.5 * TILE - 128, y: 43 * TILE - 244, frame: 0 });
    }, LOOP_WAIT);
  });

  it('draws a vertical room table (90) in its sheet\'s second frame on the bottom middle of its swapped footprint', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([
      { index: at(40, 40), piece: 'table-meeting', rotation: 90 },
      { index: at(60, 40), piece: 'table-oval', rotation: 0 },
    ]);

    await vi.waitFor(() => {
      const table = image(scene, at(40, 40));
      // 5x7 from tile (38, 37): its bottom middle is (40.5, 44) tiles, the frame's anchor (128, 244).
      expect({ x: table?.x, y: table?.y, frame: Number(table?.frame.name) }).toEqual({ x: 40.5 * TILE - 128, y: 44 * TILE - 244, frame: 1 });
      const oval = image(scene, at(60, 40));
      // 2x1 from tile (59, 40): its bottom middle is (60, 41) tiles.
      expect({ x: oval?.x, y: oval?.y, frame: Number(oval?.frame.name), key: oval?.texture.key }).toEqual({
        x: 60 * TILE - 128,
        y: 41 * TILE - 244,
        frame: 0,
        key: artSheetKey('table-oval', 'sheet'),
      });
    }, LOOP_WAIT);
  });

  it('draws a painted desk table in its own color, and in the manifest default without one', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([
      { index: at(11, 12), piece: 'desk-painted', rotation: 0, color: '#c83c3c' },
      { index: at(21, 12), piece: 'desk-painted', rotation: 0 },
    ]);

    await vi.waitFor(() => {
      expect(image(scene, at(11, 12))?.texture.key).toBe(recoloredSheetKey('desk-painted', 'sheet', '#c83c3c'));
      expect(image(scene, at(21, 12))?.texture.key).toBe(artSheetKey('desk-painted', 'sheet'));
    }, LOOP_WAIT);
  });

  it('draws a chair in both of its layers around its ground point', async () => {
    const { scene, handlers } = await bootConnected();
    handlers.onDecor!([{ index: at(30, 30), piece: 'chair-leather', rotation: 270 }]);

    await vi.waitFor(() => {
      const layers = scene.children.list.filter(
        (child) => child.name === CHAIR_OBJECT_NAME && child.type === 'Image' && (child as Phaser.GameObjects.Image).texture.key === artSheetKey('chair-leather', 'sheet'),
      );
      expect(layers.map((layer) => (layer as Phaser.GameObjects.Image).depth).sort((a, b) => a - b)).toEqual([
        chairLayerDepth(30.5 * TILE, 'back'),
        chairLayerDepth(30.5 * TILE, 'front'),
      ]);
    }, LOOP_WAIT);
  });

  it('keeps a placeholder on the footprint of a piece no catalog knows, and goes when the room drops it', async () => {
    const { scene, handlers } = await bootConnected({ artUploadsUrl: null });
    handlers.onDecor!([{ index: at(50, 50), piece: 'plant-nowhere', rotation: 0 }]);
    const placeholder = scene.children.getByName(decorObjectName(at(50, 50))) as Phaser.GameObjects.Rectangle;
    expect(placeholder.type).toBe('Rectangle');
    expect([placeholder.x, placeholder.y]).toEqual([50.5 * TILE, 50.5 * TILE]);

    handlers.onDecor!([]);
    expect(scene.children.getByName(decorObjectName(at(50, 50)))).toBeNull();
  });

  it('collides with a room table once a catalog read later knows its footprint, and redraws it', async () => {
    const { scene, handlers } = await bootConnected({ artUploadsUrl: null });
    const art = (scene as unknown as { art: ArtPackLoader }).art;
    const meeting = art.manifest!.pieces.find((piece) => piece.id === 'table-meeting')!;
    const upload = { ...meeting, id: 'table-upload-0123456789abcdef' };
    // Three tiles left of the anchor: inside the 7x5 footprint, outside the anchor tile.
    const inside = { x: 37 * TILE + 16, y: 40 * TILE + 16 };

    handlers.onDecor!([{ index: at(40, 40), piece: upload.id, rotation: 0 }]);
    expect(solidAt(scene, inside.x, inside.y)).toBe(false);

    // The uploads catalog grows while the scene re-reads for the unknown piece.
    art.adoptManifest({ ...art.manifest!, pieces: [upload] }, 'uploads');

    await vi.waitFor(() => {
      expect(solidAt(scene, inside.x, inside.y)).toBe(true);
      expect(image(scene, at(40, 40))?.texture.key).toBe(artSheetKey(upload.id, 'sheet'));
    }, LOOP_WAIT);
  });
});

/**
 * At most `MAX_DESK_OCCUPANCY` people inside a desk's 3x3 area: the room
 * drops the move that would take one more in, so the local player never
 * walks in either (the client is the stricter side), by keys or auto-walk,
 * and hears why once per attempt. Its seats are not offered either.
 */
describe('OfficeScene: a full desk takes nobody else in', () => {
  const DESK_TX = 12;
  const DESK_TY = 8;
  const desk: OfficeDesk = { id: 'id-llena', label: '', x: DESK_TX * TILE, y: DESK_TY * TILE, w: 3 * TILE, h: 3 * TILE, occupant: null, mine: false };
  /** Six peers on the desk's two right columns, so its left column stays free ground. */
  const peers = Array.from({ length: 6 }, (_, i) => remoteSnapshot({
    sessionId: `par-${i}`, x: (DESK_TX + 1 + (i % 2)) * TILE + 16, y: (DESK_TY + Math.floor(i / 2)) * TILE + 16,
  }));
  const insideDesk = (point: { x: number; y: number }) =>
    point.x >= DESK_TX * TILE && point.x < (DESK_TX + 3) * TILE && point.y >= DESK_TY * TILE && point.y < (DESK_TY + 3) * TILE;

  async function fullDesk() {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const notices: number[] = [];
    arena.bridge.on('deskfull', () => notices.push(arena.scene.time.now));
    arena.bridge.emitCommand('desks', { desks: [desk] });
    for (const peer of peers) connector.handlers()!.onAdd(peer);
    // Level with the desk's middle row, two tiles left of it.
    arena.body.reset((DESK_TX - 2) * TILE + 16, (DESK_TY + 1) * TILE + 16);
    return { ...arena, connector, notices };
  }

  it('stops the player at the edge, says so once per push, and lets it in once someone leaves', async () => {
    const { player, movement, walk, connector, notices } = await fullDesk();

    movement.cursors.right.isDown = true;
    walk(1500);
    expect(insideDesk(player)).toBe(false);
    expect(player.x).toBeGreaterThan((DESK_TX - 1) * TILE);
    expect(connector.sent.some(insideDesk)).toBe(false);
    expect(notices).toHaveLength(1);

    movement.cursors.right.isDown = false;
    walk(100);
    movement.cursors.right.isDown = true;
    walk(300);
    expect(notices).toHaveLength(2);

    connector.handlers()!.onRemove('par-0');
    walk(300);
    expect(insideDesk(player)).toBe(true);
    movement.cursors.right.isDown = false;
  });

  it('ends an auto-walk into it at the edge', async () => {
    const { player, movement, walk, doubleClick, notices } = await fullDesk();

    doubleClick(DESK_TX * TILE + 16, (DESK_TY + 1) * TILE + 16);
    expect(movement.autoWalk).toBeDefined();
    walk(2000);

    expect(movement.autoWalk).toBeUndefined();
    expect(insideDesk(player)).toBe(false);
    expect(notices).toHaveLength(1);
  });
});
