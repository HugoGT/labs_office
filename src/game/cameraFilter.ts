/**
 * Camera filters: what the own camera goes through before it is published.
 * The blur runs on this machine (`@livekit/track-processors`, MediaPipe), so
 * every peer receives the already blurred video and the server never sees it.
 *
 * Import-free on purpose: the UI decides what to offer from here without
 * loading the processor library, which only `backgroundBlur.ts` imports, and
 * only once blur is actually needed.
 */

export type CameraFilter = 'none' | 'blur-light' | 'blur-strong';

export type BlurFilter = Exclude<CameraFilter, 'none'>;

/** Menu order: no filter first, then the blurs from light to full. */
export const CAMERA_FILTERS: readonly CameraFilter[] = ['none', 'blur-light', 'blur-strong'];

export const DEFAULT_CAMERA_FILTER: CameraFilter = 'none';

export function isCameraFilter(raw: unknown): raw is CameraFilter {
  return typeof raw === 'string' && (CAMERA_FILTERS as readonly string[]).includes(raw);
}

export function isBlurFilter(filter: CameraFilter): filter is BlurFilter {
  return filter !== 'none';
}

/**
 * `blurRadius` per strength. @livekit/track-processors 0.8 downsamples the
 * frame by 4, divides the radius by 4 as well and runs a two-pass gaussian
 * with sigma = that quarter radius, but at most 16 taps per side
 * (`webgl/index.ts`, `blurShader.ts`). So 64 already uses every tap; past it
 * the taps stay at 16 and only sigma grows, flattening the kernel toward a
 * box (about 7% more spread, at no extra cost). 128 is that flattest kernel,
 * the strongest blur the library can draw; 12 (3 taps) is the soft blur the
 * single option had, more than five times narrower.
 */
const BLUR_RADIUS: Record<BlurFilter, number> = {
  'blur-light': 12,
  'blur-strong': 128,
};

export function blurRadiusOf(filter: BlurFilter): number {
  return BLUR_RADIUS[filter];
}

/**
 * What the browser offers, as `@livekit/track-processors` 0.8 checks it
 * (`BackgroundTransformer.isSupported` and `ProcessorWrapper.isSupported`).
 * `webgl2` is a function because probing it creates a context: it only runs
 * once every cheaper check passed.
 */
export interface BlurEnvironment {
  offscreenCanvas: boolean;
  videoFrame: boolean;
  createImageBitmap: boolean;
  webgl2: () => boolean;
  /** `MediaStreamTrackProcessor` + `MediaStreamTrackGenerator` (Chromium). */
  streamProcessor: boolean;
  /** `HTMLCanvasElement.prototype.captureStream`, the library's fallback. */
  canvasCaptureStream: boolean;
}

/**
 * Mirrors the library's own check so the menu can disable blur up front
 * instead of offering something that fails once picked. The library still
 * checks again when it loads (`backgroundBlur.ts`): this is the fast answer,
 * that one is the authority.
 */
export function supportsCameraBlur(env: BlurEnvironment): boolean {
  if (!env.offscreenCanvas || !env.videoFrame || !env.createImageBitmap) return false;
  if (!env.streamProcessor && !env.canvasCaptureStream) return false;
  return env.webgl2();
}

/** The real browser, read lazily so nothing is probed until someone asks. */
export function browserBlurEnvironment(): BlurEnvironment {
  const scope = globalThis as Record<string, unknown>;
  return {
    offscreenCanvas: typeof scope.OffscreenCanvas !== 'undefined',
    videoFrame: typeof scope.VideoFrame !== 'undefined',
    createImageBitmap: typeof scope.createImageBitmap !== 'undefined',
    webgl2: () => {
      try {
        return document.createElement('canvas').getContext('webgl2') !== null;
      } catch {
        return false;
      }
    },
    streamProcessor:
      typeof scope.MediaStreamTrackProcessor !== 'undefined' &&
      typeof scope.MediaStreamTrackGenerator !== 'undefined',
    canvasCaptureStream:
      typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype,
  };
}
