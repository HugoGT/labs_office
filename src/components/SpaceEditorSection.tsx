import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { MIN_ROOM_SIDE } from '../game/layoutGeometry';
import type { OfficeBridge } from '../game/officeBridge';
import { roomCapacityMax } from '../game/roomCapacity';
import { DEFAULT_ROOM_NAME, freeRoomName, nextRoomName } from '../game/roomNames';
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
 * ancho/alto y aforo en el formulario. No floor choice: a room shows the
 * painted terrain under it (#182). The form starts complete: the first free
 * "Sala N" and the largest capacity, so placing a room takes one click.
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
  /**
   * `null` until typed: the field shows the first free "Sala N" of the room
   * list, worked out at render so it follows the list as it (re)loads, a room
   * just created included.
   */
  name: string | null;
  w: string;
  h: string;
  /** `null` until typed: the field shows `capacityMax` and follows the size. */
  capacity: string | null;
  /** The limit of the last valid size, so a side being retyped never drops it. */
  capacityMax: number;
}

// A whole office block by default (#184): 9x9 is what snaps to the block grid.
const DEFAULT_SIDE = 9;
const EMPTY_FORM: CreateFormValues = {
  name: null,
  w: String(DEFAULT_SIDE),
  h: String(DEFAULT_SIDE),
  capacity: null,
  capacityMax: roomCapacityMax(DEFAULT_SIDE, DEFAULT_SIDE),
};

function toForm(input: SpaceCreateInput): CreateFormValues {
  const capacityMax = roomCapacityMax(input.w, input.h);
  const capacity = input.capacity === null || input.capacity === capacityMax ? null : String(input.capacity);
  return { name: input.name, w: String(input.w), h: String(input.h), capacity, capacityMax };
}

/** A new side: an untouched capacity follows the new maximum, a typed one only shrinks to it. */
function withSide(form: CreateFormValues, side: 'w' | 'h', raw: string): CreateFormValues {
  const next = { ...form, [side]: raw };
  const w = toSize(next.w);
  const h = toSize(next.h);
  if (w === null || h === null) return next;
  const capacityMax = roomCapacityMax(w, h);
  const typed = next.capacity === null ? NaN : Number(next.capacity);
  const capacity = next.capacity !== null && next.capacity.trim() !== '' && typed > capacityMax ? String(capacityMax) : next.capacity;
  return { ...next, capacity, capacityMax };
}

function toSize(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_ROOM_SIDE) return null;
  return value;
}

/** `null` for an empty, fractional or out of range capacity: this form always sends one. */
function toCapacity(raw: string, max: number): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CAPACITY || value > max) return null;
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

  const name = form.name ?? freeRoomName(DEFAULT_ROOM_NAME, takenNames());
  const capacityText = form.capacity ?? String(form.capacityMax);
  const w = toSize(form.w);
  const h = toSize(form.h);
  const capacity = toCapacity(capacityText, form.capacityMax);
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
                max={form.capacityMax}
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
