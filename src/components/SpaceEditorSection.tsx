import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { MIN_ROOM_SIDE } from '../game/layoutGeometry';
import type { OfficeBridge } from '../game/officeBridge';
import { nextRoomName } from '../game/roomNames';
import { useEscapeStep } from '../hooks/useEscapeStep';
import { useSpaceEditor, type SpaceCreateInput } from '../hooks/useSpaceEditor';
import { MultipleToggle } from './MultipleToggle';
import styles from './SpaceEditorSection.module.css';

/**
 * Seccion de administracion de salas dentro del sidebar (#74, PR4). Mismo
 * patron que `DeskEditorSection` (D3, contenedor): es quien llama a
 * `useSpaceEditor` y quien tiene estado propio (los campos del formulario);
 * `OfficeLayoutEditor` solo la monta junto a `DeskEditorSection`.
 *
 * A diferencia de un escritorio (tamano fijo 3x3), una sala pide su propio
 * ancho/alto -- y opcionalmente aforo -- en el formulario, mismo criterio que
 * `SpaceForm` en `/dashboard`. No floor choice: a room shows the painted
 * terrain under it (#182).
 */

const MIN_CAPACITY = 1;

export interface SpaceEditorSectionProps {
  bridge: OfficeBridge;
  spaces: SpacesAdminPort;
  /** Solo para el pre-chequeo del ghost (#74, PR4 addition): ver `useSpaceEditor.ts`. */
  desks: DeskAdminPort;
  /** Releidos tras cada mutacion con exito, para que la escena converja (paired-space sync). */
  refreshDesks: () => void;
  refreshSpaces: () => void;
  /** Avisa de cada cambio off<->activo (misma exclusividad con `DeskDecorEditor` que `DeskEditorSection`). */
  onEditingChange?: (editing: boolean) => void;
  /** Flanco a `true` fuerza salir del modo edicion, mismo patron que `DeskEditorSection.forceExit`. */
  forceExit?: boolean;
  /** A chosen sidebar submenu opens directly; standalone consumers keep the entry button. */
  initiallyActive?: boolean;
  /** Inside "Editar espacios", after the desks: the section around it owns the exit. */
  embedded?: boolean;
  onExit?: () => void;
  /** Se llama ANTES de `editor.enter()` (#74, PR4 correction): ver `DeskEditorSection.onRequestActive`. */
  onRequestActive?: () => void;
}

interface CreateFormValues {
  name: string;
  w: string;
  h: string;
  /** Cadena vacia = sin limite; se manda `null` de todas formas, nunca se omite -- mismo criterio que `SpaceForm`. */
  capacity: string;
}

// A whole office block by default (#184): 9x9 is what snaps to the block grid.
const EMPTY_FORM: CreateFormValues = { name: '', w: '9', h: '9', capacity: '' };

function toForm(input: SpaceCreateInput): CreateFormValues {
  return { name: input.name, w: String(input.w), h: String(input.h), capacity: input.capacity === null ? '' : String(input.capacity) };
}

function toSize(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_ROOM_SIDE) return null;
  return value;
}

/** `undefined` marca "invalido"; `null` es el valor real de "sin limite" -- mismo criterio que `SpacesPanel.toCapacity`. */
function toCapacity(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CAPACITY) return undefined;
  return value;
}

