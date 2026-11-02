import { useEffect, useRef } from 'react';
import styles from './TileColorInput.module.css';

export interface TileColorInputProps {
  /** Accessible name of the choice ("Color de Moqueta"); the input adds the current color to it. */
  label: string;
  /** `#rrggbb`. */
  value: string;
  /**
   * The color the user settled on, lowercase `#rrggbb`: called when the picker is dismissed (the native `change`),
   * never at each step of a drag, so the parent can act on it (even hide the picker's own tile) without cutting the
   * drag short.
   */
  onChange: (hex: string) => void;
  disabled?: boolean;
}

/** Eight triangles in the colors of a palette: the icon says "pick a color" without echoing the current one, which the tile already shows. */
const TRIANGLES: readonly { points: string; fill: string }[] = [
  { points: '0,0 12,0 12,12', fill: '#0ea5a0' },
  { points: '12,0 24,0 12,12', fill: '#f2a40f' },
  { points: '24,0 24,12 12,12', fill: '#e8517a' },
  { points: '24,12 24,24 12,12', fill: '#7a3fb0' },
  { points: '24,24 12,24 12,12', fill: '#3b66d0' },
  { points: '12,24 0,24 12,12', fill: '#2eb872' },
  { points: '0,24 0,12 12,12', fill: '#d6402b' },
  { points: '0,12 0,0 12,12', fill: '#8fc93a' },
];

/**
 * The color choice of a palette tile: a small multicolor icon in the tile's
 * top-right corner that opens the browser's own color picker straight away,
 * with no list of suggestions in between. The native input is invisible over
 * the icon, so a click anywhere on it opens the picker and the keyboard
 * reaches it like any input. The parent must be `position: relative`; the
 * tile's own button stays what picks the piece.
 *
 * The input is uncontrolled while the picker is open. React's `onChange` fires at every `input` step of a drag, and a
 * controlled input is written back to the parent's value after each one: either resets or closes the picker under the
 * pointer, so only the first click of a drag would count. The browser's own `change` marks the end of the choice.
 */
export function TileColorInput({ label, value, onChange, disabled = false }: TileColorInputProps) {
  const name = `${label}: ${value}`;
  const input = useRef<HTMLInputElement>(null);
  // The native listener is attached once per input and reads the latest callback.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const element = input.current;
    if (element === null) return undefined;
    const settle = (): void => latest.current(element.value.toLowerCase());
    element.addEventListener('change', settle);
    return () => element.removeEventListener('change', settle);
  }, []);
  // A new value from the parent (a restored or reset color) reaches the input; the one just settled is already there.
  useEffect(() => {
    const element = input.current;
    if (element !== null && element.value.toLowerCase() !== value.toLowerCase()) element.value = value;
  }, [value]);
  return (
    <span className={disabled ? `${styles.corner} ${styles.disabled}` : styles.corner}>
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {TRIANGLES.map((triangle) => (
          <polygon key={triangle.points} points={triangle.points} fill={triangle.fill} />
        ))}
      </svg>
      <input ref={input} type="color" className={styles.input} defaultValue={value} disabled={disabled} aria-label={name} title={name} />
    </span>
  );
}
