/**
 * Entry point: `node tools/ci/skipTestedTree.ts`, run by ci.yml on pushes to
 * main. Writes `tested=true` to the step outputs when a PR run already
 * verified this tree (see testedTree.ts), `tested=false` otherwise. Never
 * fails the step: an error means "not proven tested", so the full CI runs.
 */
import { appendFileSync } from 'node:fs';
import { findTestedRun, gitHubFromApi } from './testedTree.ts';

const env = process.env;
const api = env.GITHUB_API_URL || 'https://api.github.com';

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

let tested = false;
try {
  const runId = await findTestedRun(env.TREE_SHA ?? '', Number(env.GITHUB_REPOSITORY_ID), gitHubFromApi(get));
  if (runId === null) {
    console.log(`No green pull request run tested tree ${env.TREE_SHA}; running the full CI.`);
  } else {
    tested = true;
    console.log(`Tree ${env.TREE_SHA} already passed in ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}; skipping the full CI.`);
  }
} catch (error) {
  console.log(`::warning::Could not check for an already tested tree, running the full CI: ${String(error)}`);
}

if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tested=${tested}\n`);
