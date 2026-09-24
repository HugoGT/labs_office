import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/createGame';
import { fetchDeskCatalog, fetchMyDeskItems, saveMyDesk } from '../game/deskDecorClient';
import type { DeskDecorAsset, PlacedDeskItem } from '../game/deskDecorPort';
import { claimDesk, fetchOfficeDesks, releaseDesk } from '../game/desksClient';
import type { OfficeDesk } from '../game/desksPort';
import { BUILT_IN_SPACES_VERSION } from '../game/mapData';
import { DEFAULT_NAME } from '../game/officeProtocol';
import { RecordingError, getRecordingUrl, startRecording, stopRecording } from '../game/recordingClient';
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
// Mismo criterio con el editor de decoracion: doblar el unico modulo que
// habla con `/assets` y `/me/desk` deja este archivo probando el CABLEADO --
// que el editor se ofrece donde debe y que la escena se entera de lo guardado.
vi.mock('../game/deskDecorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/deskDecorClient')>()),
  fetchDeskCatalog: vi.fn(),
  fetchMyDeskItems: vi.fn(),
  saveMyDesk: vi.fn(),
}));
// El hook ya tiene su propia suite (`useProximityAudio.test.ts`, slice 4A);
// aqui solo importa que OfficeShell lo llame y reenvie lo que devuelve,
// igual que `createGame` se mockea para aislar Phaser (mismo patron ya
// establecido en este archivo).
vi.mock('../hooks/useProximityAudio', () => ({ useProximityAudio: vi.fn() }));
// The only module that talks to `/recordings/*` (#5): whether a room is being
// recorded comes from the bridge, never from these calls.
vi.mock('../game/recordingClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/recordingClient')>()),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getRecordingUrl: vi.fn(),
}));

const createGameMock = vi.mocked(createGame);
const useProximityAudioMock = vi.mocked(useProximityAudio);

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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
  // Por defecto, sin decoracion que ofrecer: es el estado de un despliegue sin
  // base de datos, y deja a cada bloque declarar lo suyo sin que los demas
  // tengan que saber que existe un editor.
  vi.mocked(fetchDeskCatalog).mockResolvedValue([]);
  vi.mocked(fetchMyDeskItems).mockResolvedValue(null);
  vi.mocked(saveMyDesk).mockResolvedValue('failed');
  // Por defecto: apagado y sin LiveKit disponible (#321 decision 2 y 3) — los
  // tests que necesitan otro estado lo sobreescriben explicitamente.
  useProximityAudioMock.mockReturnValue(proximityAudio());
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
    const SELF = 'ses-me';

    function renderInRoom(spaceId = 'space-stub', name = 'Sala de Juntas') {
      render(<OfficeShell />);
      const bridge = createGameMock.mock.calls[0][1];
      act(() => bridge.emit('voice', { selfSessionId: SELF, selfName: 'Yo', peers: [], spaceId }));
      act(() => bridge.emit('room', { spaceId, name }));
      return bridge;
    }

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
    expect(screen.getByText(/Llamando a/)).toBeInTheDocument();
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

  it('clicar un escritorio libre lo coge y lo dice', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }));

    expect(await screen.findByText(/Te sentaste en/)).toBeInTheDocument();
    expect(claimDesk).toHaveBeenCalledWith(expect.objectContaining({ deskId: 'id-mesa' }));
  });

  it('un 409 dice que alguien se adelanto y vuelve a leer la lista', async () => {
    // Tragarlo dejaria el escritorio pintado como tuyo sin serlo, y la vista
    // de quien hizo clic ya no vale: hay que releerla.
    vi.mocked(claimDesk).mockResolvedValue('taken');
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }));

    expect(await screen.findByText(/se adelant/)).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
  });

  it('un fallo al coger no se cuenta como conseguido', async () => {
    vi.mocked(claimDesk).mockResolvedValue('failed');
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }));

    expect(await screen.findByText(/No se pudo coger/)).toBeInTheDocument();
  });

  it('clicar el propio OFRECE dejarlo, no lo suelta por su cuenta', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));

    expect(await screen.findByRole('button', { name: /Dejarlo/ })).toBeInTheDocument();
    expect(releaseDesk).not.toHaveBeenCalled();
  });

  it('aceptar la oferta suelta el escritorio y vuelve a leer la lista', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));
    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));

    await userEvent.click(await screen.findByRole('button', { name: /Dejarlo/ }));

    // Sin id: el servidor suelta el de la identidad verificada de quien llama.
    expect(releaseDesk).toHaveBeenCalledWith(expect.not.objectContaining({ deskId: 'id-mesa' }));
    expect(await screen.findByText(/Dejaste/)).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
  });
});

/**
 * El editor de decoracion llegando a quien ocupa un escritorio (#7, slice 6).
 * Lo que se prueba aqui es el CABLEADO: donde se ofrece el editor, donde NO,
 * y que la escena se entera de lo guardado sin recargar la pagina.
 *
 * Las reglas del editor las cubre `DeskDecorEditor.test.tsx`, las lecturas
 * `deskDecorClient.test.ts` y el ciclo de vida `useDeskDecor.test.ts`.
 */
