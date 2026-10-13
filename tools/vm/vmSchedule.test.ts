/**
 * Office-hours rules for the `test` VM: when the nightly job may stop it and
 * which machine type the next office day gets. Every instant is written in UTC
 * on purpose; Lima is UTC-5, so `12:45Z` is 07:45 in the office.
 */
import { describe, expect, it } from 'vitest';
import {
  HEAVY_MACHINE_TYPE,
  NORMAL_MACHINE_TYPE,
  OFFICE_START_CRON,
  OFFICE_STOP_CRON,
  OFFICE_TIMEZONE,
  addHeavyDay,
  decideNightly,
  isIsoDate,
  isOfficeHours,
  machineTypeName,
  nextOfficeDay,
  parseDuration,
  parseHeavyDays,
  parseHoldUntil,
  removeHeavyDay,
  serializeHeavyDays,
  serializeHoldUntil,
  upcomingHeavyDays,
  zonedDateTime,
  zonedInstant,
} from './vmSchedule.ts';

const at = (iso: string) => new Date(iso);

describe('schedule constants', () => {
  it('match the instance schedule the Terraform defaults declare', () => {
    expect(OFFICE_TIMEZONE).toBe('America/Lima');
    expect(OFFICE_START_CRON).toBe('45 7 * * 1-5');
    expect(OFFICE_STOP_CRON).toBe('0 20 * * 1-5');
  });
});

describe('zonedDateTime', () => {
  it('reads the wall clock of the office time zone', () => {
    expect(zonedDateTime(at('2026-10-13T12:45:00Z'))).toEqual({
      date: '2026-10-13',
      weekday: 2,
      hour: 7,
      minute: 45,
      second: 0,
    });
  });

  it('puts an instant after UTC midnight on the previous Lima day', () => {
    expect(zonedDateTime(at('2026-10-17T03:00:00Z'))).toMatchObject({ date: '2026-10-16', weekday: 5, hour: 22 });
  });

  it('honours any IANA zone, not a fixed offset', () => {
    expect(zonedDateTime(at('2026-07-01T12:00:00Z'), 'Europe/Madrid')).toMatchObject({ hour: 14 });
    expect(zonedDateTime(at('2026-01-01T12:00:00Z'), 'Europe/Madrid')).toMatchObject({ hour: 13 });
  });
});

