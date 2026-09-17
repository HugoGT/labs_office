import { useCallback, useEffect, useRef, useState } from 'react';
import { describeAuthError } from '../auth/authErrors';
import type { AuthPort, AuthUser } from '../auth/authPort';

export interface AuthState {
  user: AuthUser | null;
  /**
   * `false` hasta el PRIMER aviso del puerto. No es lo mismo que "no hay
   * usuario": el SDK restaura la sesion desde IndexedDB de forma asincrona,
   * asi que quien ya entro sigue sin usuario durante unos milisegundos.
   * Tratar ese hueco como "no autenticado" le ensenaria la pantalla de login
   * en cada recarga, para quitarsela de golpe un instante despues.
   */
  ready: boolean;
  /** `true` mientras un intento de acceso esta en vuelo. */
  pending: boolean;
  /** Ya traducido a texto para la persona; el error crudo no sale de aqui. */
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Compara por valor los tres campos que componen `AuthUser`. No es un
 * `deepEqual` generico a proposito: si el puerto crece, esta funcion tiene que
 * crecer con el, y un fallo al hacerlo se ve aqui y no en un remontaje raro de
 * Phaser una hora despues.
 */
function isSameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.uid === b.uid && a.email === b.email && a.displayName === b.displayName;
}

/**
 * Estado de sesion sobre el puerto de autenticacion (#8). El puerto se inyecta
 * igual que `connect` y `fetchToken` en `useProximityAudio`, asi que este hook
 * se prueba entero sin montar firebase.
 *
 * `auth === null` significa autenticacion apagada (`resolveAuthConfig`
 * devolvio `null`): listo desde el primer render, sin usuario y con `signIn` /
 * `signOut` inertes. Es el camino del desarrollo local y de la suite e2e, y
 * tiene que costar exactamente lo que costaba antes de existir el login.
 */
export function useAuth(auth: AuthPort | null): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(auth === null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Corta las escrituras de estado que llegan tras el desmontaje. */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    if (auth === null) {
      setReady(true);
      setUser(null);
      return () => {
        aliveRef.current = false;
      };
    }

    setReady(false);
    const unsubscribe = auth.onChange((next) => {
      if (!aliveRef.current) return;
      // Se conserva el objeto anterior cuando los datos no han cambiado, en vez
      // de guardar el que acaba de llegar. `onIdTokenChanged` avisa tambien al
      // RENOVAR el token, mas o menos cada hora, y esos avisos traen una
      // identidad identica en un objeto nuevo. Guardarlo tal cual propagaria una
      // referencia distinta hasta la sesion de `AuthGate`, y de ahi a las
      // dependencias del efecto de `GameCanvas`: Phaser se destruiria y se
      // volveria a crear cada hora, tirando la posicion del avatar y la conexion
      // de LiveKit de quien solo estaba trabajando.
      setUser((current) => (isSameUser(current, next) ? current : next));
      setReady(true);
    });

    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (auth === null) return;

      setError(null);
      setPending(true);
      try {
        await auth.signIn(email, password);
      } catch (cause) {
        // No se relanza: el fallo de credenciales es parte normal del flujo,
        // no una excepcion que alguien arriba deba manejar. Vive en el estado,
        // que es donde la pantalla puede mostrarlo.
        if (aliveRef.current) setError(describeAuthError(cause));
      } finally {
        if (aliveRef.current) setPending(false);
      }
      // El usuario NO se asigna aqui: llega por `onChange`, que es la unica
      // fuente de verdad de la sesion. Dos escritores discreparian en cuanto
      // el token caducase.
    },
    [auth],
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (auth === null) return;
    await auth.signOut();
  }, [auth]);

  return { user, ready, pending, error, signIn, signOut };
}
