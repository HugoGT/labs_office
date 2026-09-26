import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSession } from '../auth/authPort';
import { createAdminClient } from './adminClient';
import type { AdminPort } from './adminPort';
import { createAssetAdminClient } from './assetAdminClient';
import type { AssetAdminPort } from './assetAdminPort';
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

// El adaptador de catalogo se mockea igual y por lo mismo: aqui solo importa
// con que se construye. Lo que hace con esa base ya lo prueba
// `assetAdminClient.test.ts`.
vi.mock('./assetAdminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assetAdminClient')>()),
  createAssetAdminClient: vi.fn(),
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
const createAssetAdminClientMock = vi.mocked(createAssetAdminClient);

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

function fakeAssetPort(): AssetAdminPort {
  return {
    listAssets: vi.fn(async () => []),
    createAsset: vi.fn(),
    archiveAsset: vi.fn(),
    updateAsset: vi.fn(),
  };
}

function fakeSession(): OfficeSession {
  return { displayName: 'Ana', getIdToken: vi.fn(async () => 'id-token') };
}

beforeEach(() => {
  // El panel de catalogo se monta siempre que hay sesion y servidor, asi que
  // sin un puerto de vuelta cualquier prueba de esta ruta reventaria dentro
  // de el por algo que no es lo que prueba.
  createAssetAdminClientMock.mockReturnValue(fakeAssetPort());
});

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

describe('DashboardRoute: el panel de catalogo', () => {
  it('construye su adaptador con la RAIZ, no con /admin', () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    // `GET /admin/assets` cuelga de la raiz, escribiendo el prefijo entero en
    // cada camino, y no de `adminBaseUrl` (que ya lo incluye).
    expect(createAssetAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567');
  });

  it('pide el token a la sesion, no a una copia', async () => {
    const session = fakeSession();
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={session} />);
    await createAdminClientMock.mock.calls[0][0].getIdToken();
    await createAssetAdminClientMock.mock.calls[0][0].getIdToken();

    // El ID token caduca cada hora: una copia dejaria de valer a mitad de una
    // sesion del panel sin que nada avisase.
    expect(session.getIdToken).toHaveBeenCalledTimes(2);
  });

  it('no lo reconstruye en cada render', () => {
    createAdminClientMock.mockReturnValue(fakePort());
    const session = fakeSession();

    const { rerender } = render(<DashboardRoute session={session} />);
    rerender(<DashboardRoute session={session} />);

    // Un puerto nuevo por render volveria a disparar la carga de la lista en
    // bucle: es la dependencia del efecto del panel.
    expect(createAssetAdminClientMock).toHaveBeenCalledTimes(1);
  });

  it('sin servidor de oficina no lo construye', async () => {
    vi.stubEnv('VITE_COLYSEUS_URL', '');

    render(<DashboardRoute session={fakeSession()} />);

    await screen.findByText(/no hay servidor/i);
    expect(createAssetAdminClientMock).not.toHaveBeenCalled();
  });

  it('monta el panel de catalogo dentro del panel de administracion', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    expect(await screen.findByRole('region', { name: /catálogo/i })).toBeInTheDocument();
  });
});

describe('DashboardRoute: paneles legacy de escritorios y espacios (#107)', () => {
  it('ya no monta las secciones de Escritorios ni Espacios', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    // Sustituidos por la barra lateral de la oficina (#74), que edita lo mismo
    // sobre el mapa en vez de por coordenadas escritas a mano.
    expect(await screen.findByRole('region', { name: /catálogo/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /escritorios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /espacios/i })).not.toBeInTheDocument();
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
