/**
 * HTTP adapter of the users port (#93). Built on `officeAdminRequest.ts`, like
 * the desks, spaces and assets clients, because that is the contract where a
 * 404 means "that row is gone": exactly what a revoke of a user someone else
 * already removed returns.
 *
 * The revoke goes by POST, like every write of the panel: the server's CORS
 * middleware only announces `GET,POST,OPTIONS`.
 */

import { AdminError, type Role } from './adminPort';
import { createOfficeAdminRequest } from './officeAdminRequest';
import type { AdminUser, UsersAdminPort } from './usersAdminPort';

export interface UsersAdminClientOptions {
  /** The server ROOT (`resolveOfficeApiBaseUrl`), without `/admin`. */
  baseUrl: string;
  /** Called on EVERY request and never stored: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

const ROLES: readonly Role[] = ['superadmin', 'admin', 'employee', 'guest'];

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** A served row as an `AdminUser`, or `null` when it does not have the shape. */
function toAdminUser(raw: unknown): AdminUser | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isString(row.id) || row.id.length === 0 || !isString(row.email)) return null;
  if (!isStringOrNull(row.displayName)) return null;
  if (!ROLES.includes(row.role as Role)) return null;
  if (row.status !== 'active' && row.status !== 'revoked') return null;
  if (!isString(row.createdAt) || !isStringOrNull(row.expiresAt)) return null;
  if (row.daysLeft !== null && typeof row.daysLeft !== 'number') return null;
  if (typeof row.removable !== 'boolean') return null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Role,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    daysLeft: row.daysLeft as number | null,
    removable: row.removable,
  };
}

export function createUsersAdminClient(
  { baseUrl, getIdToken }: UsersAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): UsersAdminPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      // These routes answer 503 only when the server has no directory, and
      // then `/admin/session` already failed and this panel never mounts.
      notConfigured: 'unknown',
      // No 409 on these routes; the helper still needs a fallback.
      conflicts: ['conflict'],
    },
    fetchImpl,
  );

  return {
    async listUsers(): Promise<AdminUser[]> {
      // All or nothing, like `spacesAdminClient.listSpaces`: a table that
      // silently drops a row would hide exactly the person someone is looking
      // for.
      const body = await request<{ users?: unknown }>('/admin/users');
      if (!Array.isArray(body.users)) throw new AdminError('unknown');
      return body.users.map((raw) => {
        const user = toAdminUser(raw);
        if (user === null) throw new AdminError('unknown');
        return user;
      });
    },

    async revokeUser(id: string): Promise<void> {
      // `encodeURIComponent`: an id with a slash would invent a path segment.
      await request<{ id: string; status: 'revoked' }>(
        `/admin/users/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
      );
    },
  };
}
