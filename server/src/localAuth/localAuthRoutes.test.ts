/**
 * `POST /auth/local/sign-in` as a pure function, tested without Express like
 * every other `*Routes.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { LocalAuthConfig } from './localAuthConfig.ts';
import {
  INVALID_CREDENTIALS_BODY,
  createLocalCredentialCheck,
  handleLocalSignIn,
} from './localAuthRoutes.ts';
import { createLocalIdTokenVerifier, createLocalTokenIssuer } from './localAuthToken.ts';

const CONFIG: LocalAuthConfig = {
  users: new Map([
    ['ana@local.test', 'correct horse'],
    ['bob@local.test', 'p:w'],
  ]),
  secret: 'a-local-secret-that-is-long-enough-0123456789',
};

function deps() {
  return { checkCredentials: createLocalCredentialCheck(CONFIG.users), issuer: createLocalTokenIssuer(CONFIG) };
}

describe('createLocalCredentialCheck', () => {
  const check = createLocalCredentialCheck(CONFIG.users);

  it('returns the normalized email for a right password', () => {
    expect(check(' ANA@local.test ', 'correct horse')).toBe('ana@local.test');
    expect(check('bob@local.test', 'p:w')).toBe('bob@local.test');
  });

  it('returns null for a wrong password, a prefix of it, or an unknown email', () => {
    expect(check('ana@local.test', 'wrong')).toBeNull();
    expect(check('ana@local.test', 'correct')).toBeNull();
    expect(check('ana@local.test', '')).toBeNull();
    expect(check('nobody@local.test', 'correct horse')).toBeNull();
  });
});

describe('handleLocalSignIn', () => {
  it('answers 200 with a token the local verifier accepts', async () => {
    const result = await handleLocalSignIn({ email: 'ana@local.test', password: 'correct horse' }, deps());

    expect(result.status).toBe(200);
    const token = (result.body as { token: string }).token;
    await expect(createLocalIdTokenVerifier(CONFIG, () => {}).verify(token)).resolves.toEqual({
      uid: 'local:ana@local.test',
      email: 'ana@local.test',
      name: null,
    });
  });

  it('answers the same 401 for a wrong password and for an unknown email', async () => {
    const wrong = await handleLocalSignIn({ email: 'ana@local.test', password: 'nope' }, deps());
    const unknown = await handleLocalSignIn({ email: 'who@local.test', password: 'nope' }, deps());

    expect(wrong).toEqual({ status: 401, body: INVALID_CREDENTIALS_BODY });
    expect(unknown).toEqual(wrong);
    expect(INVALID_CREDENTIALS_BODY).toEqual({ error: 'invalid-credentials' });
  });

  it.each([undefined, null, 'text', {}, { email: 'ana@local.test' }, { email: 1, password: 'x' }])(
    'answers 400 invalid-request for a malformed body (%j)',
    async (body) => {
      await expect(handleLocalSignIn(body, deps())).resolves.toEqual({
        status: 400,
        body: { error: 'invalid-request' },
      });
    },
  );
});
