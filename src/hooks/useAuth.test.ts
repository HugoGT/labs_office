import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthPort, AuthUser } from '../auth/authPort';
import { useAuth } from './useAuth';

const ANA: AuthUser = { uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' };

/**
 * Doble del puerto con el aviso de cambio bajo control del test: el SDK real
 * notifica cuando le parece, y lo que aqui importa es justo el hueco entre el
 * montaje y el primer aviso.
 */
function fakePort(overrides: Partial<AuthPort> = {}) {
  let listener: ((user: AuthUser | null) => void) | null = null;
  const unsubscribe = vi.fn();
  const port: AuthPort = {
    onChange: vi.fn((next: (user: AuthUser | null) => void) => {
      listener = next;
      return unsubscribe;
    }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async () => undefined),
    getIdToken: vi.fn(async () => 'jwt'),
    ...overrides,
  };
  return {
    port,
    unsubscribe,
    emit(user: AuthUser | null) {
      listener?.(user);
    },
  };
}

describe('useAuth', () => {
  it('sin puerto (autenticacion apagada) esta listo de inmediato y sin usuario', () => {
    const { result } = renderHook(() => useAuth(null));

    expect(result.current.ready).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it('sin puerto, signIn y signOut no hacen nada y no revientan', async () => {
    const { result } = renderHook(() => useAuth(null));

    // #100, D9: sin puerto no hay nada que intentar y nada que falle, asi que
    // el contrato booleano dice "true" -- no hay error que reportar.
    await expect(result.current.signIn('ana@example.com', 'secreta')).resolves.toBe(true);
    await expect(result.current.signOut()).resolves.toBeUndefined();
    expect(result.current.user).toBeNull();
  });

  it('NO esta listo hasta el primer aviso del puerto', () => {
    const { port } = fakePort();

    const { result } = renderHook(() => useAuth(port));

    // El SDK restaura la sesion desde IndexedDB de forma asincrona. Darse por
    // listo antes de saberlo mostraria la pantalla de login en la cara de
    // quien ya habia entrado, en CADA recarga.
    expect(result.current.ready).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('el primer aviso con sesion restaurada deja listo y con usuario, sin pasar por login', () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));

    act(() => emit(ANA));

    expect(result.current.ready).toBe(true);
    expect(result.current.user).toEqual(ANA);
  });

  it('el primer aviso sin sesion deja listo y sin usuario', () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));

    act(() => emit(null));

    expect(result.current.ready).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('signIn delega en el puerto con lo recibido', async () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    await act(async () => {
      await result.current.signIn('ana@example.com', 'secreta');
    });

    expect(port.signIn).toHaveBeenCalledWith('ana@example.com', 'secreta');
  });

  it('#100, D9: signIn resuelve `true` cuando el puerto no lanza', async () => {
    // El contrato booleano es lo que permite a `AuthGate` encadenar el
    // reclamo del nombre de forma imperativa, sin depender de un efecto que
    // reaccione al `user` cambiar (un re-login con el MISMO uid no cambiaria
    // ese objeto).
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.signIn('ana@example.com', 'secreta');
    });

    expect(outcome).toBe(true);
  });

  it('marca pending mientras el intento esta en vuelo y lo apaga al terminar', async () => {
    let release: (() => void) | undefined;
    const { port, emit } = fakePort({
      signIn: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    act(() => {
      void result.current.signIn('ana@example.com', 'secreta');
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      release?.();
    });

    expect(result.current.pending).toBe(false);
  });

  it('un fallo se traduce a texto para la persona y apaga pending', async () => {
    const { port, emit } = fakePort({
      signIn: vi.fn(async () => {
        throw Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), {
          code: 'auth/invalid-credential',
        });
      }),
    });
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    await act(async () => {
      await result.current.signIn('ana@example.com', 'mala');
    });

    expect(result.current.error).toBe('Correo o contraseña incorrectos.');
    expect(result.current.pending).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('signIn no propaga el rechazo: el error vive en el estado, no en la pila', async () => {
    const { port, emit } = fakePort({
      signIn: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    await act(async () => {
      // #100, D9: un fallo NUNCA lanza -- resuelve `false`, y el texto vive en
      // `error`, que es lo que la pantalla puede mostrar.
      await expect(result.current.signIn('ana@example.com', 'mala')).resolves.toBe(false);
    });

    expect(result.current.error).toBe('No se pudo iniciar sesión.');
  });

  it('un intento nuevo limpia el error del anterior antes de empezar', async () => {
    const signIn = vi
      .fn<AuthPort['signIn']>()
      .mockRejectedValueOnce(
        Object.assign(new Error('nope'), { code: 'auth/invalid-credential' }),
      )
      .mockResolvedValueOnce(undefined);
    const { port, emit } = fakePort({ signIn });
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(null));

    await act(async () => {
      await result.current.signIn('ana@example.com', 'mala');
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.signIn('ana@example.com', 'buena');
    });

    expect(result.current.error).toBeNull();
  });

  it('signOut delega en el puerto', async () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));
    act(() => emit(ANA));

    await act(async () => {
      await result.current.signOut();
    });

    expect(port.signOut).toHaveBeenCalledTimes(1);
  });

  it('se desuscribe al desmontar', () => {
    const { port, unsubscribe } = fakePort();
    const { unmount } = renderHook(() => useAuth(port));

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('un aviso tardio tras el desmontaje no escribe estado', () => {
    const { port, emit } = fakePort();
    const { unmount } = renderHook(() => useAuth(port));

    unmount();

    // El SDK puede avisar despues de que React haya soltado el arbol; sin la
    // guarda, React avisa de una actualizacion sobre un componente muerto.
    expect(() => act(() => emit(ANA))).not.toThrow();
  });
});

describe('useAuth: renovacion del token', () => {
  it('REGRESION: un aviso con la misma identidad conserva la referencia del usuario', async () => {
    // `onIdTokenChanged` avisa tambien cuando el SDK RENUEVA el token, mas o
    // menos cada hora, y ese aviso trae los mismos datos en un objeto nuevo.
    // Si el hook lo guardase tal cual, la referencia cambiaria, `AuthGate`
    // rehacia la sesion y `GameCanvas` destruia y recreaba Phaser entero: el
    // avatar volveria al punto de partida y el audio se cortaria, a alguien que
    // solo estaba trabajando.
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));

    act(() => emit(ANA));
    const primero = result.current.user;
    act(() => emit({ ...ANA }));

    expect(result.current.user).toBe(primero);
  });

  it('un aviso con datos distintos si cambia el usuario', async () => {
    // La otra mitad del contrato: conservar la referencia no puede convertirse
    // en ignorar un cambio real, como el de alguien que rellena su perfil.
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));

    act(() => emit(ANA));
    act(() => emit({ ...ANA, displayName: 'Ana Gomez' }));

    expect(result.current.user?.displayName).toBe('Ana Gomez');
  });

  it('cerrar sesion despues de un aviso repetido si vacia el usuario', async () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useAuth(port));

    act(() => emit(ANA));
    act(() => emit({ ...ANA }));
    act(() => emit(null));

    expect(result.current.user).toBeNull();
  });
});

