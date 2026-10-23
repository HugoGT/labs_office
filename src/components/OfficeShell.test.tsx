import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssetAdminClient } from '../dashboard/assetAdminClient';
import type { AssetAdminPort } from '../dashboard/assetAdminPort';
import { createDeskAdminClient } from '../dashboard/deskAdminClient';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import { createSpacesAdminClient } from '../dashboard/spacesAdminClient';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createGame } from '../game/createGame';
import { createOfficeDecorClient } from '../game/officeDecorClient';
import { claimDesk, fetchOfficeDesks, releaseDesk } from '../game/desksClient';
import type { OfficeDesk } from '../game/desksPort';
import type { OfficeBridge } from '../game/officeBridge';
import { BUILT_IN_SPACES_VERSION } from '../game/mapData';
import { zoomView, type ZoomAction } from '../game/mapZoom';
import { DEFAULT_NAME } from '../game/officeProtocol';
import { RecordingError, getRecordingUrl, startRecording, stopRecording } from '../game/recordingClient';
import { useOfficeAdminRole } from '../hooks/useOfficeAdminRole';
import { useProximityAudio } from '../hooks/useProximityAudio';
import { OfficeShell } from './OfficeShell';

vi.mock('../game/createGame', () => ({ createGame: vi.fn() }));
// Unico modulo del cliente que habla con `/desks`: doblarlo aqui deja este
// archivo probando el CABLEADO -- comando, clic, peticion y aviso -- sin red.
vi.mock('../game/desksClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/desksClient')>()),
  fetchOfficeDesks: vi.fn(),
  claimDesk: vi.fn(),
  releaseDesk: vi.fn(),
}));
// El hook ya tiene su propia suite (`useProximityAudio.test.ts`, slice 4A);
// aqui solo importa que OfficeShell lo llame y reenvie lo que devuelve,
// igual que `createGame` se mockea para aislar Phaser (mismo patron ya
// establecido en este archivo).
vi.mock('../hooks/useProximityAudio', () => ({ useProximityAudio: vi.fn() }));
// El sondeo de rol ya tiene su propia suite (`useOfficeAdminRole.test.ts`,
// PR3a); aqui solo importa que `OfficeShell` lo llame y ofrezca (o no) la
// seccion de administracion segun lo que devuelva (#74, PR3c).
vi.mock('../hooks/useOfficeAdminRole', () => ({ useOfficeAdminRole: vi.fn() }));
// The ring has its own suite (`callChime.test.ts`); jsdom implements no media
// playback, so a real one here would only log "Not implemented" (#187).
vi.mock('../game/callChime', () => ({ createCallChime: () => ({ play: () => {}, stop: () => {} }) }));
// The only module that talks to `/recordings/*` (#5): whether a room is being
// recorded comes from the bridge, never from these calls.
vi.mock('../game/recordingClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/recordingClient')>()),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getRecordingUrl: vi.fn(),
}));
// Unico modulo que habla con `/admin/desks` (#74, PR3c): doblarlo aqui evita
// que la seccion de administracion, montada de forma diferida, dispare una
// peticion real al entrar en modo edicion.
vi.mock('../dashboard/deskAdminClient', () => ({ createDeskAdminClient: vi.fn() }));
// Mismo criterio con `/admin/spaces` (#74, PR4): tanto la seccion de salas
// como el cruce escritorio<->sala de `useLayoutEditor.ts` lo necesitan
// SIEMPRE que hay rol admin, no solo cuando se entra a editar salas.
vi.mock('../dashboard/spacesAdminClient', () => ({ createSpacesAdminClient: vi.fn() }));
// Mismo criterio con `/admin/assets` (catalogo migrado a "Personalizar"):
// doblarlo aqui evita que abrir el panel dispare una peticion real.
vi.mock('../dashboard/assetAdminClient', () => ({ createAssetAdminClient: vi.fn() }));
// The only module that writes the decor layer (#208): both scopes of "Decoración" without network.
vi.mock('../game/officeDecorClient', () => ({ createOfficeDecorClient: vi.fn(() => ({ setDecor: vi.fn(async () => undefined) })) }));

// Keep the real editor, but let the first submenu test control its lazy readiness.
// `loaded` settles when the factory returns: `vi.dynamicImportSettled` does not track
// a mock factory, so it could return while a cold `importOriginal` was still running.
const layoutEditorLoad = vi.hoisted(() => {
  let markLoaded!: () => void;
  const loaded = new Promise<void>((resolve) => { markLoaded = resolve; });
  return { ready: null as Promise<void> | null, loaded, markLoaded };
});
vi.mock('./OfficeLayoutEditor', async (importOriginal) => {
  await layoutEditorLoad.ready;
  const editorModule = await importOriginal<typeof import('./OfficeLayoutEditor')>();
  layoutEditorLoad.markLoaded();
  return editorModule;
});

const createGameMock = vi.mocked(createGame);
const useProximityAudioMock = vi.mocked(useProximityAudio);
const useOfficeAdminRoleMock = vi.mocked(useOfficeAdminRole);
const createDeskAdminClientMock = vi.mocked(createDeskAdminClient);
const createSpacesAdminClientMock = vi.mocked(createSpacesAdminClient);
const createAssetAdminClientMock = vi.mocked(createAssetAdminClient);

/** Puerto falso por defecto (#74, PR3c): sin llamadas en vuelo salvo que un test las controle. */
function fakeDeskAdminPort(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => []),
    createDesk: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    updateDesk: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    deleteDesk: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Puerto falso por defecto (#74, PR4): sin salas salvo que un test las controle. */
function fakeSpacesAdminPort(overrides: Partial<SpacesAdminPort> = {}): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => []),
    createSpace: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    updateSpace: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    deleteSpace: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Puerto falso por defecto: sin piezas de catalogo salvo que un test las controle. */
function fakeAssetAdminPort(overrides: Partial<AssetAdminPort> = {}): AssetAdminPort {
  return {
    listAssets: vi.fn(async () => []),
    createAsset: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    archiveAsset: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    updateAsset: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    ...overrides,
  };
}

/**
 * Base del valor que devuelve el hook mockeado. Cada test sobreescribe solo
 * lo que ejerce: asi ampliar `UseProximityAudioResult` no obliga a tocar
 * todos los tests que no hablan de ese campo.
 */
function proximityAudio(
  overrides: Partial<ReturnType<typeof useProximityAudio>> = {},
): ReturnType<typeof useProximityAudio> {
  return {
    micOn: false,
    camOn: false,
    audioAvailable: false,
    audioBlocked: false,
    dnd: false,
    toggleMic: vi.fn(),
    toggleCam: vi.fn(),
    unblockAudio: vi.fn(),
    videoTracks: new Map(),
    speakers: new Set(),
    localVideoTrack: null,
    screenShareOn: false,
    screenShareAvailable: false,
    toggleScreenShare: vi.fn(),
    screenShareTracks: new Map(),
    localScreenShareTrack: null,
    activeScreenSharer: null,
    recordableMedia: false,
    cameraFilter: 'none',
    setCameraFilter: vi.fn(),
    cameraBlurAvailable: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
  // Por defecto: apagado y sin LiveKit disponible (#321 decision 2 y 3) — los
  // tests que necesitan otro estado lo sobreescriben explicitamente.
  useProximityAudioMock.mockReturnValue(proximityAudio());
  // Por defecto nadie administra: los tests de la seccion de escritorios
  // sobreescriben esto explicitamente.
  useOfficeAdminRoleMock.mockReturnValue(null);
  createDeskAdminClientMock.mockReturnValue(fakeDeskAdminPort());
  createSpacesAdminClientMock.mockReturnValue(fakeSpacesAdminPort());
  createAssetAdminClientMock.mockReturnValue(fakeAssetAdminPort());
});

