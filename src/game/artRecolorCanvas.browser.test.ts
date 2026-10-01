import { describe, expect, it } from 'vitest';
import { recolorPixels } from './artColor';
import { paintRecoloredCanvas } from './artRecolorCanvas';

/**
 * Real Chromium canvas: the painter the office textures and the creation
 * previews share must give exactly the pixels `recolorPixels` computes.
 */
describe('paintRecoloredCanvas', () => {
  it('paints the source in the target color, pixel for pixel what recolorPixels computes', () => {
    const source = document.createElement('canvas');
    source.width = 2;
    source.height = 1;
    const context = source.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    // One pixel of the default paint, one that is not paint of that ramp.
    context.fillStyle = '#4f9a8a';
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = '#d0d4d8';
    context.fillRect(1, 0, 1, 1);
    const before = context.getImageData(0, 0, 2, 1).data;

    const painted = paintRecoloredCanvas(source, '#4f9a8a', '#c0392b');

    expect(painted).not.toBeNull();
    expect(painted!.width).toBe(2);
    const after = painted!.getContext('2d')!.getImageData(0, 0, 2, 1).data;
    expect(Array.from(after)).toEqual(Array.from(recolorPixels(before, '#4f9a8a', '#c0392b')));
    expect(Array.from(after.slice(4))).toEqual(Array.from(before.slice(4)));
    expect(Array.from(after.slice(0, 4))).not.toEqual(Array.from(before.slice(0, 4)));
  });
});
