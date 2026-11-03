import { chairPreviewFrames, previewFrame, sofaPreviewFrames, type MaterialCatalog, type MaterialOption } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { decorColorKey, decorSizeLabel, type DecorBrush } from '../game/decorEditor';
import { decorPieceInfo, type DecorPieceInfo } from '../game/officeDecor';
import type { DecorPick } from '../hooks/useDecorEditor';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import styles from './DecorPalette.module.css';
import { ColorableTile } from './ColorableTile';

/**
 * The palette of the decor editor (#208): every piece the office decor layer
 * places, grouped by kind, each with a thumbnail cut from its sheet (pack and
 * approved uploads, from the same catalog as the other palettes). A tile is
 * its picture, plus the size in tiles of a room table or a sofa: the name is its
 * tooltip and accessible name, the heading says the kind; a colorable piece's
 * tile also carries the color icon, and a click anywhere on it picks the piece
 * in its current color and opens the color picker, which then changes the
 * picked piece live. Presentational: the editor owns which entry is picked,
 * the colors and what a click on the map does.
 */

type DecorCatalogKind = 'chair' | 'sofa' | 'desk' | 'table' | 'plant' | 'tree' | 'door';

/** The groups in palette order, named for the person picking, each with the catalog kinds it lists in order. */
const GROUPS: readonly { kinds: readonly DecorCatalogKind[]; label: string }[] = [
  // #121: the small pieces that dress one's own desk come first, named for the space they dress.
  { kinds: ['plant'], label: 'Mi espacio' },
  { kinds: ['desk'], label: 'Escritorios' },
  { kinds: ['chair'], label: 'Sillas' },
  // A room's furniture together. Only the office scope offers it (`fitsDeskArea` leaves both out).
  { kinds: ['table', 'sofa'], label: 'Sala' },
  // Only the office scope offers them (`fitsDeskArea` leaves trees out).
  { kinds: ['tree'], label: 'Árboles' },
  // #223: only the office scope offers them (the desk scope's `fitsDeskArea` leaves doors out).
  { kinds: ['door'], label: 'Puertas' },
];

/** The kinds whose pieces that take a color come first, so the ones people paint are at hand. */
const COLORABLE_FIRST: ReadonlySet<DecorCatalogKind> = new Set(['chair', 'desk']);

/** `options` with the colorable ones first for a kind that asks for it, each part in catalog order. */
function inPaletteOrder(kind: DecorCatalogKind, options: readonly MaterialOption[]): readonly MaterialOption[] {
  if (!COLORABLE_FIRST.has(kind)) return options;
  return [...options.filter((option) => option.colorable), ...options.filter((option) => !option.colorable)];
}

/** The kinds whose tile also writes their size in tiles, which tells pieces of one look apart. */
const SIZED: ReadonlySet<DecorCatalogKind> = new Set(['table', 'sofa']);

/** The thumbnail box, in pixels. */
const THUMBNAIL_PX = 48;

/**
 * box, and a room table or a tree shrinks just enough to fit, so the small oval one
 * box, and a room table shrinks just enough to fit, so the small oval one
 * reads as big as it can.
 */
function shrinkFor(kind: DecorCatalogKind, frame: { readonly width: number; readonly height: number }): number {
  if (kind === 'desk' || kind === 'sofa') return 2;
  if (kind === 'table' || kind === 'tree') return Math.max(1, Math.ceil(Math.max(frame.width, frame.height) / THUMBNAIL_PX));
  return 1;
}

/** A catalog entry as the editor picks it, or `null` when the decor layer does not place it. */
export function decorPickOf(option: MaterialOption): DecorPick | null {
  const info = decorPieceInfo(option.piece);
  return info === null ? null : { id: option.id, info };
}

/** How the catalog sizes a piece of the layer, by id: what the scene's manifest would say. */
export function catalogDecorInfo(catalog: MaterialCatalog | null): (piece: string) => DecorPieceInfo | null {
  const known = new Map<string, DecorPieceInfo>();
  for (const { kinds } of GROUPS) {
    for (const kind of kinds) {
      for (const option of catalog?.[kind] ?? []) {
        const pick = decorPickOf(option);
        if (pick !== null) known.set(pick.id, pick.info);
      }
    }
  }
  return (piece) => known.get(piece) ?? null;
}

