import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthPort, AuthUser, OfficeSession } from '../auth/authPort';
import type { ClaimDisplayNameResult, DisplayNamePort } from '../auth/displayNamePort';
import { AuthGate } from './AuthGate';

const ANA: AuthUser = { uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' };

function fakePort(overrides: Partial<AuthPort> = {}) {
  let listener: ((user: AuthUser | null) => void) | null = null;
  const port: AuthPort = {
    onChange: vi.fn((next: (user: AuthUser | null) => void) => {
      listener = next;
      return vi.fn();
    }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async () => undefined),
    getIdToken: vi.fn(async () => 'jwt'),
    ...overrides,
  };
  return {
    port,
    emit(user: AuthUser | null) {
      act(() => listener?.(user));
    },
  };
}

/** #100: doble de `DisplayNamePort`. `undefined` en las claves no sobreescritas. */
function fakeDisplayNamePort(overrides: Partial<DisplayNamePort> = {}): DisplayNamePort {
  return {
    claim: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana Lopez' })),
    read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: null })),
    ...overrides,
  };
}

/** Rellena y envia el formulario: Nombre, Correo, Contrasena, Enter. */
async function submitLogin(
  user: ReturnType<typeof userEvent.setup>,
  { name = 'Ana Lopez', email = 'ana@example.com', password = 'secreta' } = {},
) {
  await user.type(screen.getByLabelText(/^nombre$/i), name);
  await user.type(screen.getByLabelText(/correo/i), email);
  await user.type(screen.getByLabelText(/contraseña/i), `${password}{Enter}`);
}

/** Registra cada sesion con la que se renderizan los hijos. */
function officeSpy() {
  const sessions: (OfficeSession | null)[] = [];
  return {
    sessions,
    render: (session: OfficeSession | null) => {
      sessions.push(session);
      return <div data-testid="office">{session ? session.displayName : 'sin sesion'}</div>;
    },
  };
}

describe('AuthGate: autenticacion apagada', () => {
  it('sin puerto monta la oficina de inmediato, sin pantalla de login', () => {
    const office = officeSpy();

    render(<AuthGate auth={null}>{office.render}</AuthGate>);

    // Este es el camino del desarrollo local y de la suite e2e
    // (`.env.e2e` fija las variables a vacio): tiene que costar lo mismo que
    // antes de existir el login.
    expect(screen.getByTestId('office')).toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
    expect(office.sessions).toEqual([null]);
  });
});

describe('AuthGate: autenticacion encendida', () => {
  it('mientras no se sabe si hay sesion no ensena el login ni la oficina', () => {
    const office = officeSpy();
    const { port } = fakePort();

    render(<AuthGate auth={port}>{office.render}</AuthGate>);

    // Ensenar el login en este hueco lo haria parpadear en la cara de quien
    // ya habia entrado, en cada recarga.
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('office')).not.toBeInTheDocument();
    expect(office.sessions).toEqual([]);
  });

  it('sin usuario ensena el login y no monta la oficina', () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{office.render}</AuthGate>);

    emit(null);

    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
    expect(screen.queryByTestId('office')).not.toBeInTheDocument();
  });

  it('enviar el formulario inicia sesion por el puerto', async () => {
    const user = userEvent.setup();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{officeSpy().render}</AuthGate>);
    emit(null);

    await submitLogin(user);

    expect(port.signIn).toHaveBeenCalledWith('ana@example.com', 'secreta');
  });

  it('un fallo de credenciales se ensena traducido, no crudo', async () => {
    const user = userEvent.setup();
    const { port, emit } = fakePort({
      signIn: vi.fn(async () => {
        throw Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), {
          code: 'auth/invalid-credential',
        });
      }),
    });
    render(<AuthGate auth={port}>{officeSpy().render}</AuthGate>);
    emit(null);

    await submitLogin(user, { password: 'mala' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(screen.queryByText(/Firebase/)).not.toBeInTheDocument();
  });

  it('con usuario monta la oficina con su nombre y retira el login', () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{office.render}</AuthGate>);

    emit(ANA);

    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('office')).toHaveTextContent('Ana');
    expect(office.sessions.at(-1)?.displayName).toBe('Ana');
  });

  it('la sesion entregada pide el token al puerto en cada llamada, no lo cachea', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{office.render}</AuthGate>);
    emit(ANA);

    const session = office.sessions.at(-1);
    await expect(session?.getIdToken()).resolves.toBe('jwt');
    await expect(session?.getIdToken()).resolves.toBe('jwt');

    // Un token cacheado caducaria a la hora y el servidor empezaria a
    // rechazar peticiones sin que nada avisase.
    expect(port.getIdToken).toHaveBeenCalledTimes(2);
  });

  it('la sesion mantiene su identidad entre renders: no remonta la oficina', () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    const { rerender } = render(<AuthGate auth={port}>{office.render}</AuthGate>);
    emit(ANA);
    const first = office.sessions.at(-1);

    rerender(<AuthGate auth={port}>{office.render}</AuthGate>);

    // `GameCanvas` recrea Phaser entero cuando cambia la identidad de sus
    // props; una sesion nueva por render tiraria el juego en cada render.
    expect(office.sessions.at(-1)).toBe(first);
  });

  it('the session signs out through the port (#66)', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{office.render}</AuthGate>);
    emit(ANA);

    await office.sessions.at(-1)?.signOut?.();

    // The port's listener then reports `null`, which is what brings back the
    // login (see the test below): the office never decides that by itself.
    expect(port.signOut).toHaveBeenCalledTimes(1);
  });

  it('cerrar la sesion devuelve al login sin desmontar el resto de la pagina', () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    render(<AuthGate auth={port}>{office.render}</AuthGate>);
    emit(ANA);
    expect(screen.getByTestId('office')).toBeInTheDocument();

    emit(null);

    expect(screen.queryByTestId('office')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
  });
});

