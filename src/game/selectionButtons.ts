/**
 * The move and trash buttons drawn under a selection on the map: the decor
 * editor's (#208), and the desk and room editor's, which took them over from
 * a sidebar row. Each layer decides what is selected and what a click on a
 * button does; this only draws them, a fixed size on screen at any zoom, and
 * tells which one a pointer is on.
 */

import Phaser from 'phaser';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';

export type SelectionAction = 'move' | 'delete';

/** Side of each button on screen: big enough to hit at any zoom, small next to a chair at 2x. */
export const SELECTION_BUTTON_PX = 24;
export const SELECTION_DELETE_COLOR = 0xdc2626;
const MOVE_COLOR = 0x1f2937;
const ICON_COLOR = 0xffffff;
/**
 * Font glyphs instead of art drawn line by line, which broke apart at small
 * sizes: ↔ moves, 🗑 deletes. The wastebasket asks the emoji fonts first so it
 * keeps its picture; the arrow stays a plain white glyph. The wastebasket fills
 * its whole glyph box, so it goes smaller to keep a margin in the button.
 */
const ICON_FONT_PX = 16;
const ICONS: Record<SelectionAction, { glyph: string; fontFamily: string; fontPx: number }> = {
  move: { glyph: '\u2194', fontFamily: 'system-ui, "Segoe UI Symbol", sans-serif', fontPx: ICON_FONT_PX },
  delete: {
    glyph: '\u{1F5D1}',
    fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif',
    fontPx: 10,
  },
};
/** Screen gap between the footprint and the buttons, and between the two buttons. */
const BUTTON_GAP_PX = 4;

/** A selection's footprint in tiles. */
export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SelectionButton {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Text;
}

export class SelectionButtons {
  private readonly scene: Phaser.Scene;
  private readonly names: Record<SelectionAction, string>;
  private buttons: Record<SelectionAction, SelectionButton> | null = null;
  /** The camera zoom the buttons were sized for: a new zoom resizes them. */
  private shownZoom = 1;

  constructor(scene: Phaser.Scene, names: Record<SelectionAction, string>) {
    this.scene = scene;
    this.names = names;
  }

  /** The camera zoom the buttons were last placed for. */
  get zoom(): number {
    return this.shownZoom;
  }

  /** Puts the buttons under `rect`, side by side and centered on it, or over it at the map's bottom edge. */
  show(rect: SelectionRect, mapHeight: number): void {
    const zoom = this.scene.cameras.main.zoom || 1;
    this.shownZoom = zoom;
    const size = SELECTION_BUTTON_PX / zoom;
    const gap = BUTTON_GAP_PX / zoom;
    const below = rect.y + rect.h < mapHeight;
    const centerY = below ? (rect.y + rect.h) * TILE + gap + size / 2 : rect.y * TILE - gap - size / 2;
    const centerX = (rect.x + rect.w / 2) * TILE;
    const offset = (size + gap) / 2;
    this.buttons ??= { move: this.make('move'), delete: this.make('delete') };
    for (const [action, x] of [['move', centerX - offset], ['delete', centerX + offset]] as const) {
      const { background, icon } = this.buttons[action];
      background.setScale(1 / zoom).setPosition(x, centerY).setVisible(true);
      icon.setScale(1 / zoom).setPosition(x, centerY).setVisible(true);
    }
  }

  hide(): void {
    if (this.buttons === null) return;
    for (const { background, icon } of Object.values(this.buttons)) {
      background.setVisible(false);
      icon.setVisible(false);
    }
  }

  /** Which shown button, if any, the pointer is on. */
  at(pointer: Phaser.Input.Pointer): SelectionAction | null {
    if (this.buttons === null) return null;
    for (const action of ['move', 'delete'] as const) {
      const { background } = this.buttons[action];
      if (background.visible && background.getBounds().contains(pointer.worldX, pointer.worldY)) return action;
    }
    return null;
  }

  destroy(): void {
    if (this.buttons !== null) for (const { background, icon } of Object.values(this.buttons)) {
      background.destroy();
      icon.destroy();
    }
    this.buttons = null;
  }

  /** A button made at its screen size around (0, 0); `show` scales and places it. */
  private make(action: SelectionAction): SelectionButton {
    const depth = LAYOUT_GHOST_DEPTH + 2;
    const background = this.scene.add
      .rectangle(0, 0, SELECTION_BUTTON_PX, SELECTION_BUTTON_PX, action === 'move' ? MOVE_COLOR : SELECTION_DELETE_COLOR)
      .setStrokeStyle(1, ICON_COLOR, 0.6)
      .setDepth(depth)
      .setName(this.names[action]);
    const { glyph, fontFamily, fontPx } = ICONS[action];
    const icon = this.scene.add
      .text(0, 0, glyph, { fontFamily, fontSize: `${fontPx}px`, color: '#ffffff' })
      .setOrigin(0.5)
      // Drawn at the screen's pixel density: scaled by 1/zoom, it stays sharp.
      .setResolution(window.devicePixelRatio || 1)
      .setDepth(depth + 0.5)
      .setName(`${background.name}:icon`);
    return { background, icon };
  }
}
