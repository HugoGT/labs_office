import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PixelBuffer, rgba } from './pixelBuffer.ts';

test('pixels can be written, read and blitted', () => {
  const buffer = new PixelBuffer(4, 3);
  buffer.setPixel(1, 2, rgba(10, 20, 30, 255));
  assert.deepEqual(buffer.getPixel(1, 2), rgba(10, 20, 30, 255));
  assert.equal(buffer.getPixel(0, 0).a, 0);
  const target = new PixelBuffer(8, 8);
  target.blit(buffer, 3, 4);
  assert.deepEqual(target.getPixel(4, 6), rgba(10, 20, 30, 255));
});

test('writes outside the buffer are ignored', () => {
  const buffer = new PixelBuffer(2, 2);
  buffer.setPixel(-1, 0, rgba(1, 1, 1, 255));
  buffer.setPixel(0, 5, rgba(1, 1, 1, 255));
  assert.equal(buffer.countOpaque(), 0);
});

test('horizontal mirroring flips columns', () => {
  const buffer = new PixelBuffer(3, 1);
  buffer.setPixel(0, 0, rgba(255, 0, 0, 255));
  const mirrored = buffer.mirroredHorizontally();
  assert.equal(mirrored.getPixel(2, 0).r, 255);
  assert.equal(mirrored.getPixel(0, 0).a, 0);
});

test('outlining surrounds opaque pixels with a darker ring', () => {
  const buffer = new PixelBuffer(5, 5);
  buffer.setPixel(2, 2, rgba(200, 100, 50, 255));
  buffer.addOutline((neighbor) => rgba(neighbor.r >> 2, neighbor.g >> 2, neighbor.b >> 2, 255));
  assert.equal(buffer.countOpaque(), 5);
  assert.deepEqual(buffer.getPixel(2, 1), rgba(50, 25, 12, 255));
  assert.equal(buffer.getPixel(1, 1).a, 0);
});
