/**
 * Maquina de estados del lado del RECEPTOR de una invitacion de llamada
 * (issue #2, D12). Vive en su propio hook, no dentro de `useOfficeBridge`:
 * `useOfficeBridge` es deliberadamente un simple suscriptor evento->estado
 * (ver su propio comentario), y esta pila necesita temporizadores por tarjeta,
 * un sonido y emision de comandos -- un subsistema entero, mismo patron que
 * `useProximityAudio`, probado con `renderHook`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCallChime } from '../game/callChime';
import type { OfficeBridge } from '../game/officeBridge';

/**
 * Duracion del aviso visual/sonoro de una invitacion recien llegada (D11):
 * mismo shape que `TOAST_TIMEOUT_MS` en `OfficeShell.tsx`, por eso es
 * comprobable con temporizadores falsos.
 */
export const CALL_ALERT_MS = 4000;

export interface CallInvitationCard {
  /** sessionId del llamador; tambien la clave de React (unico por D5: el
   * registro del servidor deduplica por llamador, nunca hay dos con el mismo
   * `from`). */
  from: string;
  name: string;
  /** true durante los primeros CALL_ALERT_MS tras la llegada. */
  alerting: boolean;
  /** false = tombstone (D7, decision humana #305.5): el llamador se
   * desconecto: solo queda descartar la tarjeta, no se puede ir con el. */
  callerPresent: boolean;
}

export interface UseCallInvitationsResult {
  /** Orden de llegada: la mas nueva al final (decision humana #305.2, se
   * apilan a la derecha, la segunda abajo de la primera). */
  invitations: readonly CallInvitationCard[];
  accept(from: string): void;
  dismiss(from: string): void;
}

export function useCallInvitations(bridge: OfficeBridge): UseCallInvitationsResult {
  const [invitations, setInvitations] = useState<readonly CallInvitationCard[]>([]);
  // Un chime por hook, no por tarjeta: es un efecto de sonido puntual, no
  // estado por invitacion (D11).
  const chimeRef = useRef(createCallChime());
  // Un temporizador de aviso POR llamador pendiente -- a diferencia del toast
  // unico de `OfficeShell`, aqui puede haber varias tarjetas "alerting" a la
  // vez y cada una se apaga por su cuenta.
  const alertTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function clearAlertTimer(from: string): void {
    const timer = alertTimers.current.get(from);
    if (timer === undefined) return;
    clearTimeout(timer);
    alertTimers.current.delete(from);
  }

  useEffect(() => {
    // Se lee la MISMA instancia del ref en la limpieza: el mapa se muta en
    // el sitio, nunca se reemplaza, asi que esto barre cualquier temporizador
    // vivo sin importar cuando se creo.
    const timers = alertTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(
    () =>
      bridge.on('callinvite', ({ from, name }) => {
        setInvitations((current) => [
          ...current,
          { from, name, alerting: true, callerPresent: true },
        ]);

        const timer = setTimeout(() => {
          alertTimers.current.delete(from);
          setInvitations((current) =>
            current.map((invite) => (invite.from === from ? { ...invite, alerting: false } : invite)),
          );
        }, CALL_ALERT_MS);
        alertTimers.current.set(from, timer);
      }),
    [bridge],
  );

  useEffect(
    () =>
      bridge.on('callerleft', ({ from }) => {
        setInvitations((current) =>
          current.map((invite) => (invite.from === from ? { ...invite, callerPresent: false } : invite)),
        );
      }),
    [bridge],
  );

  const accept = useCallback(
    (from: string) => {
      clearAlertTimer(from);
      bridge.emitCommand('respondCall', { from, accept: true });
      chimeRef.current.play();
      setInvitations((current) => current.filter((invite) => invite.from !== from));
    },
    [bridge],
  );

  const dismiss = useCallback(
    (from: string) => {
      // D7: dismiss sobre un tombstone TAMBIEN emite `respondCall` -- una
      // sola regla, el `has()` del servidor la vuelve un no-op inofensivo, la
      // misma que ya rechaza una respuesta forjada o tardia.
      clearAlertTimer(from);
      bridge.emitCommand('respondCall', { from, accept: false });
      setInvitations((current) => current.filter((invite) => invite.from !== from));
    },
    [bridge],
  );

  return { invitations, accept, dismiss };
}
