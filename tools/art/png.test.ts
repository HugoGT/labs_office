import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PixelBuffer, rgba } from './domain/pixelBuffer.ts';
import { encodePng } from './png.ts';
import { decodePng } from './pngDecode.ts';

function sample(): PixelBuffer {
  const image = new PixelBuffer(5, 3);
  image.setPixel(0, 0, rgba(255, 0, 0));
  image.setPixel(4, 2, rgba(10, 20, 30, 78));
  image.setPixel(2, 1, rgba(168, 214, 240, 110));
  return image;
}

/** Hand-built PNG whose rows use a given filter, to cover filters the encoder never writes. */
function filteredPng(width: number, raw: readonly number[][], filter: number): Buffer {
  const png = encodePng(new PixelBuffer(width, raw.length));
  const header = png.subarray(0, 8 + 25);
  const body = Buffer.concat(raw.map((row) => Buffer.from([filter, ...row])));
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    // decodePng does not check CRCs of chunks it reads, so a zero CRC is enough here.
    return out;
  };
  return Buffer.concat([header, chunk('IDAT', deflateSync(body)), chunk('IEND', Buffer.alloc(0))]);
}

describe('decodePng', () => {
  it('round-trips what encodePng writes', () => {
    const image = sample();
    const decoded = decodePng(encodePng(image));
    expect([decoded.width, decoded.height]).toEqual([5, 3]);
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
  });

  it('undoes the sub, up, average and paeth filters', () => {
    // Two pixels per row; after unfiltering every row must read (10,20,30,40) (50,60,70,80).
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80];
    const expected = [...pixels, ...pixels];
    const sub = [
      [10, 20, 30, 40, 40, 40, 40, 40],
      [10, 20, 30, 40, 40, 40, 40, 40],
    ];
    expect(Array.from(decodePng(filteredPng(2, sub, 1)).data)).toEqual(expected);
    const up = [pixels, [0, 0, 0, 0, 0, 0, 0, 0]];
    // Row 0 has nothing above it, so "up" leaves it as is.
    expect(Array.from(decodePng(filteredPng(2, up, 2)).data)).toEqual(expected);
    // Average on row 0: left only (halved); on row 1: (left + up) / 2.
    const average = [
      [10, 20, 30, 40, 45, 50, 55, 60],
      [5, 10, 15, 20, 20, 20, 20, 20],
    ];
    expect(Array.from(decodePng(filteredPng(2, average, 3)).data)).toEqual(expected);
    // Paeth on row 1 predicts from "up" for the first pixel and from the best of three after.
    const paeth = [
      [10, 20, 30, 40, 40, 40, 40, 40],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    expect(Array.from(decodePng(filteredPng(2, paeth, 4)).data)).toEqual(expected);
  });

  it('rejects anything that is not an 8-bit RGBA PNG', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/signature/);
    const png = Buffer.from(encodePng(sample()));
    png[8 + 8 + 9] = 2; // color type: RGB
    expect(() => decodePng(png)).toThrow(/RGBA/);
  });
});
