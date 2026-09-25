import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/authPort';
import type { ClaimDisplayNameResult, DisplayNamePort, ReadDisplayNameResult } from '../auth/displayNamePort';
import { useDisplayName } from './useDisplayName';

const ANA: AuthUser = { uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' };

function fakePort(overrides: Partial<DisplayNamePort> = {}): DisplayNamePort {
  return {
    claim: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana' })),
    read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana' })),
    ...overrides,
  };
}

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

describe('useDisplayName: restauracion (D6)', () => {
  it('sin usuario, no lee nada y se queda pending', () => {
    const port = fakePort();

    const { result } = renderHook(() => useDisplayName(port, null, vi.fn()));

    expect(result.current.flow).toEqual({ phase: 'pending' });
    expect(port.read).not.toHaveBeenCalled();
  });

  it('con usuario, lee el nombre guardado y resuelve con el', async () => {
    const port = fakePort({ read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Bea' })) });

    const { result } = renderHook(() => useDisplayName(port, ANA, vi.fn()));

    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: 'Bea' });
    expect(port.read).toHaveBeenCalledTimes(1);
  });

  it('sin nombre guardado (null), resuelve con null sin reclamar nada', async () => {
    const port = fakePort({ read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: null })) });

    const { result } = renderHook(() => useDisplayName(port, ANA, vi.fn()));

    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: null });
    expect(port.claim).not.toHaveBeenCalled();
  });

  it.each<[Extract<ReadDisplayNameResult['outcome'], 'unavailable' | 'failed'>]>([['unavailable'], ['failed']])(
    'un GET %s NO cierra sesion: fail-open al derivado (null)',
    async (outcome) => {
      const signOut = vi.fn(async () => undefined);
      const port = fakePort({ read: vi.fn(async () => ({ outcome })) });

      const { result } = renderHook(() => useDisplayName(port, ANA, signOut));

      await act(async () => {});

      expect(result.current.flow).toEqual({ phase: 'resolved', displayName: null });
      expect(signOut).not.toHaveBeenCalled();
    },
  );

  it('sin puerto (sin directorio configurado), resuelve con null sin tocar la red', async () => {
    const { result } = renderHook(() => useDisplayName(null, ANA, vi.fn()));

    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: null });
  });

  it('una vez resuelto no vuelve a leer para la misma cuenta', async () => {
    const port = fakePort({ read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Bea' })) });
    const { rerender } = renderHook(({ u }) => useDisplayName(port, u, vi.fn()), {
      initialProps: { u: ANA as AuthUser | null },
    });
    await act(async () => {});
    expect(port.read).toHaveBeenCalledTimes(1);

    rerender({ u: ANA });

    expect(port.read).toHaveBeenCalledTimes(1);
  });

  it('al cerrar sesion vuelve a pending, para releer en el siguiente login', async () => {
    const port = fakePort({ read: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Bea' })) });
    const { result, rerender } = renderHook(({ u }) => useDisplayName(port, u, vi.fn()), {
      initialProps: { u: ANA as AuthUser | null },
    });
    await act(async () => {});

    rerender({ u: null });

    expect(result.current.flow).toEqual({ phase: 'pending' });
  });

  it('no lee mientras un submit sigue en vuelo sobre la MISMA transicion de usuario', async () => {
    const { claim, release } = pendingClaim();
    const port = fakePort({ claim });
    const signIn = vi.fn(async () => true);
    const { result, rerender } = renderHook(({ u }) => useDisplayName(port, u, vi.fn()), {
      initialProps: { u: null as AuthUser | null },
    });

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submit(signIn, 'Ana');
    });
    // El aviso de sesion llega MIENTRAS el reclamo sigue en vuelo, igual que en
    // produccion (`onIdTokenChanged` no espera a que termine ningun POST).
    rerender({ u: ANA });
    // Deja que el `signIn` inyectado resuelva y `submit` llegue a llamar a
    // `port.claim` (de ahi sale la funcion `release` de este test).
    await act(async () => {});

    expect(port.read).not.toHaveBeenCalled();

    await act(async () => {
      release({ outcome: 'ok', displayName: 'Ana' });
      await pending;
    });

    expect(port.read).not.toHaveBeenCalled();
    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: 'Ana' });
  });
});

