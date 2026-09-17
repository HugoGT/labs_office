import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/createGame';
import { useProximityAudio } from '../hooks/useProximityAudio';
import { OfficeShell } from './OfficeShell';

vi.mock('../game/createGame', () => ({ createGame: vi.fn() }));
// El hook ya tiene su propia suite (`useProximityAudio.test.ts`, slice 4A);
// aqui solo importa que OfficeShell lo llame y reenvie lo que devuelve,
// igual que `createGame` se mockea para aislar Phaser (mismo patron ya
// establecido en este archivo).
vi.mock('../hooks/useProximityAudio', () => ({ useProximityAudio: vi.fn() }));

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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
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
        teleportTo: expect.any(Function),
        callNpc: expect.any(Function),
      }),
    );
  });

  it('al entrar a una sala, muestra un toast compuesto con el nombre en <b>', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { room: 'Sala de Juntas' }));

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

    act(() => bridge.emit('room', { room: '<img src=x onerror=alert(1)>' }));

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

      act(() => bridge.emit('room', { room: 'Sala de Juntas' }));
      expect(screen.getByText(/Entraste a/)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3200));

      expect(screen.queryByText(/Entraste a/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('detiene la grabacion activa y muestra el toast al salir, ocultando el REC badge', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { room: 'Sala de Juntas' }));
    await user.click(screen.getByRole('button', { name: /Grabar/ }));
    expect(screen.getByText(/REC/)).toBeInTheDocument();

    act(() => bridge.emit('room', { room: null }));

    expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
    expect(screen.getByText('💾 Saliste de la sala: grabación detenida')).toBeInTheDocument();
  });

  it('salir de una sala sin grabacion activa no muestra el toast de detencion', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('room', { room: 'Sala de Juntas' }));
    act(() => bridge.emit('room', { room: null }));

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

  it('reenvia los nearby recibidos del bridge a los chips de BottomBar', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('nearby', { names: ['Ana', 'Beto'] }));

    expect(screen.getByText('🔊 Ana')).toBeInTheDocument();
    expect(screen.getByText('🔊 Beto')).toBeInTheDocument();
  });

  it('la lista fusionada de nearby llega a BottomBar sin filtrar ni reordenar (companeros reales primero, tal cual la emite la escena)', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    // `OfficeScene.proximityTick` (3A) ya antepone companeros reales a NPCs
    // y puede repetir nombres (D7); `OfficeShell` no debe filtrar, ordenar
    // ni deduplicar nada de eso antes de pasarlo a `BottomBar`.
    act(() => bridge.emit('nearby', { names: ['HugoGT', 'HugoGT', 'Ana', 'Beto'] }));

    const chips = screen.getAllByText(/^🔊 /).map((el) => el.textContent);
    expect(chips).toEqual(['🔊 HugoGT', '🔊 HugoGT', '🔊 Ana', '🔊 Beto']);
  });

  it('al recibir npcmenu del bridge, abre el ContextMenu con nombre y estado', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'En línea', statusCode: 'g', x: 10, y: 10 }),
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
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'En línea', statusCode: 'g', x: 10, y: 10 }),
    );
    expect(screen.getByText('Pablo')).toBeInTheDocument();

    act(() => bridge.emit('closemenu', undefined));

    expect(screen.queryByText('Pablo')).not.toBeInTheDocument();
  });

  it('"Ir a su escritorio" llama a bridge.teleportTo con el id del NPC, muestra un toast y cierra el menu', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const teleportSpy = vi.spyOn(bridge, 'teleportTo');

    act(() =>
      bridge.emit('npcmenu', { id: 7, name: 'Jordan Távara', status: 'En línea', statusCode: 'g', x: 10, y: 10 }),
    );
    await user.click(screen.getByRole('button', { name: /Ir a su escritorio/ }));

    expect(teleportSpy).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('button', { name: /Ir a su escritorio/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Te teletransportaste junto a/)).toBeInTheDocument();
  });

  it('"Llamar" pide al NPC que venga via bridge.callNpc, sin mover al jugador', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const teleportSpy = vi.spyOn(bridge, 'teleportTo');
    const callSpy = vi.spyOn(bridge, 'callNpc');

    act(() =>
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'En línea', statusCode: 'g', x: 10, y: 10 }),
    );
    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    // Llamar y "Ir a su escritorio" son opuestos: uno trae al NPC, el otro
    // lleva al jugador. Confundirlos es el error facil aqui.
    expect(callSpy).toHaveBeenCalledWith(3);
    expect(teleportSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/viene hacia ti/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Llamar/ })).not.toBeInTheDocument();
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
