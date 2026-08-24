/**
 * Generacion procedural de texturas pixel-art, portada de `makeTextures`
 * (`prototype/js/app.js:99-212`). Depende de Phaser en tiempo de ejecucion
 * (`Graphics#generateTexture` necesita un contexto real): se prueba en la
 * capa navegador.
 */

import type Phaser from 'phaser';
import { HAIRS, PANTS, SHIRTS, SKINS, TILE } from './mapData';

/** Claves de avatar de NPC (app.js:206-208): `av0`..`av9`. */
export const AVATAR_KEYS: readonly string[] = Array.from({ length: 10 }, (_, i) => `av${i}`);

/** Clave de la textura del jugador (app.js:209): camisa amarilla distintiva. */
export const PLAYER_TEXTURE = 'avP';

type Draw = (g: Phaser.GameObjects.Graphics) => void;

/** Ruido determinista para dar textura a tiles de un solo color (app.js:105-111). */
function speckle(
  g: Phaser.GameObjects.Graphics,
  color: number,
  w: number,
  h: number,
  n: number,
  seed: number,
): void {
  g.fillStyle(color, 1);
  for (let i = 0; i < n; i++) {
    const x = (i * 13 + seed * 7) % w;
    const y = (i * 29 + seed * 11) % h;
    g.fillRect(x, y, 2, 1);
  }
}