describe('OfficeShell', () => {
  it('provee un OfficeBridge real a GameCanvas (D3: unico dueno del bridge)', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    expect(bridge).toEqual(
      expect.objectContaining({
        on: expect.any(Function),
        emit: expect.any(Function),
        onCommand: expect.any(Function),
        emitCommand: expect.any(Function),
      }),
    );
  });

  it('al entrar a una sala, muestra un toast compuesto con el nombre en <b>', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { spaceId: 'space-stub', name: 'Sala de Juntas' }));

    // BottomBar's status text and the entry toast both render the room name
    // in bold; assert every occurrence is a real <b> element, not a string.
    const occurrences = screen.getAllByText('Sala de Juntas');
    expect(occurrences.length).toBeGreaterThan(0);
    occurrences.forEach((el) => expect(el.tagName).toBe('B'));
    expect(screen.getByText(/Entraste a/)).toBeInTheDocument();
  });

  it('muestra el aviso de la llave de puertas y «Sala bloqueada» desde el evento "doorlocknotice" (#223, S15)', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    expect(screen.queryByText('Pulsa X para bloquear la sala')).toBeNull();

    act(() => bridge.emit('doorlocknotice', { lockable: 'lock', insideLocked: false }));
    expect(screen.getByText('Pulsa X para bloquear la sala')).toBeInTheDocument();

    act(() => bridge.emit('doorlocknotice', { lockable: null, insideLocked: true }));
    expect(screen.queryByText('Pulsa X para bloquear la sala')).toBeNull();
    expect(screen.getByText('Sala bloqueada')).toBeInTheDocument();

    act(() => bridge.emit('doorlocknotice', { lockable: null, insideLocked: false }));
    expect(screen.queryByText('Sala bloqueada')).toBeNull();
  });

  it('un nombre de sala con marcado renderiza como texto literal (sin dangerouslySetInnerHTML)', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { spaceId: 'space-stub', name: '<img src=x onerror=alert(1)>' }));

    const occurrences = screen.getAllByText('<img src=x onerror=alert(1)>');
    expect(occurrences.length).toBeGreaterThan(0);
    occurrences.forEach((el) => expect(el.tagName).toBe('B'));
    expect(document.querySelector('#office-shell img')).toBeNull();
  });

  it('el toast desaparece por si solo tras su timeout', () => {
    vi.useFakeTimers();
    try {
      render(<OfficeShell />);
      const bridge = createGameMock.mock.calls[0][1];

      act(() => bridge.emit('room', { spaceId: 'space-stub', name: 'Sala de Juntas' }));
      expect(screen.getByText(/Entraste a/)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3200));

      expect(screen.queryByText(/Entraste a/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('recording (#5): server-owned, visible to every occupant', () => {
    beforeEach(() => {
      useProximityAudioMock.mockReturnValue(proximityAudio({ recordableMedia: true }));
    });

    const SELF = 'ses-me';

    function renderInRoom(spaceId = 'space-stub', name = 'Sala de Juntas') {
      render(<OfficeShell />);
      const bridge = createGameMock.mock.calls[0][1];
      act(() => bridge.emit('voice', { selfSessionId: SELF, selfName: 'Yo', peers: [], spaceId }));
      act(() => bridge.emit('room', { spaceId, name }));
      return bridge;
    }

    it('a room nobody publishes in offers nothing to record (#144)', () => {
      useProximityAudioMock.mockReturnValue(proximityAudio({ recordableMedia: false }));
      renderInRoom();

      const button = screen.getByRole('button', { name: /Grabar/ });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'No hay cámaras, pantalla o audio que grabar');
    });

    it('clicking Grabar asks the server to start; the badge waits for the synced state', async () => {
      const user = userEvent.setup();
      vi.mocked(startRecording).mockResolvedValue({ spaceId: 'space-stub', startedBy: SELF, startedAt: 1 });
      renderInRoom();

      await user.click(screen.getByRole('button', { name: /Grabar/ }));

      expect(startRecording).toHaveBeenCalledWith({
        url: expect.stringMatching(/\/recordings$/),
        sessionId: SELF,
        token: null,
        spaceId: 'space-stub',
      });
      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
    });

    it('a cubicle records like any room: the gate does not look at the space type', async () => {
      const user = userEvent.setup();
      vi.mocked(startRecording).mockResolvedValue({ spaceId: 'desk-stub', startedBy: SELF, startedAt: 1 });
      renderInRoom('desk-stub', 'Escritorio de Ana');

      await user.click(screen.getByRole('button', { name: /Grabar/ }));

      expect(startRecording).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'desk-stub' }));
    });

    it('someone else starting it shows the badge and tells this occupant too', () => {
      const bridge = renderInRoom();

      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: 'ses-other', startedAt: 1 } } }));

      expect(screen.getByText(/REC/)).toBeInTheDocument();
      expect(screen.getByText('⏺ Esta sala se está grabando')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Detener/ })).toBeInTheDocument();
    });

    it('entering a room that is already being recorded tells you so', () => {
      render(<OfficeShell />);
      const bridge = createGameMock.mock.calls[0][1];
      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: 'ses-other', startedAt: 1 } } }));
      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();

      act(() => bridge.emit('room', { spaceId: 'space-stub', name: 'Sala de Juntas' }));

      expect(screen.getByText(/REC/)).toBeInTheDocument();
      expect(screen.getByText('⏺ Esta sala se está grabando')).toBeInTheDocument();
    });

    it('a recording in another room shows nothing here', () => {
      const bridge = renderInRoom();

      act(() => bridge.emit('recordings', { active: { 'otra-sala': { startedBy: 'ses-other', startedAt: 1 } } }));

      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
    });

    it('when it stops while you stay in the room, the badge goes and you are told', () => {
      const bridge = renderInRoom();
      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: 'ses-other', startedAt: 1 } } }));

      act(() => bridge.emit('recordings', { active: {} }));

      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
      expect(screen.getByText('⏹ Grabación detenida')).toBeInTheDocument();
    });

    it('Detener asks the server to stop, whoever started it', async () => {
      const user = userEvent.setup();
      vi.mocked(stopRecording).mockResolvedValue(undefined);
      const bridge = renderInRoom();
      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: 'ses-other', startedAt: 1 } } }));

      await user.click(screen.getByRole('button', { name: /Detener/ }));

      expect(stopRecording).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SELF, spaceId: 'space-stub' }));
      expect(startRecording).not.toHaveBeenCalled();
    });

    it('a 409 says the room is already being recorded; other failures say it could not start', async () => {
      const user = userEvent.setup();
      renderInRoom();

      vi.mocked(startRecording).mockRejectedValueOnce(new RecordingError(409, 'already-recording'));
      await user.click(screen.getByRole('button', { name: /Grabar/ }));
      expect(await screen.findByText('Ya se está grabando esta sala')).toBeInTheDocument();

      vi.mocked(startRecording).mockRejectedValueOnce(new RecordingError(502, 'egress-failed'));
      await user.click(screen.getByRole('button', { name: /Grabar/ }));
      expect(await screen.findByText('No se pudo iniciar la grabación')).toBeInTheDocument();
    });

    it('the starter walking out stops it on the server and is told, and the badge goes', async () => {
      vi.mocked(stopRecording).mockResolvedValue(undefined);
      const bridge = renderInRoom();
      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: SELF, startedAt: 1 } } }));

      act(() => bridge.emit('room', { spaceId: null, name: null }));

      await vi.waitFor(() =>
        expect(stopRecording).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: SELF, spaceId: 'space-stub' }),
        ),
      );
      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
      expect(screen.getByText('💾 Saliste de la sala: grabación detenida')).toBeInTheDocument();
    });

    describe('finished recording ready (#58)', () => {
      const READY = { recordingId: 'rec-1', spaceId: 'space-stub', availableUntil: Date.UTC(2026, 9, 23, 12) };

      function fakeTab() {
        return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
      }

      it('shows a persistent notice that outlives the toast timeout', () => {
        vi.useFakeTimers();
        try {
          const bridge = renderInRoom();
          act(() => bridge.emit('recordingready', READY));

          act(() => vi.advanceTimersByTime(10_000));

          expect(screen.getByText('La grabación está lista')).toBeInTheDocument();
        } finally {
          vi.useRealTimers();
        }
      });

      it('Ver fetches a URL and opens it in a new tab', async () => {
        const user = userEvent.setup();
        const tab = fakeTab();
        const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
        vi.mocked(getRecordingUrl).mockResolvedValue({ url: 'http://m/k?sig', expiresAt: 1 });
        const bridge = renderInRoom();
        act(() => bridge.emit('recordingready', READY));

        await user.click(screen.getByRole('button', { name: 'Ver' }));

        expect(getRecordingUrl).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: SELF, recordingId: 'rec-1', download: false }),
        );
        // The tab is opened inside the click, before the await: a window opened
        // after a network round trip is what popup blockers stop.
        expect(open).toHaveBeenCalledWith('', '_blank');
        await vi.waitFor(() => expect(tab.location.href).toBe('http://m/k?sig'));
        expect(tab.opener).toBeNull();
        open.mockRestore();
      });

      it('Descargar fetches an attachment URL and navigates to it', async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        vi.mocked(getRecordingUrl).mockResolvedValue({ url: 'http://m/k?attach', expiresAt: 1 });
        const bridge = renderInRoom();
        act(() => bridge.emit('recordingready', READY));

        await user.click(screen.getByRole('button', { name: 'Descargar' }));

        expect(getRecordingUrl).toHaveBeenCalledWith(expect.objectContaining({ recordingId: 'rec-1', download: true }));
        await vi.waitFor(() => expect(open).toHaveBeenCalledWith('http://m/k?attach', '_self'));
        open.mockRestore();
      });

      it('a failure closes the blank tab and says so in a toast', async () => {
        const user = userEvent.setup();
        const tab = fakeTab();
        const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
        vi.mocked(getRecordingUrl).mockRejectedValue(new RecordingError(403, 'forbidden-recording'));
        const bridge = renderInRoom();
        act(() => bridge.emit('recordingready', READY));

        await user.click(screen.getByRole('button', { name: 'Ver' }));

        expect(await screen.findByText('No se pudo abrir la grabación')).toBeInTheDocument();
        expect(tab.close).toHaveBeenCalled();
        open.mockRestore();
      });

      it('(#5) an expired recording says so and drops its notice', async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        vi.mocked(getRecordingUrl).mockRejectedValue(new RecordingError(410, 'recording-expired'));
        const bridge = renderInRoom();
        act(() => bridge.emit('recordingready', READY));

        await user.click(screen.getByRole('button', { name: 'Descargar' }));

        expect(await screen.findByText('La grabación ya no está disponible')).toBeInTheDocument();
        expect(screen.queryByText('La grabación está lista')).not.toBeInTheDocument();
        open.mockRestore();
      });

      it('Cerrar dismisses the notice', async () => {
        const user = userEvent.setup();
        const bridge = renderInRoom();
        act(() => bridge.emit('recordingready', READY));

        await user.click(screen.getByRole('button', { name: 'Cerrar' }));

        expect(screen.queryByText('La grabación está lista')).not.toBeInTheDocument();
      });
    });

    it('someone who did not start it walks out silently and the recording keeps going', () => {
      const bridge = renderInRoom();
      act(() => bridge.emit('recordings', { active: { 'space-stub': { startedBy: 'ses-other', startedAt: 1 } } }));

      act(() => bridge.emit('room', { spaceId: null, name: null }));

      expect(stopRecording).not.toHaveBeenCalled();
      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
      expect(screen.queryByText('💾 Saliste de la sala: grabación detenida')).not.toBeInTheDocument();
      expect(screen.queryByText('⏹ Grabación detenida')).not.toBeInTheDocument();
    });
  });

  it('en piso abierto (sin sala) el boton de grabar queda deshabilitado y la grabacion nunca se activa', () => {
    render(<OfficeShell />);

    const recordButton = screen.getByRole('button', { name: /Grabar/ });

    // El propio atributo `disabled` -- que depende del mismo `room` que lee
    // el gate -- es la prueba de que un click real de usuario no puede
    // siquiera llegar al handler mientras no haya sala: ningun navegador
    // despacha `click` sobre un boton deshabilitado.
    expect(recordButton).toBeDisabled();
    expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
  });

  it('salir de una sala sin grabacion activa no muestra el toast de detencion', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { spaceId: 'space-stub', name: 'Sala de Juntas' }));
    act(() => bridge.emit('room', { spaceId: null, name: null }));

    expect(screen.queryByText('💾 Saliste de la sala: grabación detenida')).not.toBeInTheDocument();
  });

  it('mic y camara empiezan apagados en el montaje (#321 decision 2): ningun dispositivo se pide al unirse', () => {
    render(<OfficeShell />);

    expect(screen.getByRole('button', { name: /Mic/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Cámara/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('micOn/camOn/audioAvailable fluyen del hook a BottomBar, no de estado local propio', () => {
    useProximityAudioMock.mockReturnValue(proximityAudio({ micOn: true, audioAvailable: true }));

    render(<OfficeShell />);

    // Si OfficeShell aun tuviera su propio `useState(true)` para mic/cam,
    // esta combinacion asimetrica (mic prendido, cam apagado) no podria
    // distinguirse de un valor fijo: por eso los dos difieren entre si.
    const micButton = screen.getByRole('button', { name: /Mic/ });
    const camButton = screen.getByRole('button', { name: /Cámara/ });
    expect(micButton).toHaveAttribute('aria-pressed', 'true');
    expect(camButton).toHaveAttribute('aria-pressed', 'false');
    expect(micButton).toBeEnabled();
    expect(camButton).toBeEnabled();
  });

  it('audioAvailable en false deshabilita mic y camara en BottomBar (matriz de degradacion)', () => {
    useProximityAudioMock.mockReturnValue(proximityAudio({ audioAvailable: false }));

    render(<OfficeShell />);

    expect(screen.getByRole('button', { name: /Mic/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cámara/ })).toBeDisabled();
  });

  it('clicar mic/camara invoca toggleMic/toggleCam del hook, no un setState local', async () => {
    const user = userEvent.setup();
    const toggleMic = vi.fn();
    const toggleCam = vi.fn();
    useProximityAudioMock.mockReturnValue(
      proximityAudio({ audioAvailable: true, toggleMic, toggleCam }),
    );

    render(<OfficeShell />);
    await user.click(screen.getByRole('button', { name: /Mic/ }));

    expect(toggleMic).toHaveBeenCalledTimes(1);
    expect(toggleCam).not.toHaveBeenCalled();
  });

  it('the camera filter menu shows the hook filter and sends picks to it', async () => {
    const user = userEvent.setup();
    const setCameraFilter = vi.fn();
    useProximityAudioMock.mockReturnValue(
      proximityAudio({ audioAvailable: true, cameraFilter: 'blur-strong', cameraBlurAvailable: false, setCameraFilter }),
    );

    render(<OfficeShell />);
    await user.click(screen.getByRole('button', { name: 'Opciones de cámara' }));

    expect(screen.getByRole('menuitemradio', { name: 'Desenfoque total' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Desenfoque total' })).toBeDisabled();
    await user.click(screen.getByRole('menuitemradio', { name: 'Sin filtro' }));
    expect(setCameraFilter).toHaveBeenCalledExactlyOnceWith('none');
  });

  it('OfficeShell es el unico dueno del bridge: se lo pasa al hook, BottomBar solo recibe props planas', () => {
    render(<OfficeShell />);

    expect(useProximityAudioMock).toHaveBeenCalledTimes(1);
    const [bridgeArg] = useProximityAudioMock.mock.calls[0];
    expect(bridgeArg).toEqual(
      expect.objectContaining({ on: expect.any(Function), emit: expect.any(Function) }),
    );
  });

  it('emitir "nearby" (evento retirado, D9) no renderiza ningun chip: BottomBar ya no lo recibe', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    // `nearby` ya no existe en `OfficeEventMap`; el cast prueba que, aunque
    // alguien lo emitiera de forma insegura, no hay ningun consumidor vivo
    // que lo convierta en un chip visible.
    act(() =>
      (bridge.emit as (type: string, payload: unknown) => void)('nearby', { names: ['Ana'] }),
    );

    expect(screen.queryByText(/^🔊/)).not.toBeInTheDocument();
  });

  it('al recibir peermenu del bridge, abre el ContextMenu con nombre y estado', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('peermenu', {
        sessionId: 'peer-3',
        name: 'Pablo',
        status: 'En línea',
        statusCode: 'g',
        x: 10,
        y: 10,
      }),
    );

    expect(screen.getByText('Pablo')).toBeInTheDocument();
    // La etiqueta tambien aparece como opcion del selector propio, asi que se
    // busca la del menu: el <span> del encabezado, no el <option>.
    const menuStatus = screen.getAllByText('En línea').find((el) => el.tagName === 'SPAN');
    expect(menuStatus).toBeInTheDocument();
  });

  it('closemenu del bridge cierra el ContextMenu abierto', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('peermenu', {
        sessionId: 'peer-3',
        name: 'Pablo',
        status: 'En línea',
        statusCode: 'g',
        x: 10,
        y: 10,
      }),
    );
    expect(screen.getByText('Pablo')).toBeInTheDocument();

    act(() => bridge.emit('closemenu', undefined));

    expect(screen.queryByText('Pablo')).not.toBeInTheDocument();
  });

  it('"Ver perfil" muestra la ficha del companero en un toast y cierra el menu', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('peermenu', {
        sessionId: 'peer-7',
        name: 'Jordan Távara',
        status: 'En línea',
        statusCode: 'g',
        x: 10,
        y: 10,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Ver perfil/ }));

    expect(screen.getByText(/Empleado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver perfil/ })).not.toBeInTheDocument();
  });

  it('sin bloqueo de autoplay no muestra ningun aviso de audio', () => {
    render(<OfficeShell />);

    expect(screen.queryByText(/bloqueó el audio/)).not.toBeInTheDocument();
  });

  it('con el audio bloqueado por el navegador, ofrece desbloquearlo (#18)', async () => {
    const unblockAudio = vi.fn();
    useProximityAudioMock.mockReturnValue(
      proximityAudio({ audioAvailable: true, audioBlocked: true, unblockAudio }),
    );

    render(<OfficeShell />);
    await userEvent.click(screen.getByRole('button', { name: /activar el audio/i }));

    expect(unblockAudio).toHaveBeenCalledTimes(1);
  });
});

