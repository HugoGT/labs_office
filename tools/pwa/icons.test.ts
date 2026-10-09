import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../server/src/assets/pngCodec.ts';
import { ICON_BACKGROUND, PWA_ICONS, renderIconFiles } from './icons.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

describe('PWA icons (#13)', () => {
  const files = renderIconFiles();

  it('renders one PNG per declared icon at its declared size', () => {
    expect([...files.keys()].sort()).toEqual(PWA_ICONS.map((icon) => icon.file).sort());
    for (const icon of PWA_ICONS) {
      const image = decodePng(files.get(icon.file) as Uint8Array);
      expect(`${image.width}x${image.height}`).toBe(icon.sizes);
    }
  });

  it('covers the sizes Chrome requires to install: 192, 512 and a 512 maskable', () => {
    const declared = PWA_ICONS.map((icon) => `${icon.sizes} ${icon.purpose}`);
    expect(declared).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  });

  it('is deterministic', () => {
    const again = renderIconFiles();
    for (const [path, bytes] of files) expect(Buffer.compare(again.get(path) as Uint8Array, bytes)).toBe(0);
  });

  it.each(PWA_ICONS.map((icon) => icon.file))('committed %s matches the generator (run `pnpm pwa:icons`)', (file) => {
    const committed = readFileSync(join(REPO_ROOT, file));
    expect(Buffer.compare(committed, files.get(file) as Uint8Array)).toBe(0);
  });

  it('draws the logo: white ink on its black background', () => {
    for (const icon of PWA_ICONS) {
      const image = decodePng(files.get(icon.file) as Uint8Array);
      // The stem of the "c" crosses the middle row at 40% of the width.
      const ink = ((image.height / 2) * image.width + Math.round(image.width * 0.4)) * 4;
      expect(Math.min(image.data[ink], image.data[ink + 1], image.data[ink + 2])).toBeGreaterThan(200);
      // Inside the "c", between its stem and its mouth, stays background.
      const hole = ((image.height / 2) * image.width + Math.round(image.width * 0.5)) * 4;
      expect([...image.data.slice(hole, hole + 4)]).toEqual([0, 0, 0, 255]);
    }
    expect(ICON_BACKGROUND).toEqual([0, 0, 0]);
  });

  it('keeps the maskable icon full-bleed and its drawing inside the safe zone', () => {
    const icon = PWA_ICONS.find((candidate) => candidate.purpose === 'maskable');
    const image = decodePng(files.get(icon?.file as string) as Uint8Array);
    const center = image.width / 2;
    // W3C maskable safe zone: a centered circle with a radius of 40% of the icon.
    const safeRadius = image.width * 0.4;
    let drawn = 0;
    let nonOpaque = 0;
    let outsideSafeZone = 0;
    // Check every pixel, but aggregate violations to avoid hundreds of thousands of matcher calls in CI.
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const at = (y * image.width + x) * 4;
        if (image.data[at + 3] !== 255) nonOpaque += 1;
        if (image.data[at] === ICON_BACKGROUND[0]
          && image.data[at + 1] === ICON_BACKGROUND[1]
          && image.data[at + 2] === ICON_BACKGROUND[2]) continue;
        drawn += 1;
        if (Math.hypot(x + 0.5 - center, y + 0.5 - center) >= safeRadius) outsideSafeZone += 1;
      }
    }
    expect(nonOpaque).toBe(0);
    expect(outsideSafeZone).toBe(0);
    expect(drawn).toBeGreaterThan(0);
  });
});
