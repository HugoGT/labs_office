import { useEffect, useRef } from 'react';
import type { MaterialOption, PreviewFrame } from '../game/artMaterials';
import { pagePreviewCache, type ArtPreviewCache } from '../game/artPreview';

/**
 * One frame of a pack sheet, cut from the sheet the office draws and painted
 * by the same generator (`artPreview.ts`), so a preview shows exactly the
 * pixels the map will. Presentational: the caller picks the frame, the canvas
 * is sized to it one sheet pixel per CSS pixel (any other scale would blur or
 * skip art pixels).
 */
export interface ArtPreviewCanvasProps {
  option: MaterialOption;
  color: string | null;
  frame: PreviewFrame;
  /** Accessible name of the image. */
  label: string;
  className?: string;
  preview?: ArtPreviewCache;
}

export function ArtPreviewCanvas({ option, color, frame, label, className, preview = pagePreviewCache }: ArtPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { x, y, width, height } = frame;

  useEffect(() => {
    let cancelled = false;
    void preview.sheet(option, color).then((sheet) => {
      const canvas = canvasRef.current;
      if (cancelled || sheet === null || canvas === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sheet, x, y, width, height, 0, 0, width, height);
    });
    return () => {
      cancelled = true;
    };
  }, [option, color, preview, x, y, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
      width={width}
      height={height}
      style={{ width, height }}
    />
  );
}
