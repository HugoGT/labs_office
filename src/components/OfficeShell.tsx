import { type ReactNode, useEffect, useRef, useState } from 'react';
import { resolveLivekitConfig } from '../game/livekitEndpoint';
import { createOfficeBridge, type OfficeEventMap } from '../game/officeBridge';
import { resolveOfficeEndpoint } from '../game/officeEndpoint';
import { DEFAULT_STATUS, type PresenceStatus } from '../game/officeProtocol';
import { useOfficeBridge } from '../hooks/useOfficeBridge';
import { useProximityAudio } from '../hooks/useProximityAudio';
import { AudioUnblockPrompt } from './AudioUnblockPrompt';
import { BottomBar } from './BottomBar';
import { ContextMenu, type NpcMenuAction } from './ContextMenu';
import { GameCanvas } from './GameCanvas';
import { RecBadge } from './RecBadge';
import { Toast } from './Toast';
import { VideoTiles } from './VideoTiles';

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
  const { room, nearby, menu, presence, closeMenu } = useOfficeBridge(bridge);
  // Se resuelve una sola vez: cambiarlo remontaria Phaser entero.
  const [endpoint] = useState(() =>
    resolveOfficeEndpoint({
      configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    }),
  );
  // Se resuelve una sola vez, en el mismo espiritu que `endpoint`: cambiar la
  // configuracion de LiveKit a mitad de sesion no tiene sentido de producto.
  const [livekitConfig] = useState(() =>
    resolveLivekitConfig({
      configuredUrl: import.meta.env.VITE_LIVEKIT_URL as string | undefined,
      officeEndpoint: endpoint,
    }),
  );
  /**
   * El estado de presencia vive aqui y no en la escena: React es su unico
   * escritor y Phaser lo sigue por comando. Al reves -- Phaser como dueno y
   * React leyendo por evento -- el selector tendria que esperar a que la
   * escena confirmase cada cambio para redibujarse.
   */
  const [status, setStatus] = useState<PresenceStatus>(DEFAULT_STATUS);
  const { micOn, camOn, audioAvailable, audioBlocked, speakers, toggleMic, toggleCam, unblockAudio } =
    useProximityAudio(bridge, { config: livekitConfig, status });

  /**
   * Mismo patron que `setStatus` (D7): React es el dueno del `Set` de
   * hablantes (LiveKit se lo entrega via `useProximityAudio`) y la escena solo
   * lo sigue por comando, para encender el anillo de los avatares remotos.
   */
  useEffect(() => {
    bridge.emitCommand('speakers', { sessionIds: [...speakers] });
  }, [bridge, speakers]);

  function handleChangeStatus(next: PresenceStatus): void {
    setStatus(next);
    bridge.emitCommand('setStatus', { status: next });
  }

  // D4: unico bloque muerto en produccion de este archivo. Bajo `__OFFICE_E2E__`
  // (compilado a `false` en el build normal, ver vite.config.ts D2) instala el
  // hook de posicionamiento de test sobre el mismo `bridge` que ya posee este
  // componente (D3: unico dueno). El `import()` dinamico deja el modulo entero
  // fuera del grafo cuando la guarda es `false` -- mas fuerte que tree-shaking
  // un import estatico.
  useEffect(() => {
    if (!__OFFICE_E2E__) return undefined;

    let uninstall: (() => void) | undefined;
    let cancelled = false;

    void import('../game/officeTestHook').then(({ installOfficeTestHook }) => {
      if (cancelled) return;
      uninstall = installOfficeTestHook(bridge);
    });

    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [bridge]);

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
      <GameCanvas bridge={bridge} endpoint={endpoint} />
      <VideoTiles bridge={bridge} />
      <RecBadge visible={recording} />
      <ContextMenu menu={menu} onAction={handleMenuAction} onClose={closeMenu} />
      <BottomBar
        micOn={micOn}
        camOn={camOn}
        audioAvailable={audioAvailable}
        recording={recording}
        room={room}
        nearby={nearby}
        presence={presence}
        status={status}
        onChangeStatus={handleChangeStatus}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleRecord={() => {
          if (!room) return;
          setRecording((value) => !value);
        }}
      />
      <AudioUnblockPrompt blocked={audioBlocked} onUnblock={unblockAudio} />
      <Toast message={toastMessage} />
    </div>
  );
}
