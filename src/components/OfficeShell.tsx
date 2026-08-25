import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createOfficeBridge, type OfficeEventMap } from '../game/officeBridge';
import { useOfficeBridge } from '../hooks/useOfficeBridge';
import { BottomBar } from './BottomBar';
import { ContextMenu, type NpcMenuAction } from './ContextMenu';
import { GameCanvas } from './GameCanvas';
import { RecBadge } from './RecBadge';
import { Toast } from './Toast';

/** Duracion del toast antes de auto-ocultarse (`app.js:525`, `ms || 3200`). */
const TOAST_TIMEOUT_MS = 3200;

/**
 * Unico dueno del `OfficeBridge` (D3): lo crea via `useState`, se suscribe
 * con `useOfficeBridge` y compone `GameCanvas` + el HUD. Los componentes
 * presentacionales del HUD (Toast, RecBadge, BottomBar, ContextMenu) nunca
 * reciben el bridge, solo props planas.
 */
export function OfficeShell() {
  const [bridge] = useState(createOfficeBridge);
  const { room, nearby, menu, closeMenu } = useOfficeBridge(bridge);
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

  /**
   * Acciones del menu contextual (`app.js:474-486,602-604`). `call` y `goto`
   * son opuestos y conviene no confundirlos: `call` trae al NPC hasta ti,
   * `goto` te lleva a ti hasta su escritorio.
   */
  function handleMenuAction(action: NpcMenuAction, target: OfficeEventMap['npcmenu']): void {
    closeMenu();
    if (action === 'call') {
      bridge.callNpc(target.id);
      setToastMessage(
        <>
          📞 <b>{target.name}</b> viene hacia ti… (prototipo: la videollamada 1:1 llegará con
          LiveKit)
        </>,
      );
    } else if (action === 'goto') {
      bridge.teleportTo(target.id);
      setToastMessage(
        <>
          🚶 Te teletransportaste junto a <b>{target.name}</b>
        </>,
      );
    } else {
      setToastMessage(
        <>
          👤 <b>{target.name}</b> · Empleado · {target.status}
        </>,
      );
    }
  }

  return (
    <div id="office-shell">
      <GameCanvas bridge={bridge} />
      <RecBadge visible={recording} />
      <ContextMenu menu={menu} onAction={handleMenuAction} onClose={closeMenu} />
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
