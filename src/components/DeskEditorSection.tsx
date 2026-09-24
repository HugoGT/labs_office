import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { useLayoutEditor } from '../hooks/useLayoutEditor';
import styles from './DeskEditorSection.module.css';

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
  onRequestActive,
}: DeskEditorSectionProps) {
  const editor = useLayoutEditor({ bridge, desks, spaces, refreshDesks, refreshSpaces });
  const [label, setLabel] = useState('');
  const wasCreatingRef = useRef(false);

  const active = editor.state.tag !== 'off';

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
    if (editor.state.tag === 'placing' && editor.state.mode === 'create') {
      wasCreatingRef.current = true;
      return;
    }
    // Colocacion de creacion resuelta (exito o fallo): solo se limpia el
    // campo en EXITO -- en fallo, "no se borra en silencio" es justo lo que
    // pide la spec, para que quien administra no tenga que volver a
    // escribirla tras un `desk-overlap`.
    if (editor.state.tag === 'idle' && wasCreatingRef.current) {
      wasCreatingRef.current = false;
      if (editor.error === null) setLabel('');
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

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === '' || busy) return;
    editor.startCreate(trimmed);
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Escritorios</h3>
        <button type="button" className={styles.exit} onClick={editor.exit}>
          Salir
        </button>
      </div>

      {selected === null && !placing && (
        <>
          <ul className={styles.list}>
            {editor.desks.map((desk) => (
              <li key={desk.id} className={styles.row}>
                <span>{desk.label}</span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => editor.select(desk.id)}
                >
                  {`Seleccionar ${desk.label}`}
                </button>
              </li>
            ))}
          </ul>

          <form className={styles.form} onSubmit={handleCreateSubmit}>
            <label className={styles.hint} htmlFor="new-desk-label">
              Etiqueta del nuevo escritorio
            </label>
            <input
              id="new-desk-label"
              className={styles.input}
              type="text"
              autoComplete="off"
              required
              disabled={busy}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <button type="submit" className={styles.button} disabled={busy || label.trim() === ''}>
              Colocar nuevo escritorio
            </button>
          </form>
        </>
      )}

      {selected !== null && !placing && (
        <div className={styles.row}>
          <span>{selected.label}</span>
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