describe('OfficeShell: llamar a un companero real (issue #2, unit 11, D3/D12)', () => {
  it('"Llamar" sobre un peer emite el comando callPeer con su sessionId y muestra un toast de espera', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { sessionId: string }[] = [];
    bridge.onCommand('callPeer', (payload) => commands.push(payload));

    act(() =>
      bridge.emit('peermenu', {
        sessionId: 'peer-1',
        name: 'Marta Ríos',
        status: 'En línea',
        statusCode: 'g',
        x: 10,
        y: 10,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    // D3: React solo pide la invitacion, nunca aprende que "aceptar" implica
    // caminar -- por eso el unico comando que ve esta prueba es `callPeer`.
    expect(commands).toEqual([{ sessionId: 'peer-1' }]);
    const toast = screen.getByText(/Llamando a/);
    expect(toast).toBeInTheDocument();
    // #187: the green svg phone, never the red phone emoji.
    expect(toast.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(toast.textContent).not.toContain('\u{1F4DE}');
    expect(screen.queryByRole('button', { name: /Llamar/ })).not.toBeInTheDocument();
  });

  it('"callaccepted" del bridge muestra un toast con quien viene hacia ti (regla de feedback del llamador)', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('callaccepted', { by: 'peer-1', name: 'Marta Ríos' }));

    expect(screen.getByText(/viene hacia ti/)).toBeInTheDocument();
    expect(screen.getByText('Marta Ríos')).toBeInTheDocument();
  });

  it('monta la pila de invitaciones (D12): una llamada entrante renderiza su tarjeta y aceptar emite respondCall', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { from: string; accept: boolean }[] = [];
    bridge.onCommand('respondCall', (payload) => commands.push(payload));

    act(() => bridge.emit('callinvite', { from: 'caller-1', name: 'Diego Soto' }));
    expect(screen.getByText(/te está llamando/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ir con la persona/ }));

    expect(commands).toEqual([{ from: 'caller-1', accept: true }]);
    expect(screen.queryByText(/te está llamando/)).not.toBeInTheDocument();
  });
});

