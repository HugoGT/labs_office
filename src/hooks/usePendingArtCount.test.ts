import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contribution } from '../dashboard/artContributionPort';
import type { ArtReviewPort } from '../dashboard/artReviewPort';
import { PENDING_ART_POLL_MS, usePendingArtCount } from './usePendingArtCount';

function piece(id: string): Contribution {
  return {
    id,
    kind: 'plant',
    name: id,
    author: 'Ana',
    status: 'pending',
    reviewNote: null,
    submittedAt: '2026-10-01T10:00:00.000Z',
    retiredAt: null,
    files: [],
    uploadedBy: null,
  };
}

function reviews(list: ArtReviewPort['list']): ArtReviewPort {
  return { list, approve: vi.fn(), reject: vi.fn(), retire: vi.fn(), fileDataUrl: vi.fn() };
}

describe('usePendingArtCount (#122)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the pieces waiting for review as soon as it mounts', async () => {
    const list = vi.fn(async () => [piece('a'), piece('b'), piece('c')]);
    const port = reviews(list);
    const { result } = renderHook(() => usePendingArtCount(port));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(list).toHaveBeenCalledWith('pending');
    expect(result.current.count).toBe(3);
  });

  it('asks for nothing without a port: whoever does not review has no count', async () => {
    const { result } = renderHook(() => usePendingArtCount(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ART_POLL_MS * 2);
    });

    expect(result.current.count).toBe(0);
  });

  it('asks again every minute, so a piece sent meanwhile shows up without reloading', async () => {
    const list = vi.fn<ArtReviewPort['list']>().mockResolvedValueOnce([]).mockResolvedValue([piece('a')]);
    const port = reviews(list);
    const { result } = renderHook(() => usePendingArtCount(port));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.count).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ART_POLL_MS);
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.count).toBe(1);
  });

  it('takes the number the queue itself reports, without waiting for the next poll', async () => {
    const list = vi.fn(async () => [piece('a'), piece('b')]);
    const port = reviews(list);
    const { result } = renderHook(() => usePendingArtCount(port));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => result.current.report(1));

    expect(result.current.count).toBe(1);
  });

  it('keeps the last count when a request fails, and tries again later', async () => {
    const list = vi.fn<ArtReviewPort['list']>().mockResolvedValueOnce([piece('a'), piece('b')]).mockRejectedValueOnce(new Error('red')).mockResolvedValue([piece('a')]);
    const port = reviews(list);
    const { result } = renderHook(() => usePendingArtCount(port));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ART_POLL_MS);
    });
    expect(result.current.count).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ART_POLL_MS);
    });
    expect(result.current.count).toBe(1);
  });

  it('stops asking when it unmounts', async () => {
    const list = vi.fn(async () => []);
    const port = reviews(list);
    const { unmount } = renderHook(() => usePendingArtCount(port));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();

    await vi.advanceTimersByTimeAsync(PENDING_ART_POLL_MS * 3);

    expect(list).toHaveBeenCalledTimes(1);
  });
});
