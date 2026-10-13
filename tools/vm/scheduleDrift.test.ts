/**
 * Drift guard between the office-hours rules in vmSchedule.ts and the files
 * that repeat them: the Terraform instance schedule, the nightly workflow's
 * crons and the deploy workflow it must not race. Source-text checks, like
 * `server/src/recording/retention.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEAVY_DAYS_METADATA_KEY,
  HOLD_UNTIL_METADATA_KEY,
  OFFICE_START_CRON,
  OFFICE_STOP_CRON,
  OFFICE_TIMEZONE,
  isOfficeHours,
  zonedDateTime,
} from './vmSchedule.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function variableDefault(source: string, name: string): string {
  const block = new RegExp(`variable "${name}" \\{([\\s\\S]*?)\\n\\}`).exec(source);
  const value = block && /default\s*=\s*"([^"]*)"/.exec(block[1] as string);
  if (!value) throw new Error(`no string default for ${name}`);
  return value[1] as string;
}

describe('Terraform instance schedule', () => {
  const variables = read('../../infra/gcp/terraform/variables.tf');
  const main = read('../../infra/gcp/terraform/main.tf');

  it('declares the same zone and crons as the rules', () => {
    expect(variableDefault(variables, 'vm_schedule_timezone')).toBe(OFFICE_TIMEZONE);
    expect(variableDefault(variables, 'vm_start_schedule')).toBe(OFFICE_START_CRON);
    expect(variableDefault(variables, 'vm_stop_schedule')).toBe(OFFICE_STOP_CRON);
  });

  it('never lets an apply undo the runtime size or metadata keys', () => {
    const ignore = /ignore_changes = \[(\s*metadata_startup_script,[\s\S]*?)\n\s*\]/.exec(main)?.[1] ?? '';
    expect(ignore).toMatch(/\bmachine_type\b/);
    expect(ignore).toContain(`metadata["${HEAVY_DAYS_METADATA_KEY}"]`);
    expect(ignore).toContain(`metadata["${HOLD_UNTIL_METADATA_KEY}"]`);
  });
});

describe('nightly workflow', () => {
  const nightly = read('../../.github/workflows/vm-nightly.yml');
  const deploy = read('../../.github/workflows/deploy-test.yml');
  const crons = [...nightly.matchAll(/cron:\s*'([^']+)'/g)].map((match) => match[1] as string);

  it('runs at 20:30, 23:30 and 02:30 office time, every day', () => {
    expect(crons).toHaveLength(3);
    const officeTimes = crons.map((cron) => {
      const [minute, hour, ...rest] = cron.split(' ');
      expect(rest).toEqual(['*', '*', '*']);
      const local = zonedDateTime(new Date(Date.UTC(2026, 9, 14, Number(hour), Number(minute))));
      return `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
    });
    expect(officeTimes.sort()).toEqual(['02:30', '20:30', '23:30']);
  });

  it('only ever runs outside office hours, on any day of the week', () => {
    for (const cron of crons) {
      const [minute, hour] = cron.split(' ').map(Number) as [number, number];
      for (let day = 12; day < 19; day += 1) {
        expect(isOfficeHours(new Date(Date.UTC(2026, 9, day, hour, minute)))).toBe(false);
      }
    }
  });

  it('shares the deploy concurrency group so it never races a deploy', () => {
    const group = (source: string) => /concurrency:\s*\n\s*group:\s*(\S+)/.exec(source)?.[1];
    expect(group(deploy)).toBe('deploy-test');
    expect(group(nightly)).toBe(group(deploy));
    expect(nightly).toMatch(/cancel-in-progress: false/);
  });

  it('authenticates like the deploy, through Workload Identity Federation', () => {
    for (const line of [
      'workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}',
      'service_account: ${{ vars.GCP_DEPLOYER_SA }}',
    ]) {
      expect(deploy).toContain(line);
      expect(nightly).toContain(line);
    }
  });
});

describe('deploy while the VM is stopped', () => {
  const deploy = read('../../.github/workflows/deploy-test.yml');
  const officeDeploy = read('../../infra/gcp/scripts/office-deploy.sh');

  it('wakes the VM, with a hold, before it deploys over SSH', () => {
    const wake = deploy.indexOf('name: Wake the VM if it is stopped');
    expect(wake).toBeGreaterThan(-1);
    expect(wake).toBeLessThan(deploy.indexOf('name: Deploy over the IAP tunnel'));
    expect(deploy).toContain(`--metadata "${HOLD_UNTIL_METADATA_KEY}=`);
  });

  it('serializes office-deploy runs before reading any configuration', () => {
    const lock = officeDeploy.indexOf('flock -w');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(officeDeploy.indexOf('PROJECT_ID="$(metadata office-project-id)"'));
  });
});
