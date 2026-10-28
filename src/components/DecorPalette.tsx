import type { Swatch } from '../art/customCharacter';
import { chairPreviewFrames, previewFrame, type MaterialCatalog, type MaterialOption } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { decorSizeLabel, decorTileName, type DecorBrush } from '../game/decorEditor';
import { decorPieceInfo, type DecorPieceInfo } from '../game/officeDecor';
import type { DecorPick } from '../hooks/useDecorEditor';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import { ColorPicker } from './ColorPicker';
import styles from './DecorPalette.module.css';

/**
 * The palette of the decor editor (#208): every piece the office decor layer
 * places, grouped by kind, each with a thumbnail cut from its sheet (pack and
 * approved uploads, from the same catalog as the other palettes). A tile
 * names only what tells it apart in its group (the heading says the kind);
 * a room table also shows its size, and a colorable piece carries a color
 * picker, chosen before picking because the rail steps aside once a piece is
 * picked. Presentational: the editor owns which entry is picked, the colors
 * and what a click on the map does.
 */

type DecorCatalogKind = 'chair' | 'desk' | 'table' | 'plant' | 'door';

/** The groups in palette order, named for the person picking. */
const GROUPS: readonly { kind: DecorCatalogKind; label: string }[] = [
  { kind: 'chair', label: 'Sillas' },
  { kind: 'desk', label: 'Mesas de escritorio' },
  { kind: 'table', label: 'Mesas de sala' },
  { kind: 'plant', label: 'Plantas' },
  // #223: only the office scope offers them (the desk scope's `fitsDeskArea` leaves doors out).
  { kind: 'door', label: 'Puertas' },
];

/**
 * Quick picks for a colorable piece, the painted desk's default first; any
 * other color comes from the picker's own "Otro color".
 */
export const DECOR_COLORS: readonly Swatch[] = [
  { hex: '#4f9a8a', label: 'Verde azulado' },
  { hex: '#f3efe6', label: 'Blanco' },
  { hex: '#9aa3ad', label: 'Gris' },
  { hex: '#3a3f45', label: 'Grafito' },
  { hex: '#c0392b', label: 'Rojo' },
  { hex: '#e08a3c', label: 'Naranja' },
  { hex: '#e6c84a', label: 'Amarillo' },
  { hex: '#5a9a4f', label: 'Verde' },
  { hex: '#3c6ac8', label: 'Azul' },
  { hex: '#7a4fb0', label: 'Morado' },
  { hex: '#d77fa1', label: 'Rosa' },
];

/** Under the doors (#223, #233): where they go, since nothing else on the map says so. */
const DOOR_HINT = 'Va entre dos paredes, una en cada extremo: la puerta ocupa 2 casillas y la doble 3.';

/** The thumbnail box, in pixels. */
const THUMBNAIL_PX = 48;

/**
 * Sheet pixels per thumbnail pixel: a desk cell (96x104) is bigger than the
 * box, and a room table shrinks just enough to fit, so the small oval one
 * reads as big as it can.
 */
function shrinkFor(kind: DecorCatalogKind, frame: { readonly width: number; readonly height: number }): number {
  if (kind === 'desk') return 2;
  if (kind === 'table') return Math.max(1, Math.ceil(Math.max(frame.width, frame.height) / THUMBNAIL_PX));
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
  for (const { kind } of GROUPS) {
    for (const option of catalog?.[kind] ?? []) {
      const pick = decorPickOf(option);
      if (pick !== null) known.set(pick.id, pick.info);
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
  /** The color chosen per colorable piece; one without starts in its manifest default. */
  colors?: Readonly<Record<string, string>>;
  onPick: (pick: DecorPick) => void;
  onColorChange?: (piece: string, color: string) => void;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

function Thumbnail({ option, kind, color, preview }: { option: MaterialOption; kind: DecorCatalogKind; color: string | null; preview?: ArtPreviewCache }) {
  // A chair reads whole only with both of its layers, back first.
  const frames = kind === 'chair' ? chairPreviewFrames() : [previewFrame(option)];
  return (
    <span className={styles.thumbnail} aria-hidden="true">
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

export function DecorPalette({ value, catalog, offers = () => true, colors = {}, onPick, onColorChange, disabled = false, preview }: DecorPaletteProps) {
  const pressed = (id: string): boolean => value?.piece === id;
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
              {entries.map(({ option, pick }) => {
                const colorable = pick.info.colorable === true && option.defaultColor !== null;
                const color = colorable ? (colors[option.id] ?? option.defaultColor) : null;
                // Room tables tell their size apart; the horizontal one, as the catalog states it.
                const size = kind === 'table' ? decorSizeLabel(pick.info) : null;
                return (
                  <div key={option.id} className={styles.cell}>
                    <button
                      type="button"
                      className={styles.entry}
                      aria-label={option.name}
                      title={size === null ? option.name : `${option.name} (${size})`}
                      aria-pressed={pressed(option.id)}
                      disabled={disabled}
                      onClick={() => onPick(pick)}
                    >
                      <Thumbnail option={option} kind={kind} color={color} preview={preview} />
                      <span className={styles.label} data-tile-name>
                        {decorTileName(kind, option.name)}
                      </span>
                      {size !== null && (
                        <span className={styles.size} data-tile-size>
                          {size}
                        </span>
                      )}
                    </button>
                    {colorable && color !== null && (
                      <ColorPicker
                        label={`Color de ${option.name}`}
                        caption=""
                        presets={DECOR_COLORS}
                        value={color}
                        compact
                        disabled={disabled}
                        onChange={(hex) => onColorChange?.(option.id, hex)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {kind === 'door' && <p className={styles.size}>{DOOR_HINT}</p>}
          </div>
        );
      })}
    </div>
  );
}
