import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminPort, type AdminSession, type Invitation } from './adminPort';
import { DashboardScreen } from './DashboardScreen';

const ADMIN: AdminSession = {
  role: 'admin',
  email: 'ana@example.com',
  displayName: 'Ana',
  expiresAt: null,
};

const INVITADO: Invitation = {
  id: 'inv-1',
  email: 'invitado@example.com',
  role: 'guest',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-09-08T00:00:00.000Z',
  daysLeft: 7,
  invitedByEmail: 'ana@example.com',
};

const REVOCADO: Invitation = {
  ...INVITADO,
  id: 'inv-2',
  email: 'antiguo@example.com',
  status: 'revoked',
  daysLeft: null,
};

function fakeAdmin(overrides: Partial<AdminPort> = {}): AdminPort {
  return {
    session: vi.fn(async () => ADMIN),
    listInvitations: vi.fn(async () => [INVITADO]),
    createInvitation: vi.fn(async () => ({
      id: 'inv-3',
      email: 'nuevo@example.com',
      password: 'Zx9-clave-generada',
      expiresAt: '2026-09-24T00:00:00.000Z',
    })),
    revoke: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Rellena el formulario de invitacion y lo envia. */
async function invitar(user: ReturnType<typeof userEvent.setup>, email: string, days: string) {
  await user.type(screen.getByLabelText(/correo/i), email);
  const dias = screen.getByLabelText(/días/i);
  await user.clear(dias);
  await user.type(dias, days);
  await user.click(screen.getByRole('button', { name: /invitar/i }));
}

describe('DashboardScreen: quien puede mirar', () => {
  it('mientras no sabe quien consulta no pinta nada', () => {
    // Mismo motivo que `ready` en `AuthGate`: ensenar "no autorizado" en ese
    // hueco lo haria parpadear a quien si administra, en cada recarga.
    const admin = fakeAdmin({ session: vi.fn(() => new Promise<AdminSession>(() => {})) });

    const { container } = render(<DashboardScreen admin={admin} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('un rol que no administra ve "no autorizado" y nada mas', async () => {
    const admin = fakeAdmin({ session: vi.fn(async () => ({ ...ADMIN, role: 'employee' as const })) });

    render(<DashboardScreen admin={admin} />);

    expect(await screen.findByText(/no autorizado/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(admin.listInvitations).not.toHaveBeenCalled();
  });

  it('un 403 del servidor tambien es "no autorizado"', async () => {
    const admin = fakeAdmin({
      session: vi.fn(async () => {
        throw new AdminError('forbidden');
      }),
    });

    render(<DashboardScreen admin={admin} />);

    expect(await screen.findByText(/no autorizado/i)).toBeInTheDocument();
  });

  it('superadmin administra igual que admin', async () => {
    const admin = fakeAdmin({
      session: vi.fn(async () => ({ ...ADMIN, role: 'superadmin' as const })),
    });

    render(<DashboardScreen admin={admin} />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('un fallo de red no se disfraza de falta de permisos', async () => {
    const admin = fakeAdmin({
      session: vi.fn(async () => {
        throw new AdminError('network');
      }),
    });

    render(<DashboardScreen admin={admin} />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/servidor/i);
    expect(screen.queryByText(/no autorizado/i)).not.toBeInTheDocument();
  });
});

describe('DashboardScreen: la tabla de invitaciones', () => {
  it('ensena correo, rol, quien invito, vencimiento, dias restantes y estado', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    const fila = await screen.findByRole('row', { name: /invitado@example.com/i });
    expect(within(fila).getByText('invitado@example.com')).toBeInTheDocument();
    expect(within(fila).getByText('Invitado')).toBeInTheDocument();
    expect(within(fila).getByText('ana@example.com')).toBeInTheDocument();
    // La fecha se pinta en UTC, tal cual la manda el servidor: reinterpretarla
    // en la zona del navegador ensenaria un dia antes al oeste de Greenwich.
    expect(within(fila).getByText('08/09/2026')).toBeInTheDocument();
    expect(within(fila).getByText('7')).toBeInTheDocument();
    expect(within(fila).getByText('Activa')).toBeInTheDocument();
  });

  it('la tabla tiene encabezados de verdad, no una rejilla de divs', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: /correo/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /días/i })).toBeInTheDocument();
  });

  it('sin invitaciones lo dice, en vez de dejar una tabla muda', async () => {
    const admin = fakeAdmin({ listInvitations: vi.fn(async () => []) });

    render(<DashboardScreen admin={admin} />);

    expect(await screen.findByText(/todavía no hay invitaciones/i)).toBeInTheDocument();
  });
});

describe('DashboardScreen: revocar', () => {
  it('revoca por id y vuelve a leer la lista', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    const fila = await screen.findByRole('row', { name: /invitado@example.com/i });

    await user.click(within(fila).getByRole('button', { name: /revocar/i }));

    expect(admin.revoke).toHaveBeenCalledWith('inv-1');
    // Releer en vez de tachar la fila en local: el servidor es el dueno del
    // estado y puede haber cambiado mas cosas que esta.
    await waitFor(() => expect(admin.listInvitations).toHaveBeenCalledTimes(2));
  });

  it('una invitacion ya revocada no ofrece revocar otra vez', async () => {
    const admin = fakeAdmin({ listInvitations: vi.fn(async () => [REVOCADO]) });

    render(<DashboardScreen admin={admin} />);

    const fila = await screen.findByRole('row', { name: /antiguo@example.com/i });
    expect(within(fila).queryByRole('button', { name: /revocar/i })).not.toBeInTheDocument();
  });

  it('si el servidor rechaza la revocacion, se cuenta', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      revoke: vi.fn(async () => {
        throw new AdminError('forbidden');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    const fila = await screen.findByRole('row', { name: /invitado@example.com/i });

    await user.click(within(fila).getByRole('button', { name: /revocar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/permiso/i);
  });
});

describe('DashboardScreen: invitar', () => {
  it('manda correo y dias al puerto y refresca la lista', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '30');

    expect(admin.createInvitation).toHaveBeenCalledWith('nuevo@example.com', 30);
    await waitFor(() => expect(admin.listInvitations).toHaveBeenCalledTimes(2));
  });

  it('el campo de dias declara el rango 1..90 al navegador', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    const dias = await screen.findByLabelText(/días/i);
    expect(dias).toHaveAttribute('type', 'number');
    expect(dias).toHaveAttribute('min', '1');
    expect(dias).toHaveAttribute('max', '90');
  });

  it('91 dias no llega al servidor: el navegador corta antes de enviar', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '91');

    // `max=90` es validacion nativa: el formulario ni siquiera se envia.
    expect(admin.createInvitation).not.toHaveBeenCalled();
  });

  it('91 dias saltandose la validacion nativa tampoco llega, y se explica', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    const { container } = render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');
    await user.type(screen.getByLabelText(/correo/i), 'nuevo@example.com');
    const dias = screen.getByLabelText(/días/i);
    await user.clear(dias);
    await user.type(dias, '91');

    // Enviar el <form> directamente es exactamente lo que consigue cualquiera
    // quitando el atributo desde las herramientas del navegador: la guarda de
    // JavaScript existe para ese caso, y el servidor para cuando tambien se
    // salta esta.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(admin.createInvitation).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/1 y 90/);
  });

  it('la validacion del cliente es una comodidad: el error del servidor manda', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createInvitation: vi.fn(async () => {
        throw new AdminError('invalid-request');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '30');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no aceptó/i);
  });

  it('un correo ya invitado devuelve conflicto y se cuenta como tal', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createInvitation: vi.fn(async () => {
        throw new AdminError('conflict');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');

    await invitar(user, 'repetido@example.com', '30');

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya/i);
  });

  it('sin credenciales de administracion en el servidor lo dice con todas las letras', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createInvitation: vi.fn(async () => {
        throw new AdminError('identity-admin-not-configured');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '30');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no está configurada/i);
  });
});

