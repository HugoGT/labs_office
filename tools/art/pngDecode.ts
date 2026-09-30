/**
 * Minimal PNG decoder for the pack's own files: 8-bit RGBA, non-interlaced, any row filter. It
 * exists so tests validate the PNGs the office actually loads, not the buffers before encoding.
 * Anything else is rejected rather than half-read.
 */
import { inflateSync } from 'node:zlib';
import type { RgbaImage } from '../../src/game/artContract.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(png: Uint8Array): RgbaImage {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error('Not a PNG: bad signature');
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || color !== 6) throw new Error('Only 8-bit RGBA PNGs are supported');
      if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error('PNG without IHDR');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height) throw new Error('PNG image data does not match its size');
  const out = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] as number;
      const left = x >= 4 ? (out[row + x - 4] as number) : 0;
      const up = y > 0 ? (out[row - stride + x] as number) : 0;
      const upLeft = x >= 4 && y > 0 ? (out[row - stride + x - 4] as number) : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = Math.floor((left + up) / 2);
          break;
        case 4:
          predicted = paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unknown PNG filter ${filter}`);
      }
      out[row + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, data: out };
}
