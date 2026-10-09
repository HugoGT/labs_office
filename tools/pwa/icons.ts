/**
 * App icons of the web app manifest (#13), derived from code so they never
 * drift from their source. `pnpm pwa:icons` writes them to `public/icons/`;
 * `icons.test.ts` fails while they drift.
 *
 * The source is the Labs logo, `tools/pwa/logo.png` (a square, opaque PNG),
 * box-downsampled to every size, so swapping the logo is replacing that file
 * and running `pnpm pwa:icons`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from '../../server/src/assets/pngCodec.ts';
import type { RgbaImage } from '../../src/game/artContract.ts';
import { PWA_ICONS, type PwaIcon } from './pwaIcons.ts';

export { PWA_ICONS };

type Rgb = readonly [number, number, number];

/** Background of the logo: the tile behind its ink, full-bleed when maskable. */
export const ICON_BACKGROUND: Rgb = [0x00, 0x00, 0x00];

const LOGO_URL = new URL('./logo.png', import.meta.url);

/** Corner radius of the `any` tile, as a fraction of the icon size. */
const CORNER_RADIUS = 0.1875;

/** Hard-edged rounded square, no antialiasing, so the bytes depend on nothing but the size. */
function insideTile(x: number, y: number, size: number): boolean {
  const radius = size * CORNER_RADIUS;
  const dx = Math.max(radius - (x + 0.5), x + 0.5 - (size - radius), 0);
  const dy = Math.max(radius - (y + 0.5), y + 0.5 - (size - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** Average of the source pixels whose centers fall inside target pixel (x, y). */
function sample(logo: RgbaImage, size: number, x: number, y: number): Rgb {
  const scale = logo.width / size;
  const fromX = Math.ceil(x * scale - 0.5);
  const toX = Math.ceil((x + 1) * scale - 0.5);
  const fromY = Math.ceil(y * scale - 0.5);
  const toY = Math.ceil((y + 1) * scale - 0.5);
  const sum = [0, 0, 0];
  for (let sy = fromY; sy < toY; sy += 1) {
    for (let sx = fromX; sx < toX; sx += 1) {
      const at = (sy * logo.width + sx) * 4;
      sum[0] += logo.data[at] as number;
      sum[1] += logo.data[at + 1] as number;
      sum[2] += logo.data[at + 2] as number;
    }
  }
  const count = (toX - fromX) * (toY - fromY);
  return [Math.round(sum[0] / count), Math.round(sum[1] / count), Math.round(sum[2] / count)];
}

/**
 * `any`: the logo on a rounded tile, corners transparent. `maskable`: the
 * logo full-bleed (the platform cuts its own shape); its ink already sits
 * within 31% of the size from the center, inside the 40% radius safe zone.
 */
function renderIcon(logo: RgbaImage, icon: PwaIcon): Uint8Array {
  const size = Number(icon.sizes.split('x')[0]);
  const maskable = icon.purpose === 'maskable';
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!maskable && !insideTile(x, y, size)) continue;
      data.set([...sample(logo, size, x, y), 255], (y * size + x) * 4);
    }
  }
  return encodePng({ width: size, height: size, data });
}

export function renderIconFiles(): Map<string, Uint8Array> {
  const logo = decodePng(readFileSync(LOGO_URL));
  return new Map(PWA_ICONS.map((icon) => [icon.file, renderIcon(logo, icon)]));
}

export function writeIconFiles(root: string, files: ReadonlyMap<string, Uint8Array>): void {
  for (const [path, bytes] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}