export function SpaceEditorSection({
  bridge,
  spaces,
  desks,
  refreshDesks,
  refreshSpaces,
  onEditingChange,
  forceExit = false,
  initiallyActive = false,
  embedded = false,
  onExit,
  onRequestActive,
}: SpaceEditorSectionProps) {
  const editor = useSpaceEditor({ bridge, spaces, desks, refreshDesks, refreshSpaces });
  const [form, setForm] = useState<CreateFormValues>(EMPTY_FORM);
  /**
   * "Múltiple" (#207): a room placed starts placing the next one, with the
   * same size and capacity and the next free name, until Escape or "Cancelar".
   */
  const [multiple, setMultiple] = useState(false);
  /** Why the server refused the previous room of a "Múltiple" run: starting the next placement clears the hook's error. */
  const [runError, setRunError] = useState<string | null>(null);
  /** Where a create placement is: `saving` once its click was sent, so its end tells a placement from a cancel. */
  const createPhaseRef = useRef<'none' | 'placing' | 'saving'>('none');
  /** What the create placement in progress places. */
  const createInputRef = useRef<SpaceCreateInput | null>(null);

  const active = editor.state.tag !== 'off';

  useEffect(() => {
    if (initiallyActive) editor.enter();
    // Initialization only: later forceExit must not reopen the editor.
  }, []);

  useEffect(() => {
    onEditingChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (forceExit) editor.exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExit]);

  useEffect(() => {
    const state = editor.state;
    if (state.tag === 'placing') {
      createPhaseRef.current = state.mode === 'create' ? 'placing' : 'none';
      return;
    }
    if (state.tag === 'saving') {
      if (createPhaseRef.current === 'placing') createPhaseRef.current = 'saving';
      setRunError(null);
      return;
    }
    const phase = createPhaseRef.current;
    createPhaseRef.current = 'none';
    if (state.tag !== 'idle' || phase === 'none') {
      setRunError(null);
      return;
    }
    const input = createInputRef.current;
    if (multiple && input !== null) {
      if (phase === 'saving') {
        // Created: the next room. Refused: the same one again, somewhere else; only that placement is dropped.
        const next = editor.error === null ? { ...input, name: freeNextName(input.name) } : input;
        createInputRef.current = next;
        setRunError(editor.error);
        setForm(toForm(next));
        editor.startCreate(next);
        return;
      }
      // Cancelled mid-run: the form keeps what was about to be placed.
      setRunError(null);
      setForm(toForm(input));
      return;
    }
    // Mismo criterio que `DeskEditorSection`: el formulario solo se limpia en
    // EXITO -- en fallo, "no se borra en silencio" es justo lo que pide la
    // spec, para no tener que volver a escribirlo tras un `space-name-taken`.
    setRunError(null);
    if (editor.error === null) setForm(EMPTY_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.state, editor.error]);

  /** The next name of a run that no room in the list has yet (names are unique, `space-name-taken`). */
  function freeNextName(name: string): string {
    const taken = new Set(editor.spaces.map((space) => space.name.trim().toLowerCase()));
    let next = nextRoomName(name);
    for (let tries = 0; tries <= taken.size && taken.has(next.toLowerCase()); tries++) next = nextRoomName(next);
    return next;
  }

  // Escape: a selection or a placement is the hook's to release; with none held
  // the editor leaves like "Salir". Embedded, the section around it owns the
  // exit, so the press goes to it and this view stays as it is.
  useEscapeStep(active, () => {
    if (editor.state.tag !== 'idle') return false;
    if (embedded) {
      if (onExit === undefined) return false;
      onExit();
      return true;
    }
    editor.exit();
    onExit?.();
    return true;
  });

  function handleEnter(): void {
    onRequestActive?.();
    editor.enter();
  }

  if (!active) {
    return (
      <div className={styles.section}>
        {embedded && <h3 className={styles.title}>Salas</h3>}
        <button type="button" className={styles.enter} onClick={handleEnter}>
          Editar salas
        </button>
      </div>
    );
  }

  const state = editor.state;
  const selected =
    state.tag === 'selected' ? editor.spaces.find((space) => space.id === state.id) ?? null : null;
  const placing = state.tag === 'placing';
  const busy = editor.state.tag === 'saving' || editor.pending;

  const w = toSize(form.w);
  const h = toSize(form.h);
  const canCreate = form.name.trim() !== '' && w !== null && h !== null;

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !canCreate || w === null || h === null) return;
    const capacity = toCapacity(form.capacity);
    if (capacity === undefined) return;
    const input = { name: form.name.trim(), w, h, capacity };
    createInputRef.current = input;
    editor.startCreate(input);
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Salas</h3>
        {!embedded && (
          <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
            Salir
          </button>
        )}
      </div>

      {selected === null && !placing && (
        <>
          <ul className={styles.list}>
            {editor.spaces.map((space) => (
              <li key={space.id} className={styles.row}>
                <span>{space.name}</span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => editor.select(space.id)}
                >
                  {`Seleccionar ${space.name}`}
                </button>
              </li>
            ))}
          </ul>

          <form className={styles.form} onSubmit={handleCreateSubmit}>
            <span className={styles.hint}>{`Una sala mide al menos ${MIN_ROOM_SIDE} × ${MIN_ROOM_SIDE} casillas. Con 9 × 9, un bloque de oficina, se alinea al bloque que toques. Construye primero su terreno desde Terreno.`}</span>
            <div className={styles.field}>
              <label className={styles.hint} htmlFor="new-space-name">
                Nombre de la nueva sala
              </label>
              <input
                id="new-space-name"
                className={styles.input}
                type="text"
                autoComplete="off"
                required
                disabled={busy}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.hint} htmlFor="new-space-w">
                Ancho
              </label>
              <input
                id="new-space-w"
                className={`${styles.input} ${styles.dimInput}`}
                type="number"
                min={MIN_ROOM_SIDE}
                step={1}
                required
                disabled={busy}
                value={form.w}
                onChange={(event) => setForm((current) => ({ ...current, w: event.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.hint} htmlFor="new-space-h">
                Alto
              </label>
              <input
                id="new-space-h"
                className={`${styles.input} ${styles.dimInput}`}
                type="number"
                min={MIN_ROOM_SIDE}
                step={1}
                required
                disabled={busy}
                value={form.h}
                onChange={(event) => setForm((current) => ({ ...current, h: event.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.hint} htmlFor="new-space-capacity">
                Aforo
              </label>
              <input
                id="new-space-capacity"
                className={`${styles.input} ${styles.dimInput}`}
                type="number"
                min={MIN_CAPACITY}
                step={1}
                disabled={busy}
                value={form.capacity}
                onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))}
              />
            </div>

            <MultipleToggle checked={multiple} onChange={setMultiple} disabled={busy} />

            <button type="submit" className={styles.button} disabled={busy || !canCreate}>
              Colocar nueva sala
            </button>
          </form>
        </>
      )}

      {selected !== null && !placing && (
        <div className={styles.row}>
          <span>{selected.name}</span>
          <div className={styles.rowActions}>
            <button type="button" className={styles.button} disabled={busy} onClick={editor.startMove}>
              Mover
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => void editor.remove()}
            >
              Eliminar
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={editor.deselect}>
              Deseleccionar
            </button>
          </div>
        </div>
      )}

      {placing && (
        <div className={styles.row}>
          <span className={styles.hint}>Toca el nuevo sitio en el mapa para confirmarlo.</span>
          <button type="button" className={styles.button} disabled={busy} onClick={editor.cancelPlacing}>
            Cancelar
          </button>
        </div>
      )}
      {/* Reachable during a run, to end it after the next room. */}
      {state.tag === 'placing' && state.mode === 'create' && <MultipleToggle checked={multiple} onChange={setMultiple} />}

      {(editor.error ?? runError) !== null && (
        <div className={styles.error} role="alert">
          {editor.error ?? runError}
        </div>
      )}
    </div>
  );
}
