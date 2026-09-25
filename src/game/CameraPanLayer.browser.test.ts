import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CameraPanLayer, type CameraPanLayerOptions } from './CameraPanLayer';

/**
 * `CameraPanLayer` traduce input real de puntero a `reduceCameraPan` y aplica
 * el efecto sobre `cameras.main`, asi que necesita un `Phaser.Game` real --
 * misma escena anfitriona minima que `LayoutEditLayer.browser.test.ts`, la
 * capa no depende de nada de `OfficeScene`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const LOOP_WAIT = { timeout: 20000, interval: 50 } as const;
const HOST_SCENE_KEY = 'camera-pan-layer-host';
const WORLD = { x: 0, y: 0, width: 2000, height: 2000 } as const;

class HostScene extends Phaser.Scene {
  target!: Phaser.GameObjects.Rectangle;
  constructor() {
    super(HOST_SCENE_KEY);
  }
  create(): void {
    this.target = this.add.rectangle(400, 300, 4, 4);
    this.cameras.main.setBounds(WORLD.x, WORLD.y, WORLD.width, WORLD.height);
  }
}

async function bootHostScene(): Promise<HostScene> {
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

  return game.scene.getScene(HOST_SCENE_KEY) as HostScene;
}

function layerOptions(
  scene: HostScene,
  overrides: Partial<CameraPanLayerOptions> = {},
): CameraPanLayerOptions {
  return {
    scene,
    camera: scene.cameras.main,
    target: scene.target,
    lerp: 0.12,
    worldBounds: WORLD,
    isSuspended: () => false,
    ...overrides,
  };
}

/** Un cuadro completo del bucle real: update (donde planea la capa) + render (donde Phaser clampa). */
function nextFrame(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve) => scene.game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve()));
}

function fakePointer(
  overrides: Partial<{
    x: number;
    y: number;
    button: number;
    camera: Phaser.Cameras.Scene2D.Camera;
  }> = {},
): Phaser.Input.Pointer {
  return { x: 0, y: 0, button: 0, camera: undefined, ...overrides } as unknown as Phaser.Input.Pointer;
}

describe('CameraPanLayer: click por debajo del umbral deja el seguimiento intacto', () => {
  it('un down+up sin cruzar el umbral no toca stopFollow ni el scroll', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const stopFollow = vi.spyOn(cam, 'stopFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 102, y: 101, camera: cam }));
    scene.input.emit('pointerup', fakePointer({ x: 102, y: 101, camera: cam }));

    expect(stopFollow).not.toHaveBeenCalled();
  });
});

describe('CameraPanLayer: drag por encima del umbral desplaza la camara', () => {
  it('el scroll se mueve por -delta/zoom desde el ULTIMO move, no por el delta crudo desde el origen', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.setZoom(2);
    const startScrollX = cam.scrollX;
    const startScrollY = cam.scrollY;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 120, y: 90, camera: cam }));
    // dx=20, dy=-10, zoom=2 -> scrollX -= 10, scrollY -= -5.
    expect(cam.scrollX).toBeCloseTo(startScrollX - 10);
    expect(cam.scrollY).toBeCloseTo(startScrollY + 5);

    scene.input.emit('pointermove', fakePointer({ x: 130, y: 90, camera: cam }));
    // Segundo tramo: solo 10px mas (130-120)/zoom=2 -> 5, no (130-100)/2=15.
    expect(cam.scrollX).toBeCloseTo(startScrollX - 15);
  });
});

