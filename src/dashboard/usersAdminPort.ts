/**
 * Users port of the panel (#93): everyone in the directory, and taking access
 * away. Types only, same rule as `adminPort.ts`; the only adapter is
 * `usersAdminClient.ts`.
 *
 * A port of its own and not two more methods on `AdminPort`: it is a separate
 * surface with its own panel (`UsersPanel`), and its 404 means "that user is
 * gone", which is the `officeAdminRequest.ts` contract and not the one
 * `adminClient.ts` keeps for invitations.
 */

import type { Role } from './adminPort';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: 'active' | 'revoked';
  /** ISO 8601, as the server sends it. */
  createdAt: string;
  /** `null` = does not expire (staff). */
  expiresAt: string | null;
  /** Computed by the SERVER, like `Invitation.daysLeft`. */
  daysLeft: number | null;
  /**
   * Whether the caller may take this user's access away, decided by the
   * server with `canRemove`, the same rule the revoke route enforces. The
   * panel only uses it to show the button; the server checks it again.
   */
  removable: boolean;
}

export interface UsersAdminPort {
  listUsers(): Promise<AdminUser[]>;
  /** Revokes the access and throws the account out of the office. */
  revokeUser(id: string): Promise<void>;
}
