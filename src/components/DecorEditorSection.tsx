import { useEffect, useMemo, useRef } from 'react';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { ArtPreviewCache } from '../game/artPreview';
import { decorOutlines, fitsDeskArea, type DecorBrush } from '../game/decorEditor';
import type { OfficeBridge } from '../game/officeBridge';
import { decorInfoFromPieceId, type DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { useDecorEditor } from '../hooks/useDecorEditor';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { useWallEditor, type WallBrush } from '../hooks/useWallEditor';
import { DecorPalette, catalogDecorInfo } from './DecorPalette';
import { MultipleToggle } from './MultipleToggle';
import { WALL_ERASER_LABEL, WALL_PIECE_LABELS, WallEraser, WallPalette } from './TerrainPalette';
import styles from './TerrainEditorSection.module.css';

/**
 * The decor editor of the office sidebar (#208), one component for both of
 * its places. Container like `TerrainEditorSection`: `useDecorEditor` holds
 * the state, `DecorPalette` picks a piece (and the color of a colorable
 * one), the map (`DecorEditLayer`) draws the ghost, turns it with the wheel
 * or R and reports the clicked tile, or with nothing picked selects a placed
 * item and offers its move and trash buttons, and the scene draws the
 * pending edits. The panel explains nothing: the map shows it.
 *
 * Both scopes are the one "Decoración" menu of "Personalizar", under the
 * same header, "Salir" and Escape steps:
 *
 *   - `office` (admins): the whole map and every piece, room tables
 *     included, through `POST /admin/decor`, with «Múltiple».
 *   - `desk` (everyone else): the desk the person claimed (`area`) and what
 *     fits it, through `POST /me/decor`; one click places one piece. Without
 *     a desk (`area` `null`) it asks to claim one, and with one it ends with
 *     "Dejar escritorio". It edits while it is shown and a desk is claimed.
 *
 * The desk rules (`deskDecorRules.ts`) apply to both: `desks` lets the
 * editor and the map's ghost judge them before the server does.
 *
 * The admin's menu also paints the walls (#224, moved from "Editar
 * terreno"), below the pieces: `useWallEditor` with `WallPalette`, and its
 * eraser, «⛔ Borrador» (`WallEraser`), on its own line above «Múltiple», which takes the
 * chair, table, desk or plant under the pointer before a wall. One entry is
 * picked at a time across the pieces, the walls and the eraser, and while a wall is, the decor
 * tool is paused so the map's clicks are the wall's.
 */

/** What the picked wall brush paints, in words. */
function wallBrushLabel(brush: WallBrush): string {
  return brush.piece === null ? WALL_ERASER_LABEL : `Pintando paredes de ${WALL_PIECE_LABELS[brush.piece]}`;
}

export interface DecorEditorSectionProps {
  bridge: OfficeBridge;
  decor: OfficeDecorPort;
  scope: 'office' | 'desk';
  /** Where it may act, in tiles: the desk for `desk` (`null` without one), `null` (the whole map) for `office`. */
  area: DecorTileRect | null;
  /** Every desk area in tiles, for the desk rules; absent, none. */
  desks?: readonly DecorTileRect[];
  /** `office` only: every room in tiles, outlined for the admin like the desks (#216). */
  rooms?: readonly DecorTileRect[];
  /** `office` only: the terrain admin port the walls are painted through (#224); absent, no walls are offered. */
  terrain?: TerrainAdminPort | null;
  /** `desk` only: releases the claimed desk ("Dejar escritorio"), like the desk banner's. */
  onLeaveDesk?: () => void;
  /** Reports each closed/open change, like the other sections. */
  onEditingChange?: (editing: boolean) => void;
  /** A rising edge closes the editor: another editor took the map. */
  forceExit?: boolean;
  /** A chosen sidebar submenu opens directly; standalone consumers keep the entry button. */
  initiallyActive?: boolean;
  onExit?: () => void;
  /** Called before opening, so `OfficeLayoutEditor` can close the others first. */
  onRequestActive?: () => void;
  /** The pack and uploads catalog of the palette; injected by tests. */
  loadMaterials?: LoadMaterials;
  preview?: ArtPreviewCache;
}

export function DecorEditorSection({
  bridge,
  decor,
  scope,
  area,
  desks,
  rooms,
  terrain = null,
  onLeaveDesk,
  onEditingChange,
  forceExit = false,
  initiallyActive = false,
  onExit,
  onRequestActive,
  loadMaterials,
  preview,
}: DecorEditorSectionProps) {
  const catalog = useMaterialCatalog(loadMaterials);
  const infoOf = useMemo(() => {
    const fromCatalog = catalogDecorInfo(catalog);
    return (piece: string) => fromCatalog(piece) ?? decorInfoFromPieceId(piece);
  }, [catalog]);
  const office = scope === 'office';
  const hasDesk = !office && area !== null;
  // Only an admin paints walls: the desk scope never gets the port, so it offers none.
  // Called on a map click, long after this render declared `editor` below.
  // The desk scope outlines its own desk, the office scope every desk and room (#216).
  const outlines = useMemo(() => decorOutlines(area, desks ?? [], office ? (rooms ?? []) : []), [area, desks, rooms, office]);
  const walls = useWallEditor({ bridge, terrain: office ? terrain : null, eraseDecor: (post, tile) => editor.erase(post, tile), infoOf, outlines });
  const editor = useDecorEditor({ bridge, decor, area, infoOf, onExit, desks, outlines, paused: walls.brush !== null });
  const offersWalls = office && terrain !== null;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const names = useMemo(() => {
    const byId = new Map<string, string>();
    for (const kind of ['chair', 'desk', 'table', 'plant'] as const) for (const option of catalog?.[kind] ?? []) byId.set(option.id, option.name);
    return byId;
  }, [catalog]);

  useEffect(() => {
    if (office && initiallyActive) editor.enter();
    // Initialization only: later forceExit must not reopen the editor.
  }, []);

  // One desk: it edits while a desk is claimed, from the moment one is.
  useEffect(() => {
    if (office) return;
    if (hasDesk) editor.enter();
    else editor.exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDesk]);

  // Without a desk nothing holds Escape: it leaves the menu, like the
  // admin's with nothing picked, before the sidebar's closes the panel.
  useEffect(() => {
    if (office || hasDesk) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || onExitRef.current === undefined) return;
      event.preventDefault();
      onExitRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [office, hasDesk]);

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

  function brushLabel(brush: DecorBrush): string {
    return `${brush.from === undefined ? 'Poniendo' : 'Moviendo'} ${names.get(brush.piece) ?? brush.piece}`;
  }

  const selectedItem = editor.selected === null ? undefined : editor.items.find((item) => item.index === editor.selected);

  const header = (
    <div className={styles.header}>
      <h3 className={styles.title}>Decoración</h3>
      <button
        type="button"
        className={styles.exit}
        onClick={() => {
          editor.exit();
          onExit?.();
        }}
      >
        Salir
      </button>
    </div>
  );

  if (!office && !editor.active) {
    return (
      <div className={styles.section}>
        {header}
        {!hasDesk && <p className={styles.hint}>Reclama un escritorio libre en el mapa para decorarlo.</p>}
      </div>
    );
  }

  if (!editor.active) {
    return (
      <div className={styles.section}>
        <button
          type="button"
          className={styles.enter}
          onClick={() => {
            onRequestActive?.();
            editor.enter();
          }}
        >
          Decoración
        </button>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      {header}

      {offersWalls && (
        <div className={styles.tools}>
          <WallEraser value={walls.brush} onPick={walls.pick} disabled={walls.blocked} />
        </div>
      )}
      {office && (
        <div className={styles.row}>
          <MultipleToggle checked={editor.multiple} onChange={editor.setMultiple} disabled={editor.blocked} />
        </div>
      )}

      <DecorPalette
        value={editor.brush}
        catalog={catalog}
        offers={office ? undefined : fitsDeskArea}
        colors={editor.colors}
        onPick={(option) => {
          walls.unpick();
          editor.pick(option);
        }}
        onColorChange={editor.setColor}
        disabled={editor.blocked}
        preview={preview}
      />

      {offersWalls && (
        <>
          <h4 className={styles.subtitle}>Paredes</h4>
          <WallPalette value={walls.brush} onPick={walls.pick} walls={catalog?.wall ?? null} disabled={walls.blocked} preview={preview} />
        </>
      )}

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
          <span>{brushLabel(editor.brush)}</span>
          <button type="button" className={styles.button} onClick={editor.unpick}>
            Deseleccionar
          </button>
        </div>
      )}
      {selectedItem !== undefined && editor.brush === null && (
        <div className={styles.row}>
          <span>Seleccionado: {names.get(selectedItem.piece) ?? selectedItem.piece}</span>
        </div>
      )}
      {(editor.pending || walls.pending) && <span className={styles.hint}>Guardando…</span>}

      {(walls.error ?? editor.error) !== null && (
        <div className={styles.error} role="alert">
          {walls.error ?? editor.error}
        </div>
      )}

      {!office && onLeaveDesk !== undefined && (
        <button type="button" className={styles.leave} onClick={onLeaveDesk}>
          Dejar escritorio
        </button>
      )}
    </div>
  );
}
