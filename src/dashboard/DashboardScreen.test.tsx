import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminPort, type AdminSession } from './adminPort';
import { DashboardScreen } from './DashboardScreen';

const ADMIN: AdminSession = {
  role: 'admin',
  email: 'ana@example.com',
  displayName: 'Ana',
  expiresAt: null,
};

function fakeAdmin(overrides: Partial<AdminPort> = {}): AdminPort {
  return {
    session: vi.fn(async () => ADMIN),
    listInvitations: vi.fn(async () => []),
    createInvitation: vi.fn(async () => ({
      id: 'inv-3',
      email: 'nuevo@example.com',
      expiresAt: '2026-09-24T00:00:00.000Z',
      emailSent: true,
    })),
    createUser: vi.fn(async () => ({
      id: 'user-1',
      email: 'nueva@example.com',
      role: 'employee' as const,
      emailSent: true,
    })),
    revoke: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async (id: string) => ({
      id,
      email: 'invitado@example.com',
      emailSent: true,
    })),
    ...overrides,
  };
}

/**
 * Las dos altas tienen un campo "Correo", asi que las consultas van SIEMPRE
 * acotadas a su tarjeta. Sin acotar, `getByLabelText(/correo/i)` encontraria
 * dos campos y el test fallaria por ambiguo en vez de por lo que prueba.
 */
function tarjeta(nombre: RegExp) {
  return screen.getByRole('region', { name: nombre });
}

/** Rellena el formulario de invitacion y lo envia. */
async function invitar(user: ReturnType<typeof userEvent.setup>, email: string, days: string) {
  const form = within(tarjeta(/^invitaciones$/i));
  await user.type(form.getByLabelText(/correo/i), email);
  const dias = form.getByLabelText(/días/i);
  await user.clear(dias);
  await user.type(dias, days);
  await user.click(form.getByRole('button', { name: /invitar/i }));
}

/** Rellena el alta de alguien de casa y la envia. */
async function darDeAlta(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  rol?: RegExp,
) {
  const form = within(tarjeta(/nuevo usuario/i));
  await user.type(form.getByLabelText(/correo/i), email);
  if (rol) await user.selectOptions(form.getByLabelText(/rol/i), form.getByRole('option', { name: rol }));
  await user.click(form.getByRole('button', { name: /crear usuario/i }));
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
    expect(screen.queryByRole('region', { name: /nuevo usuario/i })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('region', { name: /nuevo usuario/i })).toBeInTheDocument();
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

describe('DashboardScreen: las dos tarjetas de alta', () => {
  it('"Nuevo usuario" se pinta ANTES que "Invitaciones"', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    const headings = (await screen.findAllByRole('heading', { level: 2 })).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['Nuevo usuario', 'Invitaciones']);
  });

  it('"Nuevo usuario" dice que su acceso no caduca, sin nada mas', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    const tarjeta = within(await screen.findByRole('region', { name: /nuevo usuario/i }));
    expect(tarjeta.getByText('Su acceso no caduca.')).toBeInTheDocument();
  });

  it('"Invitaciones" conserva su subtitulo de siempre', async () => {
    render(<DashboardScreen admin={fakeAdmin()} />);

    const tarjeta = within(await screen.findByRole('region', { name: /^invitaciones$/i }));
    expect(
      tarjeta.getByText(/acceso temporal para alguien de fuera: caduca solo y se puede revocar/i),
    ).toBeInTheDocument();
  });

  it('ya no pinta la tabla de invitaciones ni pide la lista al puerto', async () => {
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);

    await screen.findByRole('region', { name: /^invitaciones$/i });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(admin.listInvitations).not.toHaveBeenCalled();
  });
});

describe('DashboardScreen: invitar', () => {
  it('manda correo y dias al puerto', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'nuevo@example.com', '30');

    expect(admin.createInvitation).toHaveBeenCalledWith('nuevo@example.com', 30);
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
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'nuevo@example.com', '91');

    // `max=90` es validacion nativa: el formulario ni siquiera se envia.
    expect(admin.createInvitation).not.toHaveBeenCalled();
  });

  it('91 dias saltandose la validacion nativa tampoco llega, y se explica', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });
    const form = within(tarjeta(/^invitaciones$/i));
    await user.type(form.getByLabelText(/correo/i), 'nuevo@example.com');
    const dias = form.getByLabelText(/días/i);
    await user.clear(dias);
    await user.type(dias, '91');

    // Enviar el <form> directamente es exactamente lo que consigue cualquiera
    // quitando el atributo desde las herramientas del navegador: la guarda de
    // JavaScript existe para ese caso, y el servidor para cuando tambien se
    // salta esta.
    fireEvent.submit(tarjeta(/^invitaciones$/i).querySelector('form') as HTMLFormElement);

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
    await screen.findByRole('region', { name: /^invitaciones$/i });

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
    await screen.findByRole('region', { name: /^invitaciones$/i });

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
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'nuevo@example.com', '30');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no está configurada/i);
  });
});

