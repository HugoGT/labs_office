import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePrivateArtImages } from './usePrivateArtImages';

const FILES = [
  { role: 'walk', path: 'a.png' },
  { role: 'seated', path: 'b.png' },
];

describe('usePrivateArtImages (#122)', () => {
  it('reads every file of the piece through the port, by role', async () => {
    const read = vi.fn(async (path: string) => `data:${path}`);

    const { result } = renderHook(() => usePrivateArtImages(read, FILES));

    await waitFor(() => expect(result.current).toEqual({ walk: 'data:a.png', seated: 'data:b.png' }));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads nothing without files, and a file that fails is simply missing', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === 'b.png') throw new Error('404');
      return `data:${path}`;
    });

    const none = renderHook(() => usePrivateArtImages(read, null));
    expect(none.result.current).toEqual({});

    const { result } = renderHook(() => usePrivateArtImages(read, FILES));
    await waitFor(() => expect(result.current).toEqual({ walk: 'data:a.png' }));
  });
});