describe('OfficeShell: estado de presencia (#1)', () => {
  it('arranca "En línea" y lo refleja en el selector', () => {
    render(<OfficeShell />);

    expect(screen.getByLabelText('Mi estado')).toHaveValue('g');
  });

  it('elegir un estado lo envia a la escena por el puente y lo refleja en el HUD', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { status: string }[] = [];
    bridge.onCommand('setStatus', (payload) => commands.push(payload));

    await user.selectOptions(screen.getByLabelText('Mi estado'), 'r');

    // React es el unico escritor del estado; la escena lo sigue por comando.
    expect(commands).toEqual([{ status: 'r' }]);
    expect(screen.getByLabelText('Mi estado')).toHaveValue('r');
  });

  it('el estado elegido llega al hook de audio, que es quien deja de publicar', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);

    await user.selectOptions(screen.getByLabelText('Mi estado'), 'r');

    expect(useProximityAudioMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ status: 'r' }),
    );
  });

  it('en "No molestar" mic y camara quedan deshabilitados aunque haya LiveKit', async () => {
    const user = userEvent.setup();
    useProximityAudioMock.mockReturnValue(proximityAudio({ audioAvailable: true }));

    render(<OfficeShell />);
    await user.selectOptions(screen.getByLabelText('Mi estado'), 'r');

    expect(screen.getByRole('button', { name: /Mic/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cámara/ })).toBeDisabled();
  });
});

describe('OfficeShell: habla real llega al anillo del avatar por comando (issue #17, D7)', () => {
  it('reenvia el conjunto de hablantes del hook como comando "speakers" a la escena', () => {
    const { rerender } = render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { sessionIds: string[] }[] = [];
    bridge.onCommand('speakers', (payload) => commands.push(payload));

    useProximityAudioMock.mockReturnValue(proximityAudio({ speakers: new Set(['par-1']) }));
    rerender(<OfficeShell />);

    expect(commands.at(-1)).toEqual({ sessionIds: ['par-1'] });
  });

  it('un conjunto de hablantes vacio tambien se reenvia: apaga el anillo cuando nadie habla', () => {
    useProximityAudioMock.mockReturnValue(proximityAudio({ speakers: new Set(['par-1']) }));
    const { rerender } = render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { sessionIds: string[] }[] = [];
    bridge.onCommand('speakers', (payload) => commands.push(payload));

    useProximityAudioMock.mockReturnValue(proximityAudio({ speakers: new Set() }));
    rerender(<OfficeShell />);

    expect(commands.at(-1)).toEqual({ sessionIds: [] });
  });
});

describe('OfficeShell: sesion autenticada (#8)', () => {
  const session = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  it('sin sesion la oficina se monta igual que antes, sin nombre ni token', () => {
    render(<OfficeShell />);

    // El camino del desarrollo local y de la suite e2e: `AuthGate` entrega
    // `null` y aqui no debe cambiar nada.
    expect(createGameMock.mock.calls[0][2]).toEqual({ endpoint: expect.anything() });
    expect(useProximityAudioMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ session: null }),
    );
  });

  it('reenvia la sesion a la escena, que la necesita para entrar a la sala', () => {
    render(<OfficeShell session={session} />);

    expect(createGameMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({ playerName: 'Ana Torres', getIdToken: expect.any(Function) }),
    );
  });

  it('reenvia la sesion al hook de audio, que la necesita para pedir el token de LiveKit', () => {
    render(<OfficeShell session={session} />);

    // Son los dos unicos sitios que hablan con el servidor: la sala de
    // Colyseus y `POST /livekit/token`. Ambos verifican el mismo ID token.
    expect(useProximityAudioMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ session }),
    );
  });
});

