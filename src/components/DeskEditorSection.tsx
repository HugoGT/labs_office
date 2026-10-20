import { useEffect } from 'react';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { useLayoutEditor } from '../hooks/useLayoutEditor';
import styles from './DeskEditorSection.module.css';

/**
 * How the list names a desk: its own label when an older one has it, else
 * where it is and, when claimed, whose it is. A desk is created empty
 * (Editar espacios), with no label asked.
 */
export function deskName(desk: AdminDesk): string {
  if (desk.label !== '') return desk.label;
  const where = `(${desk.x}, ${desk.y})`;
  const owner = desk.occupant?.displayName;
  if (desk.occupant === null) return `Escritorio libre ${where}`;
  return owner ? `Escritorio de ${owner} ${where}` : `Escritorio ocupado ${where}`;
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
   * Inside "Editar espacios", next to the rooms: the section around it owns
   * the exit, so this part shows none of its own.
   */
  embedded?: boolean;
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
  onExit,
  onRequestActive,
}: DeskEditorSectionProps) {
  const editor = useLayoutEditor({ bridge, desks, spaces, refreshDesks, refreshSpaces });

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

  function handleEnter(): void {
    onRequestActive?.();
    editor.enter();
  }

  if (!active) {
    return (
      <div className={styles.section}>
        {embedded && <h3 className={styles.title}>Escritorios</h3>}
        <button type="button" className={styles.enter} onClick={handleEnter}>
          Editar escritorios
        </button>
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
        {!embedded && (
          <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
            Salir
          </button>
        )}
      </div>

      {selected === null && !placing && (
        <>
          <ul className={styles.list}>
            {editor.desks.map((desk) => (
              <li key={desk.id} className={styles.row}>
                <span>{deskName(desk)}</span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => editor.select(desk.id)}
                >
                  {`Seleccionar ${deskName(desk)}`}
                </button>
              </li>
            ))}
          </ul>

          {/* Nothing to ask: a desk is created empty, and its occupant decorates it from "Mi espacio". */}
          <button type="button" className={styles.button} disabled={busy} onClick={editor.startCreate}>
            Crear escritorio
          </button>
        </>
      )}

      {selected !== null && !placing && (
        <div className={styles.row}>
          <span>{deskName(selected)}</span>
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
