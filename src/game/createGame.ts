import Phaser from 'phaser';
import { BootScene } from './BootScene';

/** Crea la instancia de Phaser montada en `parent`. El caller es dueno de destruirla. */
export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0d1117',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene],
  });
}
