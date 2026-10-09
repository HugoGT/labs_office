/**
 * Camera filters: what the own camera goes through before it is published.
 * The blur runs on this machine (`@livekit/track-processors`, MediaPipe), so
 * every peer receives the already blurred video and the server never sees it.
 *
 * Import-free on purpose: the UI decides what to offer from here without
 * loading the processor library, which only `backgroundBlur.ts` imports, and
 * only once blur is actually needed.
 */

export type CameraFilter = 'none' | 'blur';

/** Menu order: no filter first. */
export const CAMERA_FILTERS: readonly CameraFilter[] = ['none', 'blur'];

export const DEFAULT_CAMERA_FILTER: CameraFilter = 'none';

export function isCameraFilter(raw: unknown): raw is CameraFilter {
  return typeof raw === 'string' && (CAMERA_FILTERS as readonly string[]).includes(raw);
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
