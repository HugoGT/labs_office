/**
 * Entry point: `node tools/ci/waitForEmptyOffice.ts`, run by deploy-test.yml
 * before an automatic deploy touches the VM (#276). Reads `/health` on
 * `https://$APP_HOST` until nobody is inside. Exits 1 when the office stayed
 * busy for the whole budget, so the run shows red and someone can deploy by
 * hand (`gh workflow run deploy-test.yml`), which never waits.
 */
import { DEPLOY_WAIT_MAX_MINUTES, playersIn, waitForEmptyOffice } from './deployWindow.ts';

const url = `https://${process.env.APP_HOST}/health`;

async function readPlayers(): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? playersIn(await res.json()) : null;
  } catch {
    return null;
  }
}

const decision = await waitForEmptyOffice({
  readPlayers,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (line) => console.log(line),
  maxWaitMs: DEPLOY_WAIT_MAX_MINUTES * 60_000,
});

if (decision.kind === 'give-up') {
  console.log(`::error::${decision.players} still in the office after ${DEPLOY_WAIT_MAX_MINUTES} minutes; not deploying. Deploy by hand with: gh workflow run deploy-test.yml`);
  process.exit(1);
}
console.log(decision.reason === 'empty' ? 'The office is empty; deploying.' : `${url} did not report a count; deploying.`);
