/**
 * #278: no other container may starve the SFU of CPU. Source-text checks on
 * the VM compose, like `scheduleDrift.test.ts`: the file is only ever parsed
 * by Docker on the VM.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL_MACHINE_TYPE } from './vmSchedule.ts';

const compose = readFileSync(new URL('../../infra/gcp/docker-compose.yml', import.meta.url), 'utf8');

/** Each top-level service and the text of its block. */
function services(): Map<string, string> {
  const section = /^services:\n([\s\S]*?)^\S/m.exec(compose)?.[1] ?? '';
  const blocks = new Map<string, string>();
  for (const match of section.matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)) {
    blocks.set(match[1] as string, match[2] as string);
  }
  return blocks;
}

const cpusOf = (block: string) => Number(/^ {4}cpus: "([\d.]+)"$/m.exec(block)?.[1] ?? Number.NaN);
// Docker's default weight when a service sets none.
const sharesOf = (block: string) => Number(/^ {4}cpu_shares: (\d+)$/m.exec(block)?.[1] ?? 1024);
const vcpusOf = (machineType: string) => Number(/-(\d+)$/.exec(machineType)?.[1]);

describe('CPU isolation of the SFU (#278)', () => {
  const all = services();
  const others = [...all.keys()].filter((name) => name !== 'livekit');

  it('finds every service of the stack', () => {
    expect([...all.keys()].sort()).toEqual(['caddy', 'colyseus', 'egress', 'livekit', 'redis', 'web']);
  });

  it('never caps LiveKit itself', () => {
    expect(all.get('livekit')).not.toMatch(/^ {4}cpus:/m);
  });

  it('weights LiveKit above everything else together, with margin', () => {
    const livekit = sharesOf(all.get('livekit') as string);
    const rest = others.reduce((sum, name) => sum + sharesOf(all.get(name) as string), 0);
    expect(livekit).toBeGreaterThanOrEqual(3 * rest);
  });

  it('caps every other service but Egress, below the size of a normal day', () => {
    const capped = others.filter((name) => name !== 'egress');
    const caps = capped.map((name) => cpusOf(all.get(name) as string));
    for (const [index, cap] of caps.entries()) expect(cap, `${capped[index]} cpus`).toBeGreaterThan(0);
    expect(caps.reduce((sum, cap) => sum + cap, 0)).toBeLessThan(vcpusOf(NORMAL_MACHINE_TYPE));
  });

  it('leaves Egress unquoted on purpose: its admission reads the cgroup quota', () => {
    const egress = all.get('egress') as string;
    expect(egress).not.toMatch(/^ {4}cpus:/m);
    expect(compose).toMatch(/Egress gets no `cpus` quota/);
  });
});