describe('DashboardScreen: account created, the password is emailed (#94)', () => {
  it('confirms the email went out and never shows a password', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'nuevo@example.com', '30');

    const panel = within(await screen.findByRole('region', { name: /cuenta creada/i }));
    expect(panel.getByText(/enviamos un correo a nuevo@example.com/i)).toBeInTheDocument();
    expect(panel.queryByText(/contraseña:/i)).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: /reenviar/i })).not.toBeInTheDocument();
  });

  it('when the email failed it says so and offers to re-send it', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createInvitation: vi.fn(async () => ({
        id: 'inv-3',
        email: 'nuevo@example.com',
        expiresAt: '2026-09-24T00:00:00.000Z',
        emailSent: false,
      })),
      sendPasswordReset: vi.fn(async (id: string) => ({
        id,
        email: 'nuevo@example.com',
        emailSent: true,
      })),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });
    await invitar(user, 'nuevo@example.com', '30');

    const panel = within(await screen.findByRole('region', { name: /cuenta creada/i }));
    expect(panel.getByRole('alert')).toHaveTextContent(/no se pudo enviar el correo/i);

    await user.click(panel.getByRole('button', { name: /reenviar correo/i }));

    expect(admin.sendPasswordReset).toHaveBeenCalledWith('inv-3');
    expect(await panel.findByText(/enviamos un correo a nuevo@example.com/i)).toBeInTheDocument();
    expect(panel.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a re-send that fails again keeps the retry and explains the server error', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createUser: vi.fn(async () => ({
        id: 'user-1',
        email: 'nueva@example.com',
        role: 'employee' as const,
        emailSent: false,
      })),
      sendPasswordReset: vi.fn(async () => {
        throw new AdminError('identity-admin-not-configured');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });
    await darDeAlta(user, 'nueva@example.com');

    const panel = within(await screen.findByRole('region', { name: /cuenta creada/i }));
    await user.click(panel.getByRole('button', { name: /reenviar correo/i }));

    expect(await panel.findByText(/no está configurada/i)).toBeInTheDocument();
    expect(panel.getByRole('button', { name: /reenviar correo/i })).toBeEnabled();
  });

  it('dismissing it removes the panel', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });
    await invitar(user, 'nuevo@example.com', '30');
    await screen.findByRole('region', { name: /cuenta creada/i });

    await user.click(screen.getByRole('button', { name: /entendido/i }));

    expect(screen.queryByRole('region', { name: /cuenta creada/i })).not.toBeInTheDocument();
  });
});

