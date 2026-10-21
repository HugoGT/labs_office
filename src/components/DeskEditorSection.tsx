import { useEffect, useRef, useState } from 'react';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { useEscapeStep } from '../hooks/useEscapeStep';
import { useLayoutEditor } from '../hooks/useLayoutEditor';
import styles from './DeskEditorSection.module.css';
import { LayoutItemList } from './LayoutItemList';
import { MultipleToggle } from './MultipleToggle';

/**
 * How the list names a desk: its own label when an older one has it, else
 * whose it is when claimed, else where it is (the only way to tell free ones
 * apart). A desk is created empty (Editar espacios), with no label asked.
 */
export function deskName(desk: AdminDesk): string {
  if (desk.label !== '') return desk.label;
  const where = `(${desk.x}, ${desk.y})`;
  const owner = desk.occupant?.displayName;
  if (desk.occupant === null) return `Escritorio libre ${where}`;
  return owner ? `Escritorio de ${owner}` : `Escritorio ocupado ${where}`;
}

/**
 * Seccion de administracion de escritorios dentro del sidebar (#74, PR3c).
 * Contenedor (D3, mismo patron que `DesksPanel`): es quien llama a
 * `useLayoutEditor` y quien tiene estado propio (la etiqueta del formulario);
 * `OfficeSidebar` solo la monta detras de la guarda de rol.
 *
 * La colocacion en si (el ghost tile-encajado) vive en el mapa
 * (`LayoutEditLayer`, PR3b): esta seccion solo ofrece los controles -- entrar,
 * elegir/crear, mover, borrar, salir -- y muestra el error del servidor
 * cuando lo hay. El clic que confirma la posicion llega por el bridge
 * (`layoutplace`), no por nada de aqui.
 */

export interface DeskEditorSectionProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  /** Solo para el pre-chequeo del ghost (#74, PR4 addition): una sala tambien cuenta como obstaculo. Ver `useLayoutEditor.ts`. */
  spaces: SpacesAdminPort;
  /** Releidos tras cada mutacion con exito, para que la escena converja (paired-space sync). */
  refreshDesks: () => void;
  refreshSpaces: () => void;
  /** Avisa de cada cambio off<->activo (#74, PR3c: exclusividad con `DeskDecorEditor`). */
  onEditingChange?: (editing: boolean) => void;
  /** Flanco a `true` fuerza salir del modo edicion, mismo patron que `OfficeSidebar.forceCollapsed`. */
  forceExit?: boolean;
  /** A chosen sidebar submenu opens directly; standalone consumers keep the entry button. */
  initiallyActive?: boolean;
  /**
   * Inside "Editar espacios", at the level of the rooms: two buttons, the list
   * (the one submenu) and "Crear escritorio", which places a desk without going
   * through the list. The section around it owns "Salir", so this part only
   * offers "Volver".
   */
  embedded?: boolean;
  /**
   * Renders nothing while the desk editor is off: "Editar salas" holds the
   * panel. The section stays mounted, so its off hook never re-emits a null
   * `layoutedit` over the rooms' overlay and its state survives.
   */
  concealed?: boolean;
  onExit?: () => void;
  /**
   * Se llama ANTES de `editor.enter()` (#74, PR4 correction: exclusividad
   * con `SpaceEditorSection`). `OfficeLayoutEditor` lo usa para sacar a la
   * otra seccion -- envuelto en `flushSync` de su lado, para que ese `exit`
   * quede resuelto del todo antes de que este `enter()` se dispare.
   */
  onRequestActive?: () => void;
}

