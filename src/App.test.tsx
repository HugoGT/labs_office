import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createGame } from './game/createGame';

vi.mock('./game/createGame', () => ({ createGame: vi.fn() }));

const createGameMock = vi.mocked(createGame);

beforeEach(() => {
  vi.clearAllMocks();
  createGameMock.mockReturnValue({ destroy: vi.fn() } as unknown as Phaser.Game);
});

describe('App', () => {
  it('monta un unico lienzo de juego', () => {
    render(<App />);

    expect(createGameMock).toHaveBeenCalledTimes(1);
  });

  it('usa un landmark <main> como raiz', () => {
    const { container } = render(<App />);

    expect(container.querySelector('main')).not.toBeNull();
  });

  it('el contenedor del juego cuelga del <main>', () => {
    const { container } = render(<App />);
    const host = createGameMock.mock.calls[0][0];

    expect(container.querySelector('main')?.contains(host)).toBe(true);
  });
});
