import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { AuthPort, OfficeSession } from '../auth/authPort';
import type { DisplayNamePort } from '../auth/displayNamePort';
import { useAuth } from '../hooks/useAuth';
import { useDisplayName } from '../hooks/useDisplayName';
import { usePasswordReset } from '../hooks/usePasswordReset';
import { LoginScreen } from './LoginScreen';

export type { OfficeSession };

export interface AuthGateProps {
  /** `null` = autenticacion apagada (`resolveAuthConfig` devolvio `null`). */
  auth: AuthPort | null;
  /**
   * Cliente del nombre visible auto-elegido (#100). `null`/ausente cuando no
   * hay servidor o no hay directorio configurado (D7): el nombre escrito se
   * ignora y se entra con el derivado, exactamente igual que una respuesta
   * 503. Ya resuelto por `App.tsx`, igual que `auth`.
   */
  displayName?: DisplayNamePort | null;
  /** Prellena "Nombre" con el ultimo elegido con exito en este dispositivo (D8). */
  initialName?: string;
  /** Se llama con el nombre YA canonicalizado tras un reclamo con exito, para que `App.tsx` lo recuerde (D8). */
  onNameClaimed?: (name: string) => void;
  /** Recibe `null` cuando no hay autenticacion; la oficina se monta igual. */
  children: (session: OfficeSession | null) => ReactNode;
}

/**
 * Decide que hay entre quien llega y la oficina (#8, #100). Es el unico
 * componente que conoce el puerto de autenticacion; el nombre visible es
 * entero responsabilidad de `useDisplayName` (D2/D6/D7/D9) -- este componente
 * solo lo inyecta con `user`/`signOut` y consume `flow`/`error`/`claiming`/
 * `submit` (container-presentational). `LoginScreen` recibe props planas y la
 * oficina recibe una sesion, no los puertos.
 *
 * ## La invariante de una sola rama (D2)
 *
 * "Sesion de oficina si y solo si el nombre esta resuelto." No hay un estado
 * intermedio donde se vean los dos a la vez, ni uno donde la oficina aparezca
 * un instante para un nombre que luego se rechaza: `children(session)` SOLO
 * se llama cuando `user !== null` Y `useDisplayName` ya resolvio el nombre.
 * Un rechazo (taken/invalid/failed) nunca llega a resolver: el hook cierra la
 * sesion por su cuenta, con lo que la unica rama que puede pintarse es la del
 * formulario.
 */
export function AuthGate({
  auth,
  displayName: displayNamePort = null,
  initialName,
  onNameClaimed,
  children,
}: AuthGateProps) {
  const { user, ready, pending, error, signIn } = useAuth(auth);
  const reset = usePasswordReset(auth);
  const signOutQuietly = useCallback(() => auth?.signOut() ?? Promise.resolve(), [auth]);
  const { flow, error: claimError, claiming, submit } = useDisplayName(displayNamePort, user, signOutQuietly);

  /**
   * `true` en cuanto `LoginScreen` se pinto una vez desde este montaje. Sin
   * esto, la ventana entre un envio y su rechazo (`user` ya en firme, `flow`
   * todavia `pending`) desmontaria `LoginScreen` -- se pintaria `null` un
   * instante -- y al volver a `user === null` React crearia una instancia
   * NUEVA, perdiendo nombre/correo/contrasena ya escritos (D2).
   */
  const everShowedLoginRef = useRef(false);
  useEffect(() => {
    if (user === null) everShowedLoginRef.current = true;
  }, [user]);

  const handleSubmit = useCallback(
    async (name: string, email: string, password: string): Promise<void> => {
      const result = await submit(() => signIn(email, password), name);
      if (result?.outcome === 'ok') onNameClaimed?.(result.displayName);
    },
    [submit, signIn, onNameClaimed],
  );

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
    if (auth === null || user === null || flow.phase !== 'resolved') return null;
    return {
      // El nombre del directorio manda; sin el (D7/D8 sin directorio, D6
      // fail-open) cae al ya derivado que trae `user.displayName`.
      displayName: flow.displayName ?? user.displayName,
      getIdToken: () => auth.getIdToken(),
      signOut: () => auth.signOut(),
    };
  }, [auth, user, flow]);

  if (auth === null) return <>{children(null)}</>;
  if (!ready) return null;

  if (user !== null && flow.phase === 'resolved') {
    return <>{children(session)}</>;
  }

  if (user !== null && !everShowedLoginRef.current) {
    // Restauracion genuina, todavia sin pintar el formulario ni una vez: el
    // mismo hueco silencioso que `!ready` de arriba, y por la misma razon --
    // parpadear el login para una sesion que ya existia molesta mas de lo que
    // informa.
    return null;
  }

  // O no hay sesion, o hay un reclamo en vuelo/rechazado sobre un formulario
  // que YA se pinto: la misma instancia de `LoginScreen` sigue en pie, con lo
  // que nombre/correo/contrasena escritos no se pierden (D2).
  return (
    <LoginScreen
      onSubmit={(name, email, password) => void handleSubmit(name, email, password)}
      pending={pending || claiming}
      error={claimError ?? error}
      initialName={initialName}
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
