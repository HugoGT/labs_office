import { describe, expect, it } from 'vitest';
import {
  blurRadiusOf,
  browserBlurEnvironment,
  CAMERA_FILTERS,
  DEFAULT_CAMERA_FILTER,
  isBlurFilter,
  isCameraFilter,
  supportsCameraBlur,
  type BlurEnvironment,
} from './cameraFilter';

/** Everything a Chromium with WebGL2 has: the modern stream API and the canvas fallback. */
const CHROMIUM: BlurEnvironment = {
  offscreenCanvas: true,
  videoFrame: true,
  createImageBitmap: true,
  webgl2: () => true,
  streamProcessor: true,
  canvasCaptureStream: true,
};

describe('camera filters', () => {
  it('offers no filter, a light blur and a full blur, in that order, no filter by default', () => {
    expect(CAMERA_FILTERS).toEqual(['none', 'blur-light', 'blur-strong']);
    expect(DEFAULT_CAMERA_FILTER).toBe('none');
  });

  it.each(['none', 'blur-light', 'blur-strong'])('accepts %s', (filter) => {
    expect(isCameraFilter(filter)).toBe(true);
  });

  it.each([null, undefined, '', 'blur', 'Blur-light', 'virtual-background', 1, {}])('rejects %s', (raw) => {
    expect(isCameraFilter(raw)).toBe(false);
  });

  it('tells the blurs apart from no filter', () => {
    expect(CAMERA_FILTERS.filter(isBlurFilter)).toEqual(['blur-light', 'blur-strong']);
  });
});

/**
 * How @livekit/track-processors 0.8 uses `blurRadius` (src/webgl): it
 * downsamples the frame by 4, divides the radius by 4 too, and runs a
 * two-pass gaussian with sigma = that radius but at most 16 taps per side.
 */
const DOWNSAMPLE = 4;
const MAX_TAPS = 16;
const taps = (radius: number) => Math.min(MAX_TAPS, Math.max(1, Math.floor(radius / DOWNSAMPLE)));

describe('blurRadiusOf: two strengths the library can actually tell apart', () => {
  it('keeps the light blur where it always was: a soft 12', () => {
    expect(blurRadiusOf('blur-light')).toBe(12);
  });

  it('puts the full blur at 40: several times the light one, short of the 16-tap cap', () => {
    expect(blurRadiusOf('blur-strong')).toBe(40);
    expect(taps(blurRadiusOf('blur-strong'))).toBeGreaterThanOrEqual(3 * taps(blurRadiusOf('blur-light')));
    expect(taps(blurRadiusOf('blur-strong'))).toBeLessThan(MAX_TAPS);
  });

  it('lands on a whole number of taps, so no radius is lost to the division by 4', () => {
    expect(blurRadiusOf('blur-light') % DOWNSAMPLE).toBe(0);
    expect(blurRadiusOf('blur-strong') % DOWNSAMPLE).toBe(0);
  });
});

describe('supportsCameraBlur: the same checks @livekit/track-processors makes, without loading it', () => {
  it('is supported with the modern stream API', () => {
    expect(supportsCameraBlur({ ...CHROMIUM, canvasCaptureStream: false })).toBe(true);
  });

  it('is supported with only the canvas captureStream fallback (Firefox, Safari)', () => {
    expect(supportsCameraBlur({ ...CHROMIUM, streamProcessor: false })).toBe(true);
  });

  it('is not supported without either way to produce the processed track', () => {
    expect(supportsCameraBlur({ ...CHROMIUM, streamProcessor: false, canvasCaptureStream: false })).toBe(false);
  });

  it.each(['offscreenCanvas', 'videoFrame', 'createImageBitmap'] as const)('is not supported without %s', (missing) => {
    expect(supportsCameraBlur({ ...CHROMIUM, [missing]: false })).toBe(false);
  });

  it('is not supported without WebGL2', () => {
    expect(supportsCameraBlur({ ...CHROMIUM, webgl2: () => false })).toBe(false);
  });

  it('never probes WebGL2 when a cheaper check already failed', () => {
    let probed = false;
    const webgl2 = () => {
      probed = true;
      return true;
    };

    expect(supportsCameraBlur({ ...CHROMIUM, offscreenCanvas: false, webgl2 })).toBe(false);
    expect(probed).toBe(false);
  });
});

describe('browserBlurEnvironment', () => {
  it('reads jsdom as a browser without blur, never touching a canvas', () => {
    expect(supportsCameraBlur(browserBlurEnvironment())).toBe(false);
  });
});
