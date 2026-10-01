import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../../src/game/artContract.ts';
import { PngFormatError, decodePng, encodePng, hasPngSignature, readPngHeader } from './pngCodec.ts';

function image(width: number, height: number, pixels: readonly (readonly [number, number, number, number, number, number])[] = []): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, r, g, b, a] of pixels) data.set([r, g, b, a], (y * width + x) * 4);
  return { width, height, data };
}

function sample(): RgbaImage {
  return image(5, 3, [
    [0, 0, 255, 0, 0, 255],
    [4, 2, 10, 20, 30, 78],
    [2, 1, 168, 214, 240, 110],
  ]);
}

/** A chunk with a zero CRC: the decoder does not check CRCs, and re-encoding drops them anyway. */
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function header(width: number, height: number, bitDepth: number, colorType: number, interlace = 0): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return chunk('IHDR', data);
}

/** A PNG built by hand from raw scanlines (filter byte included) and extra chunks before IDAT. */
function handBuilt(width: number, height: number, colorType: number, rows: readonly number[][], extra: Buffer[] = []): Buffer {
  const raw = Buffer.concat(rows.map((row) => Buffer.from(row)));
  return Buffer.concat([SIGNATURE, header(width, height, 8, colorType), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof PngFormatError ? error.code : `not a PngFormatError: ${String(error)}`;
  }
  return undefined;
}

describe('encodePng / decodePng', () => {
  it('round-trips an RGBA image', () => {
    const decoded = decodePng(encodePng(sample()));
    expect([decoded.width, decoded.height]).toEqual([5, 3]);
    expect(Array.from(decoded.data)).toEqual(Array.from(sample().data));
  });

  it('writes the same bytes for the same pixels, so a content hash is stable', () => {
    expect(encodePng(sample()).equals(encodePng(sample()))).toBe(true);
  });

  it('undoes the sub, up, average and paeth filters', () => {
    // Two pixels per row; after unfiltering every row must read (10,20,30,40) (50,60,70,80).
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80];
    const expected = [...pixels, ...pixels];
    const decode = (filter: number, rows: number[][]) => Array.from(decodePng(handBuilt(2, 2, 6, rows.map((row) => [filter, ...row]))).data);
    expect(decode(1, [[10, 20, 30, 40, 40, 40, 40, 40], [10, 20, 30, 40, 40, 40, 40, 40]])).toEqual(expected);
    // Row 0 has nothing above it, so "up" leaves it as is.
    expect(decode(2, [pixels, [0, 0, 0, 0, 0, 0, 0, 0]])).toEqual(expected);
    // Average on row 0: left only (halved); on row 1: (left + up) / 2.
    expect(decode(3, [[10, 20, 30, 40, 45, 50, 55, 60], [5, 10, 15, 20, 20, 20, 20, 20]])).toEqual(expected);
    // Paeth on row 1 predicts from "up" for the first pixel and from the best of three after.
    expect(decode(4, [[10, 20, 30, 40, 40, 40, 40, 40], [0, 0, 0, 0, 0, 0, 0, 0]])).toEqual(expected);
  });

  it('expands RGB, grayscale and palette PNGs to RGBA, honoring tRNS', () => {
    // An editor may save an 8-bit indexed or RGB file; the stored file is RGBA anyway.
    const rgb = decodePng(handBuilt(2, 1, 2, [[0, 1, 2, 3, 4, 5, 6]], [chunk('tRNS', Buffer.from([0, 4, 0, 5, 0, 6]))]));
    expect(Array.from(rgb.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 0]);

    const gray = decodePng(handBuilt(2, 1, 0, [[0, 7, 9]]));
    expect(Array.from(gray.data)).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);

    const grayAlpha = decodePng(handBuilt(1, 1, 4, [[0, 7, 100]]));
    expect(Array.from(grayAlpha.data)).toEqual([7, 7, 7, 100]);

    const palette = Buffer.from([255, 0, 0, 0, 0, 255]);
    const indexed = decodePng(handBuilt(2, 1, 3, [[0, 1, 0]], [chunk('PLTE', palette), chunk('tRNS', Buffer.from([128]))]));
    expect(Array.from(indexed.data)).toEqual([0, 0, 255, 255, 255, 0, 0, 128]);
  });
});

describe('readPngHeader', () => {
  it('reads the size without inflating the image data', () => {
    expect(readPngHeader(encodePng(sample()))).toEqual({ width: 5, height: 3, bitDepth: 8, colorType: 6, interlace: 0 });
  });
});

describe('rejections', () => {
  it('names a file without the PNG signature not-png', () => {
    expect(hasPngSignature(Buffer.from('GIF89a'))).toBe(false);
    expect(hasPngSignature(encodePng(sample()))).toBe(true);
    expect(codeOf(() => decodePng(Buffer.from('not a png at all')))).toBe('not-png');
  });

  it('names a truncated or corrupt PNG invalid-png', () => {
    const png = encodePng(sample());
    expect(codeOf(() => decodePng(png.subarray(0, png.length - 20)))).toBe('invalid-png');
    expect(codeOf(() => decodePng(Buffer.concat([SIGNATURE, chunk('IEND', new Uint8Array(0))])))).toBe('invalid-png');
    // A chunk length pointing past the end of the file.
    const lying = Buffer.from(png);
    lying.writeUInt32BE(0x7fffffff, 8 + 25);
    expect(codeOf(() => decodePng(lying))).toBe('invalid-png');
    // An unknown filter type.
    expect(codeOf(() => decodePng(handBuilt(1, 1, 6, [[9, 1, 2, 3, 4]])))).toBe('invalid-png');
    // A palette index past the palette.
    expect(codeOf(() => decodePng(handBuilt(1, 1, 3, [[0, 5]], [chunk('PLTE', Buffer.from([1, 2, 3]))])))).toBe('invalid-png');
  });

  it('names 16-bit and interlaced PNGs unsupported-png', () => {
    const sixteen = Buffer.concat([SIGNATURE, header(1, 1, 16, 6), chunk('IEND', new Uint8Array(0))]);
    expect(codeOf(() => readPngHeader(sixteen))).toBe('unsupported-png');
    const interlaced = Buffer.concat([SIGNATURE, header(1, 1, 8, 6, 1), chunk('IEND', new Uint8Array(0))]);
    expect(codeOf(() => readPngHeader(interlaced))).toBe('unsupported-png');
  });

  it('refuses image data that inflates past the declared size, so a small file cannot expand without bound', () => {
    // 1x1 RGBA declares 5 bytes of scanline, the stream inflates to 1 MB of zeros.
    const bomb = Buffer.concat([SIGNATURE, header(1, 1, 8, 6), chunk('IDAT', deflateSync(Buffer.alloc(1 << 20))), chunk('IEND', new Uint8Array(0))]);
    expect(bomb.length).toBeLessThan(4096);
    expect(codeOf(() => decodePng(bomb))).toBe('invalid-png');
  });
});
