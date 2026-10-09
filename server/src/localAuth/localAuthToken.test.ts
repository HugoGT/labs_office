/**
 * Local session tokens: signed here with HS256 and checked by the same
 * `IdTokenVerifier` contract as the Firebase ones, so `OfficeRoom` and every
 * HTTP route take them without knowing the mode.
 */

import { SignJWT, generateKeyPair } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_AGE_DAYS, SESSION_EXPIRED } from '../verifyIdToken.ts';
import type { LocalAuthConfig } from './localAuthConfig.ts';
import {
  LOCAL_AUTH_ISSUER,
  LOCAL_TOKEN_LIFETIME_SECONDS,
  createLocalIdTokenVerifier,
  createLocalTokenIssuer,
  localUidFor,
} from './localAuthToken.ts';

const SECRET = 'a-local-secret-that-is-long-enough-0123456789';
const CONFIG: LocalAuthConfig = {
  users: new Map([['ana@local.test', 'pw']]),
  secret: SECRET,
};
const DAY = 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Signs arbitrary claims with the configured key, for the edge cases. */
async function sign(
  claims: Record<string, unknown>,
  { secret = SECRET, issuer = LOCAL_AUTH_ISSUER, audience = LOCAL_AUTH_ISSUER } = {},
): Promise<string> {
  const now = nowSeconds();
  // Claims as a plain payload, not through the setters: those would override
  // the `exp`, `iat` and `sub` a test passes.
  return new SignJWT({
    iss: issuer,
    aud: audience,
    sub: localUidFor('ana@local.test'),
    iat: now,
    exp: now + 3600,
    email: 'ana@local.test',
    auth_time: now,
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
}

function verifier() {
  const logFailure = vi.fn();
  return { verifier: createLocalIdTokenVerifier(CONFIG, logFailure), logFailure };
}

describe('localUidFor', () => {
  it('derives a stable uid from the email, prefixed so it never collides with a Firebase one', () => {
    expect(localUidFor('ana@local.test')).toBe('local:ana@local.test');
    expect(localUidFor('ANA@local.test ')).toBe('local:ana@local.test');
  });
});

describe('local token round trip', () => {
  it('a token the issuer signs verifies to the uid and email of the account', async () => {
    const token = await createLocalTokenIssuer(CONFIG).issue('ana@local.test');
    await expect(verifier().verifier.verify(token)).resolves.toEqual({
      uid: 'local:ana@local.test',
      email: 'ana@local.test',
      name: null,
    });
  });

  it('issues HS256 with its own issuer and audience, auth_time, and an exp past the session cap', async () => {
    const before = nowSeconds();
    const token = await createLocalTokenIssuer(CONFIG).issue('ana@local.test');
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));

    expect(header.alg).toBe('HS256');
    expect(payload).toMatchObject({ iss: LOCAL_AUTH_ISSUER, aud: LOCAL_AUTH_ISSUER, sub: 'local:ana@local.test' });
    expect(payload.auth_time).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBe(payload.auth_time);
    expect(payload.exp - payload.iat).toBe(LOCAL_TOKEN_LIFETIME_SECONDS);
    expect(LOCAL_TOKEN_LIFETIME_SECONDS).toBeGreaterThan(MAX_SESSION_AGE_DAYS * DAY);
  });
});

describe('createLocalIdTokenVerifier', () => {
  it.each([undefined, null, 42, '', 'not-a-jwt'])('rejects %s without throwing', async (token) => {
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await sign({}, { secret: 'another-secret-that-is-long-enough-0123456789' });
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects another issuer or audience', async () => {
    const { verifier: v } = verifier();
    await expect(v.verify(await sign({}, { issuer: 'someone-else' }))).resolves.toBeNull();
    await expect(v.verify(await sign({}, { audience: 'someone-else' }))).resolves.toBeNull();
  });

  it('accepts HS256 only: an RS256 token is refused', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const now = nowSeconds();
    const token = await new SignJWT({ email: 'ana@local.test', auth_time: now })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('local:ana@local.test')
      .setIssuer(LOCAL_AUTH_ISSUER)
      .setAudience(LOCAL_AUTH_ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await sign({ exp: nowSeconds() - 10 });
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects a token without exp', async () => {
    const now = nowSeconds();
    const token = await new SignJWT({ email: 'ana@local.test', auth_time: now })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('local:ana@local.test')
      .setIssuer(LOCAL_AUTH_ISSUER)
      .setAudience(LOCAL_AUTH_ISSUER)
      .setIssuedAt(now)
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects iat or auth_time in the future', async () => {
    const { verifier: v } = verifier();
    await expect(v.verify(await sign({ iat: nowSeconds() + 600 }))).resolves.toBeNull();
    await expect(v.verify(await sign({ auth_time: nowSeconds() + 600 }))).resolves.toBeNull();
  });

  it('rejects a sub that does not match the email', async () => {
    const token = await sign({ sub: 'local:other@local.test' });
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects an account removed from LOCAL_AUTH_USERS since the token was signed', async () => {
    const token = await sign({ email: 'gone@local.test', sub: 'local:gone@local.test' });
    await expect(verifier().verifier.verify(token)).resolves.toBeNull();
  });

  it(`names a login older than ${MAX_SESSION_AGE_DAYS} days as session-expired`, async () => {
    const { verifier: v, logFailure } = verifier();
    const token = await sign({ auth_time: nowSeconds() - (MAX_SESSION_AGE_DAYS * DAY + 60) });
    await expect(v.verify(token)).resolves.toBe(SESSION_EXPIRED);
    expect(logFailure).toHaveBeenCalledWith('SessionExpired');
  });

  it('refuses a token without auth_time as session-expired, failing closed like Firebase', async () => {
    const token = await sign({ auth_time: undefined });
    await expect(verifier().verifier.verify(token)).resolves.toBe(SESSION_EXPIRED);
  });

  it('logs the error name only, never the token', async () => {
    const { verifier: v, logFailure } = verifier();
    await v.verify(await sign({ exp: nowSeconds() - 10 }));
    expect(logFailure).toHaveBeenCalledWith('JWTExpired');
  });
});
