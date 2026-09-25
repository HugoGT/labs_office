import { useCallback, useEffect, useRef, useState } from 'react';
import { describePasswordResetError } from '../auth/authErrors';
import type { AuthPort } from '../auth/authPort';

export interface PasswordResetState {
  /** `true` while the request is in flight. */
  pending: boolean;
  /**
   * `true` once the neutral confirmation should show. Also `true` when the
   * provider said the account does not exist: see `describePasswordResetError`.
   */
  sent: boolean;
  /** Already translated for the person; never the raw provider error. */
  error: string | null;
  sendReset: (email: string) => Promise<void>;
  /** Back to idle, e.g. when the person returns to the sign-in form. */
  clear: () => void;
}

/**
 * "Forgot your password" over the auth port (#94). Separate from `useAuth`
 * because it has nothing to do with the session: it neither reads nor
 * changes who is signed in. Injected port, so it is tested without Firebase.
 *
 * `auth === null` (auth off) makes `sendReset` inert, same as `useAuth`.
 */
export function usePasswordReset(auth: AuthPort | null): PasswordResetState {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cuts state writes that arrive after unmount. */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const sendReset = useCallback(
    async (email: string): Promise<void> => {
      if (auth === null) return;

      setError(null);
      setSent(false);
      setPending(true);
      try {
        await auth.sendPasswordReset(email.trim());
        if (aliveRef.current) setSent(true);
      } catch (cause) {
        const message = describePasswordResetError(cause);
        if (!aliveRef.current) return;
        // `null` is a failure that must look like success (no enumeration).
        if (message === null) setSent(true);
        else setError(message);
      } finally {
        if (aliveRef.current) setPending(false);
      }
    },
    [auth],
  );

  const clear = useCallback(() => {
    setPending(false);
    setSent(false);
    setError(null);
  }, []);

  return { pending, sent, error, sendReset, clear };
}
