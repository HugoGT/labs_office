import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSession } from '../auth/authPort';
import { createAdminClient } from './adminClient';
import type { AdminPort } from './adminPort';
import DashboardRoute from './DashboardRoute';

// El adaptador real habla HTTP; aqui solo importa con que se construye y que
// su puerto llegue a la pantalla, igual que `App.test.tsx` mockea el
// adaptador de firebase.
vi.mock('./adminClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./adminClient')>()),
  createAdminClient: vi.fn(),
}));

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

    expect(await screen.findByText(/todavía no hay invitaciones/i)).toBeInTheDocument();
  });
});
