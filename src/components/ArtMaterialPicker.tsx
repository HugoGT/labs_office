import { useEffect, useRef } from 'react';
import { defaultAppearance, previewFrame, type MaterialOption } from '../game/artMaterials';
import type { ArtAppearance } from '../game/artPack';
import { pagePreviewCache, type ArtPreviewCache } from '../game/artPreview';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selected = options.find((option) => option.id === value.materialId) ?? options[0];
  const color = selected?.colorable ? (value.color ?? selected.defaultColor) : null;

  useEffect(() => {
    if (selected === undefined) return undefined;
    let cancelled = false;
    void preview.sheet(selected, color).then((sheet) => {
      const canvas = canvasRef.current;
      if (cancelled || sheet === null || canvas === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;
      const frame = previewFrame(selected);
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, color, preview]);

  if (selected === undefined) return null;
  const frame = previewFrame(selected);

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
        <canvas
          ref={canvasRef}
          className={styles.preview}
          role="img"
          aria-label={`Vista previa: ${selected.name}${color === null ? '' : `, ${color}`}`}
          width={frame.width}
          height={frame.height}
          // One sheet pixel per CSS pixel: any other scale would blur or skip art pixels.
          style={{ width: frame.width, height: frame.height }}
        />
      </div>
      <p className={styles.hint}>El material y el color no se pueden cambiar después de crear.</p>
    </fieldset>
  );
}
