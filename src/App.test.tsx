import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AuthUser } from './auth/authPort';
import { createFirebaseAuthAdapter } from './auth/firebaseAuthAdapter';
import { createGame } from './game/createGame';

vi.mock('./game/createGame', () => ({ createGame: vi.fn() }));
// El adaptador real exige un proyecto de Identity Platform; aqui solo importa
// que se construya con la configuracion resuelta y que su puerto llegue al
// `AuthGate`, igual que `createGame` se mockea para aislar Phaser.
vi.mock('./auth/firebaseAuthAdapter', () => ({ createFirebaseAuthAdapter: vi.fn() }));

const createGameMock = vi.mocked(createGame);
const createAdapterMock = vi.mocked(createFirebaseAuthAdapter);

/** Puerto con el primer aviso bajo control del test (ver `useAuth`). */
function fakePort() {
  let listener: ((user: AuthUser | null) => void) | null = null;
  const port = {
    onChange: vi.fn((next: (user: AuthUser | null) => void) => {
      listener = next;
      return vi.fn();
    }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getIdToken: vi.fn(async () => 'id-token'),
  };
  return { port, emit: (user: AuthUser | null) => act(() => listener?.(user)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
});

describe('App', () => {
  it('monta un unico lienzo de juego', () => {
    render(<App />);

    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('usa un landmark <main> como raiz', () => {
    const { container } = render(<App />);

    expect(container.querySelector('main')).not.toBeNull();
  });

  it('el contenedor del juego cuelga del <main>', () => {
    const { container } = render(<App />);
    const host = createGameMock.mock.calls[0][0];

    expect(container.querySelector('main')?.contains(host)).toBe(true);
  });
});

describe('App: autenticacion (#8)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sin configuracion de firebase entra directo, sin pantalla de login', () => {
    render(<App />);

    // Desarrollo local y suite e2e (`.env.e2e` fija las variables a vacio):
    // nadie autentica y nadie queda fuera.
    expect(createAdapterMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('con configuracion construye el adaptador una sola vez, con lo resuelto', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port } = fakePort();
    createAdapterMock.mockReturnValue(port);

    const { rerender } = render(<App />);
    rerender(<App />);

    // Reconstruirlo por render tiraria la sesion restaurada y volveria a
    // inicializar firebase en cada actualizacion del arbol.
    expect(createAdapterMock).toHaveBeenCalledTimes(1);
    expect(createAdapterMock).toHaveBeenCalledWith({
      apiKey: 'AIza-publica',
      projectId: 'oficina-virtual',
      authDomain: 'oficina-virtual.firebaseapp.com',
    });
  });

  it('con autenticacion no monta la oficina hasta saber si ya hay sesion', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port } = fakePort();
    createAdapterMock.mockReturnValue(port);

    render(<App />);

    expect(createGameMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it('sin sesion ensena el login dentro del <main>, sin montar Phaser', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    const { container } = render(<App />);

    emit(null);

    const form = screen.getByLabelText(/contraseña/i);
    expect(container.querySelector('main')?.contains(form)).toBe(true);
    expect(createGameMock).not.toHaveBeenCalled();
  });

  it('REGRESION: renovar el token no vuelve a montar la oficina', async () => {
    // El SDK avisa al renovar el ID token, mas o menos cada hora, con la misma
    // identidad en un objeto nuevo. Si esa referencia nueva llegase hasta las
    // dependencias del efecto de `GameCanvas`, Phaser se destruiria y se
    // recrearia: el avatar volveria al spawn y el audio se cortaria en mitad de
    // una conversacion. La guarda esta en `useAuth`; este test mide el efecto.
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    render(<App />);
    const ana = { uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' };

    emit(ana);
    emit({ ...ana });

    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('con sesion monta la oficina y le pasa el nombre y el token de esa sesion', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    render(<App />);

    emit({ uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' });

    expect(createGameMock).toHaveBeenCalledTimes(1);
    const options = createGameMock.mock.calls[0][2];
    expect(options?.playerName).toBe('Ana');
    await expect(options?.getIdToken?.()).resolves.toBe('id-token');
  });
});
