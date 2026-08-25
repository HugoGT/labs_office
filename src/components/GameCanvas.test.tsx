import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/createGame';
import { createOfficeBridge } from '../game/officeBridge';
import { GameCanvas } from './GameCanvas';

vi.mock('../game/createGame', () => ({ createGame: vi.fn() }));

const createGameMock = vi.mocked(createGame);
const bridge = createOfficeBridge();

/** Contabiliza instancias vivas: es lo unico que delata una fuga de Phaser. */
function trackInstances() {
  const state = { created: 0, destroyed: 0, destroyArgs: [] as unknown[] };
  createGameMock.mockImplementation(() => {
    state.created += 1;
    return {
      destroy: (removeCanvas: boolean) => {
        state.destroyed += 1;
        state.destroyArgs.push(removeCanvas);
      },
    } as unknown as Phaser.Game;
  });
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GameCanvas', () => {
  it('crea el juego dentro de su propio contenedor, no en document.body', () => {
    trackInstances();

    const { container } = render(<GameCanvas bridge={bridge} />);
    const host = container.firstElementChild;

    expect(createGameMock).toHaveBeenCalledTimes(1);
    expect(createGameMock).toHaveBeenCalledWith(host, bridge, { endpoint: null });
  });

  it('sin endpoint monta la oficina en solitario, no adivina un servidor', () => {
    trackInstances();

    render(<GameCanvas bridge={bridge} />);

    // Quien decide donde esta el servidor es `OfficeShell`, que si tiene acceso
    // a la configuracion; este componente no inventa una URL por su cuenta.
    expect(createGameMock).toHaveBeenCalledWith(expect.anything(), bridge, { endpoint: null });
  });

  it('reenvia el endpoint recibido tal cual a createGame', () => {
    trackInstances();

    render(<GameCanvas bridge={bridge} endpoint="ws://oficina.local:2567" />);

    expect(createGameMock).toHaveBeenCalledWith(expect.anything(), bridge, {
      endpoint: 'ws://oficina.local:2567',
    });
  });

  it('destruye el juego al desmontar y pide que retire el canvas', () => {
    const state = trackInstances();

    const { unmount } = render(<GameCanvas bridge={bridge} />);
    expect(state.destroyed).toBe(0);

    unmount();

    expect(state.destroyed).toBe(1);
    // `destroy(true)` = removeCanvas. Con `false` el canvas sobrevive al desmontaje.
    expect(state.destroyArgs).toEqual([true]);
  });

  it('bajo StrictMode deja exactamente una instancia viva', () => {
    const state = trackInstances();

    render(
      <StrictMode>
        <GameCanvas bridge={bridge} />
      </StrictMode>,
    );

    // StrictMode monta, desmonta y vuelve a montar: sin la limpieza del efecto
    // quedarian dos juegos peleando por el canvas.
    expect(state.created).toBeGreaterThan(0);
    expect(state.created - state.destroyed).toBe(1);
  });

  it('no recrea el juego en re-renders', () => {
    trackInstances();

    const { rerender } = render(<GameCanvas bridge={bridge} />);
    rerender(<GameCanvas bridge={bridge} />);
    rerender(<GameCanvas bridge={bridge} />);

    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('no deja referencias al juego destruido tras un ciclo completo', () => {
    const state = trackInstances();

    const { unmount } = render(<GameCanvas bridge={bridge} />);
    unmount();

    expect(state.created).toBe(state.destroyed);
  });
});
