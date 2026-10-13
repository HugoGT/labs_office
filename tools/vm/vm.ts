/**
 * Entry point: `node tools/vm/vm.ts <command>` (see USAGE in vmCommands.ts).
 * Run by the nightly workflow (`.github/workflows/vm-nightly.yml`) and by
 * `infra/gcp/scripts/office-vm.sh`. Wiring only: the clock, the environment
 * and the gcloud process live here, the decisions in vmSchedule.ts.
 */
import { execFileSync } from 'node:child_process';
import { createGcloudVm } from './gcloudVm.ts';
import { runVmCommand } from './vmCommands.ts';

const vm = createGcloudVm({
  project: process.env.GCP_PROJECT_ID || undefined,
  zone: process.env.GCP_ZONE || 'us-central1-a',
  instance: process.env.GCP_INSTANCE || 'labs-office-test',
  // stderr passes through, so a gcloud failure explains itself.
  run: (args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }),
});

process.exitCode = runVmCommand(process.argv.slice(2), {
  now: () => new Date(),
  vm,
  out: (line) => console.log(line),
});
