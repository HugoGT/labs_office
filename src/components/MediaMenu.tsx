import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import styles from './MediaMenu.module.css';

/** The HUD's side gutter: as close to the screen edge as a menu gets. */
const SCREEN_GUTTER = 16;

export interface MediaMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** One pick of the menu: a filter, a microphone, a speaker or a camera. */
export interface MediaMenuSection {
  label: string;
  options: readonly MediaMenuOption[];
  selected: string | null;
  onSelect: (value: string) => void;
  /** Said instead of the options while there are none. */
  emptyLabel?: string;
}

export interface MediaMenuProps {
  /** Names the caret and its menu. */
  label: string;
  sections: readonly MediaMenuSection[];
  /** Same as the button next to it: no LiveKit, or "No molestar". */
  disabled: boolean;
  disabledTitle?: string;
}

/**
 * Caret next to a call button that opens its options (camera filter, devices).
 * Presentational: options come in as props, a pick goes out through its
 * section's `onSelect`. Closes on a pick, Escape (focus back to the caret)
 * and a click outside (focus stays where it went).
 */
export function MediaMenu({ label, sections, disabled, disabledTitle }: MediaMenuProps) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Every menu opens leftwards from its caret (#306). A caret near the left
  // edge of a narrow screen cannot fit long device names that way, so the menu
  // gives way by just what is missing, before it paints.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    menu.style.translate = '';
    const missing = SCREEN_GUTTER - menu.getBoundingClientRect().left;
    if (missing > 0) menu.style.translate = `${missing}px`;
  }, [open, sections]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      caretRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || caretRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // A device that cannot be used has nothing to pick either.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function pick(section: MediaMenuSection, next: string): void {
    setOpen(false);
    caretRef.current?.focus();
    if (next !== section.selected) section.onSelect(next);
  }

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const enabled = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? [],
    );
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    enabled[(current + step + enabled.length) % enabled.length].focus();
  }

  // One section needs no heading: the caret already says what it is.
  const headed = sections.length > 1;

  return (
    <span className={styles.anchor}>
      <button
        ref={caretRef}
        type="button"
        className={styles.caret}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        title={disabled ? disabledTitle : label}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label={label}
          onKeyDown={moveFocus}
        >
          {sections.map((section) => (
            <div key={section.label} className={styles.section} role="group" aria-label={section.label}>
              {headed && (
                <div className={styles.heading} aria-hidden="true">
                  {section.label}
                </div>
              )}
              {section.options.length === 0 && section.emptyLabel !== undefined && (
                <button type="button" role="menuitem" className={`${styles.item} ${styles.empty}`} disabled>
                  {section.emptyLabel}
                </button>
              )}
              {section.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  className={styles.item}
                  aria-checked={option.value === section.selected}
                  disabled={option.disabled}
                  title={option.title}
                  onClick={() => pick(section, option.value)}
                >
                  <span className={styles.label}>{option.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
