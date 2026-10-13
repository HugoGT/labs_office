/**
 * The VM port over the gcloud CLI. Each call runs one `gcloud compute
 * instances ...` that waits for its operation, so a stop has finished before
 * the nightly job asks for a resize.
 */
import { machineTypeName } from './vmSchedule.ts';
import type { VmDescription, VmPort } from './vmCommands.ts';

export interface GcloudVmOptions {
  /** Omitted: the project of the active gcloud configuration. */
  readonly project?: string;
  readonly zone: string;
  readonly instance: string;
  /** Runs gcloud with these arguments and returns its stdout. */
  readonly run: (args: string[]) => string;
}

export function describeFromGcloudJson(json: unknown): VmDescription {
  const instance = json as { status?: unknown; machineType?: unknown; metadata?: { items?: unknown } } | null;
  if (!instance || typeof instance.status !== 'string' || typeof instance.machineType !== 'string') {
    throw new Error('gcloud did not describe an instance');
  }
  const metadata: Record<string, string> = {};
  const items = Array.isArray(instance.metadata?.items) ? instance.metadata.items : [];
  for (const item of items as { key?: unknown; value?: unknown }[]) {
    if (typeof item.key === 'string') metadata[item.key] = typeof item.value === 'string' ? item.value : '';
  }
  return { status: instance.status, machineType: machineTypeName(instance.machineType), metadata };
}

export function createGcloudVm(options: GcloudVmOptions): VmPort {
  const target = [options.instance, '--zone', options.zone, ...(options.project ? ['--project', options.project] : [])];
  const gcloud = (verb: string, ...args: string[]) => options.run(['compute', 'instances', verb, ...target, ...args]);

  return {
    describe: () => describeFromGcloudJson(JSON.parse(gcloud('describe', '--format=json'))),
    stop: () => void gcloud('stop', '--quiet'),
    setMachineType: (machineType) => void gcloud('set-machine-type', '--machine-type', machineType),
    setMetadata: (key, value) => {
      if (value === '') {
        gcloud('remove-metadata', '--keys', key);
        return;
      }
      // `--metadata` splits on commas; `^;^` switches the delimiter (see
      // `gcloud topic escaping`) so a comma-separated value stays one value.
      gcloud('add-metadata', `--metadata=^;^${key}=${value}`);
    },
  };
}
