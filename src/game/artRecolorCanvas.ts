/**
 * The one place a recolored pack sheet is painted (art migration, steps 4 and
 * 7). The office's textures (`artPackLoader.ts`) and the creation previews
 * (`artPreview.ts`) both call it, so a preview shows exactly the pixels the
 * office will draw. No Phaser here: the creation forms must not pull it in.
 */

import { recolorPixels } from './artColor';

export type PaintableImage = CanvasImageSource & { readonly width: number; readonly height: number };

/** A pixel rectangle of an image. */
export interface PaintRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `image` painted from `from` to `to` on a new canvas of the same size, or
 * `null` when this browser cannot read pixels back (no 2D context, a tainted
 * canvas). Callers cache the result per material and color. With `region`,
 * only that rectangle, on a canvas of its size: the carpet band of the
 * terrain tileset (#222), whose other bands are painted from other colors.
 */
export function paintRecoloredCanvas(image: PaintableImage, from: string, to: string, region?: PaintRegion): HTMLCanvasElement | null {
  const { x, y, width, height } = region ?? { x: 0, y: 0, width: image.width, height: image.height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  try {
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(recolorPixels(pixels.data, from, to));
    context.putImageData(pixels, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}
