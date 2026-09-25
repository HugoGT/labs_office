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
