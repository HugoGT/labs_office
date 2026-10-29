import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { PAN_THRESHOLD_PX } from './cameraPan';
import { DECOR_DELETE_COLOR } from './DecorEditLayer';
import {
  LAYOUT_DELETE_BUTTON_NAME,
  LAYOUT_MOVE_BUTTON_NAME,
  LAYOUT_REPLACED_NAME,
  LAYOUT_SELECTION_NAME,
  isLayoutPickName,
  LayoutEditLayer,
  layoutPickName,
} from './LayoutEditLayer';
import { MAP_H, TILE } from './mapData';
import { SELECTION_BUTTON_PX, SELECTION_DELETE_COLOR } from './selectionButtons';
import { createOfficeBridge } from './officeBridge';
import { decorInfoFromPieceId, type DecorItem } from './officeDecor';
import { HOLD_TO_MOVE_MS } from './pressHold';

/**
 * `LayoutEditLayer` dibuja overlays reales de Phaser (contornos pickable,
 * ghost de colocacion) y traduce input real, asi que se prueba dentro de un
 * `Phaser.Game` real, igual que `OfficeScene.browser.test.ts` -- pero con
 * una escena anfitriona minima: la capa no depende de nada de `OfficeScene`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'layout-edit-layer-host';

class HostScene extends Phaser.Scene {
  constructor() {
    super(HOST_SCENE_KEY);
  }
}

async function bootHostScene(): Promise<Phaser.Scene> {
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
    scene: [new HostScene()],
  });
  games.push(game);

  await waitForSceneRunning(game, HOST_SCENE_KEY);

  return game.scene.getScene(HOST_SCENE_KEY) as Phaser.Scene;
}

function fakePointer(worldX = 0, worldY = 0): Phaser.Input.Pointer {
  return { worldX, worldY, event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
}

function findPickable(scene: Phaser.Scene, id: string): Phaser.GameObjects.Rectangle | null {
  return scene.children.getByName(layoutPickName(id)) as Phaser.GameObjects.Rectangle | null;
}

function findGhost(scene: Phaser.Scene): Phaser.GameObjects.Rectangle | undefined {
  return scene.children.list.find(
    (child): child is Phaser.GameObjects.Rectangle => child.type === 'Rectangle' && child.name === '',
  );
}

describe('LayoutEditLayer: contorno pickable', () => {
  it('previews and confirms a whole office room on exactly the chosen block', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const placements: unknown[] = [];
    bridge.on('layoutplace', (value) => placements.push(value));
    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: { w: 9, h: 9, snap: 'block', obstacles: [] } });
    const pointer = fakePointer(67 * TILE, 49 * TILE);
    scene.input.emit('pointermove', pointer);
    expect(findGhost(scene)?.x).toBe((63 + 4.5) * TILE);
    expect(findGhost(scene)?.y).toBe((45 + 4.5) * TILE);
    scene.input.emit('pointerdown', pointer);
    expect(placements).toEqual([{ tx: 63, ty: 45, valid: true }]);
  });
  it('dibuja un contorno del tamano exacto por cada rectangulo pickable', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [{ id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 }],
      selectedId: null,
      placing: null,
    });

    const zone = findPickable(scene, 'desk-1');
    expect(zone).not.toBeNull();
    expect(zone!.width).toBe(3 * TILE);
    expect(zone!.height).toBe(3 * TILE);
    expect(zone!.isStroked).toBe(true);
    expect(zone!.isFilled).toBe(false);
  });

  it('un comando null retira todo lo dibujado', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [{ id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 }],
      selectedId: null,
      placing: null,
    });
    bridge.emitCommand('layoutedit', null);

    expect(findPickable(scene, 'desk-1')).toBeNull();
  });

  it('emite layoutpick con el id al clicar un rectangulo pickable', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const picks: unknown[] = [];
    bridge.on('layoutpick', (payload) => picks.push(payload));

    bridge.emitCommand('layoutedit', {
      pickable: [{ id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 }],
      selectedId: null,
      placing: null,
    });
    findPickable(scene, 'desk-1')!.emit('pointerdown', fakePointer());

    expect(picks).toEqual([{ id: 'desk-1' }]);
  });

  it('leaves a right click on a pickable rectangle to the scene, which walks with it', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const picks: unknown[] = [];
    bridge.on('layoutpick', (payload) => picks.push(payload));
    bridge.emitCommand('layoutedit', { pickable: [{ id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 }], selectedId: null, placing: null });

    const zone = findPickable(scene, 'desk-1')!;
    expect(isLayoutPickName(zone.name)).toBe(true);
    zone.emit('pointerdown', { ...fakePointer(), button: 2 });

    expect(picks).toEqual([]);
  });
});

describe('LayoutEditLayer: sala (kind !== desk) como contorno, no arte de piso (#74, PR4)', () => {
  it('una sala rectangular no cuadrada se dibuja como contorno del tamano exacto, sin relleno', async () => {
    // A diferencia de un escritorio (siempre 3x3), una sala puede tener
    // cualquier w/h: este pickable de 6x2 prueba que el contorno sigue el
    // rectangulo pedido y no un tamano fijo -- mismo codigo que un escritorio,
    // sin ninguna rama por `kind` (no existe tal campo en `PickableRect`).
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [{ id: 'room-1', x0: 3, y0: 3, x1: 8, y1: 4 }],
      selectedId: null,
      placing: null,
    });

    const zone = findPickable(scene, 'room-1');
    expect(zone).not.toBeNull();
    expect(zone!.width).toBe(6 * TILE);
    expect(zone!.height).toBe(2 * TILE);
    expect(zone!.isStroked).toBe(true);
    expect(zone!.isFilled).toBe(false);
  });

  it('mover el ghost de una sala solo redibuja el contorno: ningun tile de piso se toca', async () => {
    // No hay ninguna llamada a pintar terreno en este archivo -- `updateGhost`
    // solo reposiciona el rectangulo del ghost. Esta asercion prueba que el
    // unico objeto Phaser que cambia de posicion es el ghost mismo.
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [],
      selectedId: 'room-1',
      placing: { w: 6, h: 2, obstacles: [] },
    });
    const beforeCount = scene.children.list.length;
    scene.input.emit('pointermove', fakePointer(10 * TILE, 10 * TILE));
    const afterCount = scene.children.list.length;

    expect(afterCount).toBe(beforeCount);
    expect(findGhost(scene)!.width).toBe(6 * TILE);
    expect(findGhost(scene)!.height).toBe(2 * TILE);
  });
});

describe('LayoutEditLayer: ghost de colocacion', () => {
  it('pinta el ghost en verde cuando la posicion encajada no solapa ningun obstaculo', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [],
      selectedId: null,
      placing: { w: 3, h: 3, obstacles: [] },
    });
    scene.input.emit('pointermove', fakePointer(10 * TILE, 10 * TILE));

    const ghost = findGhost(scene);
    expect(ghost).toBeDefined();
    expect(ghost!.visible).toBe(true);
    expect(ghost!.fillColor).toBe(0x22c55e);
  });

  it('pinta el ghost en rojo cuando la posicion encajada solapa un obstaculo', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', {
      pickable: [],
      selectedId: null,
      placing: { w: 3, h: 3, obstacles: [{ x0: 8, y0: 8, x1: 10, y1: 10 }] },
    });
    scene.input.emit('pointermove', fakePointer(10 * TILE, 10 * TILE));

    expect(findGhost(scene)!.fillColor).toBe(0xef4444);
  });

  it('sin comando de colocacion activo, no hay ghost que mover', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);

    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    scene.input.emit('pointermove', fakePointer(10 * TILE, 10 * TILE));

    expect(findGhost(scene)).toBeUndefined();
  });
});

describe('LayoutEditLayer: what a move would erase', () => {
  const WIDTH = 40;
  const chair = (tx: number, ty: number): DecorItem => ({ index: ty * WIDTH + tx, piece: 'chair-wood', rotation: 0 });
  /** A 6x6 room at (4, 4) holding a chair; two more chairs elsewhere. */
  const ITEMS = [chair(5, 5), chair(21, 5), chair(30, 30)];
  const MOVING = { pickable: [{ id: 'r1', x0: 4, y0: 4, x1: 9, y1: 9 }], selectedId: null, placing: { w: 6, h: 6, obstacles: [], id: 'r1' } };

  function replacedOutlines(scene: Phaser.Scene): Phaser.GameObjects.Rectangle[] {
    return scene.children.list.filter(
      (child): child is Phaser.GameObjects.Rectangle => child.name === LAYOUT_REPLACED_NAME && (child as Phaser.GameObjects.Rectangle).visible,
    );
  }

  it('outlines in red the decor a moved room would erase where it lands, never what it carries', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge, { decor: { items: () => ITEMS, infoOf: decorInfoFromPieceId, width: WIDTH } });

    bridge.emitCommand('layoutedit', MOVING);
    // The room centered on (23, 7): tiles 20..25 x 4..9, over the chair at (21, 5).
    scene.input.emit('pointermove', fakePointer(23 * TILE, 7 * TILE));

    const [outline, ...rest] = replacedOutlines(scene);
    expect(rest).toEqual([]);
    expect(outline!.strokeColor).toBe(DECOR_DELETE_COLOR);
    expect([outline!.x, outline!.y, outline!.width, outline!.height]).toEqual([21.5 * TILE, 5.5 * TILE, TILE, TILE]);

    // One tile off its own place: its own chair stays under it, and nothing goes.
    scene.input.emit('pointermove', fakePointer(8 * TILE, 7 * TILE));
    expect(replacedOutlines(scene)).toEqual([]);
  });

  it('outlines nothing while creating, and drops the outlines when the move ends', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge, { decor: { items: () => ITEMS, infoOf: decorInfoFromPieceId, width: WIDTH } });

    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: { w: 6, h: 6, obstacles: [] } });
    scene.input.emit('pointermove', fakePointer(23 * TILE, 7 * TILE));
    expect(replacedOutlines(scene)).toEqual([]);

    bridge.emitCommand('layoutedit', MOVING);
    scene.input.emit('pointermove', fakePointer(23 * TILE, 7 * TILE));
    expect(replacedOutlines(scene)).toHaveLength(1);
    bridge.emitCommand('layoutedit', null);
    expect(replacedOutlines(scene)).toEqual([]);
  });
});

