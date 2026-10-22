/**
 * Whether a push to main carries a tree that a pull request run of ci.yml
 * already verified. A PR run tests `refs/pull/N/merge`; when main did not move
 * before the merge, the merge (or squash) commit has that exact tree, so a
 * second full run would test the same bytes again. Any other case, including
 * every error, runs the full CI.
 *
 * The PR run records its tree as an empty artifact named after it. The repo is
 * public and a fork's PR runs its own copy of ci.yml, so a fork could upload
 * that name for any tree: only runs whose head is this repository count.
 */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

export const testedTreeArtifactName = (tree: string) => `tested-tree-${tree}`;

export interface TestedTreeArtifact {
  name: string;
  expired: boolean;
  workflowRunId: number;
}

export interface TestedTreeRun {
  path: string;
  event: string;
  conclusion: string | null;
  headRepositoryId: number | null;
}

export interface TestedTreeGitHub {
  listArtifacts(name: string): Promise<TestedTreeArtifact[]>;
  getRun(id: number): Promise<TestedTreeRun>;
}

// SHA-1 or SHA-256 object ids, as git prints them.
const TREE_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The id of a green same-repo PR run of ci.yml that tested `tree`, or null. */
export async function findTestedRun(
  tree: string,
  repositoryId: number,
  github: TestedTreeGitHub,
): Promise<number | null> {
  if (!TREE_SHA.test(tree)) return null;
  const name = testedTreeArtifactName(tree);
  for (const artifact of await github.listArtifacts(name)) {
    if (artifact.name !== name || artifact.expired) continue;
    const run = await github.getRun(artifact.workflowRunId);
    if (
      run.path === CI_WORKFLOW_PATH &&
      run.event === 'pull_request' &&
      run.conclusion === 'success' &&
      run.headRepositoryId === repositoryId
    ) {
      return artifact.workflowRunId;
    }
  }
  return null;
}

interface ArtifactsPayload {
  artifacts: { name: string; expired: boolean; workflow_run: { id: number } }[];
}

interface RunPayload {
  path: string;
  event: string;
  conclusion: string | null;
  head_repository: { id: number } | null;
}

/** Adapts the REST API; `get` takes a path relative to `/repos/{owner}/{repo}`. */
export function gitHubFromApi(get: (path: string) => Promise<unknown>): TestedTreeGitHub {
  return {
    async listArtifacts(name) {
      const body = (await get(`/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`)) as ArtifactsPayload;
      return body.artifacts.map((a) => ({ name: a.name, expired: a.expired, workflowRunId: a.workflow_run.id }));
    },
    async getRun(id) {
      const run = (await get(`/actions/runs/${id}`)) as RunPayload;
      return {
        path: run.path,
        event: run.event,
        conclusion: run.conclusion,
        headRepositoryId: run.head_repository?.id ?? null,
      };
    },
  };
}
