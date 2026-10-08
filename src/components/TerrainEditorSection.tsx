import { useEffect, useState, type FormEvent } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { LAYOUT_MATERIALS, isLayoutMaterial, type LayoutMaterial } from '../game/officeLayout';
import { BLOCK_COLUMNS, BLOCK_ROWS, useTerrainEditor } from '../hooks/useTerrainEditor';
import { SPAWN_BLOCK_INDEX } from '../game/mapGeneration';
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
  /** A chosen sidebar submenu opens directly; standalone consumers keep the entry button. */
  initiallyActive?: boolean;
  onExit?: () => void;
  /** Called before opening, so `OfficeLayoutEditor` can close the others first. */
  onRequestActive?: () => void;
}

export function TerrainEditorSection({ bridge, terrain, onEditingChange, forceExit = false, onRequestActive, initiallyActive = false, onExit }: TerrainEditorSectionProps) {
  const editor = useTerrainEditor({ bridge, terrain });
  const [column, setColumn] = useState('');
  const [row, setRow] = useState('');
  const [seed, setSeed] = useState('123');
  const [landBlocks, setLandBlocks] = useState('30');
  const [landMaterial, setLandMaterial] = useState<Exclude<LayoutMaterial, 'water'>>('grass');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [editor.draft]);

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

  if (!editor.active) {
    return (
      <div className={styles.section}>
        <button type="button" className={styles.enter} onClick={handleEnter}>
          Editar terreno
        </button>
      </div>
    );
  }

  const { selected, blocks } = editor;
  const pending = editor.pending || editor.blocked;
  const current = selected === null ? null : blocks[selected]!;
  const chosen = selected === SPAWN_BLOCK_INDEX ? current : editor.material ?? current;
  const changed = selected !== SPAWN_BLOCK_INDEX && current !== null && chosen !== null && chosen !== current;

  function handleCoordinates(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    editor.selectAt(Number(column), Number(row));
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Terreno</h3>
        <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
          Salir
        </button>
      </div>

      <span className={styles.hint}>Toca un bloque en el mapa o escribe su columna y fila.</span>
      <span className={styles.hint}>Cada bloque ocupa 9 × 9 casillas (288 × 288 px). El bloque central de madera está protegido. El agua es terreno sin construir y no se puede caminar.</span>
      <fieldset className={styles.form} disabled={pending}>
        <legend>Generar mapa por bloques</legend>
        <label className={styles.field}>Semilla (0–4294967295)
          <input className={styles.input} type="number" min={0} max={4294967295} step={1} value={seed} onChange={(event) => { setSeed(event.target.value); editor.discard(); }} />
        </label>
        <label className={styles.field}>Bloques de tierra (1–140, incluye la entrada)
          <input className={styles.input} type="number" min={1} max={140} step={1} value={landBlocks} onChange={(event) => { setLandBlocks(event.target.value); editor.discard(); }} />
        </label>
        <label className={styles.field}>Material generado
          <select className={styles.input} value={landMaterial} onChange={(event) => {
            if (isLayoutMaterial(event.target.value) && event.target.value !== 'water') { setLandMaterial(event.target.value); editor.discard(); }
          }}>
            {LAYOUT_MATERIALS.filter((material) => material !== 'water').map((material) => <option key={material} value={material}>{TERRAIN_MATERIAL_LABELS[material]}</option>)}
          </select>
        </label>
        <button className={styles.button} type="button" disabled={seed === '' || landBlocks === ''} onClick={() => editor.generate({ seed: Number(seed), landBlocks: Number(landBlocks), material: landMaterial })}>Vista previa procedural</button>
        <button className={styles.button} type="button" onClick={() => editor.generate({ seed: 0, landBlocks: 1, material: 'wood' })}>Vista previa: solo entrada central</button>
        {editor.draft !== null && <>
          <span className={styles.hint}>Vista previa en el mapa: solo la ves tú. Reemplaza el terreno, no borra salas ni escritorios. Puede rechazarse si el agua cubre una ubicación o una persona.</span>
          <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo reemplazar el terreno por esta vista previa</label>
          <button className={styles.button} type="button" disabled={!confirmed} onClick={() => void editor.applyGenerated()}>Aplicar mapa</button>
          <button className={styles.button} type="button" onClick={editor.discard}>Descartar mapa</button>
        </>}
      </fieldset>
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
        <button type="submit" className={styles.button} disabled={pending || column === '' || row === ''}>
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
              disabled={pending || selected === SPAWN_BLOCK_INDEX}
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
