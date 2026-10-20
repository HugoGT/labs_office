import { useEffect, useId, useRef } from 'react';
import type { Swatch } from '../art/customCharacter';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover';
import styles from './StylePicker.module.css';

export interface ColorPickerProps {
  /** Accessible name of the choice ("Color de pelo"); the button adds the current color to it. */
  label: string;
  /** Short visible caption under the button ("Color"). */
  caption: string;
  /** Curated colors offered as quick picks; any other color comes from the free picker. */
  presets: readonly Swatch[];
  /** `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
}

/**
 * A color of the character creator: a swatch button showing the current
 * color opens a popover with the curated presets and a native color input
 * for any other RGB, the way desks take a color (`ArtMaterialPicker`). A
 * preset closes it; the free picker keeps it open while it is dragged.
 */
export function ColorPicker({ label, caption, presets, value, onChange }: ColorPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const inputId = useId();
  const popover = useAnchoredPopover(triggerRef, popoverRef);
  const name = presets.find((preset) => preset.hex === value)?.label ?? value;

  useEffect(() => {
    if (!popover.open) return;
    const pressed = popoverRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    (pressed ?? popoverRef.current?.querySelector<HTMLElement>('button, input'))?.focus();
  }, [popover.open]);

  const pickPreset = (hex: string) => {
    popover.close();
    if (hex !== value) onChange(hex);
  };

  return (
    <div className={styles.picker}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${label}: ${name}`}
        title={`${label}: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        aria-controls={popover.open ? popoverId : undefined}
        onClick={popover.toggle}
      >
        <span data-swatch className={styles.swatchLarge} style={{ backgroundColor: value }} aria-hidden="true" />
      </button>
      <span className={styles.caption} aria-hidden="true">
        {caption}
      </span>
      {popover.open && (
        <div
          ref={popoverRef}
          id={popoverId}
          className={styles.menu}
          style={popover.style}
          role="dialog"
          aria-label={label}
          onKeyDown={popover.onKeyDown}
        >
          <div className={styles.presets}>
            {presets.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                className={styles.preset}
                aria-label={preset.label}
                title={preset.label}
                aria-pressed={preset.hex === value}
                onClick={() => pickPreset(preset.hex)}
              >
                <span className={styles.swatch} style={{ backgroundColor: preset.hex }} aria-hidden="true" />
              </button>
            ))}
          </div>
          <label className={styles.free} htmlFor={inputId}>
            <span>Otro color</span>
            <input
              id={inputId}
              type="color"
              className={styles.colorInput}
              value={value}
              onChange={(event) => onChange(event.target.value.toLowerCase())}
            />
          </label>
        </div>
      )}
    </div>
  );
}
