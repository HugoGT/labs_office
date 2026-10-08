import { useEffect, useState } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { ArtPreviewCache } from '../game/artPreview';
import type { OfficeBridge } from '../game/officeBridge';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { useTerrainEditor } from '../hooks/useTerrainEditor';
import { TERRAIN_MATERIAL_LABELS, TerrainPalette } from './TerrainPalette';
import styles from './TerrainEditorSection.module.css';

/**
 * Terrain section of the office sidebar (#123 phase 2), next to the desk and
 * room editors and behind the same role guard. Container like
 * `DeskEditorSection`: `useTerrainEditor` holds the state, the palette
 * (`TerrainPalette`) picks the floor, the map (`TerrainEditLayer`) reports
 * the clicked blocks, and the scene draws the pending paints.
 */

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
  /** The pack floors of the thumbnails; injected by tests. */
  loadMaterials?: LoadMaterials;
  preview?: ArtPreviewCache;
}

export function TerrainEditorSection({
  bridge,
  terrain,
  onEditingChange,
  forceExit = false,
  onRequestActive,
  initiallyActive = false,
  onExit,
  loadMaterials,
  preview,
}: TerrainEditorSectionProps) {
  const editor = useTerrainEditor({ bridge, terrain });
  const catalog = useMaterialCatalog(loadMaterials);
  const [confirmed, setConfirmed] = useState(false);

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

  async function handleClear(): Promise<void> {
    setConfirmed(false);
    await editor.clear();
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Terreno</h3>
        <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
          Salir
        </button>
      </div>

      <span className={styles.hint}>
        Elige un suelo y toca bloques del mapa para pintarlos: cada bloque ocupa 9 × 9 casillas (288 × 288 px). El suelo sigue elegido hasta que lo deseleccionas o pulsas Escape.
      </span>
      <span className={styles.hint}>
        Pintar sobre el vacío crea terreno nuevo; «Vacío» lo borra. El agua y el vacío no se pueden caminar. El bloque central de la entrada siempre es de madera.
      </span>

      <TerrainPalette
        value={editor.brush}
        onPick={editor.pick}
        floors={catalog?.floor ?? null}
        disabled={editor.blocked}
        preview={preview}
      />

      {editor.brush !== null && (
        <div className={styles.row}>
          <span>{`Pintando con ${TERRAIN_MATERIAL_LABELS[editor.brush]}`}</span>
          <button type="button" className={styles.button} onClick={editor.unpick}>
            Deseleccionar
          </button>
        </div>
      )}
      {editor.pending && <span className={styles.hint}>Guardando…</span>}

      <fieldset className={styles.form} disabled={editor.pending || editor.blocked}>
        <legend className={styles.hint}>Vaciar terreno</legend>
        <span className={styles.hint}>
          Devuelve todos los bloques al vacío salvo la entrada. No borra salas ni escritorios: se rechaza si el vacío taparía alguno.
        </span>
        <label className={styles.hint}>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo vaciar todo el terreno
        </label>
        <button type="button" className={styles.button} disabled={!confirmed} onClick={() => void handleClear()}>
          Vaciar terreno
        </button>
      </fieldset>

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
