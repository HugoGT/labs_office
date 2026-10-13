/**
 * The commands behind `node tools/vm/vm.ts` (nightly job and office-vm.sh),
 * driven through a fake VM so no test ever talks to gcloud.
 */
import { describe, expect, it } from 'vitest';
import { runVmCommand, type VmDescription, type VmPort } from './vmCommands.ts';
import { HEAVY_MACHINE_TYPE, NORMAL_MACHINE_TYPE } from './vmSchedule.ts';

interface FakeVm extends VmPort {
  readonly calls: string[];
  state: VmDescription;
}

function fakeVm(initial: Partial<VmDescription> = {}): FakeVm {
  const vm: FakeVm = {
    calls: [],
    state: { status: 'RUNNING', machineType: NORMAL_MACHINE_TYPE, metadata: {}, ...initial },
    describe() {
      vm.calls.push('describe');
      return { ...vm.state, metadata: { ...vm.state.metadata } };
    },
    stop() {
      vm.calls.push('stop');
      vm.state = { ...vm.state, status: 'TERMINATED' };
    },
    setMachineType(type) {
      vm.calls.push(`setMachineType ${type}`);
      vm.state = { ...vm.state, machineType: type };
    },
    setMetadata(key, value) {
      vm.calls.push(`setMetadata ${key}=${value}`);
      vm.state = { ...vm.state, metadata: { ...vm.state.metadata, [key]: value } };
    },
  };
  return vm;
}

function run(argv: string[], vm: VmPort, now = '2026-10-14T01:30:00Z') {
  const lines: string[] = [];
  const code = runVmCommand(argv, { now: () => new Date(now), vm, out: (line) => lines.push(line) });
  return { code, output: lines.join('\n') };
}

const mutations = (vm: FakeVm) => vm.calls.filter((call) => call !== 'describe');

describe('nightly', () => {
  it('stops a running VM after hours, then sizes it for a heavy next day', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-14' } });
    const { code, output } = run(['nightly'], vm);
    expect(code).toBe(0);
    expect(mutations(vm)).toEqual(['stop', `setMachineType ${HEAVY_MACHINE_TYPE}`]);
    expect(output).toMatch(/stopping/);
    expect(output).toMatch(new RegExp(`${HEAVY_MACHINE_TYPE}`));
  });

  it('keeps a held VM running and does not resize it', () => {
    const vm = fakeVm({ metadata: { 'office-hold-until': '2026-10-14T02:00:00Z', 'office-heavy-days': '2026-10-14' } });
    const { code, output } = run(['nightly'], vm);
    expect(code).toBe(0);
    expect(mutations(vm)).toEqual([]);
    expect(output).toMatch(/hold/);
  });

  it('treats a garbage hold as no hold', () => {
    const vm = fakeVm({ metadata: { 'office-hold-until': 'forever' } });
    run(['nightly'], vm);
    expect(mutations(vm)).toEqual(['stop']);
  });

  it('resizes an already stopped VM only when the size differs', () => {
    const heavy = fakeVm({ status: 'TERMINATED', machineType: HEAVY_MACHINE_TYPE });
    run(['nightly'], heavy);
    expect(mutations(heavy)).toEqual([`setMachineType ${NORMAL_MACHINE_TYPE}`]);

    const normal = fakeVm({ status: 'TERMINATED' });
    run(['nightly'], normal);
    expect(mutations(normal)).toEqual([]);
  });

  it('changes nothing with --dry-run but says what it would do', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-14' } });
    const { code, output } = run(['nightly', '--dry-run'], vm);
    expect(code).toBe(0);
    expect(mutations(vm)).toEqual([]);
    expect(output).toMatch(/dry run: would stop/);
    expect(output).toMatch(new RegExp(`dry run: would set the machine type to ${HEAVY_MACHINE_TYPE}`));
  });

  it('warns about garbage heavy days and ignores them', () => {
    const vm = fakeVm({ status: 'TERMINATED', metadata: { 'office-heavy-days': 'oops,2026-10-14' } });
    const { output } = run(['nightly'], vm);
    expect(output).toMatch(/ignoring invalid heavy days: oops/);
    expect(mutations(vm)).toEqual([`setMachineType ${HEAVY_MACHINE_TYPE}`]);
  });

  it('does not resize when the stop left the VM in another state', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-14' } });
    vm.stop = () => {
      vm.calls.push('stop');
      vm.state = { ...vm.state, status: 'STOPPING' };
    };
    run(['nightly'], vm);
    expect(mutations(vm)).toEqual(['stop']);
  });
});

