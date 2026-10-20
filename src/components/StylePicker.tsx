import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { Option } from '../art/customCharacter';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover';
import { PixelFramesCanvas, type PixelFrame } from './PixelFramesCanvas';
import styles from './StylePicker.module.css';

export interface StylePickerProps<T extends string> {
  /** Accessible name of the choice ("Estilo de pelo"); the button adds the current option to it. */
  label: string;
  /** Short visible caption under the button ("Estilo"). */
  caption: string;
  options: readonly Option<T>[];
  value: T;
  /** The option drawn on the current character, cropped to the body part it changes. */
  thumbnail: (value: T) => PixelFrame;
  /** Integer scale of the thumbnails (pixel art). */
  scale?: number;
  onChange: (value: T) => void;
}

/**
 * A style choice of the character creator, picked by looking rather than by
 * reading, like the terrain palette: a button showing the current option on
 * the person's own character opens a menu with one thumbnail per option.
 * `menuitemradio` items with their labels as names, so a screen reader reads
 * the same choice; arrows move between them, Escape and a click outside close
 * the menu, and the focus goes back to the button.
 */
export function StylePicker<T extends string>({ label, caption, options, value, thumbnail, scale = 2, onChange }: StylePickerProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const popover = useAnchoredPopover(triggerRef, menuRef);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (popover.open) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [popover.open]);

  const pick = (next: T) => {
    popover.close();
    if (next !== value) onChange(next);
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) {
      popover.onKeyDown(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className={styles.picker}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${label}: ${current?.label ?? ''}`}
        title={`${label}: ${current?.label ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-controls={popover.open ? menuId : undefined}
        onClick={popover.toggle}
      >
        <span aria-hidden="true" className={styles.thumb}>
          <PixelFramesCanvas frames={[thumbnail(value)]} scale={scale} label="" />
        </span>
      </button>
      <span className={styles.caption} aria-hidden="true">
        {caption}
      </span>
      {popover.open && (
        <div ref={menuRef} id={menuId} className={styles.menu} style={popover.style} role="menu" aria-label={label} onKeyDown={moveFocus}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              className={styles.item}
              aria-checked={option.value === value}
              aria-label={option.label}
              title={option.label}
              onClick={() => pick(option.value)}
            >
              <span aria-hidden="true" className={styles.thumb}>
                <PixelFramesCanvas frames={[thumbnail(option.value)]} scale={scale} label="" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
