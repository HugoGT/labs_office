import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSession } from '../auth/authPort';
import { createAdminClient } from './adminClient';
import type { AdminPort } from './adminPort';
import { createUsersAdminClient } from './usersAdminClient';
import type { UsersAdminPort } from './usersAdminPort';
import DashboardRoute from './DashboardRoute';

// El adaptador real habla HTTP; aqui solo importa con que se construye y que
// su puerto llegue a la pantalla, igual que `App.test.tsx` mockea el
// adaptador de firebase.
vi.mock('./adminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./adminClient')>()),
  createAdminClient: vi.fn(),
}));

// Users panel (#93): mocked for the same reason as the other adapters.
vi.mock('./usersAdminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usersAdminClient')>()),
  createUsersAdminClient: vi.fn(),
}));

const createUsersAdminClientMock = vi.mocked(createUsersAdminClient);

function fakeUsersPort(): UsersAdminPort {
  return { listUsers: vi.fn(async () => []), revokeUser: vi.fn(async () => undefined) };
}

beforeEach(() => {
  createUsersAdminClientMock.mockReturnValue(fakeUsersPort());
});

const createAdminClientMock = vi.mocked(createAdminClient);

function fakePort(): AdminPort {
  return {
    session: vi.fn(async () => ({
      role: 'admin' as const,
      email: 'ana@example.com',
      displayName: 'Ana',
      expiresAt: null,
    })),
    listInvitations: vi.fn(async () => []),
    createInvitation: vi.fn(),
    createUser: vi.fn(),
    revoke: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(),
  };
}

function fakeSession(): OfficeSession {
  return { displayName: 'Ana', getIdToken: vi.fn(async () => 'id-token') };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('DashboardRoute', () => {
  it('sin autenticacion lo dice, en vez de romperse', async () => {
    // `AuthGate` entrega `null` cuando la autenticacion esta apagada
    // (desarrollo local, suite e2e). La oficina funciona asi; el panel no
    // puede, porque no hay ningun token que mandar.
    render(<DashboardRoute session={null} />);

    expect(await screen.findByText(/sin autenticación/i)).toBeInTheDocument();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('construye el adaptador con la ruta /admin del servidor de la oficina', () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567/admin');
  });

  it('el adaptador pide el token a la sesion, no a una copia', async () => {
    const session = fakeSession();
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={session} />);
    await createAdminClientMock.mock.calls[0][0].getIdToken();

    expect(session.getIdToken).toHaveBeenCalledTimes(1);
  });

  it('no reconstruye el adaptador en cada render', () => {
    createAdminClientMock.mockReturnValue(fakePort());
    const session = fakeSession();

    const { rerender } = render(<DashboardRoute session={session} />);
    rerender(<DashboardRoute session={session} />);

    // Un puerto nuevo por render volveria a disparar la carga de `session()`
    // y la lista en bucle: es la dependencia del efecto de `DashboardScreen`.
    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
  });

  it('sin servidor de oficina configurado no inventa una URL', async () => {
    vi.stubEnv('VITE_COLYSEUS_URL', '');

    render(<DashboardRoute session={fakeSession()} />);

    expect(await screen.findByText(/no hay servidor/i)).toBeInTheDocument();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('con sesion y servidor monta el panel', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    expect(await screen.findByRole('region', { name: /nuevo usuario/i })).toBeInTheDocument();
  });
});

describe('DashboardRoute: paneles legacy de escritorios y espacios (#107), y catalogo migrado', () => {
  it('ya no monta las secciones de Escritorios, Espacios ni Catálogo', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    // Escritorios/Espacios: sustituidos por la barra lateral de la oficina
    // (#74), que edita lo mismo sobre el mapa en vez de por coordenadas
    // escritas a mano. Catálogo: migrado al panel "Personalizar" de esa misma
    // barra lateral, junto a escritorios y salas.
    await screen.findByRole('region', { name: /nuevo usuario/i });
    expect(screen.queryByRole('region', { name: /escritorios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /espacios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /catálogo/i })).not.toBeInTheDocument();
  });
});

describe('DashboardRoute: users panel (#93)', () => {
  it('builds its adapter with the server ROOT and the live session token, once', async () => {
    const session = fakeSession();
    createAdminClientMock.mockReturnValue(fakePort());

    const { rerender } = render(<DashboardRoute session={session} />);
    rerender(<DashboardRoute session={session} />);

    expect(createUsersAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createUsersAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567');
    await createUsersAdminClientMock.mock.calls[0][0].getIdToken();
    expect(session.getIdToken).toHaveBeenCalledTimes(1);
  });

  it('mounts the users panel inside the admin panel', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    expect(await screen.findByRole('region', { name: 'Usuarios' })).toBeInTheDocument();
  });
});
