import { terrainFloorPieceId } from '../game/artContract';
import type { MaterialOption, PreviewFrame } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { LAYOUT_MATERIALS, type LayoutMaterial } from '../game/officeLayout';
import { TERRAIN_FLAT_COLORS } from '../game/terrainRender';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import styles from './TerrainPalette.module.css';

/**
 * The floor palette of the terrain editor: one entry per terrain material,
 * each with a thumbnail cut from its pack floor, then the void as an eraser.
 * Presentational: the editor owns which entry is picked and what a click on
 * the map does with it.
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

/** Floors in drawing order, the eraser last. */
const PALETTE_ORDER: readonly LayoutMaterial[] = [...LAYOUT_MATERIALS.filter((material) => material !== 'void'), 'void'];

/** A corner of the 96px floor motif at 1:1: enough to read the texture, small enough for a grid. */
const THUMBNAIL: PreviewFrame = { x: 0, y: 0, width: 48, height: 48 };

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export interface TerrainPaletteProps {
  /** The picked entry, or `null`. */
  value: LayoutMaterial | null;
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
            aria-pressed={value === material}
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