export function DeskEditorSection({
  bridge,
  desks,
  spaces,
  refreshDesks,
  refreshSpaces,
  onEditingChange,
  forceExit = false,
  initiallyActive = false,
  embedded = false,
  concealed = false,
  onExit,
  onRequestActive,
}: DeskEditorSectionProps) {
  const editor = useLayoutEditor({ bridge, desks, spaces, refreshDesks, refreshSpaces });
  /** A desk being placed straight from the default view of "Editar espacios", with no list in between. */
  const [creating, setCreating] = useState(false);
  /** Why the server refused that desk, kept for the default view the section goes back to. */
  const [createError, setCreateError] = useState<string | null>(null);
  /**
   * "Múltiple" (#207): a desk placed, created or refused, starts placing the
   * next one instead of going back, until Escape, "Cancelar" or "Salir".
   */
  const [multiple, setMultiple] = useState(false);
  /** Why the server refused the previous desk of a "Múltiple" run: the next placement clears the hook's error. */
  const [runError, setRunError] = useState<string | null>(null);
  /** Where a create placement is: `saving` once its click was sent, so its end tells a placement from a cancel. */
  const createPhaseRef = useRef<'none' | 'placing' | 'saving'>('none');

  const active = editor.state.tag !== 'off';

  useEffect(() => {
    if (initiallyActive) editor.enter();
    // Initialization only: later forceExit must not reopen the editor.
  }, []);

  useEffect(() => {
    onEditingChange?.(active);
    // Solo se reporta el cambio, no se recuerda `onEditingChange` entre
    // renders: quien lo pasa (`OfficeShell`, a traves de `OfficeSidebar`) ya
    // lo mantiene estable con `useCallback`, mismo criterio que el resto de
    // los enganches de este archivo.
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
    const placed = createPhaseRef.current === 'saving';
    createPhaseRef.current = 'none';
    if (state.tag === 'idle' && placed && multiple) {
      // Created or refused, the run goes on: only that desk is dropped.
      setRunError(editor.error);
      editor.startCreate();
      return;
    }
    setRunError(null);
    if (!creating) return;
    if (state.tag === 'off') {
      setCreating(false);
    } else if (state.tag === 'idle') {
      // The placement ended, created, cancelled or refused: back to the default view.
      setCreating(false);
      setCreateError(editor.error);
      editor.exit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, editor.state, editor.error]);

  // Escape: a selection or a placement is the hook's to release; with none held
  // it leaves, a level at a time (the terrain editor's rule): the list goes back
  // to the default view, a standalone editor exits like "Salir".
  useEscapeStep(active, () => {
    if (editor.state.tag !== 'idle') return false;
    editor.exit();
    if (!embedded) onExit?.();
    return true;
  });

  function handleEnter(): void {
    setCreateError(null);
    onRequestActive?.();
    editor.enter();
  }

  function handleCreate(): void {
    setCreateError(null);
    onRequestActive?.();
    editor.enter();
    editor.startCreate();
    setCreating(true);
  }

  if (!active) {
    if (concealed) return null;
    if (!embedded) {
      return (
        <div className={styles.section}>
          <button type="button" className={styles.enter} onClick={handleEnter}>
            Editar escritorios
          </button>
        </div>
      );
    }
    // Two full-width buttons at the level of "Salas": the list is the only submenu.
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>Escritorios</h3>
        <button type="button" className={styles.button} onClick={handleEnter}>
          Editar escritorios
        </button>
        <button type="button" className={styles.button} onClick={handleCreate}>
          Crear escritorio
        </button>
        <MultipleToggle checked={multiple} onChange={setMultiple} />
        {createError !== null && (
          <div className={styles.error} role="alert">
            {createError}
          </div>
        )}
      </div>
    );
  }

  const state = editor.state;
  const selected =
    state.tag === 'selected' ? editor.desks.find((desk) => desk.id === state.id) ?? null : null;
  const placing = state.tag === 'placing';
  const busy = editor.state.tag === 'saving' || editor.pending;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Escritorios</h3>
        {embedded ? (
          // The section around it owns "Salir"; this one only goes back to its
          // default view, and has nothing to go back from while a desk is placed.
          !creating && (
            <button type="button" className={styles.exit} onClick={editor.exit}>
              Volver
            </button>
          )
        ) : (
          <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
            Salir
          </button>
        )}
      </div>

      {selected === null && !placing && !creating && (
        <>
          {/* One line per desk: no selection step, each button acts on its own row. */}
          <LayoutItemList
            items={editor.desks.map((desk) => ({ id: desk.id, name: deskName(desk) }))}
            busy={busy}
            onMove={(id) => editor.startMove(id)}
            onRemove={(id) => void editor.remove(id)}
          />

          {/* Nothing to ask: a desk is created empty, and its occupant decorates it from "Mi espacio". */}
          {!embedded && (
            <>
              <button type="button" className={styles.button} disabled={busy} onClick={editor.startCreate}>
                Crear escritorio
              </button>
              <MultipleToggle checked={multiple} onChange={setMultiple} />
            </>
          )}
        </>
      )}

      {selected !== null && !placing && (
        <div className={styles.row}>
          <span className={styles.name} title={deskName(selected)}>{deskName(selected)}</span>
          <div className={styles.rowActions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => editor.startMove()}>
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
      {/* Reachable during a run, to end it after the next desk; the list view offers its own. */}
      {(creating || (state.tag === 'placing' && state.mode === 'create')) && <MultipleToggle checked={multiple} onChange={setMultiple} />}

      {(editor.error ?? runError) !== null && (
        <div className={styles.error} role="alert">
          {editor.error ?? runError}
        </div>
      )}
    </div>
  );
}
