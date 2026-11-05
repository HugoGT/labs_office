/**
 * The deploy window (#276): every merge to main deploys to the VM the office
 * is running on, and recreating the server container drops everyone inside,
 * meetings included. The automatic deploy waits until `/health` reports
 * nobody inside; a manual `workflow_dispatch` never waits, which is the way
 * to ship something urgent.
 *
 * Import-free, run by Node type stripping like `testedTree.ts`.
 */

/** How often the office is asked while someone is inside. */
export const DEPLOY_WAIT_POLL_MS = 60_000;

/**
 * Longest wait, kept under the 6 hour cap GitHub puts on a hosted job. The
 * 20:00 scheduled stop usually ends it sooner: a stopped VM does not answer,
 * and that reads as nobody inside.
 */
export const DEPLOY_WAIT_MAX_MINUTES = 300;

/** The people count of a `/health` body, or null when it carries none. */
export function playersIn(health: unknown): number | null {
  if (typeof health !== 'object' || health === null) return null;
  const players = (health as { players?: unknown }).players;
  return typeof players === 'number' && Number.isInteger(players) && players >= 0 ? players : null;
}

export type DeployWindowDecision =
  | { kind: 'deploy'; reason: 'empty' | 'unknown' }
  | { kind: 'wait'; players: number }
  | { kind: 'give-up'; players: number };

export interface DeployWindowInput {
  /** People inside, or null when the office did not say (stopped VM, older server). */
  players: number | null;
  waitedMs: number;
  maxWaitMs: number;
}

export function decideDeployWindow({ players, waitedMs, maxWaitMs }: DeployWindowInput): DeployWindowDecision {
  // Not knowing is not a reason to hold a deploy forever: a stopped VM has
  // nobody to drop, and a server older than the count only happens once.
  if (players === null) return { kind: 'deploy', reason: 'unknown' };
  if (players === 0) return { kind: 'deploy', reason: 'empty' };
  if (waitedMs >= maxWaitMs) return { kind: 'give-up', players };
  return { kind: 'wait', players };
}

export interface WaitForEmptyOfficeDeps {
  readPlayers(): Promise<number | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
  maxWaitMs: number;
}

/** Polls until the office is empty or the budget is spent; never throws for a busy office. */
export async function waitForEmptyOffice({ readPlayers, sleep, now, log, maxWaitMs }: WaitForEmptyOfficeDeps): Promise<Exclude<DeployWindowDecision, { kind: 'wait' }>> {
  const start = now();
  for (;;) {
    const decision = decideDeployWindow({ players: await readPlayers(), waitedMs: now() - start, maxWaitMs });
    if (decision.kind !== 'wait') return decision;
    log(`${decision.players} in the office; checking again in ${DEPLOY_WAIT_POLL_MS / 1000} s`);
    await sleep(DEPLOY_WAIT_POLL_MS);
  }
}
