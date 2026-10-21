import { useEffect, useMemo } from 'react';
import type { ArtPreviewCache } from '../game/artPreview';
import { fitsDeskArea, type DecorBrush } from '../game/decorEditor';
import type { OfficeBridge } from '../game/officeBridge';
import { decorInfoFromPieceId, isRotatable, type DecorRotation, type DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { useDecorEditor } from '../hooks/useDecorEditor';
import { useMaterialCatalog, type LoadMaterials } from '../hooks/useMaterialCatalog';
import { DecorPalette, catalogDecorInfo } from './DecorPalette';
import { MultipleToggle } from './MultipleToggle';
import styles from './TerrainEditorSection.module.css';

/**
 * The decor editor of the office sidebar (#208), one component for both of
 * its places. Container like `TerrainEditorSection`: `useDecorEditor` holds
 * the state, `DecorPalette` picks a piece or the eraser, the map
 * (`DecorEditLayer`) draws the ghost and reports the clicked tile, and the
 * scene draws the pending edits.
 *
 *   - `office` ("Decoración", admins): the whole map and every piece, room
 *     tables included, through `POST /admin/decor`; it has its own way in and out.
 *   - `desk` ("Mi espacio", everyone): the person's desk only and what fits
 *     it, through `POST /me/decor`; open for as long as it is shown.
 */

/** The way a chair or desk table looks, in words, by rotation. */
const ROTATION_LABELS: Readonly<Record<DecorRotation, string>> = {
  0: 'hacia abajo',
  90: 'hacia la derecha',
  180: 'hacia arriba',
  270: 'hacia la izquierda',
};

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
  const infoOf = useMemo(() => {
    const fromCatalog = catalogDecorInfo(catalog);
    return (piece: string) => fromCatalog(piece) ?? decorInfoFromPieceId(piece);
  }, [catalog]);
  const office = scope === 'office';
  const editor = useDecorEditor({ bridge, decor, area, infoOf, onExit: office ? onExit : undefined });
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
    if (brush.kind === 'eraser') return 'Quitando muebles';
    const name = names.get(brush.piece) ?? brush.piece;
    return isRotatable(brush.info.kind) ? `Poniendo ${name} mirando ${ROTATION_LABELS[brush.rotation]}` : `Poniendo ${name}`;
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
          ? 'Elige una pieza y toca una casilla del mapa para ponerla: la sombra muestra dónde queda y se vuelve roja donde no cabe. Poner una pieza en la casilla de otra la cambia, y «Quitar» borra el mueble que ocupa la casilla que toques. Con una pieza elegida se ocultan el minimapa y los menús de la derecha; vuelven al ponerla, o con Escape, y con nada elegido Escape sale del editor.'
          : 'Elige una pieza y toca una casilla de tu escritorio para ponerla; «Quitar» borra el mueble que toques. Lo que pongas se queda en el escritorio aunque lo dejes. Con una pieza elegida se ocultan los menús de la derecha; vuelven al ponerla, o con Escape.'}
      </span>
      <span className={styles.hint}>Con «Múltiple» la pieza sigue elegida para poner varias seguidas, hasta Escape.</span>
      <span className={styles.hint}>Gira con la rueda del mouse o R sobre el mapa (Mayúsculas + R al revés), o con «Girar»: solo las sillas y las mesas de escritorio.</span>

      <div className={styles.row}>
        <MultipleToggle checked={editor.multiple} onChange={editor.setMultiple} disabled={editor.blocked} />
      </div>

      <DecorPalette
        value={editor.brush}
        catalog={catalog}
        offers={office ? undefined : fitsDeskArea}
        onPick={editor.pick}
        onErase={editor.pickEraser}
        disabled={editor.blocked}
        preview={preview}
      />

      <div className={styles.row}>
        <span>Mirando {ROTATION_LABELS[editor.rotation]}</span>
        <button type="button" className={styles.button} onClick={() => editor.rotate()} disabled={editor.blocked}>
          Girar
        </button>
      </div>

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
