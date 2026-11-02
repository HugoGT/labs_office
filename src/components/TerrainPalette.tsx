import { terrainFloorPieceId } from '../game/artContract';
import { previewFrame, type MaterialOption, type PreviewFrame } from '../game/artMaterials';
import type { Swatch } from '../art/customCharacter';
import type { ArtPreviewCache } from '../game/artPreview';
import { LAYOUT_MATERIALS, WALL_PIECES, isColorableTerrainMaterial, type LayoutMaterial, type WallPieceId } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { isTerrainFloorPieceId } from '../game/terrainFloors';
import { TERRAIN_FLAT_COLORS } from '../game/terrainRender';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import { ColorPicker } from './ColorPicker';
import { DECOR_COLORS } from './DecorPalette';
import styles from './TerrainPalette.module.css';

/**
 * The palettes of the terrain editor. Floors: one entry per terrain
 * material, each with a thumbnail cut from its pack floor, then the void as
 * an eraser; carpet also carries a color picker (#222), like the painted
 * desk's tile in the decor palette. Walls: one picture-only tile per wall
 * piece, cut from its pack sheet and named by its tooltip, like the decor
 * palette's, then the wall eraser. Presentational: the editor owns which
 * entry is picked (one across every palette) and what a click on the map
 * does with it.
 *
 * An approved uploaded floor (S13) is an entry too, after the built-in floors
 * and before the eraser: it paints wood with that piece over it, so it has
 * the thumbnail and the name of its own sheet and no color.
 */

/** UI names of the materials. */
export const TERRAIN_MATERIAL_LABELS: Readonly<Record<LayoutMaterial, string>> = {
  void: 'Vacío',
  water: 'Agua',
  grass: 'Césped',
  dirt: 'Tierra',
  sand: 'Arena',
  cobblestone: 'Empedrado',
  wood: 'Madera',
  tile: 'Baldosa',
  carpet: 'Moqueta',
};

/** Floors from the highest drawing priority down; void, the lowest, is the eraser and comes last. */
const PALETTE_ORDER: readonly LayoutMaterial[] = [...LAYOUT_MATERIALS].reverse();

/** A corner of the 96px floor motif at 1:1: enough to read the texture, small enough for a grid. */
const THUMBNAIL: PreviewFrame = { x: 0, y: 0, width: 48, height: 48 };

/**
 * Quick picks for a colorable floor: its pack default first, then the decor
 * palette's colors (#222), so carpet and painted desks share one set.
 */
