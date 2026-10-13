/**
 * Office-hours rules for the deployed `test` VM (cost cut: the VM only runs
 * while people work). Pure: every function takes its instant and data as
 * arguments and never reads the clock, the environment or gcloud, so the
 * nightly job, `office-vm.sh` and the tests share one source of truth.
 *
 * The instance schedule in Terraform starts the VM at OFFICE_START and stops
 * it at OFFICE_STOP on weekdays, in OFFICE_TIMEZONE. Office hours are the
 * half-open window [start, stop): 07:45 is inside, 20:00 is already outside.
 * `infra/gcp/terraform/variables.tf` must declare the same cron strings, which
 * `scheduleDrift.test.ts` asserts.
 *
 * Import-free on purpose: Node runs it by type stripping in a GitHub runner
 * that never ran `pnpm install`.
 */

export const OFFICE_TIMEZONE = 'America/Lima';
export const OFFICE_START = { hour: 7, minute: 45 } as const;
export const OFFICE_STOP = { hour: 20, minute: 0 } as const;
/** Cron day-of-week numbers (0 is Sunday): Monday to Friday. */
export const OFFICE_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

const cronOf = (time: { hour: number; minute: number }) => `${time.minute} ${time.hour} * * 1-5`;
export const OFFICE_START_CRON = cronOf(OFFICE_START);
export const OFFICE_STOP_CRON = cronOf(OFFICE_STOP);

export const NORMAL_MACHINE_TYPE = 'e2-standard-4';
export const HEAVY_MACHINE_TYPE = 'e2-standard-8';

export const HEAVY_DAYS_METADATA_KEY = 'office-heavy-days';
export const HOLD_UNTIL_METADATA_KEY = 'office-hold-until';

/** Longest hold a manual start may ask for; anything longer is a typo. */
export const MAX_HOLD_MS = 24 * 60 * 60 * 1000;