describe('OfficeShell: nombre real del usuario local (#6)', () => {
  it('escribe en la barra el nombre de la sesion, no uno cableado', () => {
    render(<OfficeShell session={{ displayName: 'Ana Torres', getIdToken: async () => null }} />);

    expect(screen.getByText(/Ana Torres/)).toBeInTheDocument();
    expect(screen.queryByText(/HugoGT/)).not.toBeInTheDocument();
  });

  it('sin sesion la barra cae en el nombre por defecto, no en el de una persona', () => {
    render(<OfficeShell />);

    // Desarrollo local, e2e y la oficina abierta comparten este camino: sin
    // identidad verificada el HUD llama al usuario como lo llama el servidor.
    expect(screen.getByText(new RegExp(DEFAULT_NAME))).toBeInTheDocument();
  });
});

/**
 * La config de espacios servida llegando a la escena (#7, slice 3). Lo que se
 * prueba aqui es el ENVIO: que este componente la resuelve y la manda por
 * comando. Que la escena la adopte lo cubre `OfficeScene.browser.test.ts`, y
 * la lectura de `/spaces` la cubre `spacesConfig.test.ts`.
 */
describe('OfficeShell: config de espacios servida (#7, slice 3)', () => {
  it('manda la config resuelta a la escena por comando, no por prop', async () => {
    // Por prop entraria en las dependencias del efecto de `GameCanvas` y
    // recrearia Phaser entero al llegar; por comando la escena la adopta en
    // caliente y sigue corriendo.
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const configs: { spaces: readonly { id: string }[]; version: string }[] = [];
    bridge.onCommand('spacesconfig', (payload) => configs.push(payload));

    await vi.waitFor(() => expect(configs.length).toBeGreaterThan(0));
  });

  it('el juego se monta ANTES de que la config llegue: nadie espera a la red', async () => {
    // Retrasar el montaje hasta tener la config le costaria a todo el mundo,
    // en todo despliegue, un viaje de red antes de ver la oficina.
    render(<OfficeShell />);

    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('sin servidor que responda manda el fallback incorporado', async () => {
    // Es el camino de un despliegue sin `DATABASE_URL` (y el de jsdom, donde
    // el fetch no llega a ninguna parte): todos los clientes caen en el mismo
    // valor, asi que coinciden en version y se siguen oyendo.
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const versions: string[] = [];
    bridge.onCommand('spacesconfig', ({ version }) => versions.push(version));

    await vi.waitFor(() => expect(versions).toContain(BUILT_IN_SPACES_VERSION));
  });
});

/**
 * Convergencia tras el drift de un par (#74, PR3a). `OfficeScene` ya acota el
 * evento a UNA vez por version distinta (`OfficeScene.browser.test.ts`); lo
 * que se prueba aqui es que este componente REACCIONA a cada evento que le
 * llega releyendo las dos listas, sin filtrar nada por su cuenta.
 */
describe('OfficeShell: convergencia tras drift de un par (#74, PR3a)', () => {
  const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  function spacesReads(fetchSpy: { mock: { calls: unknown[][] } }): number {
    return fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/spaces')).length;
  }

  it.each(['deskschanged', 'spaceschanged'] as const)(
    'a "%s" rereads both /desks and /spaces so desk edits converge at once (#183)',
    async (event) => {
      vi.mocked(fetchOfficeDesks).mockResolvedValue([]);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red en jsdom'));

      render(<OfficeShell session={SESION} />);
      const bridge = createGameMock.mock.calls[0][1];
      await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(spacesReads(fetchSpy)).toBe(1));

      act(() => bridge.emit(event, undefined));

      await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(spacesReads(fetchSpy)).toBe(2));
      fetchSpy.mockRestore();
    },
  );

  it('rereads /spaces on the connected edge too, so a missed edit converges (#183)', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red en jsdom'));

    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(spacesReads(fetchSpy)).toBe(1));
    const presence = (state: 'connected' | 'reconnecting') => ({ online: state === 'connected', peers: 0, state, canRetry: true });

    act(() => bridge.emit('presence', presence('connected')));
    await vi.waitFor(() => expect(spacesReads(fetchSpy)).toBe(2));
    act(() => bridge.emit('presence', presence('connected')));
    act(() => bridge.emit('presence', presence('reconnecting')));
    act(() => bridge.emit('presence', presence('connected')));
    await vi.waitFor(() => expect(spacesReads(fetchSpy)).toBe(3));
    fetchSpy.mockRestore();
  });

  it('un "spacesstale" del puente relee tanto /desks como /spaces', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red en jsdom'));

    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));
    const spacesCallsBeforeStale = fetchSpy.mock.calls.length;

    act(() => bridge.emit('spacesstale', { version: 'version-editada' }));

    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(spacesCallsBeforeStale),
    );

    fetchSpy.mockRestore();
  });

  it('dos versiones distintas relean dos veces, una por evento recibido', async () => {
    // El acotado a "una vez por version" vive en la escena, no aqui: este
    // componente no vuelve a filtrar lo que ya le llega filtrado.
    vi.mocked(fetchOfficeDesks).mockResolvedValue([]);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red en jsdom'));

    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));

    act(() => bridge.emit('spacesstale', { version: 'version-a' }));
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));

    act(() => bridge.emit('spacesstale', { version: 'version-b' }));
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(3));
  });
});

/**
 * Los escritorios asignables llegando a la escena y repartiendose (#7, slice
 * 5). Lo que se prueba aqui es el CABLEADO: que este componente resuelve la
 * lista y la manda por comando, y que un clic en el canvas acaba en la
 * peticion correcta y en un aviso que dice la verdad.
 *
 * Que la escena los dibuje lo cubre `OfficeScene.browser.test.ts`, la lectura
 * de `/desks` la cubre `desksClient.test.ts` y el ciclo de vida del enganche
 * lo cubre `useDesks.test.ts`.
 */
