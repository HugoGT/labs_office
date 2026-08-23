import Phaser from 'phaser';

/**
 * Escena de humo: valida que Phaser 3 renderiza dentro de React.
 * El mapa real, avatares y proximidad se portan desde `prototype/js/app.js`
 * en el paso "portar app.js a modulos TypeScript" (TODOS seccion 1).
 */
export const TILE = 32;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const { width, height } = this.scale;

    // Rejilla de tiles: confirma escala entera y filtro NEAREST (pixel art).
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x1f2937, 1);
    for (let x = 0; x <= width; x += TILE) grid.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += TILE) grid.lineBetween(0, y, width, y);

    this.add
      .text(width / 2, height / 2, 'Phaser 3 + React + TypeScript listo', {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#4ade80',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 28, `Phaser v${Phaser.VERSION} — Fase 0`, {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#9ca3af',
      })
      .setOrigin(0.5);
  }
}
