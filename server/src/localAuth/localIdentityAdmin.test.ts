import { describe, expect, it } from 'vitest';
import { IdentityAdminError } from '../admin/identityAdminPort.ts';
import { createLocalIdentityAdmin } from './localIdentityAdmin.ts';

describe('createLocalIdentityAdmin', () => {
  const admin = createLocalIdentityAdmin();

  it('creates an account by answering the uid the local token will carry', async () => {
    // The directory row is matched by uid on login, so it must be the same
    // `local:<email>` the sign-in route signs.
    await expect(admin.createAccount(' Ana@Local.Test ', 'ignored')).resolves.toBe('local:ana@local.test');
  });

  it('disables and enables as no-ops: the directory status is what locks an account out', async () => {
    await expect(admin.disableAccount('local:ana@local.test')).resolves.toBeUndefined();
    await expect(admin.enableAccount('local:ana@local.test')).resolves.toBeUndefined();
  });

  it('cannot send a password-reset email, so the dashboard reports emailSent: false', async () => {
    await expect(admin.sendPasswordReset('ana@local.test')).rejects.toBeInstanceOf(IdentityAdminError);
  });
});
