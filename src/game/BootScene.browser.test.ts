import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootScene, TILE } from './BootScene';

/**
 * Dos niveles sobre la misma escena:
 * - la aritmetica de `create()` contra una superficie falsa (deterministica);
 * - la escena corriendo dentro de un Phaser.Game real (que de verdad pinta).
 */

type Line = { x1: number; y1: number; x2: number; y2: number };
type TextCall = { x: number; y: number; content: string; origin: number | null };

function sceneWithFakeSurface(width: number, height: number) {
  const lines: Line[] = [];
  const texts: TextCall[] = [];

  const graphics = {
    lineStyle: () => graphics,
    lineBetween: (x1: number, y1: number, x2: number, y2: number) => {
      lines.push({ x1, y1, x2, y2 });
    },
  };

  const add = {
    graphics: () => graphics,
    text: (x: number, y: number, content: string) => {
      const call: TextCall = { x, y, content, origin: null };
      texts.push(call);
      const gameObject = {
        setOrigin: (origin: number) => {
          call.origin = origin;
          return gameObject;
        },
      };
      return gameObject;
    },
  };

  const scene = new BootScene();
  Object.assign(scene, { scale: { width, height }, add });

  return { scene, lines, texts };
}

describe('BootScene: aritmetica de create()', () => {
  it('se registra con la clave "boot" que espera createGame', () => {
    expect(new BootScene().sys.settings.key).toBe('boot');
  });

  it('dibuja la rejilla con bordes inclusivos en ambos ejes', () => {
    // 100 / 32 -> verticales en 0, 32, 64, 96 ; 70 / 32 -> horizontales en 0, 32, 64
    const { scene, lines } = sceneWithFakeSurface(100, 70);

    scene.create();

    expect(lines.filter((l) => l.x1 === l.x2).map((l) => l.x1)).toEqual([
      0, 32, 64, 96,
    ]);
    expect(lines.filter((l) => l.y1 === l.y2).map((l) => l.y1)).toEqual([
      0, 32, 64,
    ]);
  });

  it('extiende cada linea de lado a lado del viewport', () => {
    const { scene, lines } = sceneWithFakeSurface(96, 64);

    scene.create();

    for (const line of lines.filter((l) => l.x1 === l.x2)) {
      expect([line.y1, line.y2]).toEqual([0, 64]);
    }
    for (const line of lines.filter((l) => l.y1 === l.y2)) {
      expect([line.x1, line.x2]).toEqual([0, 96]);
    }
  });

  it('usa un paso de rejilla de TILE pixeles', () => {
    const { scene, lines } = sceneWithFakeSurface(TILE * 4, TILE);

    scene.create();

    expect(lines.filter((l) => l.x1 === l.x2).map((l) => l.x1)).toEqual([
      0,
      TILE,
      TILE * 2,
      TILE * 3,
      TILE * 4,
    ]);
  });

  it('centra los dos textos, el segundo debajo del primero', () => {
    const { scene, texts } = sceneWithFakeSurface(800, 600);

    scene.create();

    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ x: 400, y: 300, origin: 0.5 });
    expect(texts[1]).toMatchObject({ x: 400, y: 328, origin: 0.5 });
  });

  it('muestra la version real de Phaser, no una cadena fija', () => {
    const { scene, texts } = sceneWithFakeSurface(800, 600);

    scene.create();

    expect(texts[1].content).toContain(Phaser.VERSION);
    expect(texts[1].content).toContain('Fase 0');
  });
});

describe('BootScene dentro de un Phaser.Game real', () => {
  let game: Phaser.Game | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    game?.destroy(true);
    game = null;
    host?.remove();
    host = null;
  });

  async function boot(): Promise<Phaser.Scene> {
    host = document.createElement('div');
    host.style.width = '320px';
    host.style.height = '240px';
    document.body.append(host);

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: 320,
      height: 240,
      scene: [BootScene],
    });

    const booted = game;
    await vi.waitFor(() => {
      expect(booted.scene.getScene('boot')?.scene.settings.status).toBe(
        Phaser.Scenes.RUNNING,
      );
    });
    return booted.scene.getScene('boot') as Phaser.Scene;
  }

  it('crea la rejilla y los dos textos como objetos de escena', async () => {
    const scene = await boot();

    const kinds = scene.children.list.map((child) => child.type).sort();
    expect(kinds).toEqual(['Graphics', 'Text', 'Text']);
  });

  it('los textos renderizados anuncian el stack listo', async () => {
    const scene = await boot();

    const rendered = scene.children.list
      .filter((child): child is Phaser.GameObjects.Text => child.type === 'Text')
      .map((child) => child.text);

    expect(rendered[0]).toContain('Phaser 3 + React + TypeScript');
    expect(rendered[1]).toContain(Phaser.VERSION);
  });
});
