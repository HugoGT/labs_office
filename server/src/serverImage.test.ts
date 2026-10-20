/**
 * Drift guard between what the server imports and what its image copies
 * (`infra/gcp/docker/colyseus.Dockerfile`). The server runs its `.ts` files
 * straight from the image, so a shared module it starts importing from a
 * folder the Dockerfile does not copy only fails when the container boots.
 * Same approach as `caddyRoutes.test.ts`: source text on both sides.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Repository paths the runtime stage copies (`COPY <source> <dest>`, never `--from`). */
function copiedPaths(dockerfile: string): string[] {
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  return [...runtime.matchAll(/^COPY (?!--)(\S+) \S+$/gm)].map((match) => match[1]!.replace(/^\.\//, '').replace(/\/$/, ''));
}

/** Every repository file reachable from `entry` through relative static imports. */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'";]*?from\s+'(\.[^']+)'/g)) {
      const target = resolve(dirname(file), match[1]!);
      if (existsSync(target)) pending.push(target);
    }
  }
  return seen;
}

describe('server image contents', () => {
  const copied = copiedPaths(readFileSync(resolve(ROOT, 'infra/gcp/docker/colyseus.Dockerfile'), 'utf8'));
  const imported = [...importClosure(resolve(ROOT, 'server/src/main.ts'))].map((file) => relative(ROOT, file));

  it('finds what to compare (guards against a broken extractor)', () => {
    expect(copied).toContain('server/src');
    expect(imported).toContain('src/game/officeProtocol.ts');
  });

  it('copies every file the server imports', () => {
    const missing = imported.filter((file) => !copied.some((path) => file === path || file.startsWith(`${path}/`)));
    expect(missing).toEqual([]);
  });
});
