import { useEffect, useRef, useState } from 'react';

/** RGBA8 pixels row by row, what `PixelBuffer` (and `ImageData`) hold. */
export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export interface PixelFramesCanvasProps {
  readonly frames: readonly PixelFrame[];
  /** An integer: pixel art is drawn 1:1 into the canvas and scaled up by CSS, never resampled. */
  readonly scale: number;
  readonly label: string;
  readonly frameMs?: number;
  readonly className?: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Draws pixel frames on a canvas at an integer scale, stepping through them
 * when there are several (the walk), or showing the first under reduced
 * motion. Without a 2D context (jsdom) it keeps an empty canvas of the right
 * size, so layout and labels stay the same.
 */
export function PixelFramesCanvas({ frames, scale, label, frameMs = 100, className }: PixelFramesCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const first = frames[0];

  useEffect(() => {
    setIndex(0);
    if (frames.length < 2 || prefersReducedMotion()) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % frames.length), frameMs);
    return () => clearInterval(timer);
  }, [frames, frameMs]);

  useEffect(() => {
    const frame = frames[index] ?? frames[0];
    const context = canvasRef.current?.getContext?.('2d') ?? null;
    if (!frame || context === null || typeof ImageData === 'undefined') return;
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
  }, [frames, index]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={first?.width ?? 0}
      height={first?.height ?? 0}
      style={{ width: (first?.width ?? 0) * scale, height: (first?.height ?? 0) * scale, imageRendering: 'pixelated' }}
      role="img"
      aria-label={label}
    />
  );
}