describe('heavy', () => {
  it('lists the upcoming heavy days', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-01,2026-10-20' } });
    const { code, output } = run(['heavy', 'list'], vm);
    expect(code).toBe(0);
    expect(output).toBe('2026-10-20');
  });

  it('says so when there are none', () => {
    expect(run(['heavy', 'list'], fakeVm()).output).toMatch(/no upcoming heavy days/);
  });

  it('adds a day into the sorted list', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-20' } });
    expect(run(['heavy', 'add', '2026-10-15'], vm).code).toBe(0);
    expect(mutations(vm)).toEqual(['setMetadata office-heavy-days=2026-10-15,2026-10-20']);
  });

  it('removes a day', () => {
    const vm = fakeVm({ metadata: { 'office-heavy-days': '2026-10-15,2026-10-20' } });
    expect(run(['heavy', 'rm', '2026-10-15'], vm).code).toBe(0);
    expect(mutations(vm)).toEqual(['setMetadata office-heavy-days=2026-10-20']);
  });

  it('refuses an invalid date without touching the VM', () => {
    const vm = fakeVm();
    const { code, output } = run(['heavy', 'add', '2026-02-30'], vm);
    expect(code).toBe(2);
    expect(output).toMatch(/2026-02-30/);
    expect(vm.calls).toEqual([]);
  });

  it('refuses a past date to add', () => {
    const vm = fakeVm();
    const { code, output } = run(['heavy', 'add', '2026-10-01'], vm);
    expect(code).toBe(2);
    expect(output).toMatch(/past/);
    expect(mutations(vm)).toEqual([]);
  });
});

describe('hold', () => {
  it('writes now plus the duration', () => {
    const vm = fakeVm();
    const { code, output } = run(['hold', '2h'], vm);
    expect(code).toBe(0);
    expect(mutations(vm)).toEqual(['setMetadata office-hold-until=2026-10-14T03:30:00Z']);
    expect(output).toMatch(/2026-10-14T03:30:00Z/);
  });

  it('refuses a bad duration', () => {
    const vm = fakeVm();
    expect(run(['hold', 'soon'], vm).code).toBe(2);
    expect(vm.calls).toEqual([]);
  });
});

describe('status', () => {
  it('reports state, size, hold and the plan for the next office day', () => {
    const vm = fakeVm({
      metadata: { 'office-hold-until': '2026-10-14T02:00:00Z', 'office-heavy-days': '2026-10-14,2026-10-30' },
    });
    const { code, output } = run(['status'], vm);
    expect(code).toBe(0);
    expect(output).toMatch(/status: RUNNING/);
    expect(output).toMatch(new RegExp(`machine type: ${NORMAL_MACHINE_TYPE}`));
    expect(output).toMatch(/hold until: 2026-10-14T02:00:00Z \(active\)/);
    expect(output).toMatch(/heavy days: 2026-10-14, 2026-10-30/);
    expect(output).toMatch(new RegExp(`next office day: 2026-10-14 \\(${HEAVY_MACHINE_TYPE}\\)`));
    expect(mutations(vm)).toEqual([]);
  });

  it('marks an expired hold', () => {
    const vm = fakeVm({ metadata: { 'office-hold-until': '2026-10-14T01:00:00Z' } });
    expect(run(['status'], vm).output).toMatch(/hold until: 2026-10-14T01:00:00Z \(expired\)/);
  });
});

describe('usage', () => {
  it('prints help and fails on an unknown command', () => {
    const { code, output } = run(['frobnicate'], fakeVm());
    expect(code).toBe(2);
    expect(output).toMatch(/usage/i);
  });
});
