import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CameraPanLayer } from './CameraPanLayer';

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

class HostScene extends Phaser.Scene {
  target!: Phaser.GameObjects.Rectangle;
  constructor() {
    super(HOST_SCENE_KEY);
  }
  create(): void {
    this.target = this.add.rectangle(400, 300, 4, 4);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
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
    new CameraPanLayer({ scene, camera: cam, target: scene.target, lerp: 0.12, isSuspended: () => false });

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
    new CameraPanLayer({ scene, camera: cam, target: scene.target, lerp: 0.12, isSuspended: () => false });

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
    new CameraPanLayer({ scene, camera: cam, target: scene.target, lerp: 0.12, isSuspended: () => false });

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
    new CameraPanLayer({ scene, camera: cam, target: scene.target, lerp: 0.12, isSuspended: () => false });

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 130, y: 100, camera: cam }));
    scene.input.emit('pointerupoutside', fakePointer({ x: 130, y: 100, camera: cam }));

    expect(startFollow).toHaveBeenCalledTimes(1);
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
      new CameraPanLayer({
        scene,
        camera: cam,
        target: scene.target,
        lerp: 0.12,
        isSuspended: guard.isSuspended,
      });

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
    new CameraPanLayer({ scene, camera: cam, target: scene.target, lerp: 0.12, isSuspended: () => false });

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
    const layer = new CameraPanLayer({
      scene,
      camera: cam,
      target: scene.target,
      lerp: 0.12,
      isSuspended: () => false,
    });
    layer.destroy();

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

    expect(cam.scrollX).toBe(startScrollX);
  });
});
