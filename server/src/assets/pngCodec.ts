/**
 * Pure PNG codec on `node:zlib`, shared by the art exporter (`tools/art`) and
 * the upload pipeline (#121). No dependency: the exporter already needed one
 * to write the pack, and the upload only needs to read what an editor saves
 * and write it back as the contract's `png-rgba8`.
 *
 * The decoder reads 8-bit, non-interlaced PNGs of any color type (gray, RGB,
 * palette, gray+alpha, RGBA) and always answers RGBA. Everything else is
 * refused with a typed code instead of half-read: an uploaded file is
 * untrusted, and the only thing the server ever stores is what `encodePng`
 * writes from the decoded pixels, so no chunk, metadata or trailing payload
 * of the original survives.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import type { RgbaImage } from '../../../src/game/artContract.ts';

export type PngFormatErrorCode = 'not-png' | 'invalid-png' | 'unsupported-png';

export class PngFormatError extends Error {
  readonly code: PngFormatErrorCode;

  constructor(code: PngFormatErrorCode, message: string) {
    super(message);
    this.name = 'PngFormatError';
    this.code = code;
  }
}

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Samples per pixel of each 8-bit color type. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Far above any sheet of the contract (the terrain tileset is 512x2336). It
 * only bounds what a header can make the decoder allocate.
 */
const MAX_SIDE = 8192;

function bufferOf(png: Uint8Array): Buffer {
  return Buffer.from(png.buffer, png.byteOffset, png.byteLength);
}

export function hasPngSignature(png: Uint8Array): boolean {
  return png.length >= SIGNATURE.length && SIGNATURE.every((value, i) => png[i] === value);
}

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function* chunks(bytes: Buffer): Generator<Chunk> {
  let offset = SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new PngFormatError('invalid-png', 'PNG chunk header is truncated');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new PngFormatError('invalid-png', 'PNG chunk runs past the end of the file');
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    yield { type, data: bytes.subarray(offset + 8, offset + 8 + length) };
    if (type === 'IEND') return;
    offset = end;
  }
  throw new PngFormatError('invalid-png', 'PNG without IEND');
}

/** The IHDR alone: lets a caller check the size before any image data is inflated. */
export function readPngHeader(png: Uint8Array): PngHeader {
  if (!hasPngSignature(png)) throw new PngFormatError('not-png', 'Not a PNG: bad signature');
  const first = chunks(bufferOf(png)).next();
  if (first.done || first.value.type !== 'IHDR' || first.value.data.length !== 13) {
    throw new PngFormatError('invalid-png', 'PNG does not start with IHDR');
  }
  const data = first.value.data;
  const header = {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8] as number,
    colorType: data[9] as number,
    interlace: data[12] as number,
  };
  if (header.width === 0 || header.height === 0 || header.width > MAX_SIDE || header.height > MAX_SIDE) {
    throw new PngFormatError('invalid-png', `PNG size ${header.width}x${header.height} is out of range`);
  }
  if (CHANNELS[header.colorType] === undefined) throw new PngFormatError('invalid-png', `Unknown PNG color type ${header.colorType}`);
  if (header.bitDepth !== 8) throw new PngFormatError('unsupported-png', 'Only 8-bit PNGs are supported');
  if (header.interlace !== 0) throw new PngFormatError('unsupported-png', 'Interlaced PNGs are not supported');
  return header;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undoes the row filters of `raw` and answers the bare samples, one row after another. */
function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] as number;
      const left = x >= bpp ? (out[row + x - bpp] as number) : 0;
      const up = y > 0 ? (out[row - stride + x] as number) : 0;
      const upLeft = x >= bpp && y > 0 ? (out[row - stride + x - bpp] as number) : 0;
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
          throw new PngFormatError('invalid-png', `Unknown PNG filter ${String(filter)}`);
      }
      out[row + x] = (value + predicted) & 0xff;
    }
  }
  return out;
}

export function decodePng(png: Uint8Array): RgbaImage {
  const header = readPngHeader(png);
  const { width, height, colorType } = header;
  const channels = CHANNELS[colorType] as number;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  for (const { type, data } of chunks(bufferOf(png))) {
    if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
  }
  if (idat.length === 0) throw new PngFormatError('invalid-png', 'PNG without image data');
  if (colorType === 3 && (palette === null || palette.length % 3 !== 0)) throw new PngFormatError('invalid-png', 'Indexed PNG without a palette');

  const stride = width * channels;
  const expected = (stride + 1) * height;
  let raw: Buffer;
  try {
    // The cap is what keeps a few KB of zeros from inflating into gigabytes.
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch {
    throw new PngFormatError('invalid-png', 'PNG image data does not inflate to its declared size');
  }
  if (raw.length !== expected) throw new PngFormatError('invalid-png', 'PNG image data does not match its size');
  const samples = unfilter(raw, height, stride, channels);

  const out = new Uint8ClampedArray(width * height * 4);
  const key = transparency;
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const o = i * 4;
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    switch (colorType) {
      case 0:
        r = g = b = samples[s] as number;
        // An 8-bit gray key is the low byte of a 16-bit value.
        if (key !== null && key.length >= 2 && key[1] === r) a = 0;
        break;
      case 2:
        r = samples[s] as number;
        g = samples[s + 1] as number;
        b = samples[s + 2] as number;
        if (key !== null && key.length >= 6 && key[1] === r && key[3] === g && key[5] === b) a = 0;
        break;
      case 3: {
        const index = samples[s] as number;
        const colors = palette as Buffer;
        if (index * 3 + 2 >= colors.length) throw new PngFormatError('invalid-png', `PNG palette index ${index} is out of range`);
        r = colors[index * 3] as number;
        g = colors[index * 3 + 1] as number;
        b = colors[index * 3 + 2] as number;
        if (key !== null && index < key.length) a = key[index] as number;
        break;
      }
      case 4:
        r = g = b = samples[s] as number;
        a = samples[s + 1] as number;
        break;
      default:
        r = samples[s] as number;
        g = samples[s + 1] as number;
        b = samples[s + 2] as number;
        a = samples[s + 3] as number;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * RGBA8, no row filtering, IHDR + one IDAT + IEND and nothing else. The
 * output depends only on the pixels, so the pack's files keep their bytes
 * and an upload's hash names its pixels, not the editor that saved it.
 */
export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    writeChunk('IHDR', header),
    writeChunk('IDAT', deflateSync(raw)),
    writeChunk('IEND', new Uint8Array(0)),
  ]);
}
