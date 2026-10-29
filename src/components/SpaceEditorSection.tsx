import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { MIN_ROOM_SIDE } from '../game/layoutGeometry';
import type { OfficeBridge } from '../game/officeBridge';
import { defaultRoomCapacity } from '../game/roomCapacity';
import { DEFAULT_ROOM_NAME, freeRoomName, nextRoomName } from '../game/roomNames';
import { useEscapeStep } from '../hooks/useEscapeStep';
import { useSpaceEditor, type SpaceCreateInput } from '../hooks/useSpaceEditor';
import { LayoutItemList } from './LayoutItemList';
import { MultipleToggle } from './MultipleToggle';
import styles from './SpaceEditorSection.module.css';

/**
 * Seccion de administracion de salas dentro del sidebar (#74, PR4). Mismo
 * patron que `DeskEditorSection` (D3, contenedor): es quien llama a
 * `useSpaceEditor` y quien tiene estado propio (los campos del formulario);
 * `OfficeLayoutEditor` solo la monta junto a `DeskEditorSection`.
 *
 * A diferencia de un escritorio (tamano fijo 3x3), una sala pide su propio
 * ancho/alto y aforo en el formulario. No floor choice: a room shows the
 * painted terrain under it (#182). The form starts complete: the first free
 * "Sala N" and a default capacity, so placing a room takes one click.
 *
 * Embedded in "Editar espacios" it mirrors the desks: the default view is the
 * creation form behind an "Editar salas" button, which swaps it for the room
 * list (one row per room, `LayoutItemList`) until "Volver" or Escape.
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
  /**
   * Embedded, reports when the room list takes the panel or gives it back, so
   * the section around it hides the desks meanwhile, like the desk list hides
   * the rooms.
   */
  onListViewChange?: (listing: boolean) => void;
  onExit?: () => void;
  /** Se llama ANTES de `editor.enter()` (#74, PR4 correction): ver `DeskEditorSection.onRequestActive`. */
  onRequestActive?: () => void;
}

interface CreateFormValues {
  /**
   * `null` until typed: the field shows the first free "Sala N" of the room
   * list, worked out at render so it follows the list as it (re)loads, a room
   * just created included.
   */
  name: string | null;
  w: string;
  h: string;
  /** `null` until typed: the field shows `capacityDefault` and follows the size. */
  capacity: string | null;
  /** The default of the last valid size, so a side being retyped never drops it. */
  capacityDefault: number;
}

// A whole office block by default (#184): 9x9 is what snaps to the block grid.
const DEFAULT_SIDE = 9;
const EMPTY_FORM: CreateFormValues = {
  name: null,
  w: String(DEFAULT_SIDE),
  h: String(DEFAULT_SIDE),
  capacity: null,
  capacityDefault: defaultRoomCapacity(DEFAULT_SIDE, DEFAULT_SIDE),
};

function toForm(input: SpaceCreateInput): CreateFormValues {
  const capacityDefault = defaultRoomCapacity(input.w, input.h);
  const capacity = input.capacity === null || input.capacity === capacityDefault ? null : String(input.capacity);
  return { name: input.name, w: String(input.w), h: String(input.h), capacity, capacityDefault };
}

/**
 * A new side: an untouched capacity follows the new default. A typed one is
 * the admin's and stays as typed, never clamped: the default is no limit.
 */
function withSide(form: CreateFormValues, side: 'w' | 'h', raw: string): CreateFormValues {
  const next = { ...form, [side]: raw };
  const w = toSize(next.w);
  const h = toSize(next.h);
  if (w === null || h === null) return next;
  return { ...next, capacityDefault: defaultRoomCapacity(w, h) };
}

function toSize(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_ROOM_SIDE) return null;
  return value;
}

