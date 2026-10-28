import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { shardFiles } from './testShards.ts';

/** Vitest sequencer that shards by recorded file time (`testShards.ts`); ordering stays Vitest's own. */
export class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const timings = JSON.parse(readFileSync(new URL('./testTimings.json', import.meta.url), 'utf8')) as Record<string, number>;
    const byPath = new Map<string, TestSpecification[]>();
    for (const spec of files) {
      const path = relative(this.ctx.config.root, spec.moduleId).split('\\').join('/');
      byPath.set(path, [...(byPath.get(path) ?? []), spec]);
    }
    return shardFiles([...byPath.keys()], timings, count, index).flatMap((path) => byPath.get(path)!);
  }
}
