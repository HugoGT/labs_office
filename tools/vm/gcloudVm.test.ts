/**
 * The gcloud adapter of the VM port: only the argument lists and the parsing
 * of `describe --format=json`, through an injected runner.
 */
import { describe, expect, it } from 'vitest';
import { createGcloudVm, describeFromGcloudJson } from './gcloudVm.ts';

function recording(stdout = '{}') {
  const calls: string[][] = [];
  const vm = createGcloudVm({
    project: 'proj',
    zone: 'us-central1-a',
    instance: 'labs-office-test',
    run: (args) => {
      calls.push(args);
      return stdout;
    },
  });
  return { vm, calls };
}

const target = ['labs-office-test', '--zone', 'us-central1-a', '--project', 'proj'];

describe('describeFromGcloudJson', () => {
  it('reads status, machine type name and metadata items', () => {
    expect(
      describeFromGcloudJson({
        status: 'RUNNING',
        machineType: 'https://www.googleapis.com/compute/v1/projects/p/zones/z/machineTypes/e2-standard-4',
        metadata: { items: [{ key: 'office-heavy-days', value: '2026-10-14' }, { key: 'empty' }] },
      }),
    ).toEqual({
      status: 'RUNNING',
      machineType: 'e2-standard-4',
      metadata: { 'office-heavy-days': '2026-10-14', empty: '' },
    });
  });

  it('copes with an instance without metadata', () => {
    expect(describeFromGcloudJson({ status: 'TERMINATED', machineType: 'e2-standard-8' }).metadata).toEqual({});
  });

  it('rejects a payload that is not an instance', () => {
    expect(() => describeFromGcloudJson(null)).toThrow();
    expect(() => describeFromGcloudJson({ status: 1 })).toThrow();
  });
});

describe('createGcloudVm', () => {
  it('describes as JSON', () => {
    const { vm, calls } = recording('{"status":"RUNNING","machineType":"e2-standard-4"}');
    expect(vm.describe().status).toBe('RUNNING');
    expect(calls).toEqual([['compute', 'instances', 'describe', ...target, '--format=json']]);
  });

  it('stops and resizes', () => {
    const { vm, calls } = recording();
    vm.stop();
    vm.setMachineType('e2-standard-8');
    expect(calls).toEqual([
      ['compute', 'instances', 'stop', ...target, '--quiet'],
      ['compute', 'instances', 'set-machine-type', ...target, '--machine-type', 'e2-standard-8'],
    ]);
  });

  it('escapes the comma list delimiter of --metadata', () => {
    const { vm, calls } = recording();
    vm.setMetadata('office-heavy-days', '2026-10-14,2026-10-15');
    expect(calls).toEqual([
      ['compute', 'instances', 'add-metadata', ...target, '--metadata=^;^office-heavy-days=2026-10-14,2026-10-15'],
    ]);
  });

  it('removes the key for an empty value', () => {
    const { vm, calls } = recording();
    vm.setMetadata('office-heavy-days', '');
    expect(calls).toEqual([['compute', 'instances', 'remove-metadata', ...target, '--keys', 'office-heavy-days']]);
  });

  it('leaves the project to gcloud config when none is given', () => {
    const calls: string[][] = [];
    const vm = createGcloudVm({ zone: 'z', instance: 'i', run: (args) => (calls.push(args), '{}') });
    vm.stop();
    expect(calls[0]).toEqual(['compute', 'instances', 'stop', 'i', '--zone', 'z', '--quiet']);
  });
});
