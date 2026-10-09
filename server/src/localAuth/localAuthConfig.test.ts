/**
 * Local auth configuration: a pure parse of an injected env object, so no test
 * touches `process.env`. Errors must never echo a password: they reach the
 * container log.
 */

import { describe, expect, it } from 'vitest';
import {
  LOCAL_AUTH_MIN_SECRET_LENGTH,
  parseLocalAuthUsers,
  resolveLocalAuthConfig,
} from './localAuthConfig.ts';
import { AuthConfigError } from '../authConfigError.ts';

const SECRET = 'x'.repeat(LOCAL_AUTH_MIN_SECRET_LENGTH);

describe('parseLocalAuthUsers', () => {
  it('reads comma-separated email:password pairs, lowercasing and trimming emails', () => {
    const users = parseLocalAuthUsers(' Admin@Local.Test : cambiame , ana@local.test:otra');
    expect([...users]).toEqual([
      ['admin@local.test', 'cambiame'],
      ['ana@local.test', 'otra'],
    ]);
  });

  it('keeps every colon after the first one in the password', () => {
    expect(parseLocalAuthUsers('ana@local.test:a:b:c').get('ana@local.test')).toBe('a:b:c');
  });

  it('ignores empty segments such as a trailing comma', () => {
    expect([...parseLocalAuthUsers('ana@local.test:pw,,')]).toEqual([['ana@local.test', 'pw']]);
  });

  it.each([
    ['no colon', 'ana@local.test'],
    ['empty email', ':pw'],
    ['email without @', 'ana:pw'],
    ['email without domain', 'ana@:pw'],
    ['empty password', 'ana@local.test:'],
    ['blank password', 'ana@local.test:   '],
  ])('rejects a malformed entry (%s)', (_label, raw) => {
    expect(() => parseLocalAuthUsers(raw)).toThrow(AuthConfigError);
  });

  it('rejects the same email twice, whatever its case', () => {
    expect(() => parseLocalAuthUsers('ana@local.test:a,ANA@local.test:b')).toThrow(/duplicate/i);
  });

  it('never puts a password in the error message', () => {
    try {
      parseLocalAuthUsers('ana@local.test:s3cr3t-pw,ana@local.test:s3cr3t-pw');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t-pw');
    }
  });

  it('rejects a list with no entries at all', () => {
    expect(() => parseLocalAuthUsers(' , ')).toThrow(AuthConfigError);
  });
});

describe('resolveLocalAuthConfig', () => {
  it('is null when neither variable is set or both are blank', () => {
    expect(resolveLocalAuthConfig({})).toBeNull();
    expect(resolveLocalAuthConfig({ LOCAL_AUTH_USERS: '  ', LOCAL_AUTH_SECRET: '' })).toBeNull();
  });

  it('returns the users and the trimmed secret', () => {
    const config = resolveLocalAuthConfig({
      LOCAL_AUTH_USERS: 'ana@local.test:pw',
      LOCAL_AUTH_SECRET: ` ${SECRET}\n`,
    });
    expect(config?.secret).toBe(SECRET);
    expect(config?.users.get('ana@local.test')).toBe('pw');
  });

  it('requires a secret when users are set', () => {
    expect(() => resolveLocalAuthConfig({ LOCAL_AUTH_USERS: 'ana@local.test:pw' })).toThrow(
      /LOCAL_AUTH_SECRET/,
    );
  });

  it(`requires a secret of at least ${LOCAL_AUTH_MIN_SECRET_LENGTH} characters`, () => {
    expect(() =>
      resolveLocalAuthConfig({
        LOCAL_AUTH_USERS: 'ana@local.test:pw',
        LOCAL_AUTH_SECRET: 'x'.repeat(LOCAL_AUTH_MIN_SECRET_LENGTH - 1),
      }),
    ).toThrow(/at least/);
  });

  it('refuses a secret without users instead of silently running without auth', () => {
    expect(() => resolveLocalAuthConfig({ LOCAL_AUTH_SECRET: SECRET })).toThrow(/LOCAL_AUTH_USERS/);
  });
});
