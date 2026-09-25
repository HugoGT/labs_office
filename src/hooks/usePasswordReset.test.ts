import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthPort } from '../auth/authPort';
import { usePasswordReset } from './usePasswordReset';

function fakePort(sendPasswordReset: AuthPort['sendPasswordReset']): AuthPort {
  return {
    onChange: vi.fn(() => vi.fn()),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getIdToken: vi.fn(async () => null),
    sendPasswordReset: vi.fn(sendPasswordReset),
  };
}

function firebaseError(code: string): unknown {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { code });
}

describe('usePasswordReset (#94)', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => usePasswordReset(fakePort(async () => undefined)));

    expect(result.current).toMatchObject({ pending: false, sent: false, error: null });
  });

  it('asks the port with the trimmed email and reports it as sent', async () => {
    const port = fakePort(async () => undefined);
    const { result } = renderHook(() => usePasswordReset(port));

    await act(() => result.current.sendReset('  ana@example.com  '));

    expect(port.sendPasswordReset).toHaveBeenCalledWith('ana@example.com');
    expect(result.current).toMatchObject({ pending: false, sent: true, error: null });
  });

  it('REGRESSION: an unknown account looks exactly like a sent email', async () => {
    const known = renderHook(() => usePasswordReset(fakePort(async () => undefined)));
    const unknown = renderHook(() =>
      usePasswordReset(
        fakePort(async () => {
          throw firebaseError('auth/user-not-found');
        }),
      ),
    );

    await act(() => known.result.current.sendReset('ana@example.com'));
    await act(() => unknown.result.current.sendReset('nadie@example.com'));

    expect(unknown.result.current.sent).toBe(known.result.current.sent);
    expect(unknown.result.current.error).toBe(known.result.current.error);
  });

  it('shows the translated error for failures the person can act on', async () => {
    const { result } = renderHook(() =>
      usePasswordReset(
        fakePort(async () => {
          throw firebaseError('auth/too-many-requests');
        }),
      ),
    );

    await act(() => result.current.sendReset('ana@example.com'));

    expect(result.current.sent).toBe(false);
    expect(result.current.error).toMatch(/demasiados intentos/i);
  });

  it('is pending while the request is in flight', async () => {
    let finish: () => void = () => {};
    const { result } = renderHook(() =>
      usePasswordReset(fakePort(() => new Promise<void>((resolve) => (finish = resolve)))),
    );

    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = result.current.sendReset('ana@example.com');
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      finish();
      await sending;
    });
    expect(result.current.pending).toBe(false);
  });

  it('clear() goes back to idle so the form can be used again', async () => {
    const { result } = renderHook(() => usePasswordReset(fakePort(async () => undefined)));
    await act(() => result.current.sendReset('ana@example.com'));

    act(() => result.current.clear());

    expect(result.current).toMatchObject({ pending: false, sent: false, error: null });
  });

  it('without a port (auth off) does nothing', async () => {
    const { result } = renderHook(() => usePasswordReset(null));

    await act(() => result.current.sendReset('ana@example.com'));

    expect(result.current).toMatchObject({ pending: false, sent: false, error: null });
  });
});