export interface DecorPaletteProps {
  /** The editor's brush: an entry is pressed while its piece (any rotation or color) is picked. */
  value: DecorBrush | null;
  /** The pack and uploads catalog, or `null` while it is unavailable: nothing to offer then. */
  catalog: MaterialCatalog | null;
  /** Which pieces to offer (the desk scope: what fits a desk); every one by default. */
  offers?: (info: DecorPieceInfo) => boolean;
  /** The color chosen per colorable piece, keyed by `decorColorKey` (a fabric sofa reads its armchair's); one without starts in its manifest default. */
  colors?: Readonly<Partial<Record<string, string>>>;
  onPick: (pick: DecorPick) => void;
  /** A colorable piece's color, live while its picker is dragged; also what its tile reports when clicked (picked, in its current color). */
  onColorChange?: (piece: string, color: string) => void;
  /** A colorable tile's color picker opened (`true`) or closed: the editor keeps its rail on screen while it is open. */
  onColorPicking?: (open: boolean) => void;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

function Thumbnail({
  option,
  kind,
  color,
  sized,
  preview,
}: {
  option: MaterialOption;
  kind: DecorCatalogKind;
  color: string | null;
  /** The tile also shows a size under the picture, so the picture keeps clear of it. */
  sized: boolean;
  preview?: ArtPreviewCache;
}) {
  // A chair or a sofa reads whole only with both of its layers, back first.
  const frames = kind === 'chair' ? chairPreviewFrames() : kind === 'sofa' ? sofaPreviewFrames() : [previewFrame(option)];
  return (
    <span className={sized ? `${styles.thumbnail} ${styles.sized}` : styles.thumbnail} aria-hidden="true">
      {frames.map((frame) => (
        <ArtPreviewCanvas
          key={frame.y}
          option={option}
          color={color}
          frame={frame}
          shrink={shrinkFor(kind, frame)}
          label={option.name}
          className={styles.canvas}
          preview={preview}
        />
      ))}
    </span>
  );
}

export function DecorPalette({ value, catalog, offers = () => true, colors = {}, onPick, onColorChange, onColorPicking, disabled = false, preview }: DecorPaletteProps) {
  const pressed = (id: string): boolean => value?.piece === id;
  return (
    <div className={styles.palettes}>
      {GROUPS.map(({ kinds, label }) => {
        const entries = kinds.flatMap((kind) =>
          inPaletteOrder(kind, catalog?.[kind] ?? []).flatMap((option) => {
            // A retired upload still draws where it was placed (#264), but is not offered.
            if (option.retired) return [];
            const pick = decorPickOf(option);
            return pick !== null && offers(pick.info) ? [{ kind, option, pick }] : [];
          }),
        );
        if (entries.length === 0) return null;
        return (
          <div key={label} className={styles.group}>
            <h4 className={styles.subtitle}>{label}</h4>
            <div className={styles.palette} role="group" aria-label={label}>
              {entries.map(({ kind, option, pick }) => {
                const colorable = pick.info.colorable === true && option.defaultColor !== null;
                const color = colorable ? (colors[decorColorKey(option.id)] ?? option.defaultColor) : null;
                // Room tables and sofas tell their size apart; the horizontal one, as the catalog states it.
                const size = SIZED.has(kind) ? decorSizeLabel(pick.info) : null;
                // A colorable tile picks its piece in the color it has, never toggling it off: its click also opens the picker.
                const picksColored = colorable && color !== null && onColorChange !== undefined;
                const entry = (
                  <button
                    type="button"
                    className={styles.entry}
                    aria-label={option.name}
                    title={size === null ? option.name : `${option.name} (${size})`}
                    aria-pressed={pressed(option.id)}
                    disabled={disabled}
                    onClick={() => (picksColored ? onColorChange(option.id, color) : onPick(pick))}
                  >
                    <Thumbnail option={option} kind={kind} color={color} preview={preview} sized={size !== null} />
                    {size !== null && <span className={styles.size}>{size}</span>}
                  </button>
                );
                if (!colorable || color === null) {
                  return (
                    <div key={option.id} className={styles.cell}>
                      {entry}
                    </div>
                  );
                }
                return (
                  <ColorableTile
                    key={option.id}
                    className={styles.cell}
                    label={`Color de ${option.name}`}
                    value={color}
                    disabled={disabled}
                    onChange={(hex) => onColorChange?.(option.id, hex)}
                    onPicking={onColorPicking}
                  >
                    {entry}
                  </ColorableTile>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