/** Genera todas las texturas del mapa dentro de `scene` (app.js:99-212). */
export function createOfficeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  function tex(key: string, w: number, h: number, draw: Draw): void {
    g.clear();
    draw(g);
    g.generateTexture(key, w, h);
  }

  function avatar(key: string, skin: number, hair: number, shirt: number, pants: number): void {
    tex(key, 16, 20, (gfx) => {
      gfx.fillStyle(hair);
      gfx.fillRect(4, 0, 8, 2);
      gfx.fillRect(3, 1, 10, 3);
      gfx.fillStyle(skin);
      gfx.fillRect(4, 3, 8, 5);
      gfx.fillStyle(0x222222);
      gfx.fillRect(6, 5, 1, 1);
      gfx.fillRect(9, 5, 1, 1);
      gfx.fillStyle(shirt);
      gfx.fillRect(3, 8, 10, 6);
      gfx.fillStyle(skin);
      gfx.fillRect(2, 9, 1, 4);
      gfx.fillRect(13, 9, 1, 4);
      gfx.fillStyle(pants);
      gfx.fillRect(4, 14, 8, 3);
      gfx.fillRect(4, 17, 3, 2);
      gfx.fillRect(9, 17, 3, 2);
      gfx.fillStyle(0x222222);
      gfx.fillRect(4, 19, 3, 1);
      gfx.fillRect(9, 19, 3, 1);
    });
  }

  // Suelo (8 claves de GROUND_TEX mas 'grassB', usada por renderGround para
  // alternar franjas de cesped por paridad de fila).
  tex('grassA', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x55a24f);
    gfx.fillRect(0, 0, TILE, TILE);
    speckle(gfx, 0x4a9145, TILE, TILE, 6, 1);
  });
  tex('grassB', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x5dab56);
    gfx.fillRect(0, 0, TILE, TILE);
    speckle(gfx, 0x50994b, TILE, TILE, 6, 2);
  });
  tex('grassDark', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x3c7a3a);
    gfx.fillRect(0, 0, TILE, TILE);
    speckle(gfx, 0x336831, TILE, TILE, 8, 3);
  });
  tex('water', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x3e78c8);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x5b93dd);
    gfx.fillRect(4, 8, 10, 2);
    gfx.fillRect(18, 20, 10, 2);
    gfx.fillRect(10, 27, 8, 2);
  });
  tex('bridge', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x8a5a33);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x6e4626);
    for (let i = 0; i < 4; i++) gfx.fillRect(0, i * 8, TILE, 2);
    gfx.fillStyle(0x9c6a3f);
    gfx.fillRect(0, 0, 2, TILE);
    gfx.fillRect(TILE - 2, 0, 2, TILE);
  });
  tex('floor', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x9aa0a8);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.lineStyle(1, 0x878d96);
    gfx.strokeRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x90969e);
    gfx.fillRect(0, 0, 16, 16);
    gfx.fillRect(16, 16, 16, 16);
  });
  tex('woodf', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x9a6b42);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x8a5d38);
    for (let i = 0; i < 4; i++) gfx.fillRect(0, i * 8, TILE, 1);
    gfx.fillStyle(0xa87a4d);
    gfx.fillRect(6, 3, 12, 2);
    gfx.fillRect(18, 19, 10, 2);
  });
  tex('wall', TILE, TILE, (gfx) => {
    gfx.fillStyle(0x2f3542);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x3d4456);
    gfx.fillRect(0, 0, TILE, 8);
    gfx.fillStyle(0x262b36);
    gfx.fillRect(0, TILE - 4, TILE, 4);
  });
  tex('corridor', TILE, TILE, (gfx) => {
    gfx.fillStyle(0xcbb083);
    gfx.fillRect(0, 0, TILE, TILE);
    speckle(gfx, 0xbda276, TILE, TILE, 6, 4);
  });

  // Mobiliario.
  tex('desk', TILE * 2, TILE, (gfx) => {
    gfx.fillStyle(0x6f4a2e);
    gfx.fillRect(0, 6, 64, 26);
    gfx.fillStyle(0x8b5e3c);
    gfx.fillRect(0, 0, 64, 10);
    gfx.fillStyle(0x1f2937);
    gfx.fillRect(8, 0, 20, 3);
    gfx.fillStyle(0x0f2b4a);
    gfx.fillRect(9, 10, 18, 12);
    gfx.fillStyle(0x1e5f8a);
    gfx.fillRect(11, 12, 14, 8);
    gfx.fillStyle(0x0f2b4a);
    gfx.fillRect(38, 10, 18, 12);
    gfx.fillStyle(0x1e5f8a);
    gfx.fillRect(40, 12, 14, 8);
    gfx.fillStyle(0x374151);
    gfx.fillRect(14, 25, 12, 4);
  });
  tex('chairB', 16, 16, (gfx) => {
    gfx.fillStyle(0x2563eb);
    gfx.fillRect(2, 0, 12, 5);
    gfx.fillStyle(0x3b82f6);
    gfx.fillRect(2, 5, 12, 8);
    gfx.fillStyle(0x1f2937);
    gfx.fillRect(4, 13, 2, 3);
    gfx.fillRect(10, 13, 2, 3);
  });
  tex('stool', 14, 12, (gfx) => {
    gfx.fillStyle(0x8b5e3c);
    gfx.fillRect(1, 0, 12, 6);
    gfx.fillStyle(0x6e4626);
    gfx.fillRect(3, 6, 2, 6);
    gfx.fillRect(9, 6, 2, 6);
  });
  tex('barrel', 20, 24, (gfx) => {
    gfx.fillStyle(0x8a5a33);
    gfx.fillRect(2, 0, 16, 24);
    gfx.fillStyle(0x6e4626);
    gfx.fillRect(2, 4, 16, 2);
    gfx.fillRect(2, 17, 16, 2);
    gfx.fillStyle(0x9c6a3f);
    gfx.fillRect(4, 0, 3, 24);
  });
  tex('tableGray', 7 * TILE, 5 * TILE, (gfx) => {
    gfx.fillStyle(0x565e6a);
    gfx.fillRect(0, 0, 224, 160);
    gfx.fillStyle(0x6b7280);
    gfx.fillRect(4, 4, 216, 152);
    gfx.fillStyle(0x0f2b4a);
    gfx.fillRect(62, 50, 100, 60);
    gfx.fillStyle(0x1e5f8a);
    gfx.fillRect(68, 56, 88, 48);
    gfx.fillStyle(0x35c26a);
    gfx.fillRect(74, 62, 30, 4);
    gfx.fillRect(74, 72, 50, 4);
    gfx.fillRect(74, 82, 40, 4);
  });
  tex('tableWood', 5 * TILE, 3 * TILE, (gfx) => {
    gfx.fillStyle(0x6e4626);
    gfx.fillRect(0, 0, 160, 96);
    gfx.fillStyle(0x8b5e3c);
    gfx.fillRect(4, 4, 152, 88);
    gfx.fillStyle(0x9c6a3f);
    gfx.fillRect(10, 10, 140, 3);
    gfx.fillRect(10, 50, 140, 3);
  });

  // Naturaleza.
  tex('tree', TILE * 2, 80, (gfx) => {
    gfx.fillStyle(0x6e4626);
    gfx.fillRect(28, 56, 8, 22);
    gfx.fillStyle(0x2e6b34);
    gfx.fillEllipse(32, 32, 58, 52);
    gfx.fillStyle(0x3f8a42);
    gfx.fillEllipse(28, 26, 40, 34);
    gfx.fillStyle(0x55a24f);
    gfx.fillEllipse(22, 20, 18, 14);
    gfx.fillEllipse(40, 30, 14, 10);
  });
  tex('bush', 24, 16, (gfx) => {
    gfx.fillStyle(0x3f8a42);
    gfx.fillEllipse(12, 9, 22, 13);
    gfx.fillStyle(0x55a24f);
    gfx.fillEllipse(9, 6, 10, 7);
  });
  tex('flower', 10, 10, (gfx) => {
    gfx.fillStyle(0x55a24f);
    gfx.fillRect(4, 5, 2, 4);
    gfx.fillStyle(0xf472b6);
    gfx.fillRect(2, 1, 6, 4);
    gfx.fillStyle(0xfde68a);
    gfx.fillRect(4, 2, 2, 2);
  });

  // Avatares (16x20, se escalan x2 en el punto de uso).
  AVATAR_KEYS.forEach((key, i) => {
    avatar(key, SKINS[i % 3], HAIRS[(i * 3 + 1) % 5], SHIRTS[(i * 5 + 2) % 7], PANTS[i % 3]);
  });
  avatar(PLAYER_TEXTURE, SKINS[0], 0x2b2b2b, 0xfacc15, 0x1f2937);

  g.destroy();
}