describe('CameraPanLayer: soltar reanuda el seguimiento sin saltar', () => {
  it('el scroll justo tras soltar es el mismo que paneando, y luego converge de vuelta al target', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 300, y: 100, camera: cam }));
    const scrollAtRelease = cam.scrollX;
    scene.input.emit('pointerup', fakePointer({ x: 300, y: 100, camera: cam }));

    // `startFollow` salta el scroll de golpe (Camera.js): el `setScroll`
    // posterior debe devolverlo al mismo punto, no dejarlo en el del target.
    expect(cam.scrollX).toBeCloseTo(scrollAtRelease);
    // Y a partir de ahi el `preRender` de cada cuadro lo va acercando de
    // vuelta -- el "glide" sin tween aparte.
    await vi.waitFor(() => {
      expect(cam.scrollX).not.toBeCloseTo(scrollAtRelease, 0);
    }, LOOP_WAIT);
  });

  it('pointerupoutside termina el pan igual que pointerup', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 130, y: 100, camera: cam }));
    scene.input.emit('pointerupoutside', fakePointer({ x: 130, y: 100, camera: cam }));

    await vi.waitFor(() => expect(startFollow).toHaveBeenCalledTimes(1), LOOP_WAIT);
  });
});

describe('CameraPanLayer: guardas que impiden armar el pan', () => {
  it('editor de layout activo, clic sobre algo interactivo, o boton distinto del izquierdo: ninguno arma pan', async () => {
    const guards: Array<{
      isSuspended: () => boolean;
      currentlyOver: Phaser.GameObjects.GameObject[];
      button: number;
    }> = [
      // isSuspended (editor de layout activo).
      { isSuspended: () => true, currentlyOver: [], button: 0 },
      // currentlyOver no vacio (clic sobre un peer/escritorio/pick).
      { isSuspended: () => false, currentlyOver: [{} as Phaser.GameObjects.GameObject], button: 0 },
      // Boton distinto del izquierdo.
      { isSuspended: () => false, currentlyOver: [], button: 2 },
    ];

    for (const guard of guards) {
      const scene = await bootHostScene();
      const cam = scene.cameras.main;
      const startScrollX = cam.scrollX;
      new CameraPanLayer(layerOptions(scene, { isSuspended: guard.isSuspended }));

      scene.input.emit(
        'pointerdown',
        fakePointer({ x: 100, y: 100, button: guard.button, camera: cam }),
        guard.currentlyOver,
      );
      scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

      expect(cam.scrollX).toBe(startScrollX);
    }
  });

  it('un down sobre la camara del minimapa no arma pan en la camara principal, y el minimapa nunca se toca', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const minimap = scene.cameras.add(200, 0, 100, 100);
    const startScrollX = cam.scrollX;
    const minimapScrollX = minimap.scrollX;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 50, camera: minimap }), []);
    scene.input.emit('pointermove', fakePointer({ x: 280, y: 50, camera: minimap }));

    expect(cam.scrollX).toBe(startScrollX);
    expect(minimap.scrollX).toBe(minimapScrollX);
  });
});

describe('CameraPanLayer: destroy', () => {
  it('destroy() retira los listeners: eventos posteriores no hacen nada', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startScrollX = cam.scrollX;
    const layer = new CameraPanLayer(layerOptions(scene));
    layer.destroy();

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

    expect(cam.scrollX).toBe(startScrollX);
  });
});

describe('CameraPanLayer: la vista mas grande que el mundo sigue paneando (#53)', () => {
  it('con bounds mas chicos que el canvas, el drag mueve la camara y el clamp del cuadro siguiente no lo deshace', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    // Mundo 200x150 en un canvas 320x240: el mismo caso que 2048x1408 en un
    // monitor 2560x1440, donde `setBounds` al mundo dejaba el scroll fijo.
    const world = { x: 0, y: 0, width: 200, height: 150 };
    cam.setBounds(world.x, world.y, world.width, world.height);
    await nextFrame(scene);
    const startScrollX = cam.scrollX;
    const startScrollY = cam.scrollY;
    new CameraPanLayer(layerOptions(scene, { worldBounds: world }));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 160, y: 140, camera: cam }));
    await nextFrame(scene);

    expect(cam.scrollX).toBeCloseTo(startScrollX - 60);
    expect(cam.scrollY).toBeCloseTo(startScrollY - 40);

    scene.input.emit('pointerup', fakePointer({ x: 160, y: 140, camera: cam }));
  });

  it('al soltar planea de vuelta y, al llegar, repone los bounds del mundo y el seguimiento', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 300, y: 250, camera: cam }));
    scene.input.emit('pointerup', fakePointer({ x: 300, y: 250, camera: cam }));

    await vi.waitFor(() => expect(startFollow).toHaveBeenCalledTimes(1), LOOP_WAIT);
    const bounds = cam.getBounds();
    expect([bounds.x, bounds.y, bounds.width, bounds.height]).toEqual([
      WORLD.x,
      WORLD.y,
      WORLD.width,
      WORLD.height,
    ]);
    // Aterriza donde el seguimiento la habria dejado: el target centrado.
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
    expect(cam.midPoint.y).toBeCloseTo(scene.target.y, 0);
  });
});

