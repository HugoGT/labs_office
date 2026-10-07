import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../auth/authPort';
import type { AccessDeniedReason } from '../game/officeProtocol';
import type {
  CharacterCatalog,
  CharacterOption,
  CharacterPort,
  ReadCharacterResult,
  SaveCharacterResult,
} from '../auth/characterPort';

/**
 * Where the entrance stands on the character (art migration, step 5):
 * `pending` while the name is not resolved yet or the choice is being read,
 * `choosing` while the selector is shown, and `resolved` once the office may
 * open. `resolved` carries no id on purpose: the office draws the character
 * the server replicates, never one this hook remembers.
 */
export type CharacterFlow =
  | { phase: 'pending' }
  | { phase: 'choosing'; options: readonly CharacterOption[]; initialId: string }
  | { phase: 'resolved' };

export interface UseCharacterChoiceResult {
  flow: CharacterFlow;
  /** Spanish copy of the last rejected save; `null` while there is none. */
  error: string | null;
  saving: boolean;
  choose: (avatarId: string) => Promise<void>;
}

const PENDING: CharacterFlow = { phase: 'pending' };
const RESOLVED: CharacterFlow = { phase: 'resolved' };

/**
 * The one rule of the entrance, pure so its cases are tested one by one.
 *
 * - Never chose (`chosen: false`, which every account from before the
 *   migration is): ask.
 * - A fresh sign-in: ask again, with the saved character preselected.
 * - A restored session (page refresh) that already chose: let in.
 * - Explicit access denial: stay pending; the entrance signs out and explains.
 * - Anything that cannot be read (no directory, a failed read, no catalog):
 *   let in with what the server has. Choosing a look is never a reason to
 *   lock someone out of the office, and the marker stays NULL, so they are
 *   asked on their next access.
 */
export function decideCharacterStep(
  read: ReadCharacterResult,
  catalog: CharacterCatalog | null,
  freshSignIn: boolean,
): CharacterFlow {
  if (read.outcome === 'denied') return PENDING;
  if (read.outcome !== 'ok' || catalog === null) return RESOLVED;
  if (read.chosen && !freshSignIn) return RESOLVED;
  const offered = catalog.options.some((option) => option.id === read.avatarId);
  return { phase: 'choosing', options: catalog.options, initialId: offered ? read.avatarId : catalog.defaultId };
}

function describeSaveRejection(result: SaveCharacterResult): string {
  if (result.outcome !== 'invalid') return 'No se pudo guardar tu personaje. Inténtalo de nuevo.';
  return result.reason === 'retired-piece'
    ? 'Ese personaje ya no está disponible. Elige otro.'
    : 'Ese personaje no existe. Elige otro.';
}

/**
 * Owner of the character step of the entrance, after `useDisplayName`.
 * `AuthGate` injects the user, whether the name is resolved and whether this
 * is a fresh sign-in, and consumes `flow`/`error`/`saving`/`choose`.
 *
 * Without a port (no server, no auth, or the `/dashboard` route) the step does
 * not exist and the flow is `resolved` from the first render, so nothing in
 * front of the dashboard or a local office changes.
 */
export function useCharacterChoice(
  port: CharacterPort | null,
  user: AuthUser | null,
  nameResolved: boolean,
  freshSignIn: boolean,
  onAccessDenied?: (reason: AccessDeniedReason) => Promise<void>,
): UseCharacterChoiceResult {
  const [flow, setFlow] = useState<CharacterFlow>(PENDING);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const aliveRef = useRef(true);
  const saveGenerationRef = useRef(0);
  /** Read inside the effect, so a later render cannot change what was decided for this sign-in. */
  const freshRef = useRef(freshSignIn);
  freshRef.current = freshSignIn;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // A refusal belongs to the login that sent it, never a later session.
  useEffect(() => {
    setSaving(false);
    return () => { saveGenerationRef.current += 1; };
  }, [user, port]);

  useEffect(() => {
    if (port === null) return;
    if (user === null) {
      setFlow(PENDING);
      setError(null);
      return;
    }
    if (!nameResolved) return;

    let cancelled = false;
    void Promise.all([port.read(), port.catalog()]).then(([read, catalog]) => {
      if (cancelled || !aliveRef.current) return;
      if (read.outcome === 'denied') {
        setFlow(PENDING);
        void onAccessDenied?.(read.reason);
        return;
      }
      if (read.outcome === 'unavailable') {
        console.warn('[auth] personaje no guardado: no hay directorio o catalogo configurado');
      }
      setFlow(decideCharacterStep(read, catalog, freshRef.current));
    });
    return () => {
      cancelled = true;
    };
  }, [port, user, nameResolved, onAccessDenied]);

  const choose = useCallback(
    async (avatarId: string): Promise<void> => {
      if (port === null) return;
      const generation = saveGenerationRef.current;
      if (aliveRef.current) {
        setSaving(true);
        setError(null);
      }
      try {
        const result = await port.save(avatarId);
        if (!aliveRef.current || generation !== saveGenerationRef.current) return;
        if (result.outcome === 'denied') {
          setFlow(PENDING);
          await onAccessDenied?.(result.reason);
          return;
        }
        if (result.outcome === 'ok' || result.outcome === 'unavailable') {
          setFlow(RESOLVED);
          return;
        }
        setError(describeSaveRejection(result));
      } finally {
        if (aliveRef.current && generation === saveGenerationRef.current) setSaving(false);
      }
    },
    [port, onAccessDenied],
  );

  return { flow: port === null ? RESOLVED : flow, error, saving, choose };
}
