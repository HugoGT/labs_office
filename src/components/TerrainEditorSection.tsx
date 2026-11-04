import { useEffect, useMemo } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { MaterialOption } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import type { OfficeBridge } from '../game/officeBridge';
import type { DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { terrainOutlines } from '../game/terrainEditor';
import { useDecorEditor } from '../hooks/useDecorEditor';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { useTerrainEditor, type FloorBrush } from '../hooks/useTerrainEditor';
import { useWallEditor, type WallBrush } from '../hooks/useWallEditor';
import { useCatalogDecorInfo } from './DecorEditorSection';
import { TERRAIN_MATERIAL_LABELS, TerrainPalette, WALL_ERASER_LABEL, WALL_PIECE_LABELS, WallEraser, WallPalette } from './TerrainPalette';
import styles from './TerrainEditorSection.module.css';

/**
 * Terrain section of the office sidebar (#123 phase 2), next to the desk and
 * room editors and behind the same role guard. Container like
 * `DeskEditorSection`: `useTerrainEditor` holds the state, `TerrainPalette`
 * picks a floor, the map (`TerrainEditLayer`) reports the clicked blocks, and
 * the scene draws the pending paints. Chairs and the rest of the furniture
 * are in "Decoración" (#208).
 *
 * Below the floors, under «Paredes», it paints the walls (#224; they lived
 * in "Decoración" for a while): `useWallEditor` with `WallPalette`, and its
 * eraser, «⛔ Borrador» (`WallEraser`), which takes the chair, table, desk,
 * plant or door under the pointer before a wall. One entry is picked at a
 * time across floors, walls and the eraser. Both tools share the map's
 * `terrainedit` overlay, so the floor tool is paused while the wall tool
 * holds it.
 */

/** Never written to: the eraser only takes decor off when the menu is given the real port. */
const NO_DECOR_PORT: OfficeDecorPort = { setDecor: async () => undefined };

/** What the picked wall brush paints, in words. */
function wallBrushLabel(brush: WallBrush): string {
  return brush.piece === null ? WALL_ERASER_LABEL : `Pintando paredes de ${WALL_PIECE_LABELS[brush.piece]}`;
}

/** What the picked floor paints, in words: an uploaded floor by the name of its piece (S13). */
function brushLabel(brush: FloorBrush, floors: readonly MaterialOption[] | null): string {
  const uploaded = brush.floor === undefined ? undefined : floors?.find((option) => option.id === brush.floor);
  return `Pintando con ${uploaded?.name ?? TERRAIN_MATERIAL_LABELS[brush.material]}`;
}

export interface TerrainEditorSectionProps {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
  /** Every desk and room area in tiles, outlined on the map while editing (#216); absent, none. */
  desks?: readonly DecorTileRect[];
  rooms?: readonly DecorTileRect[];
  /**
   * The office decor layer (`POST /admin/decor`) the wall eraser takes the
   * piece under the pointer off through (#232, #233); absent, it erases walls only.
   */
  decor?: OfficeDecorPort | null;
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
  desks,
  rooms,
  decor = null,
  onEditingChange,
  forceExit = false,
  onRequestActive,
  initiallyActive = false,
  onExit,
  loadMaterials,
  preview,
}: TerrainEditorSectionProps) {
  const outlines = useMemo(() => terrainOutlines(desks ?? [], rooms ?? []), [desks, rooms]);
  const catalog = useMaterialCatalog(loadMaterials);
  const infoOf = useCatalogDecorInfo(catalog);
  // Never entered: it only lends the wall eraser its `erase`, the decor
  // menu's own rule for which piece or door a post or tile holds, and the
  // queue that sends the removal. It never draws or listens to the map.
  const decorEraser = useDecorEditor({ bridge, decor: decor ?? NO_DECOR_PORT, area: null, infoOf, paused: true });
  const walls = useWallEditor({
    bridge,
    terrain,
    ...(decor === null ? {} : { eraseDecor: (post: number, tile: number | null) => decorEraser.erase(post, tile) }),
    infoOf,
    outlines,
  });
  const editor = useTerrainEditor({ bridge, terrain, onExit, outlines, paused: walls.showing });

  useEffect(() => {
    if (initiallyActive) editor.enter();
    // Initialization only: later forceExit must not reopen the editor.
  }, []);

  // Leaving the menu puts the picked wall down with everything else.
  useEffect(() => {
    if (!editor.active) walls.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.active]);

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
        Pintar sobre el vacío crea terreno nuevo; «Vacío» lo borra. El agua y el vacío no se pueden caminar. Con ESC sales del editor.
      </span>

      <TerrainPalette
        value={editor.brush}
        onPick={(material) => {
          walls.unpick();
          editor.pick(material);
        }}
        onPickFloor={(pieceId) => {
          walls.unpick();
          editor.pickFloor(pieceId);
        }}
        floors={catalog?.floor ?? null}
        colors={editor.colors}
        onColorChange={(material, color) => {
          walls.unpick();
          editor.setColor(material, color);
        }}
        onColorPicking={editor.setPickingColor}
        disabled={editor.blocked}
        preview={preview}
      />

      <h4 className={styles.subtitle}>Paredes</h4>
      <div className={styles.tools}>
        <WallEraser
          value={walls.brush}
          onPick={(piece) => {
            editor.unpick();
            walls.pick(piece);
          }}
          disabled={walls.blocked}
        />
      </div>
      <WallPalette
        value={walls.brush}
        onPick={(piece) => {
          editor.unpick();
          walls.pick(piece);
        }}
        walls={catalog?.wall ?? null}
        disabled={walls.blocked}
        preview={preview}
      />

      {walls.brush !== null && (
        <div className={styles.row}>
          <span>{wallBrushLabel(walls.brush)}</span>
          <button type="button" className={styles.button} onClick={walls.unpick}>
            Deseleccionar
          </button>
        </div>
      )}
      {editor.brush !== null && (
        <div className={styles.row}>
          <span>{brushLabel(editor.brush, catalog?.floor ?? null)}</span>
          <button type="button" className={styles.button} onClick={editor.unpick}>
            Deseleccionar
          </button>
        </div>
      )}
      {(editor.pending || walls.pending || decorEraser.pending) && <span className={styles.hint}>Guardando…</span>}

      {(walls.error ?? decorEraser.error ?? editor.error) !== null && (
        <div className={styles.error} role="alert">
          {walls.error ?? decorEraser.error ?? editor.error}
        </div>
      )}
    </div>
  );
}