describe('zonedInstant', () => {
  it('turns an office wall time into its instant', () => {
    expect(zonedInstant('2026-10-13', 7, 45).toISOString()).toBe('2026-10-13T12:45:00.000Z');
  });

  it('follows daylight saving time in zones that have it', () => {
    expect(zonedInstant('2026-07-01', 14, 0, 'Europe/Madrid').toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(zonedInstant('2026-01-01', 13, 0, 'Europe/Madrid').toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('isOfficeHours', () => {
  it('starts at 07:45 sharp on a weekday', () => {
    expect(isOfficeHours(at('2026-10-13T12:44:59Z'))).toBe(false);
    expect(isOfficeHours(at('2026-10-13T12:45:00Z'))).toBe(true);
  });

  it('ends at 20:00 sharp, which is already outside', () => {
    expect(isOfficeHours(at('2026-10-14T00:59:59Z'))).toBe(true);
    expect(isOfficeHours(at('2026-10-14T01:00:00Z'))).toBe(false);
  });

  it('is never office hours on a weekend', () => {
    expect(isOfficeHours(at('2026-10-17T17:00:00Z'))).toBe(false);
    expect(isOfficeHours(at('2026-10-18T17:00:00Z'))).toBe(false);
  });

  it('is outside at every nightly run time', () => {
    for (const iso of ['2026-10-14T01:30:00Z', '2026-10-14T04:30:00Z', '2026-10-14T07:30:00Z']) {
      expect(isOfficeHours(at(iso))).toBe(false);
    }
  });
});

describe('nextOfficeDay', () => {
  it('is today while the scheduled start is still ahead', () => {
    expect(nextOfficeDay(at('2026-10-13T07:30:00Z'))).toBe('2026-10-13');
    expect(nextOfficeDay(at('2026-10-13T12:44:59Z'))).toBe('2026-10-13');
  });

  it('is the next weekday once today has started', () => {
    expect(nextOfficeDay(at('2026-10-13T12:45:00Z'))).toBe('2026-10-14');
    expect(nextOfficeDay(at('2026-10-14T01:30:00Z'))).toBe('2026-10-14');
  });

  it('skips the weekend', () => {
    expect(nextOfficeDay(at('2026-10-17T01:30:00Z'))).toBe('2026-10-19');
    expect(nextOfficeDay(at('2026-10-17T17:00:00Z'))).toBe('2026-10-19');
    expect(nextOfficeDay(at('2026-10-19T07:30:00Z'))).toBe('2026-10-19');
  });

  it('crosses month and year boundaries', () => {
    expect(nextOfficeDay(at('2026-12-31T22:00:00Z'))).toBe('2027-01-01');
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-10-13')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate(' 2026-10-13')).toBe(false);
    expect(isIsoDate('2026-10-13T00:00')).toBe(false);
  });
});

describe('heavy days metadata', () => {
  it('reads an absent or empty value as no days', () => {
    expect(parseHeavyDays(undefined)).toEqual({ days: [], invalid: [] });
    expect(parseHeavyDays('')).toEqual({ days: [], invalid: [] });
    expect(parseHeavyDays(' , ')).toEqual({ days: [], invalid: [] });
  });

  it('sorts, deduplicates and trims', () => {
    expect(parseHeavyDays('2026-10-15, 2026-10-14,2026-10-15')).toEqual({
      days: ['2026-10-14', '2026-10-15'],
      invalid: [],
    });
  });

  it('sets garbage aside instead of guessing', () => {
    expect(parseHeavyDays('2026-10-14,tomorrow,2026-02-30')).toEqual({
      days: ['2026-10-14'],
      invalid: ['tomorrow', '2026-02-30'],
    });
  });

  it('serializes sorted unique dates joined by commas', () => {
    expect(serializeHeavyDays(['2026-10-15', '2026-10-14', '2026-10-15'])).toBe('2026-10-14,2026-10-15');
    expect(serializeHeavyDays([])).toBe('');
  });

  it('refuses to serialize an invalid date', () => {
    expect(() => serializeHeavyDays(['2026-10-14', 'nope'])).toThrow(/nope/);
  });

  it('adds and removes one day, dropping garbage on the way', () => {
    expect(addHeavyDay('2026-10-15,junk', '2026-10-14')).toBe('2026-10-14,2026-10-15');
    expect(addHeavyDay('2026-10-14', '2026-10-14')).toBe('2026-10-14');
    expect(removeHeavyDay('2026-10-14,2026-10-15', '2026-10-14')).toBe('2026-10-15');
    expect(removeHeavyDay('2026-10-15', '2026-10-14')).toBe('2026-10-15');
  });

  it('rejects an invalid day to add or remove', () => {
    expect(() => addHeavyDay('', '2026-02-30')).toThrow(/2026-02-30/);
    expect(() => removeHeavyDay('', 'x')).toThrow(/x/);
  });

  it('lists the days from the current office date on', () => {
    expect(upcomingHeavyDays(['2026-10-12', '2026-10-13', '2026-10-20'], at('2026-10-14T03:00:00Z'))).toEqual([
      '2026-10-13',
      '2026-10-20',
    ]);
  });
});

describe('hold-until metadata', () => {
  it('reads an ISO instant with an explicit zone', () => {
    expect(parseHoldUntil('2026-10-14T03:00:00Z')?.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    expect(parseHoldUntil('2026-10-14T03:00:00.123Z')?.toISOString()).toBe('2026-10-14T03:00:00.123Z');
    expect(parseHoldUntil('2026-10-13T22:00:00-05:00')?.toISOString()).toBe('2026-10-14T03:00:00.000Z');
  });

  it('reads garbage, an absent value or a zoneless time as no hold', () => {
    for (const value of [undefined, '', 'soon', '2026-10-14', '2026-10-14T03:00:00', '2026-02-30T03:00:00Z']) {
      expect(parseHoldUntil(value)).toBeNull();
    }
  });

  it('serializes to a UTC instant without milliseconds', () => {
    expect(serializeHoldUntil(at('2026-10-14T03:00:00.999Z'))).toBe('2026-10-14T03:00:00Z');
  });
});

describe('parseDuration', () => {
  it('reads hours and minutes', () => {
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('90m')).toBe(5_400_000);
    expect(parseDuration('1h30m')).toBe(5_400_000);
  });

  it('rejects zero, garbage and absurd lengths', () => {
    for (const value of ['', '0h', '2', 'h', '2d', '-1h', '25h']) {
      expect(() => parseDuration(value)).toThrow();
    }
  });
});

describe('machineTypeName', () => {
  it('takes the last segment of a machine type URL', () => {
    expect(
      machineTypeName('https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-standard-4'),
    ).toBe('e2-standard-4');
    expect(machineTypeName('e2-standard-8')).toBe('e2-standard-8');
  });
});

describe('decideNightly', () => {
  const base = {
    now: at('2026-10-14T01:30:00Z'), // Tuesday 20:30 in Lima
    status: 'RUNNING',
    machineType: NORMAL_MACHINE_TYPE,
    heavyDays: [] as string[],
    holdUntil: null as Date | null,
  };

  it('stops a running VM outside office hours with no hold', () => {
    expect(decideNightly(base)).toMatchObject({ stop: true, resize: false, nextOfficeDay: '2026-10-14' });
  });

  it('stops when the hold has expired, the expiry instant included', () => {
    expect(decideNightly({ ...base, holdUntil: at('2026-10-14T01:00:00Z') }).stop).toBe(true);
    expect(decideNightly({ ...base, holdUntil: base.now }).stop).toBe(true);
  });

  it('keeps a running VM while its hold lasts', () => {
    const decision = decideNightly({ ...base, holdUntil: at('2026-10-14T01:30:01Z') });
    expect(decision.stop).toBe(false);
    expect(decision.reason).toMatch(/hold/);
  });

  it('never stops during office hours', () => {
    const decision = decideNightly({ ...base, now: at('2026-10-13T20:00:00Z') });
    expect(decision.stop).toBe(false);
    expect(decision.reason).toMatch(/office hours/);
  });

  it('resizes a stopped VM for a heavy next day', () => {
    expect(decideNightly({ ...base, status: 'TERMINATED', heavyDays: ['2026-10-14'] })).toMatchObject({
      stop: false,
      resize: true,
      targetMachineType: HEAVY_MACHINE_TYPE,
    });
  });

  it('sizes a stopped VM back down after a heavy day', () => {
    expect(
      decideNightly({ ...base, status: 'TERMINATED', machineType: HEAVY_MACHINE_TYPE, heavyDays: ['2026-10-13'] }),
    ).toMatchObject({ resize: true, targetMachineType: NORMAL_MACHINE_TYPE });
  });

  it('leaves a stopped VM that already has the right size', () => {
    expect(decideNightly({ ...base, status: 'TERMINATED' })).toMatchObject({ stop: false, resize: false });
  });

  it('never resizes a VM that is not stopped', () => {
    expect(decideNightly({ ...base, heavyDays: ['2026-10-14'], holdUntil: at('2026-10-15T00:00:00Z') })).toMatchObject({
      stop: false,
      resize: false,
      targetMachineType: HEAVY_MACHINE_TYPE,
    });
    expect(decideNightly({ ...base, status: 'STOPPING', heavyDays: ['2026-10-14'] })).toMatchObject({
      stop: false,
      resize: false,
    });
  });

  it('plans the Monday size from a Friday night', () => {
    expect(
      decideNightly({ ...base, now: at('2026-10-17T01:30:00Z'), status: 'TERMINATED', heavyDays: ['2026-10-19'] }),
    ).toMatchObject({ nextOfficeDay: '2026-10-19', resize: true, targetMachineType: HEAVY_MACHINE_TYPE });
  });
});
