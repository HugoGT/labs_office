import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSession } from '../auth/authPort';
import { createAdminClient } from './adminClient';
import type { AdminPort } from './adminPort';
import { createAssetAdminClient } from './assetAdminClient';
import type { AssetAdminPort } from './assetAdminPort';
import { createDeskAdminClient } from './deskAdminClient';
import type { DeskAdminPort } from './deskAdminPort';
import { createSpacesAdminClient } from './spacesAdminClient';
import type { SpacesAdminPort } from './spacesAdminPort';
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

// Los adaptadores de escritorios y catalogo se mockean igual y por lo mismo:
// aqui solo importa con que se construyen. Lo que hacen con esa base ya lo
// prueban `deskAdminClient.test.ts` y `assetAdminClient.test.ts`.
vi.mock('./deskAdminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deskAdminClient')>()),
  createDeskAdminClient: vi.fn(),
}));

vi.mock('./assetAdminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assetAdminClient')>()),
  createAssetAdminClient: vi.fn(),
}));

vi.mock('./spacesAdminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spacesAdminClient')>()),
  createSpacesAdminClient: vi.fn(),
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
const createDeskAdminClientMock = vi.mocked(createDeskAdminClient);
const createAssetAdminClientMock = vi.mocked(createAssetAdminClient);
const createSpacesAdminClientMock = vi.mocked(createSpacesAdminClient);

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
  };
}

function fakeDeskPort(): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => []),
    createDesk: vi.fn(),
    updateDesk: vi.fn(),
    deleteDesk: vi.fn(async () => undefined),
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

function fakeSpacesPort(): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => []),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    deleteSpace: vi.fn(async () => undefined),
  };
}

function fakeSession(): OfficeSession {
  return { displayName: 'Ana', getIdToken: vi.fn(async () => 'id-token') };
}

beforeEach(() => {
  // Los dos paneles se montan siempre que hay sesion y servidor, asi que sin
  // un puerto de vuelta cualquier prueba de esta ruta reventaria dentro de
  // ellos por algo que no es lo que prueba.
  createDeskAdminClientMock.mockReturnValue(fakeDeskPort());
  createAssetAdminClientMock.mockReturnValue(fakeAssetPort());
  createSpacesAdminClientMock.mockReturnValue(fakeSpacesPort());
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

    expect(await screen.findByText(/todavía no hay invitaciones/i)).toBeInTheDocument();
  });
});

describe('DashboardRoute: los paneles de escritorios, espacios y catalogo', () => {
  it('construye sus adaptadores con la RAIZ, no con /admin', () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    // `GET /desks` y `GET /spaces` no cuelgan de `/admin`, asi que estos tres
    // adaptadores piden la raiz y escriben el prefijo entero en cada camino.
    expect(createDeskAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567');
    expect(createAssetAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567');
    expect(createSpacesAdminClientMock.mock.calls[0][0].baseUrl).toBe('http://localhost:2567');
  });

  it('los cuatro adaptadores piden el token a la sesion, no a una copia', async () => {
    const session = fakeSession();
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={session} />);
    await createAdminClientMock.mock.calls[0][0].getIdToken();
    await createDeskAdminClientMock.mock.calls[0][0].getIdToken();
    await createAssetAdminClientMock.mock.calls[0][0].getIdToken();
    await createSpacesAdminClientMock.mock.calls[0][0].getIdToken();

    // El ID token caduca cada hora: una copia dejaria de valer a mitad de una
    // sesion del panel sin que nada avisase.
    expect(session.getIdToken).toHaveBeenCalledTimes(4);
  });

  it('no los reconstruye en cada render', () => {
    createAdminClientMock.mockReturnValue(fakePort());
    const session = fakeSession();

    const { rerender } = render(<DashboardRoute session={session} />);
    rerender(<DashboardRoute session={session} />);

    // Un puerto nuevo por render volveria a disparar la carga de cada lista en
    // bucle: es la dependencia del efecto de cada panel.
    expect(createDeskAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createAssetAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createSpacesAdminClientMock).toHaveBeenCalledTimes(1);
  });

  it('sin servidor de oficina no construye ninguno', async () => {
    vi.stubEnv('VITE_COLYSEUS_URL', '');

    render(<DashboardRoute session={fakeSession()} />);

    await screen.findByText(/no hay servidor/i);
    expect(createDeskAdminClientMock).not.toHaveBeenCalled();
    expect(createAssetAdminClientMock).not.toHaveBeenCalled();
    expect(createSpacesAdminClientMock).not.toHaveBeenCalled();
  });

  it('monta los tres paneles dentro del panel de administracion', async () => {
    createAdminClientMock.mockReturnValue(fakePort());

    render(<DashboardRoute session={fakeSession()} />);

    // Cada uno pide su propia lista al montarse: son sus propios contenedores
    // y `DashboardScreen` no sabe de que hablan.
    expect(await screen.findByRole('region', { name: /escritorios/i })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: /espacios/i })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: /catálogo/i })).toBeInTheDocument();
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
