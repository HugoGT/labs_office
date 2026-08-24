import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createOfficeBridge } from '../game/officeBridge';
import { useOfficeBridge } from '../hooks/useOfficeBridge';
import { BottomBar } from './BottomBar';
import { GameCanvas } from './GameCanvas';
import { RecBadge } from './RecBadge';
import { Toast } from './Toast';

/** Duracion del toast antes de auto-ocultarse (`app.js:525`, `ms || 3200`). */
const TOAST_TIMEOUT_MS = 3200;

/**
 * Unico dueno del `OfficeBridge` (D3): lo crea via `useState`, se suscribe
 * con `useOfficeBridge` y compone `GameCanvas` + el HUD. Los componentes
 * presentacionales del HUD (Toast, RecBadge, BottomBar y, desde la slice 9,
 * ContextMenu) nunca reciben el bridge, solo props planas.
 */
export function OfficeShell() {
  const [bridge] = useState(createOfficeBridge);
  const { room, nearby } = useOfficeBridge(bridge);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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
      <BottomBar
        micOn={micOn}
        camOn={camOn}
        recording={recording}
        room={room}
        nearby={nearby}
        onToggleMic={() => setMicOn((value) => !value)}
        onToggleCam={() => setCamOn((value) => !value)}
        onToggleRecord={() => {
          if (!room) return;
          setRecording((value) => !value);
        }}
      />
      <Toast message={toastMessage} />
    </div>
  );
}
