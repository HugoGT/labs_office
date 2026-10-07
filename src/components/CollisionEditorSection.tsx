import { useEffect } from 'react';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import { COLLISION_SNAPS, type CollisionSnap } from '../game/collisionEditor';
import type { OfficeBridge } from '../game/officeBridge';
import { MAX_COLLISION_RECTS } from '../game/pieceCollisions';
import { useCollisionEditor, type RectField } from '../hooks/useCollisionEditor';
import styles from './CollisionEditorSection.module.css';

/**
 * Collision section of the office sidebar, next to the desk, room and
 * terrain editors and behind the same role guard. Container like
 * `TerrainEditorSection`: `useCollisionEditor` holds the draft, the map
 * (`CollisionEditLayer`) draws it and turns picks and drags into events.
 */

export interface CollisionEditorSectionProps {
  bridge: OfficeBridge;
  collisions: CollisionAdminPort;
  /** Reports each closed/open change, like the other sections. */
  onEditingChange?: (editing: boolean) => void;
  /** A rising edge closes the editor: another editor took the map. */
  forceExit?: boolean;
  /** A chosen sidebar submenu opens directly; standalone consumers keep the entry button. */
  initiallyActive?: boolean;
  onExit?: () => void;
  /** Called before opening, so `OfficeLayoutEditor` can close the others first. */
  onRequestActive?: () => void;
}

/** The four numbers of a rectangle, in form order, with their UI names. */
const FIELDS: readonly { field: RectField; label: string }[] = [
  { field: 'x', label: 'X' },
  { field: 'y', label: 'Y' },
  { field: 'w', label: 'Ancho' },
  { field: 'h', label: 'Alto' },
];

export function CollisionEditorSection({ bridge, collisions, onEditingChange, forceExit = false, onRequestActive, initiallyActive = false, onExit }: CollisionEditorSectionProps) {
  const editor = useCollisionEditor({ bridge, collisions });

  useEffect(() => {
    if (initiallyActive) editor.enter();
    // Initialization only: later forceExit must not reopen the editor.
  }, []);

  useEffect(() => {
    onEditingChange?.(editor.active);
    // Only the change is reported; the caller keeps the callback stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.active]);

  useEffect(() => {
    if (forceExit) editor.exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExit]);

  function handleEnter(): void {
    onRequestActive?.();
    editor.enter();
  }

  const debugToggle = (
    <label className={styles.toggle}>
      <input type="checkbox" checked={editor.showAll} onChange={(event) => editor.setShowAll(event.target.checked)} />
      Mostrar colisiones
    </label>
  );

  if (!editor.active) {
    return (
      <div className={styles.section}>
        <button type="button" className={styles.enter} onClick={handleEnter}>
          Editar colisiones
        </button>
        {debugToggle}
      </div>
    );
  }

  const { pieceId, rects, selectedRect, pending } = editor;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Colisiones</h3>
        <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
          Salir
        </button>
      </div>
      {debugToggle}

      {pieceId === null ? (
        <span className={styles.hint}>Toca un objeto en el mapa para editar su colisión.</span>
      ) : (
        <>
          <span className={styles.piece}>{`${pieceId} · ${editor.saved ? 'personalizada' : 'por defecto'}`}</span>
          <span className={styles.hint}>Se aplica a todas las piezas iguales. Medidas en píxeles desde su base.</span>
          <span className={styles.hint}>
            En el mapa: arrastra fuera para dibujar un rectángulo, dentro para moverlo y desde un borde para cambiar su tamaño.
          </span>

          {rects.length === 0 && <span className={styles.hint}>Sin colisión: se puede atravesar.</span>}
          <ol className={styles.rects}>
            {rects.map((rect, index) => {
              const name = `rectángulo ${index + 1}`;
              return (
                <li key={index} className={index === selectedRect ? `${styles.rect} ${styles.selected}` : styles.rect}>
                  <button type="button" className={styles.select} aria-pressed={index === selectedRect} onClick={() => editor.selectRect(index)}>
                    {`Rectángulo ${index + 1}`}
                  </button>
                  <div className={styles.numbers}>
                    {FIELDS.map(({ field, label }) => (
                      <label key={field} className={styles.number}>
                        <span className={styles.hint}>{label}</span>
                        <input
                          className={styles.input}
                          type="number"
                          step={1}
                          aria-label={`${label} del ${name}`}
                          value={rect[field]}
                          disabled={pending}
                          onChange={(event) => {
                            if (event.target.value !== '') editor.updateRect(index, field, Number(event.target.value));
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <button type="button" className={styles.button} aria-label={`Eliminar ${name}`} disabled={pending} onClick={() => editor.deleteRect(index)}>
                    Eliminar
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className={styles.button} disabled={pending || rects.length >= MAX_COLLISION_RECTS} onClick={editor.addRect}>
            Añadir rectángulo
          </button>

          <div className={styles.field}>
            <label className={styles.hint} htmlFor="collision-snap">
              Ajuste
            </label>
            <select
              id="collision-snap"
              className={styles.input}
              value={editor.snap}
              onChange={(event) => editor.setSnap(Number(event.target.value) as CollisionSnap)}
            >
              {COLLISION_SNAPS.map((snap) => (
                <option key={snap} value={snap}>
                  {`${snap} px`}
                </option>
              ))}
            </select>
          </div>

          {editor.dirty && <span className={styles.hint}>Vista previa en el mapa: solo la ves tú hasta guardarla.</span>}
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={!editor.dirty || pending} onClick={() => void editor.save()}>
              Guardar
            </button>
            <button type="button" className={styles.button} disabled={!editor.dirty || pending} onClick={editor.cancel}>
              Cancelar
            </button>
            <button type="button" className={styles.button} disabled={!editor.saved || pending} onClick={() => void editor.restoreDefault()}>
              Restablecer
            </button>
          </div>
        </>
      )}

      {editor.notice !== null && (
        <div className={styles.notice} role="status">
          {editor.notice}
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
