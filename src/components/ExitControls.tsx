import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { useHeightCssVar } from '../hooks/useHeightCssVar';
import type { InstallOffer } from '../pwa/installMode';
import styles from './ExitControls.module.css';

export interface ExitControlsProps {
  /** `null` without a session (auth off): there is nobody to sign out. */
  onSignOut: (() => void) | null;
  /** `null` when nobody above the office can take the user out of it. */
  onLeaveOffice: (() => void) | null;
  /** `null` (or absent) when the app is installed or this browser cannot install it (#13). */
  install?: InstallOffer | null;
}

/** Manual steps per platform, for the browsers that have no install prompt (#13). */
const INSTALL_STEPS: Record<'ios' | 'macos', readonly string[]> = {
  ios: ['Toca Compartir en la barra de Safari.', 'Elige «Añadir a pantalla de inicio».'],
  macos: ['Abre el menú Archivo de Safari.', 'Elige «Añadir al Dock».'],
};

/**
 * Ways out of the office (#66), in the bottom right corner, away from the
 * call controls so neither is pressed by mistake, plus "Instalar app" (#13)
 * on the left when there is something to install. Presentational (D3): it
 * does not know about the auth port, who mounts the office, or how the
 * browser installs; it only keeps whether the steps panel is open.
 */
export function ExitControls({ onSignOut, onLeaveOffice, install = null }: ExitControlsProps) {
  // Read by the sidebar to stop above these too, not only above the bar (#86).
  const ref = useHeightCssVar('--hud-exit-height');
  const crowded = install !== null && onSignOut !== null && onLeaveOffice !== null;
  useRootCssVar('--hud-exit-buttons', crowded ? '3' : null);
  if (onSignOut === null && onLeaveOffice === null && install === null) return null;

  return (
    <div className={styles.controls} ref={ref} data-crowded={crowded || undefined}>
      {install && <InstallButton offer={install} />}
      {onSignOut && <ExitButton emoji="🔑" label="Cerrar sesión" onClick={onSignOut} />}
      {onLeaveOffice && <ExitButton emoji="🚪" label="Salir" onClick={onLeaveOffice} />}
    </div>
  );
}

/**
 * Three buttons do not fit the two-button width the bottom bar keeps clear
 * (`--hud-exit-width` in index.css), so the row publishes how many it holds.
 */
function useRootCssVar(name: string, value: string | null) {
  useEffect(() => {
    if (value === null) return;
    const root = document.documentElement;
    root.style.setProperty(name, value);
    return () => {
      root.style.removeProperty(name);
    };
  }, [name, value]);
}

function InstallButton({ offer }: { offer: InstallOffer }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // An outside click closes without pulling focus back: whatever was
    // clicked (the map, a panel) keeps it.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (offer.kind === 'prompt') {
    return <ExitButton emoji="📲" label="Instalar app" onClick={offer.onInstall} />;
  }
  return (
    <>
      <ExitButton
        ref={buttonRef}
        emoji="📲"
        label="Instalar app"
        onClick={() => setOpen((current) => !current)}
        expanded={open}
        controls={panelId}
      />
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <p id={titleId} className={styles.panelTitle}>
            Instalar Oficina Virtual
          </p>
          <ol className={styles.steps}>
            {INSTALL_STEPS[offer.kind].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

interface ExitButtonProps {
  emoji: string;
  label: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  /** Only for a button that opens a panel: `aria-expanded` and `aria-controls`. */
  expanded?: boolean;
  controls?: string;
}

/**
 * Narrow screens show only the emoji (#88), so the name is also carried by
 * `aria-label` (screen readers) and `title` (hover) instead of the text alone.
 */
function ExitButton({ emoji, label, onClick, ref, expanded, controls }: ExitButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.btn}
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded === undefined ? undefined : controls}
    >
      <span aria-hidden="true">{emoji}</span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