describe('OfficeShell: escritorios asignables (#7, slice 5)', () => {
  const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  const MESA: OfficeDesk = {
    id: 'id-mesa',
    label: 'Mesa 4',
    x: 320,
    y: 384,
    w: 96,
    h: 96,
    occupant: null,
    mine: false,
  };

  beforeEach(() => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([MESA]);
    vi.mocked(claimDesk).mockResolvedValue('claimed');
    vi.mocked(releaseDesk).mockResolvedValue('released');
  });

  it('refetches remote desk invalidations through the existing scene command and cleans up listeners', async () => {
    const { unmount } = render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    const seen: (readonly OfficeDesk[])[] = [];
    bridge.onCommand('desks', ({ desks }) => seen.push(desks));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([MESA]));
    const updated = { ...MESA, label: 'Remote update' };
    vi.mocked(fetchOfficeDesks).mockResolvedValue([updated]);
    act(() => bridge.emit('deskschanged', undefined));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([updated]));
    expect(fetchOfficeDesks).toHaveBeenCalledTimes(2);
    expect(createGameMock).toHaveBeenCalledTimes(1);
    unmount();
    act(() => bridge.emit('deskschanged', undefined));
    expect(fetchOfficeDesks).toHaveBeenCalledTimes(2);
  });

  it('refetches once on recovery so mutations missed while disconnected converge', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));
    const presence = (state: 'connected' | 'reconnecting') => ({ online: state === 'connected', peers: 0, state, canRetry: true });
    act(() => bridge.emit('presence', presence('connected')));
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
    act(() => bridge.emit('presence', presence('connected')));
    expect(fetchOfficeDesks).toHaveBeenCalledTimes(2);
    act(() => bridge.emit('presence', presence('reconnecting')));
    act(() => bridge.emit('presence', presence('connected')));
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(3));
  });

  it('manda la lista resuelta a la escena por comando, no por prop', async () => {
    // Misma razon que `spacesconfig`: por prop entraria en las dependencias
    // del efecto de `GameCanvas` y recrearia Phaser entero en cada refresco,
    // que aqui ocurre cada vez que alguien coge o suelta un sitio.
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    const listas: { desks: readonly OfficeDesk[] }[] = [];
    bridge.onCommand('desks', (payload) => listas.push(payload));

    await vi.waitFor(() => expect(listas.at(-1)?.desks).toEqual([MESA]));
  });

  it('sin sesion no pregunta por los escritorios de nadie', async () => {
    // `GET /desks` publica quien vino hoy y quien esta al lado de quien. Sin
    // credencial no hay nada que preguntar, y la oficina abierta (desarrollo
    // local, e2e) sigue funcionando igual, sin escritorios asignables.
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const listas: { desks: readonly OfficeDesk[] }[] = [];
    bridge.onCommand('desks', (payload) => listas.push(payload));

    // Nunca se pide, asi que a la escena no puede llegarle ni un escritorio:
    // que sin comando no dibuje ninguno lo fija `OfficeScene.browser.test.ts`.
    await vi.waitFor(() => expect(createGameMock).toHaveBeenCalled());
    expect(fetchOfficeDesks).not.toHaveBeenCalled();
    expect(listas.every(({ desks }) => desks.length === 0)).toBe(true);
  });

  /** The scene says the pointer is over a desk; the banner waits for the list that names it. */
  async function hoverDesk(bridge: OfficeBridge, deskId = 'id-mesa'): Promise<void> {
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});
    act(() => bridge.emit('deskhover', { deskId, x: 200, y: 150 }));
  }

  it('pasar sobre un escritorio libre ofrece reclamarlo, y reclamarlo lo coge y lo dice', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);

    expect(screen.getByRole('dialog', { name: 'Escritorio Libre' })).toBeInTheDocument();
    expect(claimDesk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reclamar escritorio' }));

    expect(await screen.findByText(/Te sentaste en/)).toBeInTheDocument();
    expect(claimDesk).toHaveBeenCalledWith(expect.objectContaining({ deskId: 'id-mesa' }));
    expect(screen.queryByRole('dialog', { name: 'Escritorio Libre' })).not.toBeInTheDocument();
  });

  it('con un escritorio propio no ofrece reclamar otro', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([
      MESA,
      { ...MESA, id: 'id-mia', x: 640, occupant: { id: 'id-ana', displayName: 'Ana Torres' }, mine: true },
    ]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);

    expect(screen.getByRole('button', { name: 'Reclamar escritorio' })).toBeDisabled();
  });

  it('un 409 dice que alguien se adelanto y vuelve a leer la lista', async () => {
    // Tragarlo dejaria el escritorio pintado como tuyo sin serlo, y la vista
    // de quien hizo clic ya no vale: hay que releerla.
    vi.mocked(claimDesk).mockResolvedValue('taken');
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);
    expect(fetchOfficeDesks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reclamar escritorio' }));

    expect(await screen.findByText(/se adelant/)).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
  });

  it('un fallo al coger no se cuenta como conseguido', async () => {
    vi.mocked(claimDesk).mockResolvedValue('failed');
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);

    await userEvent.click(screen.getByRole('button', { name: 'Reclamar escritorio' }));

    expect(await screen.findByText(/No se pudo coger/)).toBeInTheDocument();
  });

  it('pasar sobre el propio OFRECE dejarlo, no lo suelta por su cuenta', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([{ ...MESA, occupant: { id: 'id-ana', displayName: 'Ana Torres' }, mine: true }]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);

    expect(screen.getByRole('dialog', { name: 'Ana Torres' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dejar escritorio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Llamar/ })).not.toBeInTheDocument();
    expect(releaseDesk).not.toHaveBeenCalled();
  });

  it('aceptar la oferta suelta el escritorio y vuelve a leer la lista', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([{ ...MESA, occupant: { id: 'id-ana', displayName: 'Ana Torres' }, mine: true }]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);

    await userEvent.click(screen.getByRole('button', { name: 'Dejar escritorio' }));

    // Sin id: el servidor suelta el de la identidad verificada de quien llama.
    expect(releaseDesk).toHaveBeenCalledWith(expect.not.objectContaining({ deskId: 'id-mesa' }));
    expect(await screen.findByText(/Dejaste/)).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
  });

  it('pasar sobre el de alguien conectado ofrece llamarle, y nada mas', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([{ ...MESA, occupant: { id: 'id-luis', displayName: 'Luis Paz' } }]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    const calls: unknown[] = [];
    bridge.onCommand('callPeer', (command) => calls.push(command));
    act(() => bridge.emit('roster', { peers: [{ sessionId: 's-luis', name: 'Luis Paz', status: 'g' }] }));
    await hoverDesk(bridge);

    const banner = screen.getByRole('dialog', { name: 'Luis Paz' });
    expect(within(banner).getAllByRole('button')).toHaveLength(1);
    await userEvent.click(within(banner).getByRole('button', { name: 'Llamar a Luis Paz' }));

    expect(calls).toEqual([{ sessionId: 's-luis' }]);
    expect(await screen.findByText(/Llamando a/)).toBeInTheDocument();
  });

  it('el banner se va al salir del escritorio', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await hoverDesk(bridge);
    expect(screen.getByRole('dialog', { name: 'Escritorio Libre' })).toBeInTheDocument();

    act(() => bridge.emit('deskhover', null));

    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Escritorio Libre' })).not.toBeInTheDocument());
  });
});

/**
 * "Decoración" for whoever occupies a desk and does not administer (#7,
 * slice 6, then #208): the office decor layer, edited inside the desk.
 */
describe('OfficeShell: Decoración for one desk', () => {
  const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  const MIA: OfficeDesk = {
    id: 'id-mesa',
    label: 'Mesa 4',
    x: 320,
    y: 384,
    w: 96,
    h: 96,
    occupant: { id: 'id-ana', displayName: 'Ana Torres' },
    mine: true,
  };

  beforeEach(() => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([MIA]);
    vi.mocked(claimDesk).mockResolvedValue('claimed');
    vi.mocked(releaseDesk).mockResolvedValue('released');
  });

  async function openMySpace(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    await user.click(screen.getByRole('button', { name: 'Decoración' }));
  }

  it('"Decorar" in the own desk banner opens "Decoración" on that desk', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});
    act(() => bridge.emit('deskhover', { deskId: 'id-mesa', x: 200, y: 150 }));

    await userEvent.click(screen.getByRole('button', { name: 'Decorar' }));

    expect(await screen.findByRole('heading', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Ana Torres' })).not.toBeInTheDocument();
  });

  it('sin escritorio propio "Decoración" pide reclamar uno libre', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([{ ...MIA, occupant: null, mine: false }]);
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);

    await openMySpace(user);

    expect(await screen.findByText('Reclama un escritorio libre en el mapa para decorarlo.')).toBeInTheDocument();
  });

  it('con escritorio propio "Decoración" no pide reclamar ninguno', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);

    await openMySpace(user);

    expect(await screen.findByRole('heading', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByText('Reclama un escritorio libre en el mapa para decorarlo.')).not.toBeInTheDocument();
  });

  it('con escritorio propio "Decoración" lo decora con /me/decor sobre su recuadro y termina con «Dejar escritorio»', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: unknown[] = [];
    bridge.onCommand('decoredit', (command) => commands.push(command));

    await openMySpace(user);

    expect(vi.mocked(createOfficeDecorClient)).toHaveBeenCalledWith(expect.objectContaining({ scope: 'desk' }));
    // The desk at (320, 384) px is the 3x3 tiles from (10, 12), and the only desk the rules know.
    expect(commands.at(-1)).toEqual({ brush: null, area: { x: 10, y: 12, w: 3, h: 3 }, desks: [{ x: 10, y: 12, w: 3, h: 3 }] });

    await user.click(screen.getByRole('button', { name: 'Dejar escritorio' }));
    expect(releaseDesk).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Dejaste/)).toBeInTheDocument();
  });

  it('reclamar un escritorio libre lo coge y recuerda donde se decora', async () => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([{ ...MIA, id: 'id-otra', label: '', occupant: null, mine: false }]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});
    act(() => bridge.emit('deskhover', { deskId: 'id-otra', x: 200, y: 150 }));

    await userEvent.click(screen.getByRole('button', { name: 'Reclamar escritorio' }));

    expect(await screen.findByText(/Te sentaste en/)).toHaveTextContent('Te sentaste en este escritorio · Decóralo en Personalizar › Decoración');
  });

  it('dice que un escritorio esta lleno cuando la escena no deja entrar en el', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('deskfull', undefined));

    expect(await screen.findByText('Este escritorio está lleno (máximo 6 personas).')).toBeInTheDocument();
  });
});

