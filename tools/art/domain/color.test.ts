import { test } from 'vitest';
import assert from 'node:assert/strict';
import { darkenRamp, makeRamp } from './color.ts';
import type { Rgba } from './pixelBuffer.ts';

function luma({ r, g, b }: Rgba): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

test('darkenRamp paints every tone one step darker', () => {
  const ramp = makeRamp('#9b6a3a');
  const darker = darkenRamp(ramp);
  assert.deepEqual(darker.light, ramp.base);
  assert.deepEqual(darker.base, ramp.shadow);
  assert.deepEqual(darker.shadow, ramp.deep);
  assert.ok(luma(darker.deep) < luma(ramp.deep));
  assert.deepEqual(darker.outline, ramp.outline);
});
