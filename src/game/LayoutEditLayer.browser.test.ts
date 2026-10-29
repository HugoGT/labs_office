import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { PAN_THRESHOLD_PX } from './cameraPan';
import {
  LAYOUT_DELETE_BUTTON_NAME,
  LAYOUT_MOVE_BUTTON_NAME,
  LAYOUT_SELECTION_NAME,
  LayoutEditLayer,
  layoutPickName,
} from './LayoutEditLayer';
import { MAP_H, TILE } from './mapData';
import { SELECTION_BUTTON_PX, SELECTION_DELETE_COLOR } from './selectionButtons';
import { createOfficeBridge } from './officeBridge';

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
});