describe('OfficeShell: screen share (#20)', () => {
  const SELF = 'ses-me';

  function renderInSpace() {
    const rendered = render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    act(() => bridge.emit('voice', { selfSessionId: SELF, selfName: 'Yo', peers: [], spaceId: 'space-stub' }));
    return { ...rendered, bridge };
  }

  function share(sessionId: string, name: string) {
    useProximityAudioMock.mockReturnValue(proximityAudio({ activeScreenSharer: { sessionId, name } }));
  }

  it('everyone in the space is told who started sharing, the name in <b>', () => {
    const { rerender } = renderInSpace();

    share('ses-ana', 'Ana');
    rerender(<OfficeShell />);

    expect(screen.getByText(/empezó a compartir pantalla/)).toBeInTheDocument();
    expect(screen.getByText('Ana').tagName).toBe('B');
  });

  it('a takeover is announced too, with the new sharer', () => {
    const { rerender } = renderInSpace();
    share('ses-ana', 'Ana');
    rerender(<OfficeShell />);

    share('ses-beto', 'Beto');
    rerender(<OfficeShell />);

    expect(screen.getByText('Beto').tagName).toBe('B');
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('the sharer is told in the second person', () => {
    const { rerender } = renderInSpace();

    share(SELF, 'Yo');
    rerender(<OfficeShell />);

    expect(screen.getByText('Empezaste a compartir tu pantalla')).toBeInTheDocument();
  });

  it('the same person sharing again after stopping is announced again', () => {
    const { rerender } = renderInSpace();
    share('ses-ana', 'Ana');
    rerender(<OfficeShell />);

    useProximityAudioMock.mockReturnValue(proximityAudio({ activeScreenSharer: null }));
    rerender(<OfficeShell />);
    share('ses-ana', 'Ana');
    rerender(<OfficeShell />);

    expect(screen.getByText(/empezó a compartir pantalla/)).toBeInTheDocument();
  });

  it('hands the share state to the bottom bar and the tiles', () => {
    useProximityAudioMock.mockReturnValue(
      proximityAudio({ audioAvailable: true, screenShareAvailable: true, screenShareOn: true }),
    );

    renderInSpace();

    expect(screen.getByRole('button', { name: '🖥️ Dejar de compartir' })).toBeEnabled();
  });
});

describe('OfficeShell: exit controls (#66)', () => {
  it('"Cerrar sesión" signs out through the session', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);
    render(
      <OfficeShell session={{ displayName: 'Ana Torres', getIdToken: async () => null, signOut }} />,
    );

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('a failed sign out is told, not swallowed', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {
      throw new Error('network');
    });
    render(
      <OfficeShell session={{ displayName: 'Ana Torres', getIdToken: async () => null, signOut }} />,
    );

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));

    expect(await screen.findByText('No se pudo cerrar la sesión')).toBeInTheDocument();
  });

  it('without a session there is no "Cerrar sesión"', () => {
    render(<OfficeShell onLeaveOffice={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Cerrar sesión/ })).not.toBeInTheDocument();
  });

  it('"Salir" hands leaving to whoever mounted the office', async () => {
    const user = userEvent.setup();
    const onLeaveOffice = vi.fn();
    render(<OfficeShell onLeaveOffice={onLeaveOffice} />);

    await user.click(screen.getByRole('button', { name: 'Salir' }));

    expect(onLeaveOffice).toHaveBeenCalledTimes(1);
  });
});

describe('OfficeShell: map zoom control (map-zoom)', () => {
  it('shows the zoom the scene announces, whichever input changed it', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const group = screen.getByRole('group', { name: 'Zoom del mapa' });
    expect(group).toHaveTextContent('2x');

    act(() => bridge.emit('zoomchanged', zoomView(0.5)));

    expect(group).toHaveTextContent('0.5x');
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeDisabled();
  });

  it('sends each click to the scene as a zoom command, and the label resets to 2x', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const actions: ZoomAction[] = [];
    // Stands in for the scene: confirms a reset with the stop it landed on.
    bridge.onCommand('zoom', ({ action }) => {
      actions.push(action);
      if (action === 'reset') bridge.emit('zoomchanged', zoomView(2));
    });
    // The limits each disable one button: 0.5x has no zoom out, 4x no zoom in.
    act(() => bridge.emit('zoomchanged', zoomView(0.5)));
    await user.click(screen.getByRole('button', { name: 'Acercar' }));
    act(() => bridge.emit('zoomchanged', zoomView(4)));
    await user.click(screen.getByRole('button', { name: 'Alejar' }));
    await user.click(screen.getByRole('button', { name: 'Restablecer zoom a 2x (ahora 4x)' }));

    expect(actions).toEqual(['in', 'out', 'reset']);
    expect(screen.getByRole('group', { name: 'Zoom del mapa' })).toHaveTextContent('2x');
  });
});

describe('OfficeShell: replaced by another tab (#78)', () => {
  it('a replaced session hands leaving to whoever mounted the office', () => {
    const onSessionReplaced = vi.fn();
    const onLeaveOffice = vi.fn();
    render(<OfficeShell onLeaveOffice={onLeaveOffice} onSessionReplaced={onSessionReplaced} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'replaced', canRetry: true }));

    expect(onSessionReplaced).toHaveBeenCalledTimes(1);
    expect(onLeaveOffice).not.toHaveBeenCalled();
  });

  it('any other lost session stays in the office', () => {
    const onSessionReplaced = vi.fn();
    render(<OfficeShell onSessionReplaced={onSessionReplaced} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'offline', canRetry: true }));
    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'reconnecting', canRetry: true }));

    expect(onSessionReplaced).not.toHaveBeenCalled();
  });
});

describe('OfficeShell: access revoked (#93)', () => {
  it('a revoked session hands leaving to whoever mounted the office', () => {
    const onAccessRevoked = vi.fn();
    const onSessionReplaced = vi.fn();
    render(<OfficeShell onAccessRevoked={onAccessRevoked} onSessionReplaced={onSessionReplaced} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'revoked', canRetry: true }));

    expect(onAccessRevoked).toHaveBeenCalledTimes(1);
    expect(onSessionReplaced).not.toHaveBeenCalled();
  });
});

describe('OfficeShell: access denied at join (#129)', () => {
  it('a refused join hands its reason to whoever mounted the office', () => {
    const onAccessDenied = vi.fn();
    const onAccessRevoked = vi.fn();
    render(<OfficeShell onAccessDenied={onAccessDenied} onAccessRevoked={onAccessRevoked} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('presence', { online: false, peers: 0, state: 'denied', reason: 'not-provisioned', canRetry: true }),
    );

    expect(onAccessDenied).toHaveBeenCalledTimes(1);
    expect(onAccessDenied).toHaveBeenCalledWith('not-provisioned');
    expect(onAccessRevoked).not.toHaveBeenCalled();
  });

  it('a network failure is not a refusal', () => {
    const onAccessDenied = vi.fn();
    render(<OfficeShell onAccessDenied={onAccessDenied} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('presence', { online: false, peers: 0, state: 'offline', canRetry: true }));

    expect(onAccessDenied).not.toHaveBeenCalled();
    expect(screen.getByText('⚪ Sin servidor')).toBeInTheDocument();
  });
});

