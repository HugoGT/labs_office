import { useEffect, useRef } from 'react';
import type { MaterialOption, PreviewFrame } from '../game/artMaterials';
import { pagePreviewCache, type ArtPreviewCache } from '../game/artPreview';

/**
 * One frame of a pack sheet, cut from the sheet the office draws and painted
 * by the same generator (`artPreview.ts`), so a preview shows exactly the
 * pixels the map will. Presentational: the caller picks the frame, the canvas
 * is sized to it one sheet pixel per CSS pixel times a whole `scale` (any
 * other scale would blur or skip art pixels).
 */
export interface ArtPreviewCanvasProps {
  option: MaterialOption;
  color: string | null;
  frame: PreviewFrame;
  /** Accessible name of the image. */
  label: string;
  /** Whole canvas pixels per sheet pixel, drawn unsmoothed; 1 by default. */
  scale?: number;
  className?: string;
  preview?: ArtPreviewCache;
}

export function ArtPreviewCanvas({ option, color, frame, label, className, scale = 1, preview = pagePreviewCache }: ArtPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { x, y, width, height } = frame;
  const factor = Number.isInteger(scale) && scale >= 1 ? scale : 1;

  useEffect(() => {
    let cancelled = false;
    void preview.sheet(option, color).then((sheet) => {
      const canvas = canvasRef.current;
      if (cancelled || sheet === null || canvas === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sheet, x, y, width, height, 0, 0, width * factor, height * factor);
    });
    return () => {
      cancelled = true;
    };
  }, [option, color, preview, x, y, width, height, factor]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
      width={width * factor}
      height={height * factor}
      style={{ width: width * factor, height: height * factor }}
    />
  );
}
