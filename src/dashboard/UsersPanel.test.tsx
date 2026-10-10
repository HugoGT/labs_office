import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from './adminPort';
import type { AdminUser, UsersAdminPort } from './usersAdminPort';
import { UsersPanel } from './UsersPanel';

const SUPER: AdminUser = {
  id: 'u-super',
  email: 'hugo@example.com',
  displayName: 'Hugo',
  role: 'superadmin',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  daysLeft: null,
  removable: false,
  renewable: false,
};
const ANA: AdminUser = {
  ...SUPER,
  id: 'u-ana',
  email: 'ana@example.com',
  displayName: 'Ana',
  role: 'employee',
  removable: true,
};
const GUEST: AdminUser = {
  ...SUPER,
  id: 'u-guest',
  email: 'externo@example.com',
  displayName: null,
  role: 'guest',
  expiresAt: '2026-02-01T00:00:00.000Z',
  daysLeft: 5,
  removable: true,
};
const GONE: AdminUser = {
  ...ANA,
  id: 'u-gone',
  email: 'gone@example.com',
  status: 'revoked',
  removable: false,
};

function fakeUsers(overrides: Partial<UsersAdminPort> = {}): UsersAdminPort {
  return {
    listUsers: vi.fn(async () => [SUPER, ANA, GUEST, GONE]),
    revokeUser: vi.fn(async () => undefined),
    ...overrides,
  };
}

function row(email: string) {
  return within(screen.getByRole('row', { name: new RegExp(email) }));
}

describe('UsersPanel (#93): the list', () => {
  it('a revoked guest with no chosen name and future expiry already has no access to remove', async () => {
    const guest = { ...GUEST, status: 'revoked' as const, removable: false, daysLeft: 90 };
    render(<UsersPanel users={fakeUsers({ listUsers: vi.fn(async () => [guest]) })} />);
    await screen.findByText('externo@example.com');
    expect(row('externo@example.com').getByText('-')).toBeInTheDocument();
    expect(row('externo@example.com').getByText('Sin acceso')).toBeInTheDocument();
    expect(row('externo@example.com').queryByRole('button', { name: 'Quitar acceso' })).toBeNull();
  });
  it('lists everyone with role, status and expiry', async () => {
    render(<UsersPanel users={fakeUsers()} />);

    expect(await screen.findByText('hugo@example.com')).toBeInTheDocument();
    expect(row('hugo@example.com').getByText('Superadmin')).toBeInTheDocument();
    expect(row('ana@example.com').getByText('Empleado')).toBeInTheDocument();
    expect(row('externo@example.com').getByText('Invitado')).toBeInTheDocument();
    expect(row('externo@example.com').getByText('01/02/2026')).toBeInTheDocument();
    expect(row('ana@example.com').getByText('Sin caducidad')).toBeInTheDocument();
    expect(row('ana@example.com').getByText('Activo')).toBeInTheDocument();
    expect(row('gone@example.com').getByText('Sin acceso')).toBeInTheDocument();
  });

  it('offers "Quitar acceso" only where the server says the caller can remove', async () => {
    render(<UsersPanel users={fakeUsers()} />);
    await screen.findByText('hugo@example.com');

    expect(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' })).toBeInTheDocument();
    expect(row('externo@example.com').getByRole('button', { name: 'Quitar acceso' })).toBeInTheDocument();
    expect(row('hugo@example.com').queryByRole('button', { name: 'Quitar acceso' })).toBeNull();
    expect(row('gone@example.com').queryByRole('button', { name: 'Quitar acceso' })).toBeNull();
  });

  it('a load failure is told as a failure', async () => {
    render(
      <UsersPanel
        users={fakeUsers({
          listUsers: vi.fn(async () => {
            throw new AdminError('network');
          }),
        })}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo contactar/i);
  });

  it('"Actualizar" reads the list again', async () => {
    const user = userEvent.setup();
    const users = fakeUsers();
    render(<UsersPanel users={users} />);
    await screen.findByText('hugo@example.com');

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));

    await waitFor(() => expect(users.listUsers).toHaveBeenCalledTimes(2));
  });
});

describe('UsersPanel (#129): who lost access, or is about to', () => {
  const EXPIRED: AdminUser = {
    ...GUEST,
    id: 'u-expired',
    email: 'caducado@example.com',
    expiresAt: '2026-01-10T00:00:00.000Z',
    daysLeft: 0,
  };
  const LAST_DAY: AdminUser = { ...GUEST, id: 'u-last', email: 'ultimo@example.com', daysLeft: 1 };
  const LATER: AdminUser = { ...GUEST, id: 'u-later', email: 'luego@example.com', daysLeft: 30 };
  const REVOKED_EXPIRED: AdminUser = { ...EXPIRED, id: 'u-both', email: 'ambos@example.com', status: 'revoked' };

  function renderWith(list: AdminUser[]) {
    render(<UsersPanel users={fakeUsers({ listUsers: vi.fn(async () => list) })} />);
  }

  it('an active account past its expiry is marked expired, not active', async () => {
    renderWith([EXPIRED]);
    await screen.findByText('caducado@example.com');

    // The server already says it: `daysLeft` 0 is the same `expiresAt <= now`
    // the office refuses at the door.
    expect(row('caducado@example.com').getByText('Caducado')).toBeInTheDocument();
    expect(row('caducado@example.com').queryByText('Activo')).toBeNull();
  });

  it('an account expiring within a week says how soon', async () => {
    renderWith([GUEST, LAST_DAY]);
    await screen.findByText('externo@example.com');

    expect(row('externo@example.com').getByText('Caduca en 5 días')).toBeInTheDocument();
    expect(row('ultimo@example.com').getByText('Caduca en 1 día')).toBeInTheDocument();
    expect(row('externo@example.com').getByText('Activo')).toBeInTheDocument();
  });

  it('nothing to mark for a distant expiry, no expiry, or an account already revoked', async () => {
    renderWith([LATER, ANA, REVOKED_EXPIRED]);
    await screen.findByText('luego@example.com');

    for (const email of ['luego@example.com', 'ana@example.com', 'ambos@example.com']) {
      expect(row(email).queryByText(/^Caduc/)).toBeNull();
    }
    expect(row('ambos@example.com').getByText('Sin acceso')).toBeInTheDocument();
  });
});

