import { useRef } from 'react';
import type { Swatch } from '../art/customCharacter';
import styles from './StylePicker.module.css';

export interface ColorPickerProps {
  /** Accessible name of the choice ("Color de pelo"); the button adds the current color to it. */
  label: string;
  /** Short visible caption under the button ("Color"). */
  caption: string;
  /** Curated colors: one the value matches names it ("Negro"); any other is named by its hex. */
  presets: readonly Swatch[];
  /** `#rrggbb`. */
  value: string;
  /** Every color the picker is dragged through, lowercase `#rrggbb`. */
  onChange: (hex: string) => void;
  disabled?: boolean;
}

/**
 * A color of the character creator: a swatch button showing the current color opens the browser's own color
 * picker, the whole spectrum, the way a colorable floor of the terrain palette does (`ColorableTile`). Unlike that
 * tile it needs no palette icon: the swatch already is the color.
 */
export function ColorPicker({ label, caption, presets, value, onChange, disabled = false }: ColorPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const name = presets.find((preset) => preset.hex === value)?.label ?? value;

  const open = (): void => {
    const element = input.current;
    if (disabled || element === null) return;
    try {
      if (typeof element.showPicker === 'function') element.showPicker();
      else element.click();
    } catch {
      // The browser refused to open it (no user activation): the swatch stays as it is.
    }
  };

  return (
    <div className={styles.picker}>
      <span className={styles.anchor}>
        <button type="button" className={styles.trigger} disabled={disabled} aria-label={`${label}: ${name}`} title={`${label}: ${name}`} onClick={open}>
          <span data-swatch className={styles.swatchLarge} style={{ backgroundColor: value }} aria-hidden="true" />
        </button>
        {/* Invisible but real: the browser anchors its picker here. Controlled is safe: every step is echoed at once. */}
        <input
          ref={input}
          type="color"
          className={styles.colorInput}
          value={value}
          disabled={disabled}
          tabIndex={-1}
          aria-label={label}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
      </span>
      {caption !== '' && (
        <span className={styles.caption} aria-hidden="true">
          {caption}
        </span>
      )}
    </div>
  );
}
