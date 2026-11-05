import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEPLOY_WAIT_MAX_MINUTES,
  DEPLOY_WAIT_POLL_MS,
  decideDeployWindow,
  playersIn,
  waitForEmptyOffice,
} from './deployWindow.ts';

describe('playersIn', () => {
  it('reads the count /health reports', () => {
    expect(playersIn({ ok: true, players: 3 })).toBe(3);
    expect(playersIn({ ok: true, players: 0 })).toBe(0);
  });

  it('is unknown for a server that predates the count or answers something else', () => {
    expect(playersIn({ ok: true })).toBeNull();
    expect(playersIn('<!doctype html>')).toBeNull();
    expect(playersIn({ players: -1 })).toBeNull();
    expect(playersIn({ players: '2' })).toBeNull();
    expect(playersIn(null)).toBeNull();
  });
});

describe('decideDeployWindow', () => {
  const max = 60_000;

  it('deploys into an empty office', () => {
    expect(decideDeployWindow({ players: 0, waitedMs: 0, maxWaitMs: max })).toEqual({ kind: 'deploy', reason: 'empty' });
  });

  it('waits while anyone is inside', () => {
    expect(decideDeployWindow({ players: 2, waitedMs: 0, maxWaitMs: max })).toEqual({ kind: 'wait', players: 2 });
  });

  it('deploys when the office does not answer: a stopped VM has nobody to drop', () => {
    expect(decideDeployWindow({ players: null, waitedMs: 0, maxWaitMs: max })).toEqual({ kind: 'deploy', reason: 'unknown' });
  });

  it('gives up instead of waiting past its budget', () => {
    expect(decideDeployWindow({ players: 1, waitedMs: max, maxWaitMs: max })).toEqual({ kind: 'give-up', players: 1 });
  });
});

describe('waitForEmptyOffice', () => {
  function fakeClock(counts: (number | null)[]) {
    let now = 0;
    const slept: number[] = [];
    const logs: string[] = [];
    return {
      slept,
      logs,
      deps: {
        readPlayers: async () => counts.shift() ?? 0,
        sleep: async (ms: number) => {
          slept.push(ms);
          now += ms;
        },
        now: () => now,
        log: (line: string) => logs.push(line),
      },
    };
  }

  it('polls until the office empties, then lets the deploy go', async () => {
    const clock = fakeClock([3, 1, 0]);

    expect(await waitForEmptyOffice({ ...clock.deps, maxWaitMs: 10 * DEPLOY_WAIT_POLL_MS })).toEqual({ kind: 'deploy', reason: 'empty' });
    expect(clock.slept).toEqual([DEPLOY_WAIT_POLL_MS, DEPLOY_WAIT_POLL_MS]);
  });

  it('stops waiting once the budget is spent', async () => {
    const clock = fakeClock([1, 1, 1, 1, 1]);

    const decision = await waitForEmptyOffice({ ...clock.deps, maxWaitMs: 2 * DEPLOY_WAIT_POLL_MS });

    expect(decision).toEqual({ kind: 'give-up', players: 1 });
    expect(clock.slept).toHaveLength(2);
  });

  it('never sleeps for an office that is already empty', async () => {
    const clock = fakeClock([0]);

    await waitForEmptyOffice({ ...clock.deps, maxWaitMs: DEPLOY_WAIT_POLL_MS });

    expect(clock.slept).toEqual([]);
  });
});

/** Source-text checks, like `tools/vm/scheduleDrift.test.ts`. */
describe('deploy-test.yml', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-test.yml', import.meta.url), 'utf8');
  const steps = workflow.split(/\n      - name: /).slice(1);
  const stepIndex = (name: string) => steps.findIndex((step) => step.startsWith(name));
  const gate = steps[stepIndex('Wait for an empty office')] ?? '';

  it('waits for an empty office only on the automatic deploy, so a manual one stays possible', () => {
    expect(gate).toContain('node tools/ci/waitForEmptyOffice.ts');
    expect(gate).toMatch(/if: github\.event_name == 'workflow_run'/);
  });

  it('waits right before the VM is touched: after the image builds and before the wake and the deploy', () => {
    const gateAt = stepIndex('Wait for an empty office');
    expect(gateAt).toBeGreaterThan(stepIndex('Build and push the web image'));
    expect(gateAt).toBeLessThan(stepIndex('Wake the VM if it is stopped'));
    expect(gateAt).toBeLessThan(stepIndex('Deploy over the IAP tunnel'));
  });

  it('gives the job room for the whole wait', () => {
    const timeout = Number(/\n    timeout-minutes: (\d+)/.exec(workflow)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(DEPLOY_WAIT_MAX_MINUTES + 30);
    // GitHub-hosted runners stop every job at 6 hours.
    expect(timeout).toBeLessThanOrEqual(360);
  });
});