function floorColors(defaultColor: string): readonly Swatch[] {
  return [{ hex: defaultColor, label: 'Por defecto' }, ...DECOR_COLORS.filter((swatch) => swatch.hex !== defaultColor)];
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export interface TerrainPaletteProps {
  /** The editor's brush: an entry here is pressed only while its floor is picked. */
  value: TerrainBrush | null;
  onPick: (material: LayoutMaterial) => void;
  /** An approved uploaded floor was clicked (S13), by its piece id. */
  onPickFloor?: (pieceId: string) => void;
  /**
   * Floor pieces of the pack catalog, or `null` while it is unavailable: flat swatches then.
   * The uploaded ones among them become entries of their own.
   */
  floors: readonly MaterialOption[] | null;
  /** The color chosen per colorable floor; one without starts in its pack default. */
  colors?: Readonly<Partial<Record<LayoutMaterial, string>>>;
  onColorChange?: (material: LayoutMaterial, color: string) => void;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function TerrainPalette({ value, onPick, onPickFloor, floors, colors = {}, onColorChange, disabled = false, preview }: TerrainPaletteProps) {
  const builtInIds = new Set<string>(LAYOUT_MATERIALS.flatMap((kind) => (kind === 'void' ? [] : [terrainFloorPieceId(kind)])));
  const uploaded = (floors ?? []).filter((option) => isTerrainFloorPieceId(option.id) && !builtInIds.has(option.id) && !option.retired);
  const material = (kind: LayoutMaterial) => {
    const option = kind === 'void' ? undefined : floors?.find((candidate) => candidate.id === terrainFloorPieceId(kind));
    const label = TERRAIN_MATERIAL_LABELS[kind];
    const defaultColor = isColorableTerrainMaterial(kind) ? (option?.defaultColor ?? null) : null;
    const color = defaultColor === null ? null : (colors[kind] ?? defaultColor);
    const entry = (
      <button
        key={kind}
        type="button"
        className={styles.entry}
        // The plain wood brush only: an uploaded floor is wood underneath but its own entry's.
        aria-pressed={value?.kind === 'floor' && value.material === kind && value.floor === undefined}
        disabled={disabled}
        title={kind === 'void' ? 'Goma: devuelve el bloque al vacío' : undefined}
        onClick={() => onPick(kind)}
      >
        {/* Decorative: the button is named by its label. */}
        <span className={styles.thumbnail} aria-hidden="true" style={{ background: hexColor(TERRAIN_FLAT_COLORS[kind]) }}>
          {option !== undefined && <ArtPreviewCanvas option={option} color={color} frame={THUMBNAIL} label={label} className={styles.canvas} preview={preview} />}
        </span>
        <span className={styles.label}>{label}</span>
      </button>
    );
    if (defaultColor === null || color === null) return entry;
    // Chosen before or after picking, like the painted desk's tile (#222).
    return (
      <div key={kind} className={styles.cell}>
        {entry}
        <ColorPicker
          label={`Color de ${label}`}
          caption=""
          presets={floorColors(defaultColor)}
          value={color}
          compact
          disabled={disabled}
          onChange={(hex) => onColorChange?.(kind, hex)}
        />
      </div>
    );
  };
  return (
    <div className={styles.palette} role="group" aria-label="Suelos">
      {PALETTE_ORDER.filter((kind) => kind !== 'void').map(material)}
      {uploaded.map((option) => (
        <button
          key={option.id}
          type="button"
          className={styles.entry}
          aria-pressed={value?.kind === 'floor' && value.floor === option.id}
          disabled={disabled}
          onClick={() => onPickFloor?.(option.id)}
        >
          {/* Decorative: the button is named by its label. */}
          <span className={styles.thumbnail} aria-hidden="true" style={{ background: hexColor(TERRAIN_FLAT_COLORS.wood) }}>
            <ArtPreviewCanvas option={option} color={null} frame={THUMBNAIL} label={option.name} className={styles.canvas} preview={preview} />
          </span>
          <span className={styles.label}>{option.name}</span>
        </button>
      ))}
      {material('void')}
    </div>
  );
}

/** UI names of the wall pieces (the manifest's names). */
export const WALL_PIECE_LABELS: Readonly<Record<WallPieceId, string>> = {
  'wall-brick': 'Ladrillo',
  'wall-stone': 'Piedra',
  'wall-plaster': 'Yeso',
  'wall-glass': 'Vidrio',
};

/** The wall eraser says only this, in its text, its tooltip and its accessible name (#223). */
export const WALL_ERASER_LABEL = 'Borrador';

/** The sign before the eraser's word (Unicode has no eraser emoji): decorative, the word names the button. */
const WALL_ERASER_SIGN = '\u26D4';

/** Flat swatches while the pack catalog is unavailable: a hint of each material, not its art. */
const WALL_FLAT_COLORS: Readonly<Record<WallPieceId, number>> = {
  'wall-brick': 0x9a4a3a,
  'wall-stone': 0x7d8288,
  'wall-plaster': 0xd8d2c4,
  'wall-glass': 0x9cc9de,
};

/** The 16px wall frame at three canvas pixels per art pixel: the 48px thumbnail, still pixel exact. */
const WALL_THUMBNAIL_SCALE = 3;

export interface WallPaletteProps {
  /** The editor's brush: an entry here is pressed only while its wall (or the eraser) is picked. */
  value: TerrainBrush | null;
  onPick: (piece: WallPieceId) => void;
  /** Wall pieces of the pack catalog, or `null` while it is unavailable: flat swatches then. */
  walls: readonly MaterialOption[] | null;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function WallPalette({ value, onPick, walls, disabled = false, preview }: WallPaletteProps) {
  const pressed = (piece: WallPieceId): boolean => value?.kind === 'wall' && value.piece === piece;
  return (
    <div className={styles.palette} role="group" aria-label="Paredes">
      {WALL_PIECES.map((piece) => {
        const option = walls?.find((candidate) => candidate.id === piece);
        const label = WALL_PIECE_LABELS[piece];
        return (
          <button
            key={piece}
            type="button"
            className={styles.tile}
            aria-label={label}
            title={label}
            aria-pressed={pressed(piece)}
            disabled={disabled}
            onClick={() => onPick(piece)}
          >
            {/* The flat color stands in for the art only while the pack catalog is unavailable. */}
            <span className={styles.tileThumbnail} aria-hidden="true" style={option === undefined ? { background: hexColor(WALL_FLAT_COLORS[piece]) } : undefined}>
              {option !== undefined && (
                <ArtPreviewCanvas option={option} color={null} frame={previewFrame(option)} scale={WALL_THUMBNAIL_SCALE} label={label} className={styles.tileCanvas} preview={preview} />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface WallEraserProps {
  /** The editor's brush: the entry is pressed only while the wall eraser is picked. */
  value: TerrainBrush | null;
  /** Reports the click as "no wall" (`null`), what the wall brush takes for the eraser. */
  onPick: (piece: null) => void;
  disabled?: boolean;
}

/**
 * The wall eraser, one small button of its own (#223): it sits on its own
 * line above «Múltiple», not among the walls, with «⛔ Borrador» for all its words.
 */
export function WallEraser({ value, onPick, disabled = false }: WallEraserProps) {
  return (
    <button
      type="button"
      className={styles.eraser}
      aria-pressed={value?.kind === 'wall' && value.piece === null}
      disabled={disabled}
      title={WALL_ERASER_LABEL}
      onClick={() => onPick(null)}
    >
      <span aria-hidden="true">{WALL_ERASER_SIGN}</span> {WALL_ERASER_LABEL}
    </button>
  );
}
