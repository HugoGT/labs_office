import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './LoginScreen.module.css';

/** A failure deadline, never a minimum display time or a readiness signal. */
export const OFFICE_ENTRY_TIMEOUT_MS = 20000;
export type OfficeEntryState = 'ready' | 'failed';

class EntryBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Mounted only after AuthGate has resolved every required entrance choice. */
export function OfficeEntry({ children }: { children: (report: (state: OfficeEntryState) => void) => ReactNode }) {
  const [state, setState] = useState<'loading' | OfficeEntryState>('loading');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const reloadRequired = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const report = useCallback((next: OfficeEntryState) => {
    if (active.current && generation.current === attempt) {
      setState((current) => current === 'failed' ? current : next);
    }
  }, [attempt]);
  useEffect(() => {
    if (state !== 'loading') return;
    const timer = setTimeout(() => report('failed'), OFFICE_ENTRY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state, report]);

  return <>
    {state !== 'failed' && (
      <div style={{ visibility: state === 'ready' ? 'visible' : 'hidden', width: '100%', height: '100%' }}
        aria-hidden={state !== 'ready'} inert={state !== 'ready'}>
        <EntryBoundary key={attempt} onError={() => {
          // React.lazy remembers a rejected chunk; remounting cannot retry that import.
          reloadRequired.current = true;
          report('failed');
        }}>
          <Suspense fallback={null}>{children(report)}</Suspense>
        </EntryBoundary>
      </div>
    )}
    {state === 'loading' && <div className={styles.screen}><p role="status">Entrando a la oficina…</p></div>}
    {state === 'failed' && <div className={styles.screen} style={{ flexDirection: 'column' }}>
      <p role="alert">No se pudo cargar la oficina. Revisa tu conexión e inténtalo de nuevo.</p>
      <button className={styles.submit} type="button" onClick={() => {
        if (reloadRequired.current) {
          window.location.reload();
          return;
        }
        generation.current += 1;
        setAttempt(generation.current);
        setState('loading');
      }}>{reloadRequired.current ? 'Recargar página' : 'Reintentar'}</button>
    </div>}
  </>;
}
