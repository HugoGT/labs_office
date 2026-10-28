/**
 * CI splits `pnpm test:all` into shards (`--shard=N/3`, ci.yml). Vitest's own
 * sharding sorts files by a hash of their path, blind to how long they take:
 * it put three of the four `OfficeScene.*.browser.test.ts` files, a third of
 * all test time, in one shard. This assigns files by their recorded wall time
 * instead (`testTimings.json`, refreshed with `pnpm test:timings`).
 *
 * Every shard computes the whole assignment from the same file list and
 * timings, so the shards agree without talking to each other.
 */

/**
 * Files of shard `index` (1-based) out of `count`: heaviest first, each to the
 * lightest shard so far (ties to the lowest index). A file with no timing
 * weighs the median of the known ones, so a new file is neither free nor huge.
 */
export function shardFiles(
  files: readonly string[],
  timings: Readonly<Record<string, number>>,
  count: number,
  index: number,
): string[] {
  const fallback = median(files.map((file) => timings[file]).filter((ms) => ms !== undefined)) ?? 1;
  const weighted = files
    .map((file) => ({ file, ms: timings[file] ?? fallback }))
    .sort((a, b) => b.ms - a.ms || compare(a.file, b.file));
  const loads = Array.from({ length: count }, () => 0);
  const picked: string[] = [];
  for (const { file, ms } of weighted) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest] += ms;
    if (lightest === index - 1) picked.push(file);
  }
  return picked.sort(compare);
}

/** The subset of Vitest's JSON reporter output this reads. */
export interface VitestJsonReport {
  testResults: { name: string; startTime: number; endTime: number }[];
}

/** Per-file wall time in ms, keyed by the path relative to `root`, in path order. */
export function timingsFromReport(report: VitestJsonReport, root: string): Record<string, number> {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const entries = report.testResults.map(({ name, startTime, endTime }) => [
    name.startsWith(prefix) ? name.slice(prefix.length) : name,
    Math.round(endTime - startTime),
  ] as const);
  return Object.fromEntries(entries.sort(([a], [b]) => compare(a, b)));
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
