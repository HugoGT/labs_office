import { useEffect, useMemo } from 'react';
import type { ArtPreviewCache } from '../game/artPreview';
import { fitsDeskArea, type DecorBrush } from '../game/decorEditor';
import type { OfficeBridge } from '../game/officeBridge';
import type { DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { useDecorEditor } from '../hooks/useDecorEditor';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { DecorPalette } from './DecorPalette';
import { MultipleToggle } from './MultipleToggle';
import styles from './TerrainEditorSection.module.css';

/**
 * The decor editor of the office sidebar (#208), one component for both of
 * its places. Container like `TerrainEditorSection`: `useDecorEditor` holds
 * the state, `DecorPalette` picks a piece (and the color of a colorable
 * one), the map (`DecorEditLayer`) draws the ghost, turns it with the wheel
 * or R and reports the clicked tile, and the scene draws the pending edits.
 *
 *   - `office` ("Decoración", admins): the whole map and every piece, room
 *     tables included, through `POST /admin/decor`; it has its own way in and out.
 *   - `desk` ("Mi espacio", everyone): the person's desk only and what fits
 *     it, through `POST /me/decor`; open for as long as it is shown.
 */

export interface DecorEditorSectionProps {
  bridge: OfficeBridge;
  decor: OfficeDecorPort;
  scope: 'office' | 'desk';
  /** Where it may act, in tiles: the desk for `desk`, `null` (the whole map) for `office`. */
  area: DecorTileRect | null;
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
  onEditingChange,
  forceExit = false,
  initiallyActive = false,
  onExit,
  onRequestActive,
  loadMaterials,
  preview,
}: DecorEditorSectionProps) {
  const catalog = useMaterialCatalog(loadMaterials);
  const office = scope === 'office';
  const editor = useDecorEditor({ bridge, decor, area, onExit: office ? onExit : undefined });
  const names = useMemo(() => {
    const byId = new Map<string, string>();
    for (const kind of ['chair', 'desk', 'table', 'plant'] as const) for (const option of catalog?.[kind] ?? []) byId.set(option.id, option.name);
    return byId;
  }, [catalog]);

  useEffect(() => {
    if (initiallyActive || !office) editor.enter();
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

  function brushLabel(brush: DecorBrush): string {
    return `Poniendo ${names.get(brush.piece) ?? brush.piece}`;
  }

  if (!editor.active) {
    if (!office) return null;
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
      {office && (
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
      )}

      <span className={styles.hint}>
        {office
          ? 'Elige una pieza y toca una casilla del mapa para ponerla: la sombra muestra dónde queda y se vuelve roja donde no cabe. Poner una pieza en la casilla de otra la cambia. Con una pieza elegida se ocultan el minimapa y los menús de la derecha; vuelven al ponerla, o con Escape, y con nada elegido Escape sale del editor.'
          : 'Elige una pieza y toca una casilla de tu escritorio para ponerla. Lo que pongas se queda en el escritorio aunque lo dejes. Con una pieza elegida se ocultan los menús de la derecha; vuelven al ponerla, o con Escape.'}
      </span>
      <span className={styles.hint}>
        Con la pieza elegida, gírala con la rueda del mouse o con R sobre el mapa (Mayúsculas + R al revés). Las sillas y las mesas de escritorio miran a los cuatro lados; las mesas de sala se ponen en horizontal o en vertical.
      </span>
      <span className={styles.hint}>Una pieza con muestra de color se pone en el color que elijas en la muestra antes de elegirla.</span>

      <div className={styles.row}>
        <MultipleToggle checked={editor.multiple} onChange={editor.setMultiple} disabled={editor.blocked} />
      </div>

      <DecorPalette
        value={editor.brush}
        catalog={catalog}
        offers={office ? undefined : fitsDeskArea}
        colors={editor.colors}
        onPick={editor.pick}
        onColorChange={editor.setColor}
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
