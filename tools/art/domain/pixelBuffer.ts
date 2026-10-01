export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r, g, b, a };
}

/** RGBA8 image stored row by row, compatible with ImageData. */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(width: number, height: number, data?: Uint8ClampedArray<ArrayBuffer>) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getPixel(x: number, y: number): Rgba {
    if (!this.contains(x, y)) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return { r: d[i] ?? 0, g: d[i + 1] ?? 0, b: d[i + 2] ?? 0, a: d[i + 3] ?? 0 };
  }

  alphaAt(x: number, y: number): number {
    if (!this.contains(x, y)) return 0;
    return this.data[(y * this.width + x) * 4 + 3] ?? 0;
  }

  setPixel(x: number, y: number, color: Rgba): void {
    if (!this.contains(x, y)) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color.r;
    this.data[i + 1] = color.g;
    this.data[i + 2] = color.b;
    this.data[i + 3] = color.a;
  }

  /** Source-over compositing of a single pixel. */
  blendPixel(x: number, y: number, color: Rgba): void {
    if (!this.contains(x, y) || color.a === 0) return;
    if (color.a === 255) {
      this.setPixel(x, y, color);
      return;
    }
    const under = this.getPixel(x, y);
    const a = color.a / 255;
    const outA = a + (under.a / 255) * (1 - a);
    const mix = (top: number, bottom: number): number =>
      outA === 0 ? 0 : Math.round((top * a + bottom * (under.a / 255) * (1 - a)) / outA);
    this.setPixel(x, y, rgba(mix(color.r, under.r), mix(color.g, under.g), mix(color.b, under.b), Math.round(outA * 255)));
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) this.setPixel(px, py, color);
    }
  }

  /** Composites another buffer on top of this one with its top-left corner at (dx, dy). */
  blit(source: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const color = source.getPixel(x, y);
        if (color.a > 0) this.blendPixel(x + dx, y + dy, color);
      }
    }
  }

  mirroredHorizontally(): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) out.setPixel(this.width - 1 - x, y, this.getPixel(x, y));
    }
    return out;
  }

  countOpaque(): number {
    let count = 0;
    for (let i = 3; i < this.data.length; i += 4) if ((this.data[i] ?? 0) > 0) count += 1;
    return count;
  }

  /**
   * Paints every fully transparent pixel that touches a fully opaque pixel (4-neighborhood)
   * with a color derived from that neighbor. Works on a snapshot, so rings never cascade.
   */
  addOutline(colorFor: (neighbor: Rgba) => Rgba): void {
    const snapshot = new PixelBuffer(this.width, this.height, this.data.slice());
    const offsets = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (snapshot.alphaAt(x, y) !== 0) continue;
        for (const [ox, oy] of offsets) {
          if (snapshot.alphaAt(x + ox, y + oy) === 255) {
            this.setPixel(x, y, colorFor(snapshot.getPixel(x + ox, y + oy)));
            break;
          }
        }
      }
    }
  }
}
