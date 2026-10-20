import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixelFramesCanvas, type PixelFrame } from './PixelFramesCanvas';

function frame(value: number): PixelFrame {
  return { width: 2, height: 3, data: new Uint8ClampedArray(2 * 3 * 4).fill(value) };
}

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

describe('PixelFramesCanvas', () => {
  const putImageData = vi.fn();
  let reducedMotion = false;

  beforeEach(() => {
    putImageData.mockClear();
    reducedMotion = false;
    vi.useFakeTimers();
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData } as never);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion && query.includes('reduce') }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const drawn = () => putImageData.mock.calls.map(([image]) => (image as FakeImageData).data[0]);

  it('draws 1:1 into a canvas scaled up by an integer, with its label', () => {
    render(<PixelFramesCanvas frames={[frame(7)]} scale={3} label="Tu personaje en reposo" />);

    const canvas = screen.getByRole('img', { name: 'Tu personaje en reposo' }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([2, 3]);
    expect([canvas.style.width, canvas.style.height]).toEqual(['6px', '9px']);
    expect(drawn()).toEqual([7]);
  });

  it('steps through several frames', () => {
    render(<PixelFramesCanvas frames={[frame(1), frame(2), frame(3)]} scale={1} label="caminando" frameMs={100} />);

    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(100));

    expect(drawn()).toEqual([1, 2, 3, 1]);
  });

  it('stays on the first frame under reduced motion', () => {
    reducedMotion = true;
    render(<PixelFramesCanvas frames={[frame(1), frame(2)]} scale={1} label="caminando" frameMs={100} />);

    act(() => vi.advanceTimersByTime(500));

    expect(drawn()).toEqual([1]);
  });
});