describe('DashboardScreen: la contrasena generada', () => {
  it('se ensena una vez, con el aviso de que no vuelve', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '30');

    expect(await screen.findByText('Zx9-clave-generada')).toBeInTheDocument();
    expect(screen.getByText(/no se volverá a mostrar/i)).toBeInTheDocument();
  });

  it('al descartarla desaparece y no vuelve por ningun lado', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('table');
    await invitar(user, 'nuevo@example.com', '30');
    await screen.findByText('Zx9-clave-generada');

    await user.click(screen.getByRole('button', { name: /entendido/i }));

    expect(screen.queryByText('Zx9-clave-generada')).not.toBeInTheDocument();
    // La lista se relee del servidor, y el servidor nunca devuelve la
    // contrasena: si reapareciera, es que la estabamos guardando.
    expect(screen.queryByText(/Zx9/)).not.toBeInTheDocument();
  });

  it('REGRESION: la contrasena no se guarda ni se registra en ningun sitio', async () => {
    const user = userEvent.setup();
    const spies = [
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('table');

    await invitar(user, 'nuevo@example.com', '30');
    await screen.findByText('Zx9-clave-generada');

    // #24 seccion 3: se entrega una vez y no se almacena ni se registra. El
    // unico sitio donde existe es el estado de React de esta pantalla, que
    // muere con ella.
    for (const spy of spies) {
      const escrito = JSON.stringify(spy.mock.calls);
      expect(escrito).not.toContain('Zx9-clave-generada');
      spy.mockRestore();
    }
  });
});
