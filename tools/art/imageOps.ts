/** Small pixel-buffer helpers shared by the PNG export and preview scripts. */
import { PixelBuffer, type Rgba } from '../../src/art/pixelBuffer.ts';

export { place } from '../../src/art/pixelBuffer.ts';

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

