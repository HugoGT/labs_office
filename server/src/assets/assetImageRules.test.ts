import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ART_IMAGE_SPECS, sheetSize, type ArtImageKind, type RgbaImage } from '../../../src/game/artContract.ts';
import { AssetUploadError, MAX_UPLOAD_FILE_BYTES, prepareAssetImage } from './assetImageRules.ts';
import { decodePng, encodePng, readPngHeader } from './pngCodec.ts';

/** A sheet of `kind` with one opaque pixel in the middle of every frame: valid for any sprite kind. */
function sprite(kind: ArtImageKind, paint: (x: number, y: number) => readonly [number, number, number, number] | null = () => null): RgbaImage {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inFrameX = x % spec.frame.width;
      const inFrameY = y % spec.frame.height;
      const center = inFrameX === spec.frame.width >> 1 && inFrameY === spec.frame.height >> 1;
      const color = paint(x, y) ?? (center ? ([200, 40, 40, 255] as const) : null);
      if (color !== null) data.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function opaqueFloor(): RgbaImage {
  return sprite('floor', () => [90, 60, 30, 255]);
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof AssetUploadError ? error.code : `unexpected ${String(error)}`;
  }
  return undefined;
}

/** A chunk with a valid layout; its CRC is irrelevant to the decoder. */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out;
}

describe('prepareAssetImage', () => {
  it('accepts a sheet that meets its kind and answers the re-encoded PNG with its hash', () => {
    const bytes = encodePng(sprite('plant'));
    const stored = prepareAssetImage('plant', bytes, 'sheet');

    expect(stored).toMatchObject({ imageKind: 'plant', width: 32, height: 48 });
    expect(stored.sha256).toBe(createHash('sha256').update(stored.png).digest('hex'));
    expect(Array.from(decodePng(stored.png).data)).toEqual(Array.from(sprite('plant').data));
  });

  it('stores the re-encoded file, never the original: extra chunks and a trailing payload are gone', () => {
    const clean = encodePng(sprite('plant'));
    const iend = clean.subarray(clean.length - 12);
    const withMetadata = Buffer.concat([
      clean.subarray(0, 33),
      chunk('tEXt', Buffer.from('Comment\0secret author notes', 'latin1')),
      clean.subarray(33, clean.length - 12),
      iend,
      // A polyglot: something else appended after IEND.
      Buffer.from('PK\x03\x04 a zip archive hiding here'),
    ]);

    const stored = prepareAssetImage('plant', withMetadata, 'sheet');

    expect(stored.png.equals(withMetadata)).toBe(false);
    expect(stored.png.equals(clean)).toBe(true);
    expect(stored.png.includes(Buffer.from('secret'))).toBe(false);
    expect(stored.png.includes(Buffer.from('PK'))).toBe(false);
  });

  it('stores an indexed PNG as the contract RGBA8', () => {
    // A 96x96 floor saved by an editor as 8-bit indexed with a one-color palette.
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(96, 0);
    ihdr.writeUInt32BE(96, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const rows = Buffer.alloc((96 + 1) * 96);
    const indexed = Buffer.concat([
      encodePng(opaqueFloor()).subarray(0, 8),
      chunk('IHDR', ihdr),
      chunk('PLTE', Buffer.from([90, 60, 30])),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    const stored = prepareAssetImage('floor', indexed, 'sheet');

    expect(readPngHeader(stored.png)).toMatchObject({ bitDepth: 8, colorType: 6 });
    expect(stored.png.equals(encodePng(opaqueFloor()))).toBe(true);
  });

  it('refuses a file over 128 KB before reading it', () => {
    expect(MAX_UPLOAD_FILE_BYTES).toBe(128 * 1024);
    const big = Buffer.concat([encodePng(sprite('plant')), Buffer.alloc(MAX_UPLOAD_FILE_BYTES)]);
    expect(codeOf(() => prepareAssetImage('plant', big, 'sheet'))).toBe('too-large');
  });

  it('refuses what is not a PNG, and a PNG it cannot read', () => {
    expect(codeOf(() => prepareAssetImage('plant', Buffer.from('GIF89a......'), 'sheet'))).toBe('not-png');
    const png = encodePng(sprite('plant'));
    expect(codeOf(() => prepareAssetImage('plant', png.subarray(0, png.length - 30), 'sheet'))).toBe('invalid-png');
  });

  it('refuses the wrong size from the header alone', () => {
    const plant = sprite('plant');
    const wide = encodePng({ width: 33, height: 48, data: new Uint8ClampedArray(33 * 48 * 4) });
    expect(codeOf(() => prepareAssetImage('plant', wide, 'sheet'))).toBe('invalid-dimensions');
    // A character walk sheet is not a seated one.
    expect(codeOf(() => prepareAssetImage('character-seated', encodePng(sprite('character-walk')), 'seated'))).toBe('invalid-dimensions');
    expect(codeOf(() => prepareAssetImage('plant', encodePng(plant), 'sheet'))).toBeUndefined();
  });

  it('refuses more colors than the contract allows', () => {
    // 32x48 has room for 200 distinct colors away from the corners.
    let n = 0;
    const busy = sprite('plant', (x, y) => (x > 0 && x < 31 && y > 0 && y < 47 && n < 200 ? [n++, 0, 0, 255] : null));
    expect(codeOf(() => prepareAssetImage('plant', encodePng(busy), 'sheet'))).toBe('too-many-colors');
  });

  it('refuses a translucent floor and a sprite with a background', () => {
    const floor = opaqueFloor();
    floor.data[3] = 120;
    expect(codeOf(() => prepareAssetImage('floor', encodePng(floor), 'sheet'))).toBe('not-opaque');
    const backdrop = sprite('plant', () => [10, 10, 10, 255]);
    expect(codeOf(() => prepareAssetImage('plant', encodePng(backdrop), 'sheet'))).toBe('background-present');
  });

  it('names the file the error is about', () => {
    try {
      prepareAssetImage('character-walk', Buffer.from('nope'), 'walk');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AssetUploadError);
      expect((error as AssetUploadError).field).toBe('walk');
    }
  });
});
