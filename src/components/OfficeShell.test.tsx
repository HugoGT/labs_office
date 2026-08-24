import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/createGame';
import { OfficeShell } from './OfficeShell';

vi.mock('../game/createGame', () => ({ createGame: vi.fn() }));

const createGameMock = vi.mocked(createGame);

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
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

  it('mic se activa/desactiva independientemente de la camara', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);

    const micButton = screen.getByRole('button', { name: /Mic/ });
    const camButton = screen.getByRole('button', { name: /Cámara/ });
    expect(micButton).toHaveAttribute('aria-pressed', 'true');
    expect(camButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(micButton);

    expect(micButton).toHaveAttribute('aria-pressed', 'false');
    expect(camButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('reenvia los nearby recibidos del bridge a los chips de BottomBar', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() => bridge.emit('nearby', { names: ['Ana', 'Beto'] }));

    expect(screen.getByText('🔊 Ana')).toBeInTheDocument();
    expect(screen.getByText('🔊 Beto')).toBeInTheDocument();
  });

  it('al recibir npcmenu del bridge, abre el ContextMenu con nombre y estado', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'Disponible', statusCode: 'g', x: 10, y: 10 }),
    );

    expect(screen.getByText('Pablo')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
  });

  it('closemenu del bridge cierra el ContextMenu abierto', () => {
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];

    act(() =>
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'Disponible', statusCode: 'g', x: 10, y: 10 }),
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
      bridge.emit('npcmenu', { id: 7, name: 'Jordan Távara', status: 'Disponible', statusCode: 'g', x: 10, y: 10 }),
    );
    await user.click(screen.getByRole('button', { name: /Ir a su escritorio/ }));

    expect(teleportSpy).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('button', { name: /Ir a su escritorio/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Te teletransportaste junto a/)).toBeInTheDocument();
  });

  it('"Llamar" muestra un toast y cierra el menu sin teletransportar', async () => {
    const user = userEvent.setup();
    render(<OfficeShell />);
    const bridge = createGameMock.mock.calls[0][1];
    const teleportSpy = vi.spyOn(bridge, 'teleportTo');

    act(() =>
      bridge.emit('npcmenu', { id: 3, name: 'Pablo', status: 'Disponible', statusCode: 'g', x: 10, y: 10 }),
    );
    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    expect(teleportSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Llamando a/)).toBeInTheDocument();
  });
});
