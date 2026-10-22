/**
 * The decision behind `node tools/ci/skipTestedTree.ts`: whether a push to
 * main carries a tree a pull request run already verified, so ci.yml can skip
 * its second full run. Driven through a fake GitHub API, plus a source-text
 * drift check against ci.yml like `tools/vm/scheduleDrift.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CI_WORKFLOW_PATH,
  findTestedRun,
  gitHubFromApi,
  testedTreeArtifactName,
  type TestedTreeGitHub,
  type TestedTreeRun,
} from './testedTree.ts';

const REPO_ID = 1344105072;
const FORK_ID = 999;
const TREE = 'a'.repeat(40);

const greenRun: TestedTreeRun = {
  path: CI_WORKFLOW_PATH,
  event: 'pull_request',
  conclusion: 'success',
  headRepositoryId: REPO_ID,
};

function fakeGitHub(
  artifacts: { name?: string; expired?: boolean; runId: number }[],
  runs: Record<number, Partial<TestedTreeRun>>,
): TestedTreeGitHub & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    async listArtifacts(name) {
      listed.push(name);
      return artifacts.map((a) => ({ name: a.name ?? name, expired: a.expired ?? false, workflowRunId: a.runId }));
    },
    async getRun(id) {
      const run = runs[id];
      if (!run) throw new Error(`no run ${id}`);
      return { ...greenRun, ...run };
    },
  };
}

describe('findTestedRun', () => {
  it('returns the green pull request run that recorded this tree', async () => {
    const github = fakeGitHub([{ runId: 7 }], { 7: {} });

    expect(await findTestedRun(TREE, REPO_ID, github)).toBe(7);
    expect(github.listed).toEqual([`tested-tree-${TREE}`]);
  });

  it('returns null when no run recorded this tree', async () => {
    expect(await findTestedRun(TREE, REPO_ID, fakeGitHub([], {}))).toBeNull();
  });

  it('ignores a run from a fork, which can rewrite ci.yml to record any tree', async () => {
    const github = fakeGitHub([{ runId: 7 }], { 7: { headRepositoryId: FORK_ID } });

    expect(await findTestedRun(TREE, REPO_ID, github)).toBeNull();
  });

  it('ignores runs that did not pass, are not pull request CI, or another workflow', async () => {
    const github = fakeGitHub([{ runId: 1 }, { runId: 2 }, { runId: 3 }, { runId: 4 }], {
      1: { conclusion: 'failure' },
      2: { conclusion: null },
      3: { event: 'push' },
      4: { path: '.github/workflows/deploy-test.yml' },
    });

    expect(await findTestedRun(TREE, REPO_ID, github)).toBeNull();
  });

  it('ignores expired artifacts and artifacts with another name', async () => {
    const github = fakeGitHub(
      [
        { runId: 1, expired: true },
        { runId: 2, name: `tested-tree-${'b'.repeat(40)}` },
      ],
      { 1: {}, 2: {} },
    );

    expect(await findTestedRun(TREE, REPO_ID, github)).toBeNull();
  });

  it('keeps looking past a rejected run', async () => {
    const github = fakeGitHub([{ runId: 1 }, { runId: 2 }], { 1: { conclusion: 'cancelled' }, 2: {} });

    expect(await findTestedRun(TREE, REPO_ID, github)).toBe(2);
  });

  it('never queries for a value that is not a tree hash', async () => {
    const github = fakeGitHub([{ runId: 7 }], { 7: {} });

    for (const tree of ['', 'abc', TREE.toUpperCase(), `${TREE}x`]) {
      expect(await findTestedRun(tree, REPO_ID, github)).toBeNull();
    }
    expect(github.listed).toEqual([]);
  });
});

describe('gitHubFromApi', () => {
  it('maps the REST artifact and run payloads', async () => {
    const paths: string[] = [];
    const github = gitHubFromApi(async (path) => {
      paths.push(path);
      if (path.startsWith('/actions/artifacts')) {
        return {
          artifacts: [{ name: `tested-tree-${TREE}`, expired: false, workflow_run: { id: 7, head_repository_id: REPO_ID } }],
        };
      }
      return {
        path: CI_WORKFLOW_PATH,
        event: 'pull_request',
        conclusion: 'success',
        head_repository: { id: REPO_ID },
      };
    });

    expect(await github.listArtifacts(`tested-tree-${TREE}`)).toEqual([
      { name: `tested-tree-${TREE}`, expired: false, workflowRunId: 7 },
    ]);
    expect(await github.getRun(7)).toEqual(greenRun);
    expect(paths).toEqual([`/actions/artifacts?name=tested-tree-${TREE}&per_page=100`, '/actions/runs/7']);
  });
});

describe('ci.yml', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

  it('records the tree under the name the push check looks for', () => {
    expect(ci).toContain(`name: ${testedTreeArtifactName('${{ steps.tree.outputs.sha }}')}`);
  });

  it('runs the push check from this module', () => {
    expect(ci).toContain('run: node tools/ci/skipTestedTree.ts');
  });
});
