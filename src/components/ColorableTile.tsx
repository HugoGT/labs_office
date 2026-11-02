import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import styles from './ColorableTile.module.css';

/**
 * How often the color is reported while a picker is dragged. Each distinct color paints a recolored
 * texture that the office keeps, so a drag must not report one per pointer move.
 */
export const LIVE_COLOR_INTERVAL_MS = 100;

export interface ColorableTileProps {
  /** Accessible name of the choice ("Color de Moqueta"); the input adds the current color to it. */
  label: string;
  /** `#rrggbb`. */
  value: string;
  /**
   * The color being chosen, lowercase `#rrggbb`, live: at most once per `LIVE_COLOR_INTERVAL_MS` while the picker
   * is dragged, and always the last one the moment it is dismissed.
   */
  onChange: (hex: string) => void;
  /**
   * The picker was opened (`true`) or is no longer open (`false`: dismissed, a press elsewhere, Escape, or the tile
   * leaving). The parent keeps what the picker hangs from on screen while it is open.
   */
  onPicking?: (open: boolean) => void;
  disabled?: boolean;
  /** The tile's own box (`position: relative`): the icon sits in its top-right corner. */
  className?: string;
  /** The tile's button, which keeps doing what it did. */
  children: ReactNode;
}

/** Eight triangles in the colors of a palette: the icon says "this one takes a color" without echoing the current one, which the tile already shows. */
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
 * A palette tile whose piece takes a color. A click anywhere on it (the pointer or the keyboard, which clicks its
 * button) opens the browser's own color picker, anchored at the icon in the tile's top-right corner, in addition to
 * what the tile's button does; the icon only tells that the tile is colorable and takes no click of its own.
 *
 * The input is uncontrolled while the picker is open. A controlled one is written back to the parent's value after
 * every step of a drag, which resets the picker under the pointer; here the parent follows the color through
 * `onChange`, and a value it sends back never reaches the input while the picker is open.
 */
export function ColorableTile({ label, value, onChange, onPicking, disabled = false, className, children }: ColorableTileProps) {
  const name = `${label}: ${value}`;
  const input = useRef<HTMLInputElement>(null);
  // The listeners below are attached once per input and read the latest callbacks.
  const latest = useRef({ onChange, onPicking });
  useEffect(() => {
    latest.current = { onChange, onPicking };
  });
  const state = useRef({
    open: false,
    pending: null as string | null,
    timer: null as number | null,
    reported: null as string | null,
    /** The color the picker opened with, and whether a step has left it since. */
    initial: '',
    touched: false,
  });
  const setOpenRef = useRef<(open: boolean) => void>(() => {});

  useEffect(() => {
    const element = input.current;
    if (element === null) return undefined;
    // Narrowed for the hoisted functions below, which do not keep `element`'s null check.
    const picker: HTMLInputElement = element;
    const live = state.current;

    const stopTimer = (): void => {
      if (live.timer === null) return;
      window.clearTimeout(live.timer);
      live.timer = null;
    };
    const flush = (): void => {
      stopTimer();
      if (live.pending === null) return;
      const hex = live.pending;
      live.pending = null;
      if (hex === live.reported) return;
      live.reported = hex;
      latest.current.onChange(hex);
    };
    // The page sees a press anywhere on it, or an Escape, once the picker's own popup no longer has them.
    const leave = (event: Event): void => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      setOpen(false);
    };
    function setOpen(open: boolean): void {
      if (live.open === open) return;
      live.open = open;
      if (open) {
        live.initial = picker.value.toLowerCase();
        live.reported = live.initial;
        live.touched = false;
        // A press anywhere on the page is the picker's own outside click; its popup lives outside the page.
        document.addEventListener('pointerdown', leave, true);
        document.addEventListener('keydown', leave, true);
      } else {
        document.removeEventListener('pointerdown', leave, true);
        document.removeEventListener('keydown', leave, true);
        flush();
      }
      latest.current.onPicking?.(open);
    }
    setOpenRef.current = setOpen;

    const step = (): void => {
      // Steps only exist while the picker is open: one arriving after it was cancelled is its own revert, not a choice.
      if (!live.open) return;
      const value = picker.value.toLowerCase();
      // Escape in Chromium's picker closes it and puts the color it opened with back as one more `input`: measured with
      // a real Escape, the page gets that and no key event at all, no `change` either. The color the user had chosen
      // is theirs to keep (the piece stays in hand, and a second Escape, which the page does get, puts it down), so
      // that revert is not applied: the input goes back to the last color and the picker counts as closed. A drag that
      // lands on the opening color again closes it the same way, which is rare enough.
      if (live.touched && value === live.initial) {
        picker.value = live.pending ?? live.reported ?? live.initial;
        setOpen(false);
        return;
      }
      live.pending = value;
      if (value !== live.initial) live.touched = true;
      live.timer ??= window.setTimeout(flush, LIVE_COLOR_INTERVAL_MS);
    };
    const settle = (): void => {
      live.pending = element.value.toLowerCase();
      setOpen(false);
      flush();
    };
    element.addEventListener('input', step);
    element.addEventListener('change', settle);
    return () => {
      element.removeEventListener('input', step);
      element.removeEventListener('change', settle);
      setOpen(false);
      if (live.timer !== null) window.clearTimeout(live.timer);
      live.timer = null;
      setOpenRef.current = () => {};
    };
  }, []);

  // A value the parent holds that this input did not report (a restored or reset color) reaches the input, never while
  // the picker is open, and never the echo of the last color the input itself reported.
  useEffect(() => {
    const element = input.current;
    const live = state.current;
    if (element === null || live.open) return;
    const next = value.toLowerCase();
    if (next === live.reported) return;
    if (element.value.toLowerCase() !== next) element.value = value;
    live.reported = null;
  }, [value]);

  const open = (event: MouseEvent): void => {
    const element = input.current;
    // `click()` on the input (browsers without `showPicker`) bounces back up to this tile: it is not a new open.
    if (disabled || element === null || event.target === element) return;
    setOpenRef.current(true);
    try {
      if (typeof element.showPicker === 'function') element.showPicker();
      else element.click();
    } catch {
      // The browser refused to open it (no user activation, a disabled input): nothing is open then.
      setOpenRef.current(false);
    }
  };

  return (
    <div className={className} onClick={open}>
      {children}
      <span className={disabled ? `${styles.corner} ${styles.disabled}` : styles.corner}>
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {TRIANGLES.map((triangle) => (
            <polygon key={triangle.points} points={triangle.points} fill={triangle.fill} />
          ))}
        </svg>
        <input ref={input} type="color" className={styles.input} defaultValue={value} disabled={disabled} tabIndex={-1} aria-label={name} title={name} />
      </span>
    </div>
  );
}
