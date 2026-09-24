import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutEditLayer, layoutPickName } from './LayoutEditLayer';
import { TILE } from './mapData';
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

const LOOP_WAIT = { timeout: 20000, interval: 50 } as const;
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

  await vi.waitFor(() => {
    expect(game.scene.getScene(HOST_SCENE_KEY)?.scene.settings.status).toBe(Phaser.Scenes.RUNNING);
  }, LOOP_WAIT);

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
