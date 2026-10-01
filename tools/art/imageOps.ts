/** Small pixel-buffer helpers shared by the PNG export and preview scripts. */
import { PixelBuffer, type Rgba } from './domain/pixelBuffer.ts';

/** Light brown floor tone, so exported sprites read the same as in the simulation. */
export const BACKDROP: Rgba = { r: 201, g: 167, b: 124, a: 255 };

export function upscale(image: PixelBuffer, factor: number): PixelBuffer {
  const out = new PixelBuffer(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) out.setPixel(x, y, image.getPixel(Math.floor(x / factor), Math.floor(y / factor)));
  }
  return out;
}

export function onBackdrop(image: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(image.width, image.height);
  out.fillRect(0, 0, image.width, image.height, BACKDROP);
  out.blit(image, 0, 0);
  return out;
}

/** Copies a region out of `image`; pixels outside it stay transparent. Walks only the region, so cutting tiles out of a large tileset stays cheap. */
export function crop(image: PixelBuffer, x: number, y: number, width: number, height: number): PixelBuffer {
  const out = new PixelBuffer(width, height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) out.setPixel(col, row, image.getPixel(x + col, y + row));
  }
  return out;
}

/**
 * Copies `source` into `target` with its top-left at (dx, dy), pixels written as they are. Sheets
 * are assembled with this instead of `blit`, so no alpha blending can touch a translucent pixel.
 */
export function place(target: PixelBuffer, source: PixelBuffer, dx: number, dy: number): void {
  if (dx < 0 || dy < 0 || dx + source.width > target.width || dy + source.height > target.height) {
    throw new Error(`A ${source.width}x${source.height} image does not fit at (${dx}, ${dy}) in ${target.width}x${target.height}`);
  }
  for (let y = 0; y < source.height; y += 1) {
    const from = y * source.width * 4;
    target.data.set(source.data.subarray(from, from + source.width * 4), ((dy + y) * target.width + dx) * 4);
  }
}