describe('AuthGate: forgot password (#94)', () => {
  async function requestReset(port: AuthPort, emit: (user: AuthUser | null) => void, email: string) {
    const user = userEvent.setup();
    const view = render(<AuthGate auth={port}>{officeSpy().render}</AuthGate>);
    emit(null);
    await user.click(screen.getByRole('button', { name: /olvidaste/i }));
    await user.type(screen.getByLabelText(/correo/i), `${email}{Enter}`);
    const status = await screen.findByRole('status');
    const text = status.textContent;
    view.unmount();
    return text;
  }

  it('sends the reset email through the port', async () => {
    const { port, emit } = fakePort();

    await requestReset(port, emit, 'ana@example.com');

    expect(port.sendPasswordReset).toHaveBeenCalledWith('ana@example.com');
  });

  it('REGRESSION: the confirmation is identical whether or not the account exists', async () => {
    const existing = fakePort();
    const missing = fakePort({
      sendPasswordReset: vi.fn(async () => {
        throw Object.assign(new Error('Firebase: Error (auth/user-not-found).'), {
          code: 'auth/user-not-found',
        });
      }),
    });

    const forExisting = await requestReset(existing.port, existing.emit, 'ana@example.com');
    const forMissing = await requestReset(missing.port, missing.emit, 'nadie@example.com');

    expect(forMissing).toBe(forExisting);
  });
});

