/**
 * Commands of `node tools/vm/vm.ts`, the one place that turns the pure rules
 * of `vmSchedule.ts` into actions on the VM. The VM is a port, so the nightly
 * job and `infra/gcp/scripts/office-vm.sh` run the same code the tests drive
 * with a fake.
 */
import {
  HEAVY_DAYS_METADATA_KEY,
  HOLD_UNTIL_METADATA_KEY,
  addHeavyDay,
  decideNightly,
  isIsoDate,
  machineTypeFor,
  nextOfficeDay,
  parseDuration,
  parseHeavyDays,
  parseHoldUntil,
  removeHeavyDay,
  serializeHoldUntil,
  upcomingHeavyDays,
  zonedDateTime,
} from './vmSchedule.ts';

export interface VmDescription {
  readonly status: string;
  /** Machine type name, not URL. */
  readonly machineType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Every call blocks until GCE reports the operation done. */
export interface VmPort {
  describe(): VmDescription;
  stop(): void;
  setMachineType(machineType: string): void;
  /** An empty value removes the key. */
  setMetadata(key: string, value: string): void;
}

export interface VmCommandDeps {
  readonly now: () => Date;
  readonly vm: VmPort;
  readonly out: (line: string) => void;
}

export const USAGE = `usage: node tools/vm/vm.ts <command>

  nightly [--dry-run]      stop the VM if it runs after hours with no active hold,
                           then size a stopped VM for the next office day
  status                   status, machine type, hold and heavy days
  heavy list               upcoming heavy days (YYYY-MM-DD, America/Lima)
  heavy add|rm YYYY-MM-DD  mark or unmark a heavy day (e2-standard-8)
  hold <duration>          keep the VM running for 2h, 90m, 1h30m from now

  Target: GCP_PROJECT_ID (default: gcloud config), GCP_ZONE (us-central1-a),
  GCP_INSTANCE (labs-office-test).`;

class UsageError extends Error {}

function heavyDaysOf(description: VmDescription, out: (line: string) => void): string[] {
  const { days, invalid } = parseHeavyDays(description.metadata[HEAVY_DAYS_METADATA_KEY]);
  if (invalid.length > 0) out(`warning: ignoring invalid heavy days: ${invalid.join(', ')}`);
  return days;
}

function nightly(args: readonly string[], deps: VmCommandDeps): number {
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) throw new UsageError(`unknown argument: ${unknown.join(' ')}`);
  const { vm, out } = deps;
  const now = deps.now();

  let description = vm.describe();
  const heavyDays = heavyDaysOf(description, out);
  const holdUntil = parseHoldUntil(description.metadata[HOLD_UNTIL_METADATA_KEY]);
  const decide = (state: VmDescription) =>
    decideNightly({ now, status: state.status, machineType: state.machineType, heavyDays, holdUntil });

  let decision = decide(description);
  out(`${description.status} ${description.machineType}: ${decision.reason}`);

  if (decision.stop) {
    if (dryRun) {
      out('dry run: would stop the VM');
      description = { ...description, status: 'TERMINATED' };
    } else {
      out('stopping the VM');
      vm.stop();
      description = vm.describe();
    }
    decision = decide(description);
    out(`${description.status} ${description.machineType}: ${decision.reason}`);
  }

  if (decision.resize) {
    if (dryRun) {
      out(`dry run: would set the machine type to ${decision.targetMachineType}`);
    } else {
      out(`setting the machine type to ${decision.targetMachineType} for ${decision.nextOfficeDay}`);
      vm.setMachineType(decision.targetMachineType);
    }
  }
  return 0;
}

function heavy(args: readonly string[], deps: VmCommandDeps): number {
  const [action, date, ...rest] = args;
  const { vm, out } = deps;
  if (action === 'list' && date === undefined) {
    const days = upcomingHeavyDays(heavyDaysOf(vm.describe(), out), deps.now());
    out(days.length > 0 ? days.join('\n') : 'no upcoming heavy days');
    return 0;
  }
  if ((action !== 'add' && action !== 'rm') || date === undefined || rest.length > 0) {
    throw new UsageError('heavy takes list, add YYYY-MM-DD or rm YYYY-MM-DD');
  }
  if (!isIsoDate(date)) throw new UsageError(`not a YYYY-MM-DD date: ${date}`);
  if (action === 'add' && date < zonedDateTime(deps.now()).date) {
    throw new UsageError(`${date} is in the past in America/Lima`);
  }
  const current = vm.describe().metadata[HEAVY_DAYS_METADATA_KEY];
  const next = action === 'add' ? addHeavyDay(current, date) : removeHeavyDay(current, date);
  vm.setMetadata(HEAVY_DAYS_METADATA_KEY, next);
  out(`${HEAVY_DAYS_METADATA_KEY}: ${next === '' ? '(none)' : next}`);
  return 0;
}

function hold(args: readonly string[], deps: VmCommandDeps): number {
  const [duration, ...rest] = args;
  if (duration === undefined || rest.length > 0) throw new UsageError('hold takes one duration, like 2h');
  let ms: number;
  try {
    ms = parseDuration(duration);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const until = serializeHoldUntil(new Date(deps.now().getTime() + ms));
  deps.vm.setMetadata(HOLD_UNTIL_METADATA_KEY, until);
  deps.out(`${HOLD_UNTIL_METADATA_KEY}: ${until}`);
  return 0;
}

function status(args: readonly string[], deps: VmCommandDeps): number {
  if (args.length > 0) throw new UsageError('status takes no arguments');
  const { vm, out } = deps;
  const now = deps.now();
  const description = vm.describe();
  const heavyDays = heavyDaysOf(description, out);
  const rawHold = description.metadata[HOLD_UNTIL_METADATA_KEY];
  const holdUntil = parseHoldUntil(rawHold);
  const next = nextOfficeDay(now);
  const upcoming = upcomingHeavyDays(heavyDays, now);

  out(`status: ${description.status}`);
  out(`machine type: ${description.machineType}`);
  if (holdUntil) {
    const state = holdUntil.getTime() > now.getTime() ? 'active' : 'expired';
    out(`hold until: ${serializeHoldUntil(holdUntil)} (${state})`);
  } else {
    out(rawHold ? `hold until: invalid value ${JSON.stringify(rawHold)} (no hold)` : 'hold until: none');
  }
  out(`heavy days: ${upcoming.length > 0 ? upcoming.join(', ') : 'none'}`);
  out(`next office day: ${next} (${machineTypeFor(next, heavyDays)})`);
  return 0;
}

const COMMANDS: Record<string, (args: readonly string[], deps: VmCommandDeps) => number> = {
  nightly,
  heavy,
  hold,
  status,
};

/** Exit code: 0 done, 2 usage error (nothing was changed). */
export function runVmCommand(argv: readonly string[], deps: VmCommandDeps): number {
  const [name, ...args] = argv;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    deps.out(USAGE);
    return name === undefined || name === 'help' || name === '--help' ? 0 : 2;
  }
  try {
    return command(args, deps);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.out(`error: ${error.message}`);
    deps.out(USAGE);
    return 2;
  }
}