describe('OfficeShell: barra lateral de personas (#74)', () => {
  it('el roster que llega por el puente se ve al expandir la barra lateral', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('roster', { peers: [{ sessionId: 'a', name: 'Ana Remota', status: 'g' }] }));
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.getByText(/Ana Remota/)).toBeInTheDocument();
  });

  it('calling a peer from the sidebar emits callPeer and shows the same calling toast as the menu (#187)', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const commands: { sessionId: string }[] = [];
    bridge.onCommand('callPeer', (payload) => commands.push(payload));

    act(() => bridge.emit('roster', { peers: [{ sessionId: 'a', name: 'Ana Remota', status: 'g' }] }));
    await user.click(screen.getByRole('button', { name: /Personas/ }));
    await user.click(screen.getByRole('button', { name: 'Llamar a Ana Remota' }));

    expect(commands).toEqual([{ sessionId: 'a' }]);
    const toast = screen.getByText(/Llamando a/);
    expect(toast).toHaveTextContent('Llamando a Ana Remota');
    expect(toast.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('el nombre propio que ve la barra inferior es el mismo que se antepone en la barra lateral', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={{ displayName: 'Ana Torres', getIdToken: async () => null }} />);

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.getAllByText(/Ana Torres/).length).toBeGreaterThan(0);
  });

});

/**
 * Suspension de coger/soltar sitio mientras se edita el mapa (#74, PR3c). El puerto
 * de escritorios ya se dobla en el `beforeEach` de arriba; aqui cada test solo
 * fija el rol y, si hace falta, controla la lista que ve el editor.
 */
describe('OfficeShell: exclusividad del editor de layout (#74, PR3c)', () => {
  const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  const MIA: OfficeDesk = {
    id: 'id-mesa',
    label: 'Mesa 4',
    x: 320,
    y: 384,
    w: 96,
    h: 96,
    occupant: { id: 'id-ana', displayName: 'Ana Torres' },
    mine: true,
  };

  const MESA_ADMIN: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };

  beforeEach(() => {
    useOfficeAdminRoleMock.mockReturnValue('admin');
    createDeskAdminClientMock.mockReturnValue(fakeDeskAdminPort({ listDesks: vi.fn(async () => [MESA_ADMIN]) }));
    vi.mocked(fetchOfficeDesks).mockResolvedValue([MIA]);
  });

  async function openSidebar(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    // "Editar espacios" vive en el panel "Personalizar", no bajo "Personas conectadas".
    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
  }

  it('con rol admin, "Editar espacios" (escritorios y salas) se ofrece en el sidebar', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);
    await openSidebar(user);

    expect(await screen.findByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
  });

  it('"Editar espacios" opens once its lazy editor loads, and its rooms part edits the rooms (#74, PR4)', async () => {
    let resolveEditor!: () => void;
    layoutEditorLoad.ready = new Promise<void>((resolve) => { resolveEditor = resolve; });
    try {
      const user = userEvent.setup();
      render(<OfficeShell session={SESION} />);

      await openSidebar(user);
      await user.click(await screen.findByRole('button', { name: 'Editar espacios' }));

      expect(screen.queryByRole('heading', { name: 'Salas' })).not.toBeInTheDocument();
      // Import completion, not the DOM query's deadline, determines submenu readiness.
      await act(async () => {
        resolveEditor();
        await layoutEditorLoad.loaded;
        await vi.dynamicImportSettled();
      });
      await screen.findByRole('heading', { name: 'Salas' });
      // The rooms part opens already expanded.
      await screen.findByText(/Nombre de la nueva sala/);

      await user.click(screen.getByRole('button', { name: 'Salir' }));
      expect(screen.getByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Salas' })).not.toBeInTheDocument();
    } finally {
      resolveEditor();
      layoutEditorLoad.ready = null;
      await act(async () => { await vi.dynamicImportSettled(); });
    }
  });

  it('mientras se edita, pasar sobre el propio escritorio no ofrece dejarlo ni decorarlo', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await openSidebar(user);
    await user.click(await screen.findByRole('button', { name: 'Editar espacios' }));
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});

    act(() => bridge.emit('deskhover', { deskId: 'id-mesa', x: 200, y: 150 }));

    expect(screen.queryByRole('button', { name: 'Dejar escritorio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decorar' })).not.toBeInTheDocument();
    expect(vi.mocked(releaseDesk)).not.toHaveBeenCalled();
  });

  /**
   * `layoutEditing` en `OfficeShell` viene de `onLayoutEditingChange`, que
   * `OfficeLayoutEditor` ya calcula como "cualquiera de las dos secciones"
   * (deski O sala). Este test es el mismo que "mientras se edita, un
   * deskhover no abre..." de arriba pero entrando por SALAS en vez de
   * escritorios (#74, PR4 correction): prueba que ese "cualquiera de las
   * dos" de verdad suspende el banner tambien cuando quien edita es la
   * seccion de salas, no solo la de escritorios.
   */
  it('mientras se edita SALAS, pasar sobre un escritorio no abre el editor de decoracion ni ofrece dejar el sitio', async () => {
    const user = userEvent.setup();
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await openSidebar(user);
    await user.click(await screen.findByRole('button', { name: 'Editar espacios' }));
    // The rooms part is the one open by default.
    await screen.findByText(/Nombre de la nueva sala/);
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalled());
    await act(async () => {});

    act(() => bridge.emit('deskhover', { deskId: 'id-mesa', x: 200, y: 150 }));

    expect(screen.queryByRole('button', { name: 'Dejar escritorio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decorar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(releaseDesk)).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
  });
});

// Last on purpose: the install prompt store is one per page (`window`), so an
// event dispatched here would otherwise leak into the tests after it.
describe('OfficeShell: instalar la app (#13)', () => {
  it('sin beforeinstallprompt no ofrece instalar; con el evento, el boton abre el dialogo del navegador', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    expect(screen.queryByRole('button', { name: 'Instalar app' })).not.toBeInTheDocument();

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await user.click(screen.getByRole('button', { name: 'Instalar app' }));

    expect(event.prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Instalar app' })).not.toBeInTheDocument());
  });
});

describe('OfficeShell: right rail while painting terrain', () => {
  it('hides the right-hand HUD while a terrain brush is picked, and shows it again once it is not', () => {
    render(<OfficeShell onLeaveOffice={vi.fn()} />);
    const bridge = createGameMock.mock.calls[0][1];
    const rail = () => [
      screen.getByRole('complementary', { name: 'Personas', hidden: true }),
      screen.getByRole('group', { name: 'Zoom del mapa', hidden: true }),
      screen.getByRole('button', { name: 'Salir', hidden: true }),
    ];
    rail().forEach((element) => expect(element).toBeVisible());

    act(() => bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } }));
    rail().forEach((element) => expect(element).not.toBeVisible());

    // Escape unpicks the brush: the editor stays open and so does the HUD.
    act(() => bridge.emitCommand('terrainedit', { brush: null }));
    rail().forEach((element) => expect(element).toBeVisible());

    act(() => bridge.emitCommand('terrainedit', { brush: { kind: 'wall', piece: null } }));
    rail().forEach((element) => expect(element).not.toBeVisible());

    act(() => bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } }));
    act(() => bridge.emitCommand('terrainedit', null));
    rail().forEach((element) => expect(element).toBeVisible());
  });

  it('hides it the same way while a decor piece is picked (#208)', () => {
    render(<OfficeShell onLeaveOffice={vi.fn()} />);
    const bridge = createGameMock.mock.calls[0][1];
    const sidebar = () => screen.getByRole('complementary', { name: 'Personas', hidden: true });

    act(() => bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'chair-wood', info: { kind: 'chair', footprint: { w: 1, h: 1 } }, rotation: 0 }, area: null }));
    expect(sidebar()).not.toBeVisible();
    act(() => bridge.emitCommand('decoredit', { brush: null, area: null }));
    expect(sidebar()).toBeVisible();
    // A selected item holds the map but keeps the rail: the editor's panel stays at hand.
    act(() => bridge.emitCommand('decoredit', { brush: null, area: null, selected: 4242 }));
    expect(sidebar()).toBeVisible();

    // Either editor holding the map keeps it hidden until both let go.
    act(() => bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'chair-wood', info: { kind: 'chair', footprint: { w: 1, h: 1 } }, rotation: 0 }, area: null }));
    act(() => bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } }));
    act(() => bridge.emitCommand('decoredit', null));
    expect(sidebar()).not.toBeVisible();
    act(() => bridge.emitCommand('terrainedit', null));
    expect(sidebar()).toBeVisible();
  });
});