/** `null` for an empty, fractional or non-positive capacity: this form always sends one. */
function toCapacity(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CAPACITY) return null;
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
  onListViewChange,
  onExit,
  onRequestActive,
}: SpaceEditorSectionProps) {
  const editor = useSpaceEditor({ bridge, spaces, desks, refreshDesks, refreshSpaces });
  const [form, setForm] = useState<CreateFormValues>(EMPTY_FORM);
  /** Embedded only: the room list ("Editar salas") instead of the default view's form. */
  const [listing, setListing] = useState(false);
  const listViewChangeRef = useRef(onListViewChange);
  listViewChangeRef.current = onListViewChange;
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

  // The list lives only while the editor is on: leaving it drops the list too.
  const listShown = embedded && listing && active;
  useEffect(() => {
    listViewChangeRef.current?.(listShown);
  }, [listShown]);
  // An unmounted list must not keep the desks hidden around it.
  useEffect(() => () => listViewChangeRef.current?.(false), []);
  useEffect(() => {
    if (!active) setListing(false);
  }, [active]);

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
        const next = editor.error === null ? { ...input, name: freeRoomName(nextRoomName(input.name), takenNames()) } : input;
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

  /** Room names are unique (`space-name-taken`): what the form offers skips the ones the list holds. */
  function takenNames(): string[] {
    return editor.spaces.map((space) => space.name);
  }

  // Escape: a selection or a placement is the hook's to release; with none held
  // the editor leaves like "Salir". Embedded, the room list goes back to the
  // default view first, then the section around it owns the exit, so the press
  // goes to it and this view stays as it is.
  useEscapeStep(active, () => {
    if (editor.state.tag !== 'idle') return false;
    if (listShown) {
      setListing(false);
      return true;
    }
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
    // Embedded, the entry button is the list's, like "Editar escritorios".
    if (embedded) setListing(true);
  }

  /** "Volver": drops whatever the list view holds and gives the panel back to the default view. */
  function handleBack(): void {
    editor.cancelPlacing();
    editor.deselect();
    setListing(false);
  }

  if (!active) {
    return (
      <div className={styles.section}>
        {embedded && <h3 className={styles.title}>Salas</h3>}
        <button type="button" className={embedded ? styles.button : styles.enter} onClick={handleEnter}>
          Editar salas
        </button>
      </div>
    );
  }

  const state = editor.state;
  const placing = state.tag === 'placing';
  const busy = editor.state.tag === 'saving' || editor.pending;

  const name = form.name ?? freeRoomName(DEFAULT_ROOM_NAME, takenNames());
  const capacityText = form.capacity ?? String(form.capacityDefault);
  const w = toSize(form.w);
  const h = toSize(form.h);
  const capacity = toCapacity(capacityText);
  const canCreate = name.trim() !== '' && w !== null && h !== null && capacity !== null;

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !canCreate || w === null || h === null || capacity === null) return;
    const input = { name: name.trim(), w, h, capacity };
    createInputRef.current = input;
    editor.startCreate(input);
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Salas</h3>
        {embedded ? (
          // The section around it owns "Salir"; the list only goes back to the default view.
          listShown && (
            <button type="button" className={styles.exit} onClick={handleBack}>
              Volver
            </button>
          )
        ) : (
          <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
            Salir
          </button>
        )}
      </div>

      {/* A room picked on the map leaves the panel as it is: its move and trash are the buttons under it on the map. */}
      {!placing && (
        <>
          {embedded && !listShown && (
            <button type="button" className={styles.button} disabled={busy} onClick={() => setListing(true)}>
              Editar salas
            </button>
          )}

          {(!embedded || listShown) && (
            // One line per room, like the desk list: each button acts on its own row.
            <LayoutItemList
              items={editor.spaces.map((space) => ({ id: space.id, name: space.name }))}
              busy={busy}
              onMove={(id) => editor.startMove(id)}
              onRemove={(id) => void editor.remove(id)}
            />
          )}

          {!listShown && (
            <form className={styles.form} onSubmit={handleCreateSubmit}>
              <span className={styles.hint}>{`Mínimo ${MIN_ROOM_SIDE} × ${MIN_ROOM_SIDE}`}</span>
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
                  value={name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>

              <div className={styles.fieldRow}>
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
                    onChange={(event) => { const raw = event.target.value; setForm((current) => withSide(current, 'w', raw)); }}
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
                    onChange={(event) => { const raw = event.target.value; setForm((current) => withSide(current, 'h', raw)); }}
                  />
                </div>
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
                  required
                  disabled={busy}
                  value={capacityText}
                  onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))}
                />
              </div>

              <MultipleToggle checked={multiple} onChange={setMultiple} disabled={busy} />

              <button type="submit" className={styles.button} disabled={busy || !canCreate}>
                Colocar nueva sala
              </button>
            </form>
          )}
        </>
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
