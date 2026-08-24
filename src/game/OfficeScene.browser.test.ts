import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_ROWS, GROUND_TEX, MAP_H, MAP_W, TREES, ZONE_LABELS } from './mapData';
import { createOfficeBridge } from './officeBridge';
import { OFFICE_SCENE_KEY, OfficeScene } from './OfficeScene';

/**
 * `OfficeScene` orquesta fisica, camaras, tweens y timers desde el slice 7 en
 * adelante: no se prueba con una superficie falsa (ver D5) sino siempre
 * dentro de un `Phaser.Game` real, igual que `createGame`/`mapBuilder`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

async function bootOfficeScene(): Promise<Phaser.Scene> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  const bridge = createOfficeBridge();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    scene: [new OfficeScene(bridge)],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene(OFFICE_SCENE_KEY)?.scene.settings.status).toBe(
      Phaser.Scenes.RUNNING,
    );
  });

  return game.scene.getScene(OFFICE_SCENE_KEY) as Phaser.Scene;
}

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

describe('OfficeScene dentro de un Phaser.Game real: orquestacion del mapa (skeleton)', () => {
  it('pinta el suelo completo, mobiliario, arboles y etiquetas de zona en create()', async () => {
    const scene = await bootOfficeScene();

    const images = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image => c.type === 'Image',
    );
    const texts = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Text => c.type === 'Text',
    );

    const groundKeys = new Set<string>([...GROUND_TEX, 'grassB']);
    const groundImages = images.filter((img) => groundKeys.has(img.texture.key));
    const deskCount = DESK_ROWS.reduce((sum, [, , n]) => sum + n, 0);

    expect(groundImages).toHaveLength(MAP_W * MAP_H);
    expect(images.filter((img) => img.texture.key === 'desk')).toHaveLength(deskCount);
    expect(images.filter((img) => img.texture.key === 'tree')).toHaveLength(TREES.length);
    expect(texts).toHaveLength(ZONE_LABELS.length);
  });

  it('no crea NPCs ni jugador todavia: es solo el esqueleto del mapa (slices 6-7)', async () => {
    const scene = await bootOfficeScene();

    const containers = scene.children.list.filter((c) => c.type === 'Container');
    expect(containers).toHaveLength(0);
  });
});
