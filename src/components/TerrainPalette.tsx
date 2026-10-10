import { terrainFloorPieceId } from '../game/artContract';
import { chairPreviewFrames, previewFrame, type MaterialOption, type PreviewFrame } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { LAYOUT_MATERIALS, WALL_PIECES, type LayoutMaterial, type WallPieceId } from '../game/officeLayout';
import { CHAIR_PIECES, type ChairPieceId } from '../game/seating';
import type { TerrainBrush } from '../game/terrainEditor';
import { TERRAIN_FLAT_COLORS } from '../game/terrainRender';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import styles from './TerrainPalette.module.css';

/**
 * The palettes of the terrain editor. Floors: one entry per terrain
 * material, each with a thumbnail cut from its pack floor, then the void as
 * an eraser. Walls: one entry per wall piece, each with a thumbnail cut from
 * its pack sheet, then the wall eraser. Chairs: one entry per chair piece,
 * its down-facing cell as the thumbnail, then the chair eraser.
 * Presentational: the editor owns which entry is picked (one across every
 * palette) and what a click on the map does with it.
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

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export interface TerrainPaletteProps {
  /** The editor's brush: an entry here is pressed only while its floor is picked. */
  value: TerrainBrush | null;
  onPick: (material: LayoutMaterial) => void;
  /** Floor pieces of the pack catalog, or `null` while it is unavailable: flat swatches then. */
  floors: readonly MaterialOption[] | null;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function TerrainPalette({ value, onPick, floors, disabled = false, preview }: TerrainPaletteProps) {
  return (
    <div className={styles.palette} role="group" aria-label="Suelos">
      {PALETTE_ORDER.map((material) => {
        const option = material === 'void' ? undefined : floors?.find((candidate) => candidate.id === terrainFloorPieceId(material));
        const label = TERRAIN_MATERIAL_LABELS[material];
        return (
          <button
            key={material}
            type="button"
            className={styles.entry}
            aria-pressed={value?.kind === 'floor' && value.material === material}
            disabled={disabled}
            title={material === 'void' ? 'Goma: devuelve el bloque al vacío' : undefined}
            onClick={() => onPick(material)}
          >
            {/* Decorative: the button is named by its label. */}
            <span className={styles.thumbnail} aria-hidden="true" style={{ background: hexColor(TERRAIN_FLAT_COLORS[material]) }}>
              {option !== undefined && <ArtPreviewCanvas option={option} color={null} frame={THUMBNAIL} label={label} className={styles.canvas} preview={preview} />}
            </span>
            <span className={styles.label}>{label}</span>
          </button>
        );
      })}
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

export const WALL_ERASER_LABEL = 'Quitar pared';

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
  /** The wall piece, or `null` for the eraser. */
  onPick: (piece: WallPieceId | null) => void;
  /** Wall pieces of the pack catalog, or `null` while it is unavailable: flat swatches then. */
  walls: readonly MaterialOption[] | null;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function WallPalette({ value, onPick, walls, disabled = false, preview }: WallPaletteProps) {
  const pressed = (piece: WallPieceId | null): boolean => value?.kind === 'wall' && value.piece === piece;
  return (
    <div className={styles.palette} role="group" aria-label="Paredes">
      {WALL_PIECES.map((piece) => {
        const option = walls?.find((candidate) => candidate.id === piece);
        const label = WALL_PIECE_LABELS[piece];
        return (
          <button key={piece} type="button" className={styles.entry} aria-pressed={pressed(piece)} disabled={disabled} onClick={() => onPick(piece)}>
            <span className={styles.thumbnail} aria-hidden="true" style={{ background: hexColor(WALL_FLAT_COLORS[piece]) }}>
              {option !== undefined && (
                <ArtPreviewCanvas option={option} color={null} frame={previewFrame(option)} scale={WALL_THUMBNAIL_SCALE} label={label} className={styles.canvas} preview={preview} />
              )}
            </span>
            <span className={styles.label}>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={styles.entry}
        aria-pressed={pressed(null)}
        disabled={disabled}
        title="Goma: quita la pared de cada esquina"
        onClick={() => onPick(null)}
      >
        <span className={`${styles.thumbnail} ${styles.eraser}`} aria-hidden="true" />
        <span className={styles.label}>{WALL_ERASER_LABEL}</span>
      </button>
    </div>
  );
}

/** UI names of the chair pieces (the manifest's names), distinct from the floor names next to them. */
export const CHAIR_PIECE_LABELS: Readonly<Record<ChairPieceId, string>> = {
  'chair-wood': 'Silla de madera',
  'chair-metal': 'Silla de metal',
  'chair-leather': 'Silla de cuero',
  'chair-gamer': 'Silla gamer',
};

export const CHAIR_ERASER_LABEL = 'Quitar silla';

/** Flat swatches while the pack catalog is unavailable: a hint of each chair, not its art. */
const CHAIR_FLAT_COLORS: Readonly<Record<ChairPieceId, number>> = {
  'chair-wood': 0x8b5a2b,
  'chair-metal': 0x9ca3af,
  'chair-leather': 0x5b3a29,
  'chair-gamer': 0xb91c1c,
};

export interface ChairPaletteProps {
  /** The editor's brush: an entry here is pressed only while its chair (or the eraser) is picked, whatever way it faces. */
  value: TerrainBrush | null;
  /** The chair piece, or `null` for the eraser. */
  onPick: (piece: ChairPieceId | null) => void;
  /** Chair pieces of the pack catalog, or `null` while it is unavailable: flat swatches then. */
  chairs: readonly MaterialOption[] | null;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function ChairPalette({ value, onPick, chairs, disabled = false, preview }: ChairPaletteProps) {
  const pressed = (piece: ChairPieceId | null): boolean => value?.kind === 'chair' && value.piece === piece;
  return (
    <div className={styles.palette} role="group" aria-label="Sillas">
      {CHAIR_PIECES.map((piece) => {
        const option = chairs?.find((candidate) => candidate.id === piece);
        const label = CHAIR_PIECE_LABELS[piece];
        return (
          <button key={piece} type="button" className={styles.entry} aria-pressed={pressed(piece)} disabled={disabled} onClick={() => onPick(piece)}>
            <span className={`${styles.thumbnail} ${styles.layered}`} aria-hidden="true" style={{ background: hexColor(CHAIR_FLAT_COLORS[piece]) }}>
              {/* Back layer, then front layer on top: the chair as the map draws it. */}
              {option !== undefined &&
                chairPreviewFrames().map((frame) => (
                  <ArtPreviewCanvas key={frame.y} option={option} color={null} frame={frame} label={label} className={`${styles.canvas} ${styles.layer}`} preview={preview} />
                ))}
            </span>
            <span className={styles.label}>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={styles.entry}
        aria-pressed={pressed(null)}
        disabled={disabled}
        title="Goma: quita la silla de cada casilla"
        onClick={() => onPick(null)}
      >
        <span className={`${styles.thumbnail} ${styles.eraser}`} aria-hidden="true" />
        <span className={styles.label}>{CHAIR_ERASER_LABEL}</span>
      </button>
    </div>
  );
}