describe('DashboardScreen: dar de alta a alguien de casa', () => {
  const SUPER = { ...ADMIN, role: 'superadmin' as const };

  it('manda al puerto el correo sin espacios y el rol elegido', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin();
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await darDeAlta(user, '  nueva@example.com  ');

    expect(admin.createUser).toHaveBeenCalledWith('nueva@example.com', 'employee');
  });

  it('un superadmin puede elegir el rol de administrador', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({ session: vi.fn(async () => SUPER) });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await darDeAlta(user, 'jefa@example.com', /administrador/i);

    expect(admin.createUser).toHaveBeenCalledWith('jefa@example.com', 'admin');
  });

  it('a un admin no se le ofrece crear administradores', async () => {
    // Esconderlo es COSMETICO: el endpoint es publico y cualquiera puede pedir
    // `role: 'admin'` con curl. La guarda de verdad es `canAssignRole` en el
    // servidor, que responde 403. Esto solo evita ensenar una opcion que a esta
    // persona le va a dar error siempre.
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    const form = within(tarjeta(/nuevo usuario/i));
    expect(form.getByRole('option', { name: /empleado/i })).toBeInTheDocument();
    expect(form.queryByRole('option', { name: /administrador/i })).not.toBeInTheDocument();
  });

  it('un fallo al dar de alta no pinta el error dentro del formulario de invitacion', async () => {
    // Dos flujos distintos con dos estados distintos: un error del alta dentro
    // del formulario de invitar diria que fallo algo que ni se intento.
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createUser: vi.fn(async () => {
        throw new AdminError('conflict');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await darDeAlta(user, 'repetida@example.com');

    expect(await within(tarjeta(/nuevo usuario/i)).findByRole('alert')).toHaveTextContent(/ya/i);
    expect(within(tarjeta(/^invitaciones$/i)).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tras un fallo los campos se conservan, para corregir en vez de reescribir', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createUser: vi.fn(async () => {
        throw new AdminError('invalid-request');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await darDeAlta(user, 'nueva@example.com');

    const form = within(tarjeta(/nuevo usuario/i));
    expect(await form.findByRole('alert')).toBeInTheDocument();
    expect(form.getByLabelText(/correo/i)).toHaveValue('nueva@example.com');
  });

  it('un fallo al invitar no pinta el error dentro del alta de usuario', async () => {
    const user = userEvent.setup();
    const admin = fakeAdmin({
      createInvitation: vi.fn(async () => {
        throw new AdminError('conflict');
      }),
    });
    render(<DashboardScreen admin={admin} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'repetido@example.com', '30');

    expect(await within(tarjeta(/^invitaciones$/i)).findByRole('alert')).toBeInTheDocument();
    expect(within(tarjeta(/nuevo usuario/i)).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confirms the email and says the access does NOT expire', async () => {
    // Callar que no hay fecha de vencimiento dejaria a quien administra sin
    // saber cual de las dos altas hizo.
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await darDeAlta(user, 'nueva@example.com');

    // Acotado al panel: la tarjeta del alta ya explica que el acceso no
    // caduca, y sin acotar el test pasaria por ese texto en vez de por el del
    // panel.
    const panel = within(await screen.findByRole('region', { name: /cuenta creada/i }));
    expect(panel.getByText(/enviamos un correo a nueva@example.com/i)).toBeInTheDocument();
    expect(panel.getByText(/no caduca/i)).toBeInTheDocument();
  });

  it('el panel de la invitacion sigue anunciando su fecha de vencimiento', async () => {
    // El mismo componente sirve a los dos flujos; esto afirma que generalizarlo
    // no borro la unica linea que distingue un acceso temporal de uno que no lo
    // es.
    const user = userEvent.setup();
    render(<DashboardScreen admin={fakeAdmin()} />);
    await screen.findByRole('region', { name: /^invitaciones$/i });

    await invitar(user, 'nuevo@example.com', '30');

    expect(await screen.findByText(/caduca el 24\/09\/2026/i)).toBeInTheDocument();
  });
});

describe('DashboardScreen: los paneles que cuelgan debajo', () => {
  /**
   * Los paneles de escritorios y de catalogo llegan como hijos desde la raiz
   * de composicion (`DashboardRoute`), y no como puertos propios: asi esta
   * pantalla no tiene que saber que existen ni de que hablan, y sigue siendo
   * la de invitaciones y altas con un hueco debajo.
   */
  const OTRO_PANEL = <p>Panel de escritorios</p>;

  it('pinta debajo los paneles que le pasa la raiz de composicion', async () => {
    render(<DashboardScreen admin={fakeAdmin()}>{OTRO_PANEL}</DashboardScreen>);

    expect(await screen.findByText('Panel de escritorios')).toBeInTheDocument();
  });

  it('a quien no administra no le pinta ninguno', async () => {
    const admin = fakeAdmin({
      session: vi.fn(async () => ({ ...ADMIN, role: 'employee' as const })),
    });

    render(<DashboardScreen admin={admin}>{OTRO_PANEL}</DashboardScreen>);

    // La guarda de rol ya estaba aqui y vale para todo lo que cuelgue: cada
    // panel repitiendola por su cuenta seria la copia que un dia se olvida.
    expect(await screen.findByText(/no autorizado/i)).toBeInTheDocument();
    expect(screen.queryByText('Panel de escritorios')).not.toBeInTheDocument();
  });

  it('si no se sabe quien consulta, tampoco', async () => {
    const admin = fakeAdmin({
      session: vi.fn(async () => {
        throw new AdminError('network');
      }),
    });

    render(<DashboardScreen admin={admin}>{OTRO_PANEL}</DashboardScreen>);

    // Sin saber si quien mira administra, los paneles pedirian sus listas y
    // pintarian siete errores a quien no tiene nada que hacer aqui.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Panel de escritorios')).not.toBeInTheDocument();
  });
});