describe('UsersPanel (#93): removing access', () => {
  it('asks for confirmation first', async () => {
    const user = userEvent.setup();
    const users = fakeUsers();
    render(<UsersPanel users={users} />);
    await screen.findByText('ana@example.com');

    await user.click(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' }));

    expect(users.revokeUser).not.toHaveBeenCalled();
    expect(row('ana@example.com').getByRole('button', { name: 'Sí, quitar acceso' })).toBeInTheDocument();
  });

  it('cancelling leaves everything as it was', async () => {
    const user = userEvent.setup();
    const users = fakeUsers();
    render(<UsersPanel users={users} />);
    await screen.findByText('ana@example.com');

    await user.click(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' }));
    await user.click(row('ana@example.com').getByRole('button', { name: 'Cancelar' }));

    expect(users.revokeUser).not.toHaveBeenCalled();
    expect(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' })).toBeInTheDocument();
  });

  it('confirmed, it revokes and reads the list again', async () => {
    const user = userEvent.setup();
    const users = fakeUsers();
    render(<UsersPanel users={users} />);
    await screen.findByText('ana@example.com');

    await user.click(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' }));
    await user.click(row('ana@example.com').getByRole('button', { name: 'Sí, quitar acceso' }));

    expect(users.revokeUser).toHaveBeenCalledWith('u-ana');
    await waitFor(() => expect(users.listUsers).toHaveBeenCalledTimes(2));
  });

  it('a refusal from the server is shown, not swallowed', async () => {
    const user = userEvent.setup();
    const users = fakeUsers({
      revokeUser: vi.fn(async () => {
        throw new AdminError('forbidden');
      }),
    });
    render(<UsersPanel users={users} />);
    await screen.findByText('ana@example.com');

    await user.click(row('ana@example.com').getByRole('button', { name: 'Quitar acceso' }));
    await user.click(row('ana@example.com').getByRole('button', { name: 'Sí, quitar acceso' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('UsersPanel: renewing access', () => {
  const REVOKED_GUEST: AdminUser = {
    ...GUEST,
    id: 'u-revoked-guest',
    email: 'quitado@example.com',
    status: 'revoked',
    removable: false,
    renewable: true,
  };
  const REVOKED_STAFF: AdminUser = { ...GONE, renewable: true };

  it('offers "Renovar acceso" only where the server says the caller can renew', async () => {
    render(
      <UsersPanel
        users={fakeUsers({ listUsers: vi.fn(async () => [SUPER, ANA, GUEST, REVOKED_STAFF, REVOKED_GUEST]) })}
        onRenew={vi.fn()}
      />,
    );
    await screen.findByText('hugo@example.com');

    expect(row('gone@example.com').getByRole('button', { name: 'Renovar acceso' })).toBeInTheDocument();
    expect(row('quitado@example.com').getByRole('button', { name: 'Renovar acceso' })).toBeInTheDocument();
    for (const email of ['hugo@example.com', 'ana@example.com', 'externo@example.com']) {
      expect(row(email).queryByRole('button', { name: 'Renovar acceso' })).toBeNull();
    }
  });

  it('is not the red revoke button', async () => {
    render(
      <UsersPanel users={fakeUsers({ listUsers: vi.fn(async () => [ANA, REVOKED_GUEST]) })} onRenew={vi.fn()} />,
    );
    await screen.findByText('quitado@example.com');

    const renew = row('quitado@example.com').getByRole('button', { name: 'Renovar acceso' });
    const revoke = row('ana@example.com').getByRole('button', { name: 'Quitar acceso' });
    expect(renew.className).not.toBe(revoke.className);
  });

  it('clicking it hands the row up to whoever owns the forms', async () => {
    const user = userEvent.setup();
    const onRenew = vi.fn();
    render(
      <UsersPanel users={fakeUsers({ listUsers: vi.fn(async () => [REVOKED_GUEST]) })} onRenew={onRenew} />,
    );
    await screen.findByText('quitado@example.com');

    await user.click(row('quitado@example.com').getByRole('button', { name: 'Renovar acceso' }));

    expect(onRenew).toHaveBeenCalledWith(REVOKED_GUEST);
  });

  it('without anyone to hand it to, there is no button', async () => {
    render(<UsersPanel users={fakeUsers({ listUsers: vi.fn(async () => [REVOKED_GUEST]) })} />);
    await screen.findByText('quitado@example.com');

    expect(row('quitado@example.com').queryByRole('button', { name: 'Renovar acceso' })).toBeNull();
  });

  it('reads the list again when the forms above say an account changed', async () => {
    const users = fakeUsers();
    const { rerender } = render(<UsersPanel users={users} version={0} />);
    await screen.findByText('hugo@example.com');
    expect(users.listUsers).toHaveBeenCalledTimes(1);

    rerender(<UsersPanel users={users} version={1} />);

    await waitFor(() => expect(users.listUsers).toHaveBeenCalledTimes(2));
  });
});
