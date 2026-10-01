/**
 * Sheets for the material previews of the creation forms (art migration, step
 * 7). Same generator as the office: the exported sheet, `recolorFor` to decide
 * whether a color applies, and `paintRecoloredCanvas` to paint it. Only the
 * texture store differs, because the forms have no Phaser to keep it in.
 *
 * Each image loads once per URL and each recolor is painted once per material
 * and color, never per render.
 */

import type { MaterialOption } from './artMaterials';
import { recolorFor } from './artPack';
import { paintRecoloredCanvas, type PaintableImage } from './artRecolorCanvas';

export interface ArtPreviewCache {
  /** The sheet to cut the preview from, or `null` when the image cannot load. */
  sheet(option: MaterialOption, color: string | null): Promise<PaintableImage | null>;
}

export interface ArtPreviewCacheOptions {
  loadImage: (url: string) => Promise<PaintableImage | null>;
  paint?: (image: PaintableImage, from: string, to: string) => PaintableImage | null;
}

export function createArtPreviewCache({ loadImage, paint = paintRecoloredCanvas }: ArtPreviewCacheOptions): ArtPreviewCache {
  const images = new Map<string, Promise<PaintableImage | null>>();
  const painted = new Map<string, Promise<PaintableImage | null>>();

  function image(url: string): Promise<PaintableImage | null> {
    let pending = images.get(url);
    if (pending === undefined) {
      pending = loadImage(url).catch(() => null);
      images.set(url, pending);
    }
    return pending;
  }

  return {
    sheet(option, color) {
      const recolor = recolorFor(option.piece, color);
      if (recolor === null) return image(option.sheetUrl);
      const key = `${option.id}@${recolor.to}`;
      let pending = painted.get(key);
      if (pending === undefined) {
        pending = image(option.sheetUrl).then((source) => {
          if (source === null) return null;
          // Same fallback as the office: a browser that cannot paint still shows the exported color.
          return paint(source, recolor.from, recolor.to) ?? source;
        });
        painted.set(key, pending);
      }
      return pending;
    },
  };
}

function loadHtmlImage(url: string): Promise<PaintableImage | null> {
  return new Promise((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = url;
  });
}

/** One cache per page, shared by every form, so reopening a form paints nothing again. */
export const pagePreviewCache: ArtPreviewCache = createArtPreviewCache({ loadImage: loadHtmlImage });
