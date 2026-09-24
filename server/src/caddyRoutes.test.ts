/**
 * Drift guard between `createOfficeServer.ts` and the deployed Caddyfile
 * (#73, #69). Caddy's `handle` blocks are evaluated in order and the last one
 * has no matcher: it swallows everything that did not match above, and
 * answers with the SPA's `index.html` (200, not 404). A server route with no
 * corresponding `handle` block falls into that trap silently - the symptom is
 * `Unexpected token '<'` in the browser, nothing in the server logs, because
 * the request never reached it.
 *
 * This test extracts both sides from source text, the same approach as
 * `recording/retention.test.ts` for the retention constant: no server boot,
 * no Caddy binary, just the two files staying honest with each other.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serverSource = () =>
  readFileSync(new URL('./createOfficeServer.ts', import.meta.url), 'utf8');

const caddyfile = () => readFileSync(new URL('../../infra/gcp/Caddyfile', import.meta.url), 'utf8');

/**
 * Extracts every route literal registered on `app` in `createOfficeServer.ts`.
 * The regex is multiline on purpose: several routes are registered as
 * `app.get(\n  '/path',\n  ...)`, with the literal on the line after the verb
 * call, so `\s*` (which matches newlines too) sits between them instead of
 * requiring the same line.
 */
function extractServerRoutes(source: string): string[] {
  const routes: string[] = [];
  const pattern = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    routes.push(match[2]);
  }
  return routes;
}

/**
 * Extracts every Caddy `handle` matcher path: an exact path (`handle /spaces {`)
 * or a prefix (`handle /desks/* {`). The final catch-all `handle {` has no
 * path and is excluded on purpose - it is the fallback this guard exists to
 * keep routes out of.
 */
function extractCaddyHandles(source: string): string[] {
  const handles: string[] = [];
  const pattern = /handle (\/\S+) \{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    handles.push(match[1]);
  }
  return handles;
}

/**
 * Mirrors Caddy's own matching: a `/x/*` handle matches only paths that start
 * with `/x/` (never the bare `/x`), everything else is an exact match.
 */
function isCoveredBy(route: string, handle: string): boolean {
  if (handle.endsWith('/*')) {
    const prefix = handle.slice(0, -1); // drop the trailing '*', keep the '/'
    return route.startsWith(prefix);
  }
  return route === handle;
}

describe('Caddy route coverage (#73)', () => {
  // `/admin/*` is already covered by one wildcard handle and grows on its
  // own; this guard is about routes living outside it.
  const serverRoutes = [
    ...new Set(extractServerRoutes(serverSource()).filter((route) => !route.startsWith('/admin'))),
  ];
  const caddyHandles = extractCaddyHandles(caddyfile());

  it('finds server routes to check (guards against a broken extractor)', () => {
    expect(serverRoutes.length).toBeGreaterThan(5);
  });

  it.each(serverRoutes)('%s reaches the backend through a Caddy handle', (route) => {
    const covered = caddyHandles.some((handle) => isCoveredBy(route, handle));
    expect(covered, `no Caddy handle covers ${route} (handles: ${caddyHandles.join(', ')})`).toBe(
      true,
    );
  });

  it('routes /assets only as an exact match, never as a prefix', () => {
    expect(caddyHandles).toContain('/assets');
    expect(caddyHandles).not.toContain('/assets*');
    expect(caddyHandles).not.toContain('/assets/*');
  });

  it('does not capture a Vite bundle path under the /assets handle', () => {
    expect(isCoveredBy('/assets/index-abc.js', '/assets')).toBe(false);
  });
});
