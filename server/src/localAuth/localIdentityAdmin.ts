/**
 * `IdentityAdmin` of the local auth mode. Accounts and passwords live in
 * `LOCAL_AUTH_USERS`, not in Identity Platform, so there is nothing to create:
 * "creating" the account answers the uid the local token carries
 * (`localUidFor`), which is what the directory row needs to match the login.
 * That keeps the dashboard's "add user" and "invite" working in local mode;
 * the person still needs an entry in `LOCAL_AUTH_USERS` to sign in.
 *
 * Disabling is a no-op: revoking sets the directory status, which already
 * refuses the next login and the join, and evicts live sessions. There is no
 * email to send, so a reset rejects and the dashboard shows `emailSent: false`.
 */

import { IdentityAdminError, type IdentityAdmin } from '../admin/identityAdminPort.ts';
import { localUidFor } from './localAuthToken.ts';

export function createLocalIdentityAdmin(): IdentityAdmin {
  return {
    async createAccount(email) {
      return localUidFor(email);
    },
    async disableAccount() {},
    async enableAccount() {},
    async sendPasswordReset() {
      throw new IdentityAdminError('unavailable');
    },
  };
}
