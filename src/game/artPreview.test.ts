import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom, type MaterialOption } from './artMaterials';
import { createArtPreviewCache } from './artPreview';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;

function option(id: string): MaterialOption {
  const found = [...catalog.desk, ...catalog.floor].find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no option ${id}`);
  return found;
}

function harness(loaded: boolean = true) {
  const image = { width: 256, height: 64 } as unknown as HTMLImageElement;
  const loadImage = vi.fn(async (_url: string) => (loaded ? image : null));
  const paint = vi.fn((_source: CanvasImageSource, _from: string, to: string) => ({ painted: to }) as unknown as HTMLCanvasElement);
  return { image, loadImage, paint, cache: createArtPreviewCache({ loadImage, paint }) };
}

describe('createArtPreviewCache', () => {
  it('draws a non-colorable material from its exported sheet, never repainted', async () => {
    const { image, loadImage, paint, cache } = harness();

    expect(await cache.sheet(option('desk-wood'), null)).toBe(image);
    expect(loadImage).toHaveBeenCalledWith('assets/pack/desk/wood.png');
    expect(paint).not.toHaveBeenCalled();
  });

  it('the default color of a colorable material is the exported sheet itself', async () => {
    const { image, paint, cache } = harness();

    expect(await cache.sheet(option('desk-painted'), '#4f9a8a')).toBe(image);
    expect(paint).not.toHaveBeenCalled();
  });

  it('paints another color from the default one, once per material and color', async () => {
    const { loadImage, paint, cache } = harness();

    const first = await cache.sheet(option('desk-painted'), '#c0392b');
    const again = await cache.sheet(option('desk-painted'), '#C0392B');
    await cache.sheet(option('floor-plain'), '#c0392b');

    expect(again).toBe(first);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(paint).toHaveBeenCalledWith(expect.anything(), '#4f9a8a', '#c0392b');
    expect(paint).toHaveBeenCalledWith(expect.anything(), '#b9c3cc', '#c0392b');
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it('a color on a non-colorable material is ignored, as the office does', async () => {
    const { image, paint, cache } = harness();

    expect(await cache.sheet(option('floor-grass'), '#c0392b')).toBe(image);
    expect(paint).not.toHaveBeenCalled();
  });

  it('an image that cannot load gives no preview instead of throwing', async () => {
    const { cache } = harness(false);

    expect(await cache.sheet(option('desk-painted'), '#c0392b')).toBeNull();
  });

  it('a browser that cannot paint still previews the exported color', async () => {
    const image = { width: 256, height: 64 } as unknown as HTMLImageElement;
    const cache = createArtPreviewCache({ loadImage: async () => image, paint: () => null });

    expect(await cache.sheet(option('desk-painted'), '#c0392b')).toBe(image);
  });
});
