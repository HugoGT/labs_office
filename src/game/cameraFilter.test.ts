import { describe, expect, it } from 'vitest';
import {
  browserBlurEnvironment,
  CAMERA_FILTERS,
  DEFAULT_CAMERA_FILTER,
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
  it('offers exactly no filter and blur, no filter first and by default', () => {
    expect(CAMERA_FILTERS).toEqual(['none', 'blur']);
    expect(DEFAULT_CAMERA_FILTER).toBe('none');
  });

  it.each(['none', 'blur'])('accepts %s', (filter) => {
    expect(isCameraFilter(filter)).toBe(true);
  });

  it.each([null, undefined, '', 'Blur', 'virtual-background', 1, {}])('rejects %s', (raw) => {
    expect(isCameraFilter(raw)).toBe(false);
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
