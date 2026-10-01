import { useEffect, useState, type FormEvent } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { LAYOUT_MATERIALS, isLayoutMaterial, type LayoutMaterial } from '../game/officeLayout';
import { BLOCK_COLUMNS, BLOCK_ROWS, useTerrainEditor } from '../hooks/useTerrainEditor';
import styles from './TerrainEditorSection.module.css';

/**
 * Terrain section of the office sidebar (#123 phase 2), next to the desk and
 * room editors and behind the same role guard. Container like
 * `DeskEditorSection`: `useTerrainEditor` holds the state, the map
 * (`TerrainEditLayer`) outlines and picks blocks, and the scene paints the
 * preview.
 */

/** UI names of the materials, in the drawing order of `LAYOUT_MATERIALS`. */
export const TERRAIN_MATERIAL_LABELS: Readonly<Record<LayoutMaterial, string>> = {
  water: 'Agua',
  grass: 'Césped',
  dirt: 'Tierra',
  sand: 'Arena',
  cobblestone: 'Empedrado',
  wood: 'Madera',
  tile: 'Baldosa',
  carpet: 'Moqueta',
};

export interface TerrainEditorSectionProps {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
  /** Reports each closed/open change, like the other sections. */
  onEditingChange?: (editing: boolean) => void;
  /** A rising edge closes the editor: another editor took the map. */
  forceExit?: boolean;
  /** Called before opening, so `OfficeLayoutEditor` can close the others first. */
  onRequestActive?: () => void;
}

export function TerrainEditorSection({ bridge, terrain, onEditingChange, forceExit = false, onRequestActive }: TerrainEditorSectionProps) {
  const editor = useTerrainEditor({ bridge, terrain });
  const [column, setColumn] = useState('');
  const [row, setRow] = useState('');

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

  if (!editor.active) {
    return (
      <div className={styles.section}>
        <button type="button" className={styles.enter} onClick={handleEnter}>
          Editar terreno
        </button>
      </div>
    );
  }

  const { selected, blocks, pending } = editor;
  const current = selected === null ? null : blocks[selected]!;
  const chosen = editor.material ?? current;
  const changed = current !== null && chosen !== null && chosen !== current;

  function handleCoordinates(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    editor.selectAt(Number(column), Number(row));
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Terreno</h3>
        <button type="button" className={styles.exit} onClick={editor.exit}>
          Salir
        </button>
      </div>

      <span className={styles.hint}>Toca un bloque en el mapa o escribe su columna y fila.</span>
      <form className={styles.form} onSubmit={handleCoordinates}>
        <div className={styles.coordinates}>
          <div className={styles.field}>
            <label className={styles.hint} htmlFor="terrain-column">
              {`Columna (1-${BLOCK_COLUMNS})`}
            </label>
            <input
              id="terrain-column"
              className={styles.input}
              type="number"
              min={1}
              max={BLOCK_COLUMNS}
              value={column}
              onChange={(event) => setColumn(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.hint} htmlFor="terrain-row">
              {`Fila (1-${BLOCK_ROWS})`}
            </label>
            <input
              id="terrain-row"
              className={styles.input}
              type="number"
              min={1}
              max={BLOCK_ROWS}
              value={row}
              onChange={(event) => setRow(event.target.value)}
            />
          </div>
        </div>
        <button type="submit" className={styles.button} disabled={column === '' || row === ''}>
          Seleccionar bloque
        </button>
      </form>

      {selected !== null && current !== null && chosen !== null && (
        <>
          <span className={styles.row}>
            {`Columna ${(selected % BLOCK_COLUMNS) + 1}, fila ${Math.floor(selected / BLOCK_COLUMNS) + 1} · ahora ${TERRAIN_MATERIAL_LABELS[current]}`}
          </span>
          <div className={styles.field}>
            <label className={styles.hint} htmlFor="terrain-material">
              Material
            </label>
            <select
              id="terrain-material"
              className={styles.input}
              value={chosen}
              disabled={pending}
              onChange={(event) => {
                if (isLayoutMaterial(event.target.value)) editor.choose(event.target.value);
              }}
            >
              {LAYOUT_MATERIALS.map((material) => (
                <option key={material} value={material}>
                  {TERRAIN_MATERIAL_LABELS[material]}
                </option>
              ))}
            </select>
          </div>
          {changed && <span className={styles.hint}>Vista previa en el mapa: solo la ves tú hasta aplicarla.</span>}
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={!changed || pending} onClick={() => void editor.apply()}>
              Aplicar
            </button>
            <button type="button" className={styles.button} disabled={!changed || pending} onClick={editor.discard}>
              Descartar
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
