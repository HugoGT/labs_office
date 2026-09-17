import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthPort, AuthUser, OfficeSession } from '../auth/authPort';
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

    await user.type(screen.getByLabelText(/correo/i), 'ana@example.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'secreta{Enter}');

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

    await user.type(screen.getByLabelText(/correo/i), 'ana@example.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'mala{Enter}');

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
