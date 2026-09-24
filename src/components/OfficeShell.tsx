import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { resolveLivekitConfig } from '../game/livekitEndpoint';
import { createOfficeBridge, type OfficeEventMap } from '../game/officeBridge';
import { resolveOfficeEndpoint } from '../game/officeEndpoint';
import { DEFAULT_NAME, DEFAULT_STATUS, type PresenceStatus } from '../game/officeProtocol';
import {
  RecordingError,
  getRecordingUrl,
  resolveRecordingsUrl,
  startRecording,
  stopRecording,
  type RecordingRequest,
} from '../game/recordingClient';
import type { DeskItemPlacement, SaveDeskOutcome } from '../game/deskDecorPort';
import { useCallInvitations } from '../hooks/useCallInvitations';
import { useDeskDecor } from '../hooks/useDeskDecor';
import { useDesks } from '../hooks/useDesks';
import { useOfficeBridge } from '../hooks/useOfficeBridge';
import { useProximityAudio } from '../hooks/useProximityAudio';
import { useSpacesConfig } from '../hooks/useSpacesConfig';
import { AudioUnblockPrompt } from './AudioUnblockPrompt';
import { BottomBar } from './BottomBar';
import { CallInvitationStack } from './CallInvitationStack';
import { ContextMenu, type PeerMenuAction } from './ContextMenu';
import { DeskDecorEditor } from './DeskDecorEditor';
import { ExitControls } from './ExitControls';
import { GameCanvas } from './GameCanvas';
import { RecBadge } from './RecBadge';
import { RecordingReadyStack, type RecordingReadyNotice } from './RecordingReadyStack';
import { Toast } from './Toast';
import { VideoTiles } from './VideoTiles';

/** Duracion del toast antes de auto-ocultarse (`app.js:525`, `ms || 3200`). */
const TOAST_TIMEOUT_MS = 3200;

export interface OfficeShellProps {
  /**
   * Sesion autenticada (#8), o `null` sin autenticacion. No se resuelve aqui:
   * la entrega `AuthGate`, que es quien conoce el puerto. Por defecto `null`,
   * que es la oficina abierta de siempre.
   */
  session?: OfficeSession | null;
  /**
   * Takes the user out of the office (#66). Whoever mounted the shell owns
   * this: leaving means unmounting it, which the shell cannot do to itself.
   */
  onLeaveOffice?: () => void;
}

/**
 * Unico dueno del `OfficeBridge` (D3): lo crea via `useState`, se suscribe
 * con `useOfficeBridge` y compone `GameCanvas` + el HUD. Los componentes
 * presentacionales del HUD (Toast, RecBadge, BottomBar, ContextMenu) nunca
 * reciben el bridge, solo props planas.
 *
 * La sesion solo la reparte: la escena la necesita para entrar a la sala de
 * Colyseus y el hook de audio para pedir el token de LiveKit; son los dos
 * unicos puntos que hablan con el servidor. Al HUD no le baja la sesion sino
 * el nombre ya resuelto (#6): `BottomBar` es presentacional y no tiene por que
 * aprender que existe una sesion para poder escribir un nombre.
 */
