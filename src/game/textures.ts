/**
 * Generacion procedural de los avatares, portada de `makeTextures`
 * (`prototype/js/app.js:99-212`). Depende de Phaser en tiempo de ejecucion
 * (`Graphics#generateTexture` necesita un contexto real): se prueba en la capa
 * navegador.
 *
 * Todo lo que era mapa (suelo, mobiliario, naturaleza) salio de aqui y ahora
 * son frames de las hojas Kenney, ver `assets.ts`. Los avatares se quedan
 * procedurales por una razon concreta: ningun pack CC0 de Kenney trae personas
 * de cuerpo entero en vista 3/4 -- los de `roguelike-characters` son bustos
 * frontales -- y la alternativa con animacion real (LPC) es CC-BY-SA, licencia
 * virica que no encaja en un producto comercial.
 *
 * Cada avatar se genera en cuatro orientaciones. Sin ellas, un personaje que
 * anda hacia la izquierda sigue mirando de frente, que es justo lo que delata
 * a un sprite estatico moviendose.
 */

import type Phaser from 'phaser';
import { HAIRS, PANTS, SHIRTS, SKINS } from './mapData';
import { FACINGS, type Facing } from './officeProtocol';

/** Claves base de avatar de NPC (app.js:206-208): `av0`..`av9`. */
export const AVATAR_KEYS: readonly string[] = Array.from({ length: 10 }, (_, i) => `av${i}`);

/** Clave base de la textura del jugador (app.js:209): camisa amarilla distintiva. */
export const PLAYER_TEXTURE = 'avP';

/**
 * Clave de textura de una orientacion concreta. Se deriva siempre por esta
 * funcion para que nadie concatene el sufijo a mano y acabe pidiendo una
 * textura que no existe.
 */
export function avatarTextureKey(base: string, facing: Facing): string {
  return `${base}-${facing}`;
}

type Draw = (g: Phaser.GameObjects.Graphics) => void;

interface AvatarPalette {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
}

/** Genera las texturas de avatar dentro de `scene` (app.js:99-212). */
export function createOfficeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  function tex(key: string, w: number, h: number, draw: Draw): void {
    g.clear();
    draw(g);
    g.generateTexture(key, w, h);
  }

  function drawAvatar(gfx: Phaser.GameObjects.Graphics, p: AvatarPalette, facing: Facing): void {
    // Cabello: de espaldas cubre toda la cabeza, porque no se ve cara.
    gfx.fillStyle(p.hair);
    gfx.fillRect(4, 0, 8, 2);
    gfx.fillRect(3, 1, 10, 3);
    if (facing === 'up') gfx.fillRect(3, 4, 10, 4);

    if (facing !== 'up') {
      gfx.fillStyle(p.skin);
      gfx.fillRect(4, 3, 8, 5);

      gfx.fillStyle(0x222222);
      if (facing === 'down') {
        gfx.fillRect(6, 5, 1, 1);
        gfx.fillRect(9, 5, 1, 1);
      } else if (facing === 'left') {
        // De perfil solo se ve un ojo, y pegado al lado hacia el que mira.
        gfx.fillRect(5, 5, 1, 1);
      } else {
        gfx.fillRect(10, 5, 1, 1);
      }
    }

    gfx.fillStyle(p.shirt);
    gfx.fillRect(3, 8, 10, 6);

    // Brazos: de perfil solo asoma el del lado visible.
    gfx.fillStyle(p.skin);
    if (facing !== 'right') gfx.fillRect(2, 9, 1, 4);
    if (facing !== 'left') gfx.fillRect(13, 9, 1, 4);

    gfx.fillStyle(p.pants);
    gfx.fillRect(4, 14, 8, 3);
    gfx.fillRect(4, 17, 3, 2);
    gfx.fillRect(9, 17, 3, 2);

    gfx.fillStyle(0x222222);
    gfx.fillRect(4, 19, 3, 1);
    gfx.fillRect(9, 19, 3, 1);
  }

  function avatar(base: string, palette: AvatarPalette): void {
    for (const facing of FACINGS) {
      tex(avatarTextureKey(base, facing), 16, 20, (gfx) => drawAvatar(gfx, palette, facing));
    }
  }

  AVATAR_KEYS.forEach((key, i) => {
    avatar(key, {
      skin: SKINS[i % 3],
      hair: HAIRS[(i * 3 + 1) % 5],
      shirt: SHIRTS[(i * 5 + 2) % 7],
      pants: PANTS[i % 3],
    });
  });
  avatar(PLAYER_TEXTURE, { skin: SKINS[0], hair: 0x2b2b2b, shirt: 0xfacc15, pants: 0x1f2937 });

  g.destroy();
}
