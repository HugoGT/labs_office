/**
 * The one door to `@livekit/track-processors` (MediaPipe selfie segmentation
 * plus a WebGL blur). Only ever reached through a dynamic `import()`: the
 * library and MediaPipe's JS land in their own chunk, downloaded the first
 * time a camera needs the blur, so whoever never picks it never pays for it.
 * Tests inject a fake through `ConnectLivekitRoomOptions.loadBackgroundBlur`,
 * so jsdom never loads MediaPipe.
 *
 * Asset paths are the library defaults: the MediaPipe WASM comes from
 * cdn.jsdelivr.net and the segmentation model from storage.googleapis.com,
 * both fetched by the processor when it starts, not by this import.
 */
import type { BackgroundBlur } from './livekitRoom';

export async function loadBackgroundBlur(): Promise<BackgroundBlur> {
  const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors');
  return {
    supported: supportsBackgroundProcessors,
    createProcessor: (blurRadius) => BackgroundProcessor({ mode: 'background-blur', blurRadius }),
  };
}
