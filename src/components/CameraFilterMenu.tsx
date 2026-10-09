import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CAMERA_FILTERS, isBlurFilter, type CameraFilter } from '../game/cameraFilter';
import styles from './CameraFilterMenu.module.css';

export interface CameraFilterMenuProps {
  filter: CameraFilter;
  /** This browser can blur; otherwise both blurs stay visible but disabled. */
  blurAvailable: boolean;
  /** Same as the camera button next to it: no LiveKit, or "No molestar". */
  disabled: boolean;
  disabledTitle?: string;
  onChange: (filter: CameraFilter) => void;
}

const FILTER_LABEL: Record<CameraFilter, string> = {
  none: 'Sin filtro',
  'blur-light': 'Desenfoque ligero',
  'blur-strong': 'Desenfoque total',
};

const BLUR_UNAVAILABLE_TITLE = 'Este navegador no puede desenfocar el fondo';

/**
 * Caret next to the camera button that opens the camera filter menu.
 * Presentational: the filter and whether blur is possible come in as props,
 * the pick goes out through `onChange`. Closes on a pick, Escape (focus back
 * to the caret) and a click outside (focus stays where it went).
 */
export function CameraFilterMenu({ filter, blurAvailable, disabled, disabledTitle, onChange }: CameraFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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

  // A camera that cannot be used has no filter to pick either.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function pick(next: CameraFilter): void {
    setOpen(false);
    caretRef.current?.focus();
    if (next !== filter) onChange(next);
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

  return (
    <span className={styles.anchor}>
      <button
        ref={caretRef}
        type="button"
        className={styles.caret}
        aria-label="Opciones de cámara"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        title={disabled ? disabledTitle : 'Opciones de cámara'}
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
          aria-label="Filtro de cámara"
          onKeyDown={moveFocus}
        >
          {CAMERA_FILTERS.map((option) => {
            const unavailable = isBlurFilter(option) && !blurAvailable;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                className={styles.item}
                aria-checked={option === filter}
                disabled={unavailable}
                title={unavailable ? BLUR_UNAVAILABLE_TITLE : undefined}
                onClick={() => pick(option)}
              >
                {FILTER_LABEL[option]}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
