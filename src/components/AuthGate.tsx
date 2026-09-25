import { useMemo, type ReactNode } from 'react';
import type { AuthPort, OfficeSession } from '../auth/authPort';
import { useAuth } from '../hooks/useAuth';
import { usePasswordReset } from '../hooks/usePasswordReset';
import { LoginScreen } from './LoginScreen';

export type { OfficeSession };

export interface AuthGateProps {
  /** `null` = autenticacion apagada (`resolveAuthConfig` devolvio `null`). */
  auth: AuthPort | null;
  /** Recibe `null` cuando no hay autenticacion; la oficina se monta igual. */
  children: (session: OfficeSession | null) => ReactNode;
}

/**
 * Decide que hay entre quien llega y la oficina (#8). Es el unico componente
 * que conoce el puerto de autenticacion: `LoginScreen` recibe props planas y
 * la oficina recibe una sesion, no el puerto (D3).
 *
 * Tres estados y ninguno de mas:
 * - sin puerto: la oficina, con sesion `null`. Desarrollo local y suite e2e.
 * - sin saber todavia: nada. Ver `ready` en `useAuth`: ensenar el login en ese
 *   hueco lo haria parpadear en cada recarga de quien ya entro.
 * - listo: la oficina si hay usuario, la pantalla de acceso si no.
 */
export function AuthGate({ auth, children }: AuthGateProps) {
  const { user, ready, pending, error, signIn } = useAuth(auth);
  const reset = usePasswordReset(auth);

  /**
   * La identidad de la sesion importa tanto como su contenido: `GameCanvas`
   * recrea Phaser entero cuando cambia la de sus props, asi que una sesion
   * nueva por render tiraria el juego en cada render.
   *
   * `getIdToken` delega SIEMPRE en el puerto en vez de llevar un token
   * copiado: el token caduca cada hora, y una copia dejaria de valer sin que
   * nada avisase.
   */
  const session = useMemo<OfficeSession | null>(() => {
    if (auth === null || user === null) return null;
    return {
      displayName: user.displayName,
      getIdToken: () => auth.getIdToken(),
      signOut: () => auth.signOut(),
    };
  }, [auth, user]);

  if (auth === null) return <>{children(null)}</>;
  if (!ready) return null;
  if (session === null) {
    return (
      <LoginScreen
        onSubmit={signIn}
        pending={pending}
        error={error}
        passwordReset={{
          onSend: (email) => void reset.sendReset(email),
          onClear: reset.clear,
          pending: reset.pending,
          sent: reset.sent,
          error: reset.error,
        }}
      />
    );
  }

  return <>{children(session)}</>;
}
