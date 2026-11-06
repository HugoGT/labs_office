import { describe, expect, it } from 'vitest';
import { loadTestUsers, localAuthUsersEnv, orbitPoint, percentile, summarize } from './loadStats.ts';

describe('percentile', () => {
  it('takes the nearest rank of the sorted samples', () => {
    const samples = [50, 10, 40, 20, 30];
    expect(percentile(samples, 50)).toBe(30);
    expect(percentile(samples, 95)).toBe(50);
    expect(percentile(samples, 0)).toBe(10);
  });

  it('is null without samples', () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summarize', () => {
  it('reports count, p50, p95, p99 and max', () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(summarize(samples)).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  });

  it('handles a run-sized sample list (200 clients at 100 ms for minutes)', () => {
    const samples = Array.from({ length: 500_000 }, (_, index) => index % 100);
    expect(summarize(samples).max).toBe(99);
  });

  it('reports only the count when empty', () => {
    expect(summarize([])).toEqual({ count: 0, p50: null, p95: null, p99: null, max: null });
  });
});

describe('orbitPoint', () => {
  it('walks a whole-pixel circle around the center, one step per call', () => {
    const center = { x: 100, y: 200 };
    expect(orbitPoint(center, 12, 0, 8)).toEqual({ x: 112, y: 200 });
    expect(orbitPoint(center, 12, 2, 8)).toEqual({ x: 100, y: 212 });
    expect(orbitPoint(center, 12, 8, 8)).toEqual({ x: 112, y: 200 });
  });
});

describe('loadTestUsers', () => {
  it('numbers the accounts from 1 with two digits', () => {
    expect(loadTestUsers(3, 'pw')).toEqual([
      { email: 'load-01@loadtest.local', password: 'pw' },
      { email: 'load-02@loadtest.local', password: 'pw' },
      { email: 'load-03@loadtest.local', password: 'pw' },
    ]);
  });

  it('formats them as LOCAL_AUTH_USERS', () => {
    expect(localAuthUsersEnv(loadTestUsers(2, 'pw'))).toBe('load-01@loadtest.local:pw,load-02@loadtest.local:pw');
  });
});
