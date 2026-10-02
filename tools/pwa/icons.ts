/**
 * App icons of the web app manifest (#13), drawn from code like the art pack
 * so they never drift from a source nobody can regenerate. `pnpm pwa:icons`
 * writes them to `public/icons/`; `icons.test.ts` fails while they drift.
 *
 * One 16x16 pixel-art drawing (two avatars side by side, the office's whole
 * idea) scaled by whole numbers, so every icon keeps hard pixel edges.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from '../../server/src/assets/pngCodec.ts';
import { PWA_ICONS, type PwaIcon } from './pwaIcons.ts';

export { PWA_ICONS };

type Rgb = readonly [number, number, number];

/** Panel color of the office UI (`#1f2937`): the tile behind the drawing, full-bleed when maskable. */
export const ICON_BACKGROUND: Rgb = [0x1f, 0x29, 0x37];
const PALETTE: Readonly<Record<string, Rgb>> = {
  h: [0xe5, 0xe7, 0xeb],
  b: [0x3b, 0x82, 0xf6],
  g: [0x22, 0xc5, 0x5e],
};

const GRID = 16;
const DRAWING = [
  '................',
  '................',
  '................',
  '................',
  '...hhh....hhh...',
  '...hhh....hhh...',
  '...hhh....hhh...',
  '................',
  '..bbbbb..ggggg..',
  '..bbbbb..ggggg..',
  '..bbbbb..ggggg..',
  '..bbbbb..ggggg..',
  '................',
  '................',
  '................',
  '................',
] as const;

/** Corner radius of the `any` tile, as a fraction of the icon size. */
const CORNER_RADIUS = 0.1875;

/** Hard-edged rounded square, no antialiasing, so the bytes depend on nothing but the size. */
function insideTile(x: number, y: number, size: number): boolean {
  const radius = size * CORNER_RADIUS;
  const dx = Math.max(radius - (x + 0.5), x + 0.5 - (size - radius), 0);
  const dy = Math.max(radius - (y + 0.5), y + 0.5 - (size - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * `any`: the drawing on a rounded tile, corners transparent, at one grid cell
 * per `size / 16` pixels. `maskable`: full-bleed background (the platform cuts
 * its own shape) and the drawing shrunk to the middle 320 of 512 pixels, well
 * inside the 40% radius safe zone.
 */
function renderIcon(icon: PwaIcon): Uint8Array {
  const size = Number(icon.sizes.split('x')[0]);
  const maskable = icon.purpose === 'maskable';
  const drawingSize = maskable ? (size * 5) / 8 : size;
  const cell = drawingSize / GRID;
  const offset = (size - drawingSize) / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const column = Math.floor((x - offset) / cell);
      const row = Math.floor((y - offset) / cell);
      const inside = column >= 0 && column < GRID && row >= 0 && row < GRID;
      const ink = inside ? PALETTE[DRAWING[row]?.[column] ?? '.'] : undefined;
      if (!maskable && !insideTile(x, y, size)) continue;
      const color = ink ?? ICON_BACKGROUND;
      const at = (y * size + x) * 4;
      data.set([...color, 255], at);
    }
  }
  return encodePng({ width: size, height: size, data });
}

export function renderIconFiles(): Map<string, Uint8Array> {
  return new Map(PWA_ICONS.map((icon) => [icon.file, renderIcon(icon)]));
}

export function writeIconFiles(root: string, files: ReadonlyMap<string, Uint8Array>): void {
  for (const [path, bytes] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}
