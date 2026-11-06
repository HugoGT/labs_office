/** Pure helpers of the Colyseus load test (#274): no sockets, no clock. */

export interface Summary {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

/** Nearest-rank percentile, or `null` without samples. */
export function percentile(samples: readonly number[], p: number): number | null {
  return rank(sortedCopy(samples), p);
}

/**
 * Sorts once for every figure. Never `Math.max(...samples)`: a run collects
 * hundreds of thousands of samples, past the call stack's argument limit.
 */
export function summarize(samples: readonly number[]): Summary {
  const sorted = sortedCopy(samples);
  return {
    count: sorted.length,
    p50: rank(sorted, 50),
    p95: rank(sorted, 95),
    p99: rank(sorted, 99),
    max: sorted.length === 0 ? null : sorted[sorted.length - 1]!,
  };
}

function sortedCopy(samples: readonly number[]): number[] {
  return [...samples].sort((a, b) => a - b);
}

function rank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1]!;
}

/**
 * Step `step` of a walk around `center`. Whole pixels, so the server's echo
 * of the position can be matched exactly against what was sent.
 */
export function orbitPoint(center: { x: number; y: number }, radius: number, step: number, steps: number): { x: number; y: number } {
  const angle = (2 * Math.PI * (step % steps)) / steps;
  return { x: Math.round(center.x + radius * Math.cos(angle)), y: Math.round(center.y + radius * Math.sin(angle)) };
}

export interface LoadTestUser {
  email: string;
  password: string;
}

export function loadTestUsers(count: number, password: string): LoadTestUser[] {
  return Array.from({ length: count }, (_, index) => ({
    email: `load-${String(index + 1).padStart(2, '0')}@loadtest.local`,
    password,
  }));
}

/** The users as `LOCAL_AUTH_USERS` reads them (`server/src/localAuth/localAuthConfig.ts`). */
export function localAuthUsersEnv(users: readonly LoadTestUser[]): string {
  return users.map(({ email, password }) => `${email}:${password}`).join(',');
}