export function OfficeShell({ session = null, onLeaveOffice }: OfficeShellProps) {
  const [bridge] = useState(createOfficeBridge);
  const { room, spaceId, recordings, selfSessionId, menu, presence, closeMenu } = useOfficeBridge(bridge);
  // D12: la pila del receptor vive en su propio hook (temporizadores + chime
  // + comandos), no en `useOfficeBridge`, que es deliberadamente un simple
  // suscriptor evento->estado.
  const { invitations, accept, dismiss } = useCallInvitations(bridge);
  // Se resuelve una sola vez: cambiarlo remontaria Phaser entero.
  const [endpoint] = useState(() =>
    resolveOfficeEndpoint({
      configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    }),
  );
  /**
   * Config de espacios servida (#7, slice 3). Vive aqui y no en `GameCanvas`
   * por la misma razon que `endpoint`: quien sabe donde esta el servidor es
   * este componente, y `GameCanvas` no inventa urls por su cuenta.
   *
   * Viaja a la escena por COMANDO y no por prop, mismo patron que `setStatus`
   * y `speakers`: React es el dueno del dato y la escena lo sigue. Por prop
   * entraria en las dependencias del efecto de `GameCanvas` y recrearia Phaser
   * entero al llegar; y retrasar el montaje hasta tenerla le costaria a TODO
   * el mundo, en todo despliegue, una espera de red antes de ver la oficina.
   *
   * La escena arranca mientras tanto con sus `BUILT_IN_SPACES` y cambia al
   * llegar el comando. La ventana entre una cosa y otra es de un viaje de red,
   * y durante ella este cliente publica la version fallback: queda mutuamente
   * inaudible con quien ya tenga la servida, que es el modo de fallo seguro
   * que `proximityAudio.ts` garantiza -- nunca audibilidad de un solo sentido.
   */
  const spacesConfig = useSpacesConfig(endpoint);

  useEffect(() => {
    if (spacesConfig === null) return;
    bridge.emitCommand('spacesconfig', spacesConfig);
  }, [bridge, spacesConfig]);
  /**
   * Escritorios asignables servidos (#7, slice 5). Vive aqui por lo mismo que
   * `spacesConfig`, y viaja a la escena por COMANDO por lo mismo tambien:
   * llega despues de que Phaser arranque, y por prop recrearia el juego
   * entero al llegar. La diferencia esta en la frecuencia -- esta lista se
   * relee cada vez que alguien coge o suelta un sitio, asi que por prop el
   * juego se recrearia entero cada vez que alguien se sienta.
   *
   * Sin sesion no se pide: `GET /desks` publica quien vino hoy y quien esta al
   * lado de quien. La oficina abierta (desarrollo local, e2e) se queda sin
   * escritorios asignables, exactamente igual que un despliegue sin
   * directorio, y todo lo demas sigue igual.
   */
  const { desks, claim, release, refresh: refreshDesks } = useDesks(endpoint, session);
  /**
   * Lo que el editor de decoracion necesita saber (#7, slice 6). Vive aqui por
   * lo mismo que `desks`: quien sabe donde esta el servidor es este
   * componente.
   *
   * Es una lectura APARTE de `/desks` y no un campo mas de aquella. `/desks`
   * trae la decoracion de todo el mundo ya resuelta para PINTARLA, sin el
   * `assetId` con el que se vuelve a guardar; y el catalogo de lo que se puede
   * colocar no es una propiedad de ningun escritorio. Ver `deskDecorPort.ts`.
   */
  const decor = useDeskDecor(endpoint, session);
  const [decorOpen, setDecorOpen] = useState(false);
  /**
   * El escritorio propio, que es el UNICO que se puede decorar. Lo contesta el
   * servidor (`OfficeDesk.mine`) y no se deduce comparando nombres: ver
   * `desksPort.OfficeDesk.mine`.
   *
   * `null` es un estado legitimo -- nadie esta obligado a sentarse -- y el
   * editor lo cuenta ofreciendo coger un sitio, no una pantalla atada a nada.
   */
  const myDesk = desks?.find((desk) => desk.mine) ?? null;

  useEffect(() => {
    // `null` es "todavia no": mandar una lista vacia antes de tiempo pintaria
    // la oficina sin escritorios y luego con ellos.
    if (desks === null) return;
    bridge.emitCommand('desks', { desks });
  }, [bridge, desks]);
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
  const {
    micOn,
    camOn,
    audioAvailable,
    audioBlocked,
    speakers,
    toggleMic,
    toggleCam,
    unblockAudio,
    videoTracks,
    localVideoTrack,
    screenShareOn,
    screenShareAvailable,
    toggleScreenShare,
    screenShareTracks,
    localScreenShareTrack,
    activeScreenSharer,
  } = useProximityAudio(bridge, { config: livekitConfig, status, session });

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

  const [toastMessage, setToastMessage] = useState<ReactNode | null>(null);
  const previousRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (room === previousRoomRef.current) return;
    previousRoomRef.current = room;

    if (room) {
      setToastMessage(
        <>
          Entraste a <b>{room}</b>: solo escuchas a quienes están dentro
        </>,
      );
    }
  }, [room]);

  /**
   * Who started sharing, for everyone in the space (#20). A takeover is a new
   * start with a new sharer, so it is announced as well; a share ending is
   * not. The same person sharing again after stopping is a new start.
   */
  const previousSharerRef = useRef<string | null>(null);
  const sharerSessionId = activeScreenSharer?.sessionId ?? null;
  const sharerName = activeScreenSharer?.name ?? null;

  useEffect(() => {
    if (sharerSessionId === previousSharerRef.current) return;
    previousSharerRef.current = sharerSessionId;
    if (sharerSessionId === null || sharerName === null) return;

    setToastMessage(
      sharerSessionId === selfSessionId ? (
        'Empezaste a compartir tu pantalla'
      ) : (
        <>
          <b>{sharerName}</b> empezó a compartir pantalla
        </>
      ),
    );
  }, [sharerSessionId, sharerName, selfSessionId]);

  /**
   * Recording is server-owned (#5): whether this room is being recorded is
   * read from the synced state every occupant receives, never from a local
   * flag. The button only asks; the badge follows the state.
   */
  const [recordingsUrl] = useState(() => resolveRecordingsUrl(endpoint));
  const activeRecording = spaceId !== null ? recordings[spaceId] : undefined;
  const recording = activeRecording !== undefined;

  const recordingRequest = useCallback(
    async (forSpaceId: string, sessionId: string): Promise<RecordingRequest | null> => {
      if (recordingsUrl === null) return null;
      const token = session ? await session.getIdToken() : null;
      return { url: recordingsUrl, sessionId, token, spaceId: forSpaceId };
    },
    [recordingsUrl, session],
  );

  async function toggleRecording(): Promise<void> {
    if (spaceId === null || selfSessionId === null) return;
    const request = await recordingRequest(spaceId, selfSessionId);
    if (request === null) return;
    try {
      if (recording) await stopRecording(request);
      else await startRecording(request);
    } catch (err) {
      if (err instanceof RecordingError && err.status === 409) {
        setToastMessage('Ya se está grabando esta sala');
      } else {
        setToastMessage(recording ? 'No se pudo detener la grabación' : 'No se pudo iniciar la grabación');
      }
    }
  }

  /**
   * Tells every occupant when the recording of THEIR room flips, which is the
   * notice the issue asks for. Entering a room already being recorded counts
   * as a flip. Walking out is not a flip: the starter stops it on the way out
   * (nobody is left to stop it otherwise), anyone else just loses the badge.
   */
  const previousRecordingRef = useRef<{ spaceId: string | null; active: boolean; mine: boolean }>({
    spaceId: null,
    active: false,
    mine: false,
  });

  useEffect(() => {
    const previous = previousRecordingRef.current;
    const mine = activeRecording !== undefined && activeRecording.startedBy === selfSessionId;
    previousRecordingRef.current = { spaceId, active: recording, mine };

    if (spaceId !== previous.spaceId) {
      if (previous.spaceId !== null && previous.active && previous.mine && selfSessionId !== null) {
        const leftSpaceId = previous.spaceId;
        void recordingRequest(leftSpaceId, selfSessionId).then((request) =>
          request ? stopRecording(request).catch(() => undefined) : undefined,
        );
        setToastMessage('💾 Saliste de la sala: grabación detenida');
      }
      if (recording) setToastMessage('⏺ Esta sala se está grabando');
      return;
    }

    if (!previous.active && recording) setToastMessage('⏺ Esta sala se está grabando');
    else if (previous.active && !recording) setToastMessage('⏹ Grabación detenida');
  }, [spaceId, recording, activeRecording, selfSessionId, recordingRequest]);

  /**
   * Finished recordings this user took part in, once uploaded (#58). Only
   * participants receive `recordingready`; the notice stays until dismissed.
   */
  const [readyRecordings, setReadyRecordings] = useState<readonly RecordingReadyNotice[]>([]);

  useEffect(
    () =>
      bridge.on('recordingready', (notice) =>
        setReadyRecordings((current) =>
          current.some((item) => item.recordingId === notice.recordingId) ? current : [...current, notice],
        ),
      ),
    [bridge],
  );

  const dismissReadyRecording = useCallback((recordingId: string) => {
    setReadyRecordings((current) => current.filter((item) => item.recordingId !== recordingId));
  }, []);

  /**
   * 'Ver' opens the tab INSIDE the click and only fills it in after the URL
   * arrives: a window opened after a network round trip is no longer a user
   * gesture, and popup blockers stop it. 'Descargar' navigates this tab: the
   * URL answers with `Content-Disposition: attachment`, so the page stays.
   */
  async function openRecording(recordingId: string, download: boolean): Promise<void> {
    const tab = download ? null : window.open('', '_blank');
    try {
      if (recordingsUrl === null || selfSessionId === null) throw new Error('no session');
      const token = session ? await session.getIdToken() : null;
      const { url } = await getRecordingUrl({
        url: recordingsUrl,
        sessionId: selfSessionId,
        token,
        recordingId,
        download,
      });
      if (download) {
        window.open(url, '_self');
      } else if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
    } catch (error) {
      tab?.close();
      // Past the retention the bucket has deleted it (#5): retrying is
      // pointless, so the notice goes away with the explanation.
      if (error instanceof RecordingError && error.code === 'recording-expired') {
        dismissReadyRecording(recordingId);
        setToastMessage('La grabación ya no está disponible');
        return;
      }
      setToastMessage(download ? 'No se pudo descargar la grabación' : 'No se pudo abrir la grabación');
    }
  }

  useEffect(() => {
    if (toastMessage === null) return undefined;
    const timer = setTimeout(() => setToastMessage(null), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  /**
   * Regla de feedback del llamador (issue #2, D3, sin cambios desde la
   * propuesta): solo una aceptacion produce un toast servidor-origen. Pasar,
   * DND, destino desconocido o duplicado son todos el mismo silencio, y ese
   * silencio ya lo garantiza el servidor -- aqui no hay nada que descartar.
   * Se suscribe DIRECTAMENTE en `OfficeShell` (D12), no en un hook, porque es
   * un solo toast y `OfficeShell` ya es el unico dueno del bridge.
   */
  useEffect(
    () =>
      bridge.on('callaccepted', ({ name }) => {
        setToastMessage(
          <>
            🚶 <b>{name}</b> viene hacia ti
          </>,
        );
      }),
    [bridge],
  );

  /**
   * Coger un sitio libre (#7, slice 5). La escena decide QUE se puede hacer
   * con cada escritorio -- es quien sabe que hay dibujado y de quien es cada
   * uno -- y aqui se habla con el servidor y se cuenta lo que paso.
   *
   * Los tres finales se cuentan por separado y ninguno se traga. El 409 es el
   * que importa: alguien se adelanto, y decir "hecho" dejaria el escritorio
   * pintado como tuyo sin serlo. `useDesks` ya vuelve a leer la lista en ese
   * caso, porque la vista de quien hizo clic dejo de valer.
   */
  const takeDesk = useCallback(
    async (deskId: string, label: string): Promise<void> => {
      const outcome = await claim(deskId);
      if (outcome === 'claimed') {
        setToastMessage(
          <>
            🪑 Te sentaste en <b>{label}</b>
          </>,
        );
        return;
      }
      setToastMessage(
        outcome === 'taken' ? (
          <>
            🪑 Alguien se adelantó y ocupó <b>{label}</b>
          </>
        ) : (
          <>
            🪑 No se pudo coger <b>{label}</b>
          </>
        ),
      );
    },
    [claim],
  );

  const leaveDesk = useCallback(
    async (label: string): Promise<void> => {
      const outcome = await release();
      setToastMessage(
        outcome === 'released' ? (
          <>
            🪑 Dejaste <b>{label}</b>
          </>
        ) : (
          <>
            🪑 No se pudo dejar <b>{label}</b>
          </>
        ),
      );
    },
    [release],
  );

  const decorReady = decor.phase === 'ready';

  /**
   * Guardar la decoracion del escritorio propio (#7, slice 6). El escritorio
   * entero, que es lo que lee `POST /me/desk`.
   *
   * Un guardado bueno RELEE `/desks`, y ese es el camino por el que la escena
   * se entera sin recargar la pagina: la lista es autoritativa y viaja por
   * comando, igual que despues de coger o soltar sitio. Sin esto, la pieza
   * recien colocada solo existiria dentro de este panel.
   */
  const saveDecor = useCallback(
    async (items: readonly DeskItemPlacement[]): Promise<SaveDeskOutcome> => {
      const outcome = await decor.save(items);
      if (outcome === 'saved') refreshDesks();
      return outcome;
    },
    [decor, refreshDesks],
  );

  /**
   * Clic en un escritorio asignable (#7, slice 5). Se suscribe DIRECTAMENTE
   * aqui y no en un hook, misma razon que `callaccepted`: es un toast y este
   * componente ya es el unico dueno del puente.
   *
   * Dejar el sitio se OFRECE, no se hace: el toast que el HUD ya tiene lleva
   * el boton, y solo suelta quien lo pulsa. Soltar al primer clic es demasiado
   * facil de hacer sin querer -- basta con volver a clicar el propio sitio --
   * y una pantalla de confirmacion propia seria una superficie nueva para una
   * sola pregunta.
   */
  useEffect(
    () =>
      bridge.on('deskclick', ({ deskId, label, action }) => {
        if (action === 'claim') {
          void takeDesk(deskId, label);
          return;
        }
        setToastMessage(
          <>
            🪑 <b>{label}</b> es tu escritorio ·{' '}
            {/* Decorar solo se ofrece cuando de verdad se puede: sin catalogo
                o sin haber podido leer lo que ya hay puesto, el editor no
                tendria ni que ofrecer ni que conservar.
                El aviso se compone con lo que se sepa en el instante del clic
                -- por eso `decorReady` esta en las dependencias de abajo, para
                que el siguiente clic ya lo ofrezca. Las dos lecturas arrancan
                al montar, a la vez que `/desks`, asi que cuando hay un
                escritorio propio que clicar ya han aterrizado. */}
            {decorReady && (
              <>
                <button type="button" onClick={() => setDecorOpen(true)}>
                  Decorar
                </button>{' '}
                ·{' '}
              </>
            )}
            <button type="button" onClick={() => void leaveDesk(label)}>
              Dejarlo
            </button>
          </>,
        );
      }),
    [bridge, takeDesk, leaveDesk, decorReady],
  );

  /**
   * Acciones del menu contextual (`app.js:602-604`). Solo quedan dos desde que
   * se retiraron los NPCs simulados: `call` pide la invitacion y `profile`
   * muestra la ficha. `respondCall` es UN comando, no accept/pass -- la escena
   * es quien sabe que "aceptar" implica caminar y quien conoce coordenadas del
   * mundo (D3); React solo pide la invitacion.
   */
  function handleMenuAction(action: PeerMenuAction, menu: OfficeEventMap['peermenu']): void {
    closeMenu();

    if (action === 'call') {
      bridge.emitCommand('callPeer', { sessionId: menu.sessionId });
      setToastMessage(
        <>
          📞 Llamando a <b>{menu.name}</b>…
        </>,
      );
      return;
    }

    setToastMessage(
      <>
        👤 <b>{menu.name}</b> · Empleado · {menu.status}
      </>,
    );
  }

  async function signOut(current: OfficeSession): Promise<void> {
    try {
      await current.signOut?.();
    } catch {
      // Still signed in: the office stays, so it has to say why nothing happened.
      setToastMessage('No se pudo cerrar la sesión');
    }
  }

  return (
    <div id="office-shell">
      <GameCanvas bridge={bridge} endpoint={endpoint} session={session} />
      <VideoTiles
        bridge={bridge}
        videoTracks={videoTracks}
        speakers={speakers}
        localVideoTrack={localVideoTrack}
        screenShareTracks={screenShareTracks}
        localScreenShareTrack={localScreenShareTrack}
        activeScreenSharer={activeScreenSharer?.sessionId ?? null}
      />
      <RecBadge visible={recording} />
      <ContextMenu menu={menu} onAction={handleMenuAction} onClose={closeMenu} />
      <BottomBar
        playerName={session?.displayName ?? DEFAULT_NAME}
        micOn={micOn}
        camOn={camOn}
        audioAvailable={audioAvailable}
        recording={recording}
        room={room}
        presence={presence}
        status={status}
        onChangeStatus={handleChangeStatus}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleRecord={() => void toggleRecording()}
        screenShareOn={screenShareOn}
        screenShareAvailable={screenShareAvailable}
        onToggleScreenShare={toggleScreenShare}
        // #52: la barra solo avisa; quien sabe reconectar es la escena, y el
        // comando viaja por `emitCommand` como el resto -- sin metodo de
        // conveniencia en el puente.
        onRetryConnection={() => bridge.emitCommand('reconnect', undefined)}
      />
      {decorOpen && decorReady && (
        <DeskDecorEditor
          deskLabel={myDesk?.label ?? null}
          catalog={decor.catalog}
          items={decor.items}
          onSave={saveDecor}
          onClose={() => setDecorOpen(false)}
        />
      )}
      <ExitControls
        onSignOut={session?.signOut ? () => void signOut(session) : null}
        onLeaveOffice={onLeaveOffice ?? null}
      />
      <AudioUnblockPrompt blocked={audioBlocked} onUnblock={unblockAudio} />
      <Toast message={toastMessage} />
      <CallInvitationStack invitations={invitations} onAccept={accept} onDismiss={dismiss} />
      <RecordingReadyStack
        notices={readyRecordings}
        onView={(recordingId) => void openRecording(recordingId, false)}
        onDownload={(recordingId) => void openRecording(recordingId, true)}
        onDismiss={dismissReadyRecording}
      />
    </div>
  );
}