describe('AuthGate: nombre visible auto-elegido en login (#100)', () => {
  it('invariante de una sola rama: nunca se ven la oficina y el login a la vez', async () => {
    const user = userEvent.setup();
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort();
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user);
    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^nombre$/i)).not.toBeInTheDocument();
  });

  it('tras entrar, reclama el nombre escrito en el formulario', async () => {
    const user = userEvent.setup();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort();
    render(
      <AuthGate auth={port} displayName={displayName}>
        {officeSpy().render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user, { name: 'Ana Lopez' });
    await act(async () => emit(ANA));

    await waitFor(() => expect(displayName.claim).toHaveBeenCalledWith('Ana Lopez'));
  });

  it('un nombre reclamado con exito se convierte en el nombre de la sesion', async () => {
    const user = userEvent.setup();
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      claim: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana Lopez' })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user, { name: 'Ana   Lopez' });
    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana Lopez'));
  });

  it('un nombre ya elegido con exito se guarda con onNameClaimed (D8)', async () => {
    const user = userEvent.setup();
    const { port, emit } = fakePort();
    const onNameClaimed = vi.fn();
    const displayName = fakeDisplayNamePort({
      claim: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana Lopez' })),
    });
    render(
      <AuthGate auth={port} displayName={displayName} onNameClaimed={onNameClaimed}>
        {officeSpy().render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user);
    await act(async () => emit(ANA));

    await waitFor(() => expect(onNameClaimed).toHaveBeenCalledWith('Ana Lopez'));
  });

  /**
   * `claim` no resuelve hasta que el test lo suelte a mano: sin esto, los
   * mocks (todos inmediatos) podrian terminar el `handleSubmit` entero --
   * `claim` Y el `signOut` interno -- antes de que el test llegase a simular
   * el aviso de sesion (`emit(ANA)`), y esa carrera decidiria el resultado
   * segun el orden de microtareas en vez de segun la logica que se prueba.
   */
  function pendingClaim() {
    let release: ((value: ClaimDisplayNameResult) => void) | undefined;
    const claim = vi.fn(
      () =>
        new Promise<ClaimDisplayNameResult>((resolve) => {
          release = resolve;
        }),
    );
    return { claim, release: (value: ClaimDisplayNameResult) => release?.(value) };
  }

  /**
   * Un solo caso representativo a proposito: las tres copias de rechazo
   * (taken/invalid/failed) ya se prueban exhaustivamente en
   * `useDisplayName.test.ts`. Lo que este test aporta que el hook no puede es
   * la parte de integracion -- que `AuthGate` de verdad ensena el error y NO
   * desmonta `LoginScreen`, con lo que los campos escritos sobreviven (D2).
   */
  it('un rechazo cierra la sesion, muestra el error y preserva los campos (D2)', async () => {
    const user = userEvent.setup();
    const { port, emit } = fakePort();
    const { claim, release } = pendingClaim();
    const displayName = fakeDisplayNamePort({ claim });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {officeSpy().render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user, { name: 'Bea', email: 'ana@example.com', password: 'secreta' });
    // El aviso de sesion llega MIENTRAS el reclamo sigue en vuelo, igual que
    // en produccion (`onIdTokenChanged` no espera a que termine ningun POST).
    await act(async () => emit(ANA));
    await act(async () => release({ outcome: 'taken' }));

    await waitFor(() => expect(port.signOut).toHaveBeenCalledTimes(1));
    await act(async () => emit(null));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya está en uso/i);
    // Los campos siguen ahi: LoginScreen nunca se desmonto (D2).
    expect(screen.getByLabelText(/^nombre$/i)).toHaveValue('Bea');
    expect(screen.getByLabelText(/correo/i)).toHaveValue('ana@example.com');
  });

  it('un rechazo NUNCA deja ver la oficina, ni por un instante', async () => {
    const user = userEvent.setup();
    const office = officeSpy();
    const { port, emit } = fakePort();
    const { claim, release } = pendingClaim();
    const displayName = fakeDisplayNamePort({ claim });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user);
    await act(async () => emit(ANA));
    await act(async () => release({ outcome: 'taken' }));
    await act(async () => emit(null));

    expect(office.sessions).toEqual([]);
  });

  it('503/sin directorio (`displayName` null): entra con el nombre derivado, sin bloquear', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    // `displayName` prop ausente: mismo comportamiento que sin servidor o sin
    // `DATABASE_URL` (D7).
    render(<AuthGate auth={port}>{office.render}</AuthGate>);

    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana'));
  });

  it('unavailable en el claim (403/503 durante el envio): entra con el derivado, sin cerrar sesion', async () => {
    const user = userEvent.setup();
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      claim: vi.fn(async () => ({ outcome: 'unavailable' as const })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user);
    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana'));
    expect(port.signOut).not.toHaveBeenCalled();
  });

  it('sesion restaurada (sin pasar por el formulario): solo lee, nunca reclama', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana Lopez' })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );

    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana Lopez'));
    expect(displayName.read).toHaveBeenCalledTimes(1);
    expect(displayName.claim).not.toHaveBeenCalled();
  });

  it('sesion restaurada sin nombre elegido cae al derivado, sin reclamar nada', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: null })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );

    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana'));
    expect(displayName.claim).not.toHaveBeenCalled();
  });

  it('restaurar con un GET que falla NO cierra sesion: fail-open al derivado (D6)', async () => {
    const office = officeSpy();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      read: vi.fn(async () => ({ outcome: 'failed' as const })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {office.render}
      </AuthGate>,
    );

    await act(async () => emit(ANA));

    await waitFor(() => expect(screen.getByTestId('office')).toHaveTextContent('Ana'));
    expect(port.signOut).not.toHaveBeenCalled();
  });

  it('el campo Nombre se prellena con `initialName` (D8)', () => {
    const { port, emit } = fakePort();
    render(
      <AuthGate auth={port} initialName="Ana Lopez">
        {officeSpy().render}
      </AuthGate>,
    );
    emit(null);

    expect(screen.getByLabelText(/^nombre$/i)).toHaveValue('Ana Lopez');
  });

  it('recargar tras un rechazo no salta el login: sin sesion activa, se muestra el formulario', async () => {
    // Es la misma invariante que ya prueba `cerrar la sesion devuelve al
    // login`, pero es la que documenta el requisito de la especificacion: un
    // reload nunca puede saltarse el login con una sesion cuyo nombre nunca se
    // acepto.
    const user = userEvent.setup();
    const { port, emit } = fakePort();
    const displayName = fakeDisplayNamePort({
      claim: vi.fn(async () => ({ outcome: 'taken' as const })),
    });
    render(
      <AuthGate auth={port} displayName={displayName}>
        {officeSpy().render}
      </AuthGate>,
    );
    emit(null);

    await submitLogin(user);
    await act(async () => emit(ANA));
    await waitFor(() => expect(port.signOut).toHaveBeenCalledTimes(1));
    await act(async () => emit(null));

    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
    expect(screen.queryByTestId('office')).not.toBeInTheDocument();
  });
});
