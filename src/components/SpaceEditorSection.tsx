import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { defaultChoice } from '../game/artMaterials';
import type { ArtAppearance } from '../game/artPack';
import type { ArtPreviewCache } from '../game/artPreview';
import type { OfficeBridge } from '../game/officeBridge';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { useSpaceEditor } from '../hooks/useSpaceEditor';
import { ArtMaterialPicker } from './ArtMaterialPicker';
import styles from './SpaceEditorSection.module.css';

/**
 * Seccion de administracion de salas dentro del sidebar (#74, PR4). Mismo
 * patron que `DeskEditorSection` (D3, contenedor): es quien llama a
 * `useSpaceEditor` y quien tiene estado propio (los campos del formulario);
 * `OfficeLayoutEditor` solo la monta junto a `DeskEditorSection`.
 *
 * A diferencia de un escritorio (tamano fijo 3x3), una sala pide su propio
 * ancho/alto -- y opcionalmente aforo -- en el formulario, mismo criterio que
 * `SpaceForm` en `/dashboard`.
 */

const MIN_SIZE = 1;

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
  onExit?: () => void;
  /** Se llama ANTES de `editor.enter()` (#74, PR4 correction): ver `DeskEditorSection.onRequestActive`. */
  onRequestActive?: () => void;
  /** Where the material list comes from (art step 7); the page's pack manifest by default. */
  loadMaterials?: LoadMaterials;
  /** The preview generator; the page-wide cache by default. */
  preview?: ArtPreviewCache;
}

interface CreateFormValues {
  name: string;
  w: string;
  h: string;
  /** Cadena vacia = sin limite; se manda `null` de todas formas, nunca se omite -- mismo criterio que `SpaceForm`. */
  capacity: string;
}

const EMPTY_FORM: CreateFormValues = { name: '', w: '', h: '', capacity: '' };

function toSize(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_SIZE) return null;
  return value;
}

/** `undefined` marca "invalido"; `null` es el valor real de "sin limite" -- mismo criterio que `SpacesPanel.toCapacity`. */
function toCapacity(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_SIZE) return undefined;
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
  onExit,
  onRequestActive,
  loadMaterials,
  preview,
}: SpaceEditorSectionProps) {
  const editor = useSpaceEditor({ bridge, spaces, desks, refreshDesks, refreshSpaces });
  const [form, setForm] = useState<CreateFormValues>(EMPTY_FORM);
  const catalog = useMaterialCatalog(loadMaterials);
  /** `null` until the person picks something: the form then shows the pack default floor. */
  const [floor, setFloor] = useState<ArtAppearance | null>(null);
  const wasCreatingRef = useRef(false);

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
    if (editor.state.tag === 'placing' && editor.state.mode === 'create') {
      wasCreatingRef.current = true;
      return;
    }
    // Mismo criterio que `DeskEditorSection`: el formulario solo se limpia en
    // EXITO -- en fallo, "no se borra en silencio" es justo lo que pide la
    // spec, para no tener que volver a escribirlo tras un `space-name-taken`.
    if (editor.state.tag === 'idle' && wasCreatingRef.current) {
      wasCreatingRef.current = false;
      if (editor.error === null) {
        setForm(EMPTY_FORM);
        setFloor(null);
      }
    }
  }, [editor.state, editor.error]);

  function handleEnter(): void {
    onRequestActive?.();
    editor.enter();
  }

  if (!active) {
    return (
      <div className={styles.section}>
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
  // Same rule as `DeskEditorSection`: no catalog, no choice, the pack default floor.
  const chosenFloor = floor ?? (catalog === null ? null : defaultChoice(catalog, 'floor'));

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !canCreate || w === null || h === null) return;
    const capacity = toCapacity(form.capacity);
    if (capacity === undefined) return;
    editor.startCreate({ name: form.name.trim(), w, h, capacity, ...(chosenFloor === null ? {} : { floor: chosenFloor }) });
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Salas</h3>
        <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
          Salir
        </button>
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
            <span className={styles.hint}>Una oficina ocupa un bloque de 9 × 9 casillas (288 × 288 px). Con ese tamaño, la sala se alinea al bloque que toques. Construye primero su terreno desde Terreno.</span>
            <button type="button" className={styles.button} disabled={busy} onClick={() => setForm((current) => ({ ...current, w: '9', h: '9' }))}>Usar un bloque de oficina (9 × 9)</button>
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
                min={MIN_SIZE}
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
                min={MIN_SIZE}
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
                min={MIN_SIZE}
                step={1}
                disabled={busy}
                value={form.capacity}
                onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))}
              />
            </div>

            {catalog !== null && chosenFloor !== null && (
              <ArtMaterialPicker
                id="new-space-floor"
                legend="Suelo de la sala"
                options={catalog.floor}
                value={chosenFloor}
                onChange={setFloor}
                disabled={busy}
                preview={preview}
              />
            )}

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

      {editor.error !== null && (
        <div className={styles.error} role="alert">
          {editor.error}
        </div>
      )}
    </div>
  );
}