describe('CameraPanLayer: click en el minimapa (#98)', () => {
  async function addMinimap(scene: HostScene): Promise<Phaser.Cameras.Scene2D.Camera> {
    // 100x100 arriba a la derecha, viendo el mundo entero: su centro de
    // pantalla (250, 50) es el centro del mundo (1000, 1000).
    const minimap = scene.cameras.add(200, 0, 100, 100);
    minimap.setZoom(100 / WORLD.width);
    minimap.centerOn(WORLD.width / 2, WORLD.height / 2);
    // `getWorldPoint` lee la matriz que calcula el `preRender` del minimapa:
    // en la oficina real siempre hubo un render antes del primer clic.
    await nextFrame(scene);
    return minimap;
  }

  it('planea la camara principal hasta centrar el punto clicado y la deja ahi mientras el jugador no se mueve', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    const minimap = await addMinimap(scene);
    const minimapScrollX = minimap.scrollX;
    new CameraPanLayer(layerOptions(scene, { minimap }));

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 50, camera: minimap }), []);
    // Planeo, no salto: el cuadro siguiente todavia no llego.
    await nextFrame(scene);
    expect(cam.midPoint.x).not.toBeCloseTo(1000, 0);

    await vi.waitFor(() => {
      expect(cam.midPoint.x).toBeCloseTo(1000, 0);
      expect(cam.midPoint.y).toBeCloseTo(1000, 0);
    }, LOOP_WAIT);
    // Sigue ahi unos cuadros despues: el seguimiento no la reclamo.
    await nextFrame(scene);
    await nextFrame(scene);
    expect(cam.midPoint.x).toBeCloseTo(1000, 0);
    expect(minimap.scrollX).toBe(minimapScrollX);
  });

  it('en cuanto el jugador se mueve, la camara vuelve a seguirlo', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const minimap = await addMinimap(scene);
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene, { minimap }));

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 50, camera: minimap }), []);
    await vi.waitFor(() => expect(cam.midPoint.x).toBeCloseTo(1000, 0), LOOP_WAIT);

    scene.target.x += 32;

    await vi.waitFor(() => expect(startFollow).toHaveBeenCalledTimes(1), LOOP_WAIT);
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
  });

  it('boton derecho o editor de layout activo: el minimapa no mueve la camara', async () => {
    for (const guard of [
      { button: 2, isSuspended: () => false },
      { button: 0, isSuspended: () => true },
    ]) {
      const scene = await bootHostScene();
      const cam = scene.cameras.main;
      const minimap = await addMinimap(scene);
      await nextFrame(scene);
      const startScrollX = cam.scrollX;
      new CameraPanLayer(layerOptions(scene, { minimap, isSuspended: guard.isSuspended }));

      scene.input.emit(
        'pointerdown',
        fakePointer({ x: 250, y: 50, button: guard.button, camera: minimap }),
        [],
      );
      await nextFrame(scene);
      await nextFrame(scene);

      expect(cam.scrollX).toBe(startScrollX);
    }
  });
});
