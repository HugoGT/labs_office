import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createOfficeBridge } from '../game/officeBridge';
import { useOfficeBridge } from '../hooks/useOfficeBridge';
import { GameCanvas } from './GameCanvas';
import { RecBadge } from './RecBadge';
import { Toast } from './Toast';

/** Duracion del toast antes de auto-ocultarse (`app.js:525`, `ms || 3200`). */
const TOAST_TIMEOUT_MS = 3200;

/**
 * Unico dueno del `OfficeBridge` (D3): lo crea via `useState`, se suscribe
 * con `useOfficeBridge` y compone `GameCanvas` + el HUD. Los componentes
 * presentacionales del HUD (Toast, RecBadge y, desde la slice 8b/9,
 * BottomBar/ContextMenu) nunca reciben el bridge, solo props planas.
 *
 * El boton de grabar aqui es un sustituto minimo (slice 8s): la slice 8b lo
 * reemplaza por el boton real dentro de `BottomBar`.
 */
export function OfficeShell() {
  const [bridge] = useState(createOfficeBridge);
  const { room } = useOfficeBridge(bridge);
  const [recording, setRecording] = useState(false);
  const [toastMessage, setToastMessage] = useState<ReactNode | null>(null);
  const previousRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (room === previousRoomRef.current) return;
    const leftRoom = previousRoomRef.current !== null && room === null;
    previousRoomRef.current = room;

    if (room) {
      setToastMessage(
        <>
          Entraste a <b>{room}</b>: solo escuchas a quienes están dentro
        </>,
      );
    } else if (leftRoom && recording) {
      setRecording(false);
      setToastMessage('💾 Saliste de la sala: grabación detenida');
    }
  }, [room, recording]);

  useEffect(() => {
    if (toastMessage === null) return undefined;
    const timer = setTimeout(() => setToastMessage(null), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  return (
    <div id="office-shell">
      <GameCanvas bridge={bridge} />
      <RecBadge visible={recording} />
      {room && (
        <button type="button" onClick={() => setRecording((value) => !value)}>
          {recording ? '⏹ Detener' : '⏺ Grabar'}
        </button>
      )}
      <Toast message={toastMessage} />
    </div>
  );
}
