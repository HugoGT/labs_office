import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../auth/authPort';
import type { ClaimDisplayNameResult, DisplayNamePort } from '../auth/displayNamePort';

/**
 * Lo que la sesion sabe sobre su propio nombre visible, una vez resuelto:
 * `pending` mientras se restaura, se reclama, o el reclamo se rechazo (un
 * rechazo NUNCA llega a `resolved`, se queda en `pending` para siempre y
 * `error` trae el motivo, D2); y despues el nombre confirmado por el servidor
 * o `null` si no hay nada que confirmar (D6 restauracion fallida -- fail-open;
 * D7 sin directorio).
 */
export type DisplayNameFlow = { phase: 'pending' } | { phase: 'resolved'; displayName: string | null };

export interface UseDisplayNameResult {
  flow: DisplayNameFlow;
  /** Copia fija en espanol del ultimo rechazo (D2); `null` mientras no hay ninguno. */
  error: string | null;
  /** `true` mientras un `submit` esta en vuelo (incluye el `signIn` que recibe). */
  claiming: boolean;
  /** Encadena `signIn` con el reclamo del nombre; `null` si `signIn` fallo (AuthGate ya lo ensena traducido). */
  submit: (signIn: () => Promise<boolean>, name: string) => Promise<ClaimDisplayNameResult | null>;
}

const PENDING: DisplayNameFlow = { phase: 'pending' };

/** Copia fija de los tres rechazos posibles (D2); nunca el codigo crudo del servidor. */
function describeClaimRejection(outcome: 'taken' | 'invalid' | 'failed'): string {
  switch (outcome) {
    case 'taken':
      return 'Ese nombre ya está en uso. Elige otro.';
    case 'invalid':
      return 'Escribe un nombre de hasta 24 caracteres.';
    case 'failed':
      return 'No se pudo guardar tu nombre. Inténtalo de nuevo.';
  }
}

/**
 * Unico dueno de la maquina de estados del nombre visible auto-elegido (#100,
 * D2/D6/D7/D9). `AuthGate` solo inyecta `user` (de `useAuth`) y `signOut`, y
 * consume `flow`/`error`/`claiming`/`submit`: nunca toca un `DisplayNamePort`
 * por su cuenta (container-presentational).
 *
 * ## Reclamo (claim) vs. restauracion (restore)
 *
 * Un envio de formulario RECLAMA (POST) a traves de `submit`: un rechazo
 * cierra la sesion (D2). Una sesion que ya existia al cargar la pagina -- o
 * que `onChange` restaura sin pasar por el formulario -- solo LEE (GET), sin
 * cerrar sesion por lo que lea: un fallo de red o un directorio ausente caen
 * al nombre derivado (fail-open, D6/D7), porque el motivo de leer es
 * puramente informativo.
 *
 * `inFlightRef` es lo que distingue las dos: mientras un `submit` esta en
 * vuelo (incluido el `signIn` que recibe), el efecto de restauracion se
 * aparta para no pisar un reclamo que esta a punto de resolverse o
 * rechazarse.
 */
export function useDisplayName(
  port: DisplayNamePort | null,
  user: AuthUser | null,
  signOut: () => Promise<void>,
): UseDisplayNameResult {
  const [flow, setFlow] = useState<DisplayNameFlow>(PENDING);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const inFlightRef = useRef(false);
  /** Corta las escrituras de estado que llegan tras el desmontaje. */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Restauracion (D6): la cuenta ya tenia sesion -- recarga, o el primer
  // aviso de `onChange` -- y nunca paso por el formulario. Solo lee; cualquier
  // cosa que no sea un nombre confirmado cae al derivado, sin cerrar sesion.
  useEffect(() => {
    // Un `submit` en vuelo manda sobre cualquier otra cosa: ni resetea a
    // `pending` por `user === null` ni relee, este a punto de resolverse o de
    // rechazarse (D2/D9). El propio `submit` deja `flow`/`error` como
    // corresponda al terminar.
    if (inFlightRef.current) return;

    if (user === null) {
      setFlow(PENDING);
      return;
    }
    // Ya resuelto -- por un `submit` que ya termino, o por una restauracion
    // anterior para esta MISMA cuenta -- no hay nada que releer.
    if (flow.phase === 'resolved') return;

    if (port === null) {
      setFlow({ phase: 'resolved', displayName: null });
      return;
    }

    let cancelled = false;
    void port.read().then((result) => {
      if (cancelled || !aliveRef.current) return;
      setFlow({
        phase: 'resolved',
        displayName: result.outcome === 'ok' ? result.displayName : null,
      });
    });
    return () => {
      cancelled = true;
    };
    // `flow.phase` NO es dependencia a proposito: solo `user`/`port` deben
    // volver a disparar este efecto. Incluirla reprogramaria una relectura
    // justo cuando un `submit` paralelo termina de resolver `flow`, y esa
    // relectura tardia podria pisar el nombre recien reclamado con el que
    // trae el GET (D2/D9).
  }, [user, port]);

  const submit = useCallback(
    async (signIn: () => Promise<boolean>, name: string): Promise<ClaimDisplayNameResult | null> => {
      inFlightRef.current = true;
      if (aliveRef.current) setError(null);
      if (aliveRef.current) setClaiming(true);
      try {
        const signedIn = await signIn();
        // Fallo de credenciales: quien llama ya trae el texto traducido, y el
        // formulario ni se toca -- sigue siendo el mismo componente.
        if (!signedIn) return null;

        if (port === null) {
          // D7: sin directorio (o sin servidor), el nombre escrito no se
          // puede reclamar ni comprobar. Se avisa por consola -- nadie de
          // fuera lo lee -- y se entra con el derivado.
          console.warn('[auth] nombre visible ignorado: no hay directorio configurado');
          if (aliveRef.current) setFlow({ phase: 'resolved', displayName: null });
          return { outcome: 'unavailable' };
        }

        const result = await port.claim(name);

        if (result.outcome === 'ok') {
          if (aliveRef.current) setFlow({ phase: 'resolved', displayName: result.displayName });
          return result;
        }

        if (result.outcome === 'unavailable') {
          console.warn('[auth] nombre visible ignorado: no hay directorio configurado');
          if (aliveRef.current) setFlow({ phase: 'resolved', displayName: null });
          return result;
        }

        // taken | invalid | failed (D2): error visible, sesion cerrada, y
        // `flow` se queda en `pending` para siempre -- quien consume este hook
        // nunca desmonta su formulario por esto, solo cambia el `error`.
        if (aliveRef.current) setError(describeClaimRejection(result.outcome));
        await signOut();
        return result;
      } finally {
        inFlightRef.current = false;
        if (aliveRef.current) setClaiming(false);
      }
    },
    [port, signOut],
  );

  return { flow, error, claiming, submit };
}
