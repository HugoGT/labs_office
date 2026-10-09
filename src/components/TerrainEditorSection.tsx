import { useEffect } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { ArtPreviewCache } from '../game/artPreview';
import type { OfficeBridge } from '../game/officeBridge';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import type { TerrainBrush } from '../game/terrainEditor';
import { useTerrainEditor } from '../hooks/useTerrainEditor';
import { TERRAIN_MATERIAL_LABELS, TerrainPalette, WALL_PIECE_LABELS, WallPalette } from './TerrainPalette';
import styles from './TerrainEditorSection.module.css';

/**
 * Terrain section of the office sidebar (#123 phase 2), next to the desk and
 * room editors and behind the same role guard. Container like
 * `DeskEditorSection`: `useTerrainEditor` holds the state, the palettes
 * (`TerrainPalette`, `WallPalette`) pick a floor or a wall, the map
 * (`TerrainEditLayer`) reports the clicked blocks or tiles, and the scene
 * draws the pending paints.
 */

/** What the picked brush paints, in words. */
function brushLabel(brush: TerrainBrush): string {
  if (brush.kind === 'floor') return `Pintando con ${TERRAIN_MATERIAL_LABELS[brush.material]}`;
  return brush.piece === null ? 'Quitando paredes' : `Pintando paredes de ${WALL_PIECE_LABELS[brush.piece]}`;
}

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

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Terreno</h3>
        <button type="button" className={styles.exit} onClick={() => { editor.exit(); onExit?.(); }}>
          Salir
        </button>
      </div>

      <span className={styles.hint}>
        Elige un suelo y toca bloques del mapa para pintarlos, o mantén pulsado y arrastra para pintar un área: cada bloque ocupa 9 × 9 casillas (288 × 288 px). El suelo sigue elegido hasta que lo deseleccionas o pulsas Escape.
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

      <h4 className={styles.subtitle}>Paredes</h4>
      <span className={styles.hint}>
        Las paredes van sobre las líneas entre casillas y cortan el paso: toca o arrastra cerca de una esquina para levantarlas desde ella, y «Quitar pared» las borra. No se pueden poner sobre escritorios, sillas ni la entrada.
      </span>
      <WallPalette
        value={editor.brush}
        onPick={editor.pickWall}
        walls={catalog?.wall ?? null}
        disabled={editor.blocked}
        preview={preview}
      />

      {editor.brush !== null && (
        <div className={styles.row}>
          <span>{brushLabel(editor.brush)}</span>
          <button type="button" className={styles.button} onClick={editor.unpick}>
            Deseleccionar
          </button>
        </div>
      )}
      {editor.pending && <span className={styles.hint}>Guardando…</span>}

      {editor.error !== null && (
        <div className={styles.error} role="alert">
          {editor.error}
        </div>
      )}
    </div>
  );
}
