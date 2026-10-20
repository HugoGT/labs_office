import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterCatalog, CharacterChoice, CharacterPort, ReadCharacterResult } from '../auth/characterPort';
import { describeSaveRejection, initialChoice } from '../hooks/useCharacterChoice';
import { CharacterCreator } from './CharacterCreator';
import styles from './MyCharacterSection.module.css';

export interface MyCharacterSectionProps {
  /** The same port as the entrance (`createCharacterClient`), with this session's token. */
  character: CharacterPort;
  /** Back to the "Personalizar" menu, without saving. */
  onClose: () => void;
}

type SectionState =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'editing'; catalog: CharacterCatalog; initial: CharacterChoice }
  | { phase: 'saved' };

function editingState(read: ReadCharacterResult, catalog: CharacterCatalog | null): SectionState {
  if (read.outcome !== 'ok' || catalog === null) return { phase: 'unavailable' };
  return { phase: 'editing', catalog, initial: initialChoice(read, catalog) };
}

/**
 * "Mi personaje" in "Personalizar": the entrance's creator again, prefilled
 * with the saved character and saved through the same port. Container: it
 * reads and saves, `CharacterCreator` only draws. The creator opens as a
 * dialog over the office (portaled to `body`, so the sidebar's stacking
 * context never clips it); once saved the server puts the new character on
 * every live session of the account (`CharacterUpdates`), so the office
 * redraws it for everyone without reconnecting and there is nothing to
 * refresh here.
 */
export function MyCharacterSection({ character, onClose }: MyCharacterSectionProps) {
  const [state, setState] = useState<SectionState>({ phase: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    void Promise.all([character.read(), character.catalog()]).then(([read, catalog]) => {
      if (!cancelled) setState(editingState(read, catalog));
    });
    return () => {
      cancelled = true;
    };
  }, [character]);

  useEffect(() => load(), [load]);

  const save = async (choice: CharacterChoice): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const result = await character.save(choice);
      if (result.outcome === 'ok') setState({ phase: 'saved' });
      else setError(describeSaveRejection(result));
    } finally {
      setSaving(false);
    }
  };

  if (state.phase === 'loading') return <p className={styles.note}>Cargando tu personaje…</p>;
  if (state.phase === 'unavailable') {
    return <p className={styles.note}>No se pudo cargar tu personaje. Inténtalo de nuevo más tarde.</p>;
  }
  if (state.phase === 'saved') {
    return (
      <div className={styles.section}>
        <p className={styles.note} role="status">Personaje guardado. Ya te ven así en la oficina.</p>
        <button type="button" className={styles.action} onClick={() => load()}>
          Editar de nuevo
        </button>
      </div>
    );
  }
  return createPortal(
    <CharacterCreator
      heading="Mi personaje"
      description="Cambia tu personaje cuando quieras: todos lo verán al momento."
      options={state.catalog.options}
      initial={state.initial}
      pending={saving}
      error={error}
      submitLabel="Guardar personaje"
      onSubmit={(choice) => void save(choice)}
      onCancel={onClose}
    />,
    document.body,
  );
}
