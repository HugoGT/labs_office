import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Both screens enter through `import()` (#24), and the first test to mount one
// paid its cold module load inside `waitFor`'s 1s default: under a full
// `test:all` that alone timed out (#68). Loading them here, under the hook's
// 10s budget, leaves the tests waiting only on React; `createGame` stays the
// witness of whether the office mounted.
beforeAll(async () => {
  await Promise.all([import('./components/OfficeShell'), import('./dashboard/DashboardRoute')]);
});

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
});

/**
 * La oficina entra por `import()` diferido (#24, punto 8: su chunk arrastra
 * Phaser), asi que no esta montada al volver de `render`. Esperar a que
 * aparezca es lo que antes era inmediato; lo que se comprueba despues no
 * cambia.
 */
async function waitForOffice(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.querySelector('#office-shell')).not.toBeNull());
}

describe('App', () => {
  it('monta un unico lienzo de juego', async () => {
    const { container } = render(<App />);

    await waitForOffice(container);
    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('usa un landmark <main> como raiz', () => {
    const { container } = render(<App />);

    expect(container.querySelector('main')).not.toBeNull();
  });

  it('el contenedor del juego cuelga del <main>', async () => {
    const { container } = render(<App />);
    await waitForOffice(container);
    const host = createGameMock.mock.calls[0][0];

    expect(container.querySelector('main')?.contains(host)).toBe(true);
  });
});

describe('App: autenticacion (#8)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sin configuracion de firebase entra directo, sin pantalla de login', async () => {
    const { container } = render(<App />);
    await waitForOffice(container);

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

    await waitFor(() => expect(createGameMock).toHaveBeenCalledTimes(1));
    // Y sigue siendo uno solo cuando el arbol se asienta.
    await waitFor(() => expect(createGameMock).toHaveBeenCalledTimes(1));
  });

  it('con sesion monta la oficina y le pasa el nombre y el token de esa sesion', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    render(<App />);

    emit({ uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' });

    await waitFor(() => expect(createGameMock).toHaveBeenCalledTimes(1));
    const options = createGameMock.mock.calls[0][2];
    expect(options?.playerName).toBe('Ana');
    await expect(options?.getIdToken?.()).resolves.toBe('id-token');
  });
});

describe('App: leaving the office (#66)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaving unmounts the office, which tears the game down, and shows the notice', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitForOffice(container);
    const game = createGameMock.mock.results[0].value as { destroy: ReturnType<typeof vi.fn> };

    await user.click(screen.getByRole('button', { name: /Salir de la oficina/ }));

    // Destroying the game is what leaves the Colyseus room and, with the
    // shell gone, the LiveKit room: the avatar disappears for everyone.
    expect(game.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#office-shell')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Saliste de la oficina' })).toBeInTheDocument();
  });

  it('"Volver a ingresar" mounts the office again with the same session, no login', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    const user = userEvent.setup();
    const { container } = render(<App />);
    emit({ uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' });
    await waitForOffice(container);

    await user.click(screen.getByRole('button', { name: /Salir de la oficina/ }));
    await user.click(screen.getByRole('button', { name: 'Volver a ingresar' }));

    await waitForOffice(container);
    expect(createGameMock).toHaveBeenCalledTimes(2);
    expect(createGameMock.mock.calls[1][2]?.playerName).toBe('Ana');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(port.signOut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it('"Cerrar sesión" signs out through the auth port and brings back the login', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    const user = userEvent.setup();
    const { container } = render(<App />);
    emit({ uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' });
    await waitForOffice(container);

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
    expect(port.signOut).toHaveBeenCalledTimes(1);
    emit(null);

    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument();
    expect(container.querySelector('#office-shell')).toBeNull();
  });
});

describe('App: replaced by another tab (#78)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a replaced session unmounts the office and says where it went', async () => {
    const { container } = render(<App />);
    await waitForOffice(container);
    const game = createGameMock.mock.results[0].value as { destroy: ReturnType<typeof vi.fn> };
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'replaced', canRetry: true }));

    // Unmounting is what drops LiveKit too: the old tab must not keep hearing.
    expect(game.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#office-shell')).toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'Abriste la oficina en otra pestaña o dispositivo' }),
    ).toBeInTheDocument();
  });

  it('"Usar aquí" enters again with the same session, no login', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIza-publica');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'oficina-virtual');
    const { port, emit } = fakePort();
    createAdapterMock.mockReturnValue(port);
    const user = userEvent.setup();
    const { container } = render(<App />);
    emit({ uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' });
    await waitForOffice(container);
    const bridge = createGameMock.mock.calls[0][1];
    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'replaced', canRetry: true }));

    await user.click(screen.getByRole('button', { name: 'Usar aquí' }));

    // A fresh join, which in turn replaces the other tab: last one wins.
    await waitForOffice(container);
    expect(createGameMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(port.signOut).not.toHaveBeenCalled();
  });
});

describe('App: enrutado (#24)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('en /dashboard no monta la oficina: el panel no paga Phaser', async () => {
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    // El motor de juego vive tras el `import()` de `OfficeShell`, que esta
    // ruta no toca (#24, punto 8). `createGame` es el testigo de que no se
    // cargo: si el arbol montase la oficina, se habria llamado.
    expect(await screen.findByText(/sin autenticación/i)).toBeInTheDocument();
    expect(createGameMock).not.toHaveBeenCalled();
  });

  it('el panel vive dentro del mismo landmark <main>', async () => {
    window.history.pushState({}, '', '/dashboard');

    const { container } = render(<App />);

    const aviso = await screen.findByText(/sin autenticación/i);
    expect(container.querySelector('main')?.contains(aviso)).toBe(true);
  });

  it('/dashboard/ con barra final llega al mismo sitio', async () => {
    window.history.pushState({}, '', '/dashboard/');

    render(<App />);

    expect(await screen.findByText(/sin autenticación/i)).toBeInTheDocument();
  });

  it('cualquier otra ruta sigue siendo la oficina', async () => {
    window.history.pushState({}, '', '/dashboards');

    const { container } = render(<App />);

    await waitForOffice(container);
  });

  it('REGRESION: la oficina no ofrece ningun camino al panel', async () => {
    // Requisito explicito de #24: a `/dashboard` se llega escribiendo la URL
    // y por ningun otro sitio. Un enlace o un boton en el HUD convertiria una
    // pantalla de administracion en parte de la oficina para todo el mundo.
    const { container } = render(<App />);
    await waitForOffice(container);

    expect(container.querySelector('a[href*="dashboard"]')).toBeNull();
    expect(container.querySelector('[href*="admin"]')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /panel|dashboard|invitaci/i }),
    ).not.toBeInTheDocument();
  });
});