describe('useDisplayName: reclamo via submit (D2/D9)', () => {
  it('si signIn falla, no reclama nada y devuelve null', async () => {
    const port = fakePort();
    const signIn = vi.fn(async () => false);

    const { result } = renderHook(() => useDisplayName(port, null, vi.fn()));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit(signIn, 'Ana');
    });

    expect(outcome).toBeNull();
    expect(port.claim).not.toHaveBeenCalled();
  });

  it('claiming se enciende durante todo el submit y se apaga al terminar', async () => {
    const { claim, release } = pendingClaim();
    const port = fakePort({ claim });
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, null, vi.fn()));

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submit(signIn, 'Ana');
    });
    expect(result.current.claiming).toBe(true);
    // Deja que el `signIn` inyectado resuelva y `submit` llegue a llamar a
    // `port.claim` (de ahi sale la funcion `release` de este test).
    await act(async () => {});

    await act(async () => {
      release({ outcome: 'ok', displayName: 'Ana' });
      await pending;
    });

    expect(result.current.claiming).toBe(false);
  });

  it('signIn exitoso reclama el nombre escrito', async () => {
    const port = fakePort();
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, null, vi.fn()));

    await act(async () => {
      await result.current.submit(signIn, 'Ana Lopez');
    });

    expect(port.claim).toHaveBeenCalledWith('Ana Lopez');
  });

  // Estas tres pruebas fijan `user` en ANA (en vez de `null`) porque un `flow`
  // resuelto solo importa cuando ya hay sesion (D2); `read` nunca resuelve
  // para que la restauracion de arranque (dispara igual, con `user` no nulo)
  // no compita por escribir `flow` con el propio `submit`.
  it('un reclamo con exito resuelve con el nombre canonico', async () => {
    const port = fakePort({
      claim: vi.fn(async () => ({ outcome: 'ok' as const, displayName: 'Ana Lopez' })),
      read: vi.fn(() => new Promise<never>(() => {})),
    });
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, ANA, vi.fn()));

    const outcome = await act(async () => result.current.submit(signIn, 'Ana   Lopez'));

    expect(outcome).toEqual({ outcome: 'ok', displayName: 'Ana Lopez' });
    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: 'Ana Lopez' });
  });

  it('sin puerto (sin directorio), el reclamo se ignora y entra con el derivado, sin cerrar sesion', async () => {
    const signOut = vi.fn(async () => undefined);
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(null, ANA, signOut));

    const outcome = await act(async () => result.current.submit(signIn, 'Ana'));

    expect(outcome).toEqual({ outcome: 'unavailable' });
    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: null });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('unavailable durante el reclamo (403/503): entra con el derivado, sin cerrar sesion', async () => {
    const port = fakePort({
      claim: vi.fn(async () => ({ outcome: 'unavailable' as const })),
      read: vi.fn(() => new Promise<never>(() => {})),
    });
    const signOut = vi.fn(async () => undefined);
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, ANA, signOut));

    await act(async () => {
      await result.current.submit(signIn, 'Ana');
    });

    expect(result.current.flow).toEqual({ phase: 'resolved', displayName: null });
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['taken' as const, /ya está en uso/i],
    ['invalid' as const, /hasta 24 caracteres/i],
    ['failed' as const, /no se pudo guardar/i],
  ])('un rechazo (%s) cierra la sesion y ensena el error, sin resolver el nombre', async (outcome, expectedError) => {
    const port = fakePort({ claim: vi.fn(async () => ({ outcome })) });
    const signOut = vi.fn(async () => undefined);
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, null, signOut));

    await act(async () => {
      await result.current.submit(signIn, 'Bea');
    });

    expect(result.current.flow).toEqual({ phase: 'pending' });
    expect(result.current.error).toMatch(expectedError);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('un reclamo devuelve el outcome ademas de escribirlo, para que AuthGate llame a onNameClaimed sin esperar un render', async () => {
    const port = fakePort({ claim: vi.fn(async () => ({ outcome: 'taken' as const })) });
    const signIn = vi.fn(async () => true);
    const { result } = renderHook(() => useDisplayName(port, null, vi.fn()));

    const outcome = await act(async () => result.current.submit(signIn, 'Bea'));

    expect(outcome).toEqual({ outcome: 'taken' });
  });

  it('un aviso tardio tras el desmontaje no escribe estado', async () => {
    const { claim, release } = pendingClaim();
    const port = fakePort({ claim });
    const signIn = vi.fn(async () => true);
    const { result, unmount } = renderHook(() => useDisplayName(port, null, vi.fn()));

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submit(signIn, 'Ana');
    });
    // Deja que el `signIn` inyectado resuelva y `submit` llegue a llamar a
    // `port.claim` (de ahi sale la funcion `release` de este test) ANTES de
    // desmontar, para que el aviso tardio de abajo sea real.
    await act(async () => {});
    unmount();

    expect(() => {
      release({ outcome: 'ok', displayName: 'Ana' });
    }).not.toThrow();
    await pending!;
  });
});
