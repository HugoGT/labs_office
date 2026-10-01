/**
 * The one place a recolored pack sheet is painted (art migration, steps 4 and
 * 7). The office's textures (`artPackLoader.ts`) and the creation previews
 * (`artPreview.ts`) both call it, so a preview shows exactly the pixels the
 * office will draw. No Phaser here: the creation forms must not pull it in.
 */

import { recolorPixels } from './artColor';

export type PaintableImage = CanvasImageSource & { readonly width: number; readonly height: number };

/**
 * `image` painted from `from` to `to` on a new canvas of the same size, or
 * `null` when this browser cannot read pixels back (no 2D context, a tainted
 * canvas). Callers cache the result per material and color.
 */
export function paintRecoloredCanvas(image: PaintableImage, from: string, to: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  try {
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(recolorPixels(pixels.data, from, to));
    context.putImageData(pixels, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}
