import Phaser from 'phaser';
import { OfficeScene } from './OfficeScene';
import type { OfficeBridge } from './officeBridge';

/**
 * Crea la instancia de Phaser montada en `parent`. El caller es dueno de
 * destruirla. `bridge` se inyecta en `OfficeScene` por constructor (D2), no
 * por `registry`. Fisica arcade habilitada: el jugador (slice 6) necesita un
 * cuerpo fisico.
 */
export function createGame(parent: HTMLElement, bridge: OfficeBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0d1117',
    pixelArt: true,
    roundPixels: true,
    physics: {
      default: 'arcade',
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new OfficeScene(bridge)],
  });
}
