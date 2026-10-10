import { describe, expect, it } from 'vitest';
import { loadBackgroundBlur } from './backgroundBlur';
import { browserBlurEnvironment, supportsCameraBlur } from './cameraFilter';

/**
 * Real Chromium, real `@livekit/track-processors`: the lazy chunk loads, and
 * the menu's own support check (`supportsCameraBlur`) says what the library
 * says. Nothing here starts a processor, so MediaPipe's WASM and model are
 * never fetched.
 */
describe('loadBackgroundBlur', () => {
  it('loads the library on demand and agrees with the support check the menu uses', async () => {
    const blur = await loadBackgroundBlur();

    expect(blur.supported()).toBe(supportsCameraBlur(browserBlurEnvironment()));
  });

  it('creates a fresh blur processor each time, without starting it', async () => {
    const blur = await loadBackgroundBlur();
    if (!blur.supported()) return;

    const first = blur.createProcessor(12);
    const second = blur.createProcessor(40);

    expect(first).not.toBe(second);
    expect(first.name).toBe('background-processor');
    expect(first.processedTrack).toBeUndefined();
  });

  it('a processor switches strength in place, the way the camera filter changes level', async () => {
    const blur = await loadBackgroundBlur();
    if (!blur.supported()) return;
    const processor = blur.createProcessor(12) as ReturnType<typeof blur.createProcessor> & {
      mode: string;
      transformer: { options: { blurRadius?: number } };
    };

    // Not started: only the options change, which is all `switchTo` does to a
    // running pipeline as well (`BackgroundTransformer.update`).
    await processor.switchTo({ mode: 'background-blur', blurRadius: 40 });

    expect(processor.mode).toBe('background-blur');
    expect(processor.transformer.options.blurRadius).toBe(40);
  });
});
