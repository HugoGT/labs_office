import { describe, expect, it } from 'vitest';
import { shardFiles, timingsFromReport } from './testShards.ts';

const all = (files: string[], timings: Record<string, number>, count: number) =>
  Array.from({ length: count }, (_, i) => shardFiles(files, timings, count, i + 1));

describe('shardFiles', () => {
  it('puts every file in exactly one shard', () => {
    const files = Array.from({ length: 10 }, (_, i) => `f${i}.test.ts`);
    const shards = all(files, { 'f0.test.ts': 500, 'f3.test.ts': 200 }, 3);

    expect(shards.flat().sort()).toEqual([...files].sort());
  });

  it('spreads the slowest files across shards instead of hashing them together', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'];
    const shards = all(files, { a: 300, b: 290, c: 280, d: 10, e: 10, f: 10 }, 3);

    expect(shards.map((s) => s.filter((f) => ['a', 'b', 'c'].includes(f)))).toEqual([['a'], ['b'], ['c']]);
  });

  it('balances the summed time of each shard', () => {
    const timings = { a: 60, b: 50, c: 40, d: 30, e: 20, f: 10 };
    const sums = all(Object.keys(timings), timings, 3).map((s) =>
      s.reduce((sum, f) => sum + timings[f as keyof typeof timings], 0),
    );

    expect(sums).toEqual([70, 70, 70]);
  });

  it('weighs a file without a timing as the median of the known ones', () => {
    // Median 100: `new` weighs as much as `mid`, so it follows it into the lighter shard, ahead of `small`.
    const shards = all(['big', 'mid', 'small', 'new'], { big: 1000, mid: 100, small: 1 }, 2);

    expect(shards).toEqual([['big'], ['mid', 'new', 'small']]);
  });

  it('assigns the same shards whatever order the files arrive in', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const timings = Object.fromEntries(files.map((f, i) => [f, (i * 37) % 11]));

    expect(all([...files].reverse(), timings, 3)).toEqual(all(files, timings, 3));
  });

  it('returns the shard files in path order', () => {
    expect(shardFiles(['c', 'a', 'b'], {}, 1, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('timingsFromReport', () => {
  it('keys each file by its root-relative path with its wall time in ms', () => {
    const report = {
      testResults: [
        { name: '/repo/src/a.test.ts', startTime: 1000, endTime: 3500.4 },
        { name: '/repo/server/b.test.ts', startTime: 2000, endTime: 2010 },
      ],
    };

    expect(timingsFromReport(report, '/repo')).toEqual({ 'server/b.test.ts': 10, 'src/a.test.ts': 2500 });
  });
});