export interface ZonedDateTime {
  /** `YYYY-MM-DD` in the zone. */
  readonly date: string;
  /** 0 is Sunday, like cron. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall clock of `instant` in `timeZone`, through Intl (no hardcoded offset). */
export function zonedDateTime(instant: Date, timeZone: string = OFFICE_TIMEZONE): ZonedDateTime {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday as string] as number,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const local = zonedDateTime(instant, timeZone);
  const [year, month, day] = local.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, local.hour, local.minute, local.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock of `timeZone` reads `date hour:minute`. */
export function zonedInstant(date: string, hour: number, minute: number, timeZone: string = OFFICE_TIMEZONE): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset on either side of a DST change.
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

const minutesOf = (time: { hour: number; minute: number }) => time.hour * 60 + time.minute;

/** Inside [OFFICE_START, OFFICE_STOP) on an office weekday. */
export function isOfficeHours(now: Date, timeZone: string = OFFICE_TIMEZONE): boolean {
  const local = zonedDateTime(now, timeZone);
  if (!OFFICE_WEEKDAYS.includes(local.weekday)) return false;
  const minutes = minutesOf(local);
  return minutes >= minutesOf(OFFICE_START) && minutes < minutesOf(OFFICE_STOP);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The office date of the next scheduled start strictly after `now`: today
 * until 07:45, then the next weekday. It is the day whose size the nightly job
 * prepares.
 */
export function nextOfficeDay(now: Date, timeZone: string = OFFICE_TIMEZONE): string {
  let date = zonedDateTime(now, timeZone).date;
  for (let i = 0; i < 8; i += 1) {
    const start = zonedInstant(date, OFFICE_START.hour, OFFICE_START.minute, timeZone);
    if (OFFICE_WEEKDAYS.includes(weekdayOf(date)) && start.getTime() > now.getTime()) return date;
    date = addDays(date, 1);
  }
  throw new Error('no office day within a week');
}

/** A real calendar date written exactly as `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export interface HeavyDays {
  readonly days: string[];
  readonly invalid: string[];
}

/**
 * Reads the `office-heavy-days` metadata value. Garbage entries are set aside
 * in `invalid` rather than guessed at, so a typo never turns a day heavy.
 */
export function parseHeavyDays(value: string | undefined): HeavyDays {
  const days = new Set<string>();
  const invalid: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (isIsoDate(entry)) days.add(entry);
    else invalid.push(entry);
  }
  return { days: [...days].sort(), invalid };
}

export function serializeHeavyDays(days: readonly string[]): string {
  for (const day of days) {
    if (!isIsoDate(day)) throw new Error(`not a YYYY-MM-DD date: ${day}`);
  }
  return [...new Set(days)].sort().join(',');
}

function requireDate(date: string): string {
  if (!isIsoDate(date)) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return date;
}

export function addHeavyDay(value: string | undefined, date: string): string {
  return serializeHeavyDays([...parseHeavyDays(value).days, requireDate(date)]);
}

export function removeHeavyDay(value: string | undefined, date: string): string {
  requireDate(date);
  return serializeHeavyDays(parseHeavyDays(value).days.filter((day) => day !== date));
}

/** Heavy days from today's office date on. */
export function upcomingHeavyDays(days: readonly string[], now: Date, timeZone: string = OFFICE_TIMEZONE): string[] {
  const today = zonedDateTime(now, timeZone).date;
  return days.filter((day) => day >= today);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads the `office-hold-until` metadata value. Anything but an ISO instant
 * with an explicit zone is no hold: a garbage value must never keep the VM
 * (and its bill) running.
 */
export function parseHoldUntil(value: string | undefined): Date | null {
  if (!value || !ISO_INSTANT.test(value)) return null;
  if (!isIsoDate(value.slice(0, 10))) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function serializeHoldUntil(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

/** `2h`, `90m`, `1h30m`: a positive duration up to MAX_HOLD_MS. */
export function parseDuration(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(value);
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    throw new Error(`not a duration like 2h, 90m or 1h30m: ${value}`);
  }
  const ms = (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000;
  if (ms <= 0 || ms > MAX_HOLD_MS) throw new Error(`duration must be between 1m and 24h: ${value}`);
  return ms;
}

/** `.../machineTypes/e2-standard-4` or `e2-standard-4` to `e2-standard-4`. */
export function machineTypeName(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1);
}

export function machineTypeFor(date: string, heavyDays: readonly string[]): string {
  return heavyDays.includes(date) ? HEAVY_MACHINE_TYPE : NORMAL_MACHINE_TYPE;
}

export interface NightlyInput {
  readonly now: Date;
  /** GCE status: RUNNING, TERMINATED (stopped), STOPPING, ... */
  readonly status: string;
  /** Machine type name, not URL. */
  readonly machineType: string;
  readonly heavyDays: readonly string[];
  readonly holdUntil: Date | null;
}

export interface NightlyDecision {
  readonly stop: boolean;
  readonly resize: boolean;
  readonly nextOfficeDay: string;
  readonly targetMachineType: string;
  readonly reason: string;
}

/**
 * What the nightly job does to the VM right now. Stop: running, outside office
 * hours, and no hold or an expired one (a hold that ends exactly now has
 * ended). Resize: only a stopped (TERMINATED) VM whose type differs from the
 * next office day's; after a stop the caller describes the VM again and asks
 * once more, because a stop and a resize never happen in one decision.
 */
export function decideNightly(input: NightlyInput): NightlyDecision {
  const next = nextOfficeDay(input.now);
  const targetMachineType = machineTypeFor(next, input.heavyDays);
  const plan = { nextOfficeDay: next, targetMachineType };

  if (input.status === 'RUNNING') {
    if (isOfficeHours(input.now)) {
      return { ...plan, stop: false, resize: false, reason: 'running during office hours' };
    }
    if (input.holdUntil && input.holdUntil.getTime() > input.now.getTime()) {
      return { ...plan, stop: false, resize: false, reason: `running on hold until ${serializeHoldUntil(input.holdUntil)}` };
    }
    return { ...plan, stop: true, resize: false, reason: 'running outside office hours with no active hold' };
  }

  if (input.status === 'TERMINATED') {
    if (input.machineType === targetMachineType) {
      return { ...plan, stop: false, resize: false, reason: `stopped, already ${targetMachineType} for ${next}` };
    }
    return {
      ...plan,
      stop: false,
      resize: true,
      reason: `stopped, ${input.machineType} becomes ${targetMachineType} for ${next}`,
    };
  }

  return { ...plan, stop: false, resize: false, reason: `status ${input.status}: nothing to do` };
}
