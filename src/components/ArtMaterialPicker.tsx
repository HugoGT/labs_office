import { defaultAppearance, previewFrame, type MaterialOption } from '../game/artMaterials';
import type { ArtAppearance } from '../game/artPack';
import { pagePreviewCache, type ArtPreviewCache } from '../game/artPreview';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';
import styles from './ArtMaterialPicker.module.css';

/**
 * Material and color of a desk or room being created (art migration, step 7).
 * Presentational: the creation form owns the value. Only the colorable
 * material shows a color picker; the others keep their exported look.
 *
 * The preview is cut from the same sheet and painted by the same generator as
 * the office (`artPreview.ts`), so what is picked here is what the map draws.
 */

export interface ArtMaterialPickerProps {
  /** Prefix of the control ids, unique per form. */
  id: string;
  legend: string;
  options: readonly MaterialOption[];
  value: ArtAppearance;
  onChange: (next: ArtAppearance) => void;
  disabled?: boolean;
  preview?: ArtPreviewCache;
}

export function ArtMaterialPicker({
  id,
  legend,
  options,
  value,
  onChange,
  disabled = false,
  preview = pagePreviewCache,
}: ArtMaterialPickerProps) {
  const selected = options.find((option) => option.id === value.materialId) ?? options[0];
  const color = selected?.colorable ? (value.color ?? selected.defaultColor) : null;

  if (selected === undefined) return null;

  function pickMaterial(materialId: string): void {
    const option = options.find((candidate) => candidate.id === materialId);
    if (option !== undefined) onChange(defaultAppearance(option));
  }

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.controls}>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.hint} htmlFor={`${id}-material`}>
              Material
            </label>
            <select
              id={`${id}-material`}
              className={styles.select}
              value={selected.id}
              onChange={(event) => pickMaterial(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          {color !== null ? (
            <div className={styles.field}>
              <label className={styles.hint} htmlFor={`${id}-color`}>
                Color
              </label>
              <input
                id={`${id}-color`}
                className={styles.color}
                type="color"
                value={color}
                onChange={(event) => onChange({ materialId: selected.id, color: event.target.value.toLowerCase() })}
              />
            </div>
          ) : (
            <p className={styles.hint}>Este material conserva su propio aspecto.</p>
          )}
        </div>
        <ArtPreviewCanvas
          option={selected}
          color={color}
          frame={previewFrame(selected)}
          label={`Vista previa: ${selected.name}${color === null ? '' : `, ${color}`}`}
          className={styles.preview}
          preview={preview}
        />
      </div>
      <p className={styles.hint}>El material y el color no se pueden cambiar después de crear.</p>
    </fieldset>
  );
}
