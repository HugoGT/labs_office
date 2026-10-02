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

  it('keeps the maskable icon full-bleed and its drawing inside the safe zone', () => {
    const icon = PWA_ICONS.find((candidate) => candidate.purpose === 'maskable');
    const image = decodePng(files.get(icon?.file as string) as Uint8Array);
    const center = image.width / 2;
    // W3C maskable safe zone: a centered circle with a radius of 40% of the icon.
    const safeRadius = image.width * 0.4;
    let drawn = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const at = (y * image.width + x) * 4;
        const pixel = [...image.data.subarray(at, at + 4)];
        expect(pixel[3]).toBe(255);
        if (pixel.slice(0, 3).join() === ICON_BACKGROUND.join()) continue;
        drawn += 1;
        expect(Math.hypot(x + 0.5 - center, y + 0.5 - center)).toBeLessThan(safeRadius);
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });
});