describe('OfficeShell: editor de decoracion (#7, slice 6)', () => {
  const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

  const MIA: OfficeDesk = {
    id: 'id-mesa',
    label: 'Mesa 4',
    x: 320,
    y: 384,
    w: 96,
    h: 96,
    occupant: { id: 'id-ana', displayName: 'Ana Torres', items: [] },
    mine: true,
  };

  const PLANTA: DeskDecorAsset = {
    id: 'id-planta',
    name: 'Planta',
    kind: 'plant',
    textureKey: 'plant-small',
  };

  const PUESTA: PlacedDeskItem = {
    id: 'id-item',
    assetId: 'id-planta',
    slot: 4,
    rotation: 0,
    textureKey: 'plant-small',
    name: 'Planta',
  };

  beforeEach(() => {
    vi.mocked(fetchOfficeDesks).mockResolvedValue([MIA]);
    vi.mocked(claimDesk).mockResolvedValue('claimed');
    vi.mocked(releaseDesk).mockResolvedValue('released');
    vi.mocked(fetchDeskCatalog).mockResolvedValue([PLANTA]);
    vi.mocked(fetchMyDeskItems).mockResolvedValue([PUESTA]);
    vi.mocked(saveMyDesk).mockResolvedValue('saved');
  });

  /**
   * Espera a que las dos lecturas del editor hayan aterrizado. El aviso del
   * escritorio propio se compone cuando llega el clic, asi que ofrecer
   * "Decorar" depende de lo que se sepa EN ESE INSTANTE.
   */
  async function readyToDecorate(): Promise<void> {
    await vi.waitFor(() => expect(fetchMyDeskItems).toHaveBeenCalled());
    await act(async () => {});
  }

  it('clicar el propio escritorio ofrece decorarlo, ademas de dejarlo', async () => {
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await readyToDecorate();

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));

    await userEvent.click(await screen.findByRole('button', { name: /Decorar/ }));
    expect(await screen.findByRole('dialog', { name: /Mesa 4/ })).toBeInTheDocument();
  });

  it('clicar un escritorio libre NO abre el editor: solo se decora el propio', async () => {
    // El escritorio ajeno ni siquiera es clicable en la escena, y el libre lo
    // que ofrece es sentarse. Un editor abierto sobre un sitio que no es tuyo
    // guardaria tu decoracion mientras miras el de otra persona.
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchDeskCatalog).toHaveBeenCalled());

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }));

    expect(await screen.findByText(/Te sentaste en/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sin catalogo no se ofrece decorar nada', async () => {
    // La degradacion de la slice: un despliegue sin `DATABASE_URL` responde
    // 503 y la oficina se comporta exactamente como antes, sin editor.
    vi.mocked(fetchDeskCatalog).mockResolvedValue([]);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchDeskCatalog).toHaveBeenCalled());

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));

    expect(await screen.findByRole('button', { name: /Dejarlo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Decorar/ })).not.toBeInTheDocument();
  });

  it('sin poder leer el escritorio propio tampoco se ofrece decorar', async () => {
    // Guardar reemplaza el escritorio entero: con lo puesto sin leer, el
    // primer guardado borraria lo que nunca se vio.
    vi.mocked(fetchMyDeskItems).mockResolvedValue(null);
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchMyDeskItems).toHaveBeenCalled());

    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));

    expect(await screen.findByRole('button', { name: /Dejarlo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Decorar/ })).not.toBeInTheDocument();
  });

  it('guardar vuelve a leer los escritorios: la escena lo refleja sin recargar', async () => {
    // Mismo camino que coger y soltar sitio: la lista es autoritativa y la
    // escena redibuja lo que le llega por comando.
    render(<OfficeShell session={SESION} />);
    const bridge = createGameMock.mock.calls[0][1];
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(1));
    await readyToDecorate();
    act(() => bridge.emit('deskclick', { deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }));
    await userEvent.click(await screen.findByRole('button', { name: /Decorar/ }));

    await userEvent.click(await screen.findByRole('button', { name: /^Guardar/ }));

    expect(saveMyDesk).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ assetId: 'id-planta', slot: 4, rotation: 0 }] }),
    );
    await vi.waitFor(() => expect(fetchOfficeDesks).toHaveBeenCalledTimes(2));
  });

  it('sin sesion no hay editor ni peticiones de decoracion', async () => {
    // La oficina abierta (desarrollo local, e2e) no tiene a quien atribuirle
    // un escritorio, y las dos rutas solo podrian contestar 401.
    render(<OfficeShell />);
    await vi.waitFor(() => expect(createGameMock).toHaveBeenCalled());

    expect(fetchDeskCatalog).not.toHaveBeenCalled();
    expect(fetchMyDeskItems).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'Dejar de compartir' })).toBeEnabled();
  });
});
