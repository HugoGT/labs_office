import { chairPreviewFrames, previewFrame, type MaterialCatalog, type MaterialOption } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import type { DecorBrush } from '../game/decorEditor';
import { decorPieceInfo, type DecorPieceInfo } from '../game/officeDecor';
import type { DecorPick } from '../hooks/useDecorEditor';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import styles from './DecorPalette.module.css';

/**
 * The palette of the decor editor (#208): every piece the office decor layer
 * places, grouped by kind, each with a thumbnail cut from its sheet (pack and
 * approved uploads, from the same catalog as the other palettes), then the
 * eraser. Presentational: the editor owns which entry is picked and what a
 * click on the map does with it.
 */

export const DECOR_ERASER_LABEL = 'Quitar';

type DecorCatalogKind = 'chair' | 'desk' | 'table' | 'plant';

/** The groups in palette order, named for the person picking. */
const GROUPS: readonly { kind: DecorCatalogKind; label: string }[] = [
  { kind: 'chair', label: 'Sillas' },
  { kind: 'desk', label: 'Mesas de escritorio' },
  { kind: 'table', label: 'Mesas de sala' },
  { kind: 'plant', label: 'Plantas' },
];

/** Sheet pixels per thumbnail pixel: a desk cell (96x104) and a room table frame (256x192) are bigger than the 48px box. */
const SHRINK: Readonly<Record<DecorCatalogKind, number>> = { chair: 1, desk: 2, table: 6, plant: 1 };

/** A catalog entry as the editor picks it, or `null` when the decor layer does not place it. */
export function decorPickOf(option: MaterialOption): DecorPick | null {
  const info = decorPieceInfo(option.piece);
  return info === null ? null : { id: option.id, info };
}

/** How the catalog sizes a piece of the layer, by id: what the scene's manifest would say. */
export function catalogDecorInfo(catalog: MaterialCatalog | null): (piece: string) => DecorPieceInfo | null {
  const known = new Map<string, DecorPieceInfo>();
  for (const { kind } of GROUPS) {
    for (const option of catalog?.[kind] ?? []) {
      const pick = decorPickOf(option);
      if (pick !== null) known.set(pick.id, pick.info);
    }
  }
  return (piece) => known.get(piece) ?? null;
}

export interface DecorPaletteProps {
  /** The editor's brush: an entry is pressed while its piece (any rotation) or the eraser is picked. */
  value: DecorBrush | null;
  /** The pack and uploads catalog, or `null` while it is unavailable: only the eraser then. */
  catalog: MaterialCatalog | null;
  /** Which pieces to offer ("Mi espacio": what fits a desk); every one by default. */
  offers?: (info: DecorPieceInfo) => boolean;
  onPick: (pick: DecorPick) => void;
  onErase: () => void;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

function Thumbnail({ option, kind, preview }: { option: MaterialOption; kind: DecorCatalogKind; preview?: ArtPreviewCache }) {
  // A chair reads whole only with both of its layers, back first.
  const frames = kind === 'chair' ? chairPreviewFrames() : [previewFrame(option)];
  return (
    <span className={styles.thumbnail} aria-hidden="true">
      {frames.map((frame) => (
        <ArtPreviewCanvas
          key={frame.y}
          option={option}
          color={null}
          frame={frame}
          shrink={SHRINK[kind]}
          label={option.name}
          className={styles.canvas}
          preview={preview}
        />
      ))}
    </span>
  );
}

export function DecorPalette({ value, catalog, offers = () => true, onPick, onErase, disabled = false, preview }: DecorPaletteProps) {
  const pressed = (id: string): boolean => value?.kind === 'piece' && value.piece === id;
  return (
    <div className={styles.palettes}>
      {GROUPS.map(({ kind, label }) => {
        const entries = (catalog?.[kind] ?? []).flatMap((option) => {
          const pick = decorPickOf(option);
          return pick !== null && offers(pick.info) ? [{ option, pick }] : [];
        });
        if (entries.length === 0) return null;
        return (
          <div key={kind} className={styles.group}>
            <h4 className={styles.subtitle}>{label}</h4>
            <div className={styles.palette} role="group" aria-label={label}>
              {entries.map(({ option, pick }) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.entry}
                  aria-pressed={pressed(option.id)}
                  disabled={disabled}
                  onClick={() => onPick(pick)}
                >
                  <Thumbnail option={option} kind={kind} preview={preview} />
                  <span className={styles.label}>{option.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className={styles.palette}>
        <button
          type="button"
          className={styles.entry}
          aria-pressed={value?.kind === 'eraser'}
          disabled={disabled}
          title="Goma: quita el mueble que ocupa la casilla que toques"
          onClick={onErase}
        >
          <span className={`${styles.thumbnail} ${styles.eraser}`} aria-hidden="true" />
          <span className={styles.label}>{DECOR_ERASER_LABEL}</span>
        </button>
      </div>
    </div>
  );
}
