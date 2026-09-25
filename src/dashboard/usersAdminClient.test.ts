import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createUsersAdminClient } from './usersAdminClient';

/** The server ROOT, like the other `officeAdminRequest` clients: paths are written whole. */
const BASE_URL = 'http://localhost:2567';

const SERVED_EMPLOYEE = {
  id: '00000000-0000-4000-8000-0000000000e1',
  email: 'ana@example.com',
  displayName: 'Ana',
  role: 'employee',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  daysLeft: null,
  removable: true,
};

const SERVED_GUEST = {
  ...SERVED_EMPLOYEE,
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'externo@example.com',
  displayName: null,
  role: 'guest',
  status: 'revoked',
  expiresAt: '2026-02-01T00:00:00.000Z',
  daysLeft: 0,
  removable: false,
};

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      fakeResponse(status, body),
  );
}

function clientWith(fetchImpl: ReturnType<typeof fetchWith>) {
  return createUsersAdminClient(
    { baseUrl: BASE_URL, getIdToken: async () => 'id-token' },
    fetchImpl as unknown as typeof fetch,
  );
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'no-error';
  }
}

describe('createUsersAdminClient (#93)', () => {
  it('GET /admin/users unwraps and keeps every field the panel needs', async () => {
    const fetchImpl = fetchWith(200, { users: [SERVED_EMPLOYEE, SERVED_GUEST] });

    const users = await clientWith(fetchImpl).listUsers();

    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:2567/admin/users');
    expect(users).toEqual([SERVED_EMPLOYEE, SERVED_GUEST]);
  });

  it('sends the ID token as Bearer', async () => {
    const fetchImpl = fetchWith(200, { users: [] });

    await clientWith(fetchImpl).listUsers();

    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer id-token' });
  });

  it('a malformed row rejects the whole list instead of showing half of it', async () => {
    for (const bad of [
      { ...SERVED_EMPLOYEE, role: 'owner' },
      { ...SERVED_EMPLOYEE, status: 'gone' },
      { ...SERVED_EMPLOYEE, removable: 'yes' },
      { ...SERVED_EMPLOYEE, id: '' },
      null,
    ]) {
      const fetchImpl = fetchWith(200, { users: [SERVED_GUEST, bad] });
      expect(await codeOf(clientWith(fetchImpl).listUsers())).toBe('unknown');
    }
    expect(await codeOf(clientWith(fetchWith(200, { nope: [] })).listUsers())).toBe('unknown');
  });

  it('POST /admin/users/{id}/revoke escapes the id', async () => {
    const fetchImpl = fetchWith(200, { id: 'a/b', status: 'revoked' });

    await clientWith(fetchImpl).revokeUser('a/b');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/users/a%2Fb/revoke');
    expect(init?.method).toBe('POST');
  });

  it('translates the server refusals the panel can explain', async () => {
    const cases: [number, AdminErrorCode][] = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'unknown'],
    ];
    for (const [status, code] of cases) {
      expect(await codeOf(clientWith(fetchWith(status)).revokeUser(SERVED_EMPLOYEE.id))).toBe(code);
    }
  });
});