describe('LayoutEditLayer: confirmar colocacion', () => {
  it('un clic mientras se coloca emite layoutplace con la posicion encajada y su validez', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
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

  it('un clic mientras no se coloca nada no emite layoutplace', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const placements: unknown[] = [];
    bridge.on('layoutplace', (payload) => placements.push(payload));

    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    scene.input.emit('pointerdown', fakePointer(10 * TILE, 10 * TILE));

    expect(placements).toEqual([]);
  });
});

describe('LayoutEditLayer: the selected desk or room carries its move and trash buttons on the map', () => {
  const pickable = [
    { id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 },
    // Right under desk-1, where its buttons fall.
    { id: 'desk-2', x0: 2, y0: 5, x1: 4, y1: 7 },
  ];

  function named<T extends Phaser.GameObjects.GameObject>(scene: Phaser.Scene, name: string): T | null {
    return scene.children.getByName(name) as T | null;
  }

  function pointerAt(worldX: number, worldY: number, distance = 0): Phaser.Input.Pointer {
    return { worldX, worldY, button: 0, getDistance: () => distance, event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
  }

  /** A whole click as Phaser reports it: the press on what is under it, then the scene's press and release. */
  function clickAt(scene: Phaser.Scene, worldX: number, worldY: number, distance = 0): void {
    const tx = Math.floor(worldX / TILE);
    const ty = Math.floor(worldY / TILE);
    const under = pickable.find((rect) => tx >= rect.x0 && tx <= rect.x1 && ty >= rect.y0 && ty <= rect.y1);
    if (under !== undefined) findPickable(scene, under.id)!.emit('pointerdown', pointerAt(worldX, worldY));
    scene.input.emit('pointerdown', pointerAt(worldX, worldY));
    scene.input.emit('pointerup', pointerAt(worldX, worldY, distance));
  }

  function recorder(bridge: ReturnType<typeof createOfficeBridge>): unknown[] {
    const seen: unknown[] = [];
    bridge.on('layoutpick', (value) => seen.push(['pick', value]));
    bridge.on('layoutaction', (value) => seen.push(['action', value]));
    return seen;
  }

  it('outlines the selection and draws a move button and a red trash button under it, a screen size at any zoom', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });

    const outline = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_SELECTION_NAME)!;
    expect([outline.x, outline.y, outline.width, outline.height]).toEqual([3.5 * TILE, 3.5 * TILE, 3 * TILE, 3 * TILE]);
    expect(outline.visible).toBe(true);

    const move = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_MOVE_BUTTON_NAME)!;
    const trash = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_DELETE_BUTTON_NAME)!;
    expect(trash.fillColor).toBe(SELECTION_DELETE_COLOR);
    // Font glyphs, not drawn art: ↔ (U+2194) moves, 🗑 (U+1F5D1) deletes.
    const moveIcon = named<Phaser.GameObjects.Text>(scene, `${LAYOUT_MOVE_BUTTON_NAME}:icon`)!;
    const trashIcon = named<Phaser.GameObjects.Text>(scene, `${LAYOUT_DELETE_BUTTON_NAME}:icon`)!;
    expect(moveIcon.type).toBe('Text');
    expect(moveIcon.text).toBe('\u2194');
    expect(trashIcon.text).toBe('\u{1F5D1}');
    // The wastebasket fills its glyph box: at 10px it keeps a margin in the button.
    expect(trashIcon.style.fontSize).toBe('10px');
    expect([moveIcon.x, moveIcon.y, trashIcon.x, trashIcon.y]).toEqual([move.x, move.y, trash.x, trash.y]);
    expect(move.x).toBeLessThan(3.5 * TILE);
    expect(trash.x).toBeGreaterThan(3.5 * TILE);
    expect((move.x + trash.x) / 2).toBeCloseTo(3.5 * TILE);
    expect(move.getBounds().top).toBeGreaterThanOrEqual(5 * TILE);
    expect(move.getBounds().width).toBeCloseTo(SELECTION_BUTTON_PX);

    scene.cameras.main.setZoom(2);
    scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
    expect(named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_MOVE_BUTTON_NAME)!.getBounds().width).toBeCloseTo(SELECTION_BUTTON_PX / 2);
  });

  it('puts the buttons over a selection that reaches the bottom edge of the map', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    bridge.emitCommand('layoutedit', { pickable: [{ id: 'low', x0: 2, y0: MAP_H - 3, x1: 4, y1: MAP_H - 1 }], selectedId: 'low', placing: null });

    expect(named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_MOVE_BUTTON_NAME)!.getBounds().bottom).toBeLessThanOrEqual((MAP_H - 3) * TILE);
  });

  it('a click on the move button asks to move the selection, on the trash to delete it, and picks nothing under them', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const seen = recorder(bridge);
    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });

    const move = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_MOVE_BUTTON_NAME)!;
    const trash = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_DELETE_BUTTON_NAME)!;
    clickAt(scene, move.x, move.y);
    clickAt(scene, trash.x, trash.y);

    expect(seen).toEqual([
      ['action', { action: 'move', id: 'desk-1' }],
      ['action', { action: 'delete', id: 'desk-1' }],
    ]);
  });

  it('a click on the empty map lets the selection go; on another desk it only picks that one; a drag of the view does neither', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new LayoutEditLayer(scene, bridge);
    const seen = recorder(bridge);
    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });

    clickAt(scene, 20 * TILE, 20 * TILE, PAN_THRESHOLD_PX + 1);
    expect(seen).toEqual([]);

    clickAt(scene, 3.5 * TILE, 7.5 * TILE);
    clickAt(scene, 20 * TILE, 20 * TILE);

    expect(seen).toEqual([
      ['pick', { id: 'desk-2' }],
      ['action', { action: 'deselect', id: 'desk-1' }],
    ]);
  });

  it('shows no outline or buttons with nothing selected, while placing, or once the editor closes', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    const layer = new LayoutEditLayer(scene, bridge);
    const shown = (): boolean => named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_SELECTION_NAME)?.visible === true &&
      named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_MOVE_BUTTON_NAME)?.visible === true;
    const seen = recorder(bridge);

    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });
    expect(shown()).toBe(true);
    bridge.emitCommand('layoutedit', { pickable, selectedId: null, placing: null });
    expect(shown()).toBe(false);
    // With nothing selected, a click on the empty map has nothing to let go.
    clickAt(scene, 20 * TILE, 20 * TILE);
    expect(seen).toEqual([]);

    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });
    bridge.emitCommand('layoutedit', { pickable, selectedId: null, placing: { w: 3, h: 3, obstacles: [] } });
    expect(shown()).toBe(false);

    bridge.emitCommand('layoutedit', { pickable, selectedId: 'desk-1', placing: null });
    bridge.emitCommand('layoutedit', null);
    expect(shown()).toBe(false);
    layer.destroy();
    expect(named(scene, LAYOUT_SELECTION_NAME)).toBeNull();
    expect(named(scene, LAYOUT_MOVE_BUTTON_NAME)).toBeNull();
  });

  describe('a press held on a desk or room drags it: the release puts it down', () => {
    /** A press on what is under it, then the scene's press: no release yet. */
    function pressAt(scene: Phaser.Scene, worldX: number, worldY: number): void {
      const tx = Math.floor(worldX / TILE);
      const ty = Math.floor(worldY / TILE);
      const under = pickable.find((rect) => tx >= rect.x0 && tx <= rect.x1 && ty >= rect.y0 && ty <= rect.y1);
      if (under !== undefined) findPickable(scene, under.id)!.emit('pointerdown', pointerAt(worldX, worldY));
      scene.input.emit('pointerdown', pointerAt(worldX, worldY));
    }

    function frame(scene: Phaser.Scene): void {
      scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
    }

    async function setupHold(selectedId: string | null = null) {
      const scene = await bootHostScene();
      const bridge = createOfficeBridge();
      const clock = { now: 1000 };
      new LayoutEditLayer(scene, bridge, { now: () => clock.now });
      const seen = recorder(bridge);
      bridge.on('layoutplace', (value) => seen.push(['place', value]));
      bridge.emitCommand('layoutedit', { pickable, selectedId, placing: null });
      /** What React answers to the move: the ghost of a 3x3 desk. */
      const moving = (obstacles: { x0: number; y0: number; x1: number; y1: number }[] = []) =>
        bridge.emitCommand('layoutedit', { pickable, selectedId: null, placing: { w: 3, h: 3, obstacles, id: 'desk-1' } });
      return { scene, clock, seen, moving };
    }

    it('held HOLD_TO_MOVE_MS it grabs the desk; released where it was, it is put down selected and nothing moves', async () => {
      const { scene, clock, seen, moving } = await setupHold();
      const x = 3.5 * TILE;
      const y = 3.5 * TILE;

      pressAt(scene, x, y);
      clock.now += HOLD_TO_MOVE_MS - 1;
      frame(scene);
      expect(seen).toEqual([['pick', { id: 'desk-1' }]]);

      clock.now += 1;
      frame(scene);
      expect(seen.at(-1)).toEqual(['action', { action: 'move', id: 'desk-1' }]);
      moving();
      scene.input.emit('pointerup', pointerAt(x + 2, y));
      frame(scene);
      frame(scene);

      expect(seen).toEqual([
        ['pick', { id: 'desk-1' }],
        ['action', { action: 'move', id: 'desk-1' }],
        ['action', { action: 'putdown', id: 'desk-1' }],
      ]);
    });

    it('dragged and released elsewhere it lands there, held by the tile it was grabbed by', async () => {
      const { scene, clock, seen, moving } = await setupHold();

      // Grabbed by its top-left tile.
      pressAt(scene, 2.5 * TILE, 2.5 * TILE);
      clock.now += HOLD_TO_MOVE_MS;
      frame(scene);
      moving();
      scene.input.emit('pointermove', pointerAt(12.5 * TILE, 10.5 * TILE, 300));
      scene.input.emit('pointerup', pointerAt(12.5 * TILE, 10.5 * TILE, 300));
      frame(scene);

      expect(seen.at(-1)).toEqual(['place', { tx: 12, ty: 10, valid: true }]);
    });

    it('a drag past the pan threshold grabs it at once, without waiting', async () => {
      const { scene, seen } = await setupHold();

      pressAt(scene, 3.5 * TILE, 3.5 * TILE);
      scene.input.emit('pointermove', pointerAt(3.5 * TILE + 20, 3.5 * TILE, PAN_THRESHOLD_PX + 1));

      expect(seen).toEqual([['pick', { id: 'desk-1' }], ['action', { action: 'move', id: 'desk-1' }]]);
    });

    it('a release before the move reaches the map waits for it; dropped where it does not fit, it is put down', async () => {
      const { scene, clock, seen, moving } = await setupHold();

      pressAt(scene, 3.5 * TILE, 3.5 * TILE);
      clock.now += HOLD_TO_MOVE_MS;
      frame(scene);
      scene.input.emit('pointerup', pointerAt(12.5 * TILE, 10.5 * TILE, 300));
      frame(scene);
      expect(seen).toHaveLength(2);

      moving([{ x0: 10, y0: 8, x1: 20, y1: 20 }]);
      frame(scene);
      expect(seen.at(-1)).toEqual(['action', { action: 'putdown', id: 'desk-1' }]);
    });

    it('released before HOLD_TO_MOVE_MS it stays a click; a press held on a button or the empty map grabs nothing', async () => {
      const { scene, clock, seen } = await setupHold('desk-1');
      const trash = named<Phaser.GameObjects.Rectangle>(scene, LAYOUT_DELETE_BUTTON_NAME)!;

      pressAt(scene, 3.5 * TILE, 3.5 * TILE);
      clock.now += HOLD_TO_MOVE_MS - 10;
      scene.input.emit('pointerup', pointerAt(3.5 * TILE, 3.5 * TILE));
      clock.now += HOLD_TO_MOVE_MS;
      frame(scene);

      pressAt(scene, trash.x, trash.y);
      clock.now += HOLD_TO_MOVE_MS;
      frame(scene);
      scene.input.emit('pointerup', pointerAt(trash.x, trash.y));

      pressAt(scene, 20 * TILE, 20 * TILE);
      clock.now += HOLD_TO_MOVE_MS;
      frame(scene);

      expect(seen).toEqual([['pick', { id: 'desk-1' }], ['action', { action: 'delete', id: 'desk-1' }]]);
    });
  });
});
