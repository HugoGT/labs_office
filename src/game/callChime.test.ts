import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCallChime, type RingPlayer } from './callChime';

function makePlayerFake(playResult: Promise<void> | undefined = Promise.resolve()) {
  const player = {
    currentTime: 0,
    play: vi.fn(() => playResult),
    pause: vi.fn(),
  };
  return player;
}

describe('createCallChime (#187: the recorded ring)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the ring from the start', () => {
    const player = makePlayerFake();
    player.currentTime = 2.5;
    const chime = createCallChime(() => player as RingPlayer);

    chime.play();

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
  });

  it('builds ONE player and reuses it on every ring (the old chime leaked an AudioContext per play)', () => {
    const player = makePlayerFake();
    const makePlayer = vi.fn(() => player as RingPlayer);
    const chime = createCallChime(makePlayer);

    chime.play();
    chime.play();
    chime.play();

    expect(makePlayer).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(3);
  });

  it('builds nothing until the first ring', () => {
    const makePlayer = vi.fn(() => makePlayerFake() as RingPlayer);

    createCallChime(makePlayer);

    expect(makePlayer).not.toHaveBeenCalled();
  });

  it('stop pauses the ring and rewinds it', () => {
    const player = makePlayerFake();
    const chime = createCallChime(() => player as RingPlayer);
    chime.play();
    player.currentTime = 1.2;

    chime.stop();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
  });

  it('stop before any ring builds nothing and does not throw', () => {
    const makePlayer = vi.fn(() => makePlayerFake() as RingPlayer);
    const chime = createCallChime(makePlayer);

    expect(() => chime.stop()).not.toThrow();
    expect(makePlayer).not.toHaveBeenCalled();
  });

  it('an autoplay refusal (rejected play promise) is swallowed, never an unhandled rejection', async () => {
    const refusal = Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    const player = makePlayerFake(refusal);
    const chime = createCallChime(() => player as RingPlayer);

    expect(() => chime.play()).not.toThrow();
    // A handler is attached synchronously, so awaiting the same promise here
    // only observes the rejection the chime already handled.
    await expect(refusal).rejects.toThrow('blocked');
  });

  it('a play() that throws synchronously is swallowed too', () => {
    const player = makePlayerFake();
    player.play.mockImplementation(() => {
      throw new Error('not supported');
    });
    const chime = createCallChime(() => player as RingPlayer);

    expect(() => chime.play()).not.toThrow();
  });

  it('a factory that returns undefined or throws leaves the ring silent, without throwing', () => {
    const silent = createCallChime(() => undefined);
    const broken = createCallChime(() => {
      throw new Error('no audio here');
    });

    expect(() => silent.play()).not.toThrow();
    expect(() => broken.play()).not.toThrow();
    expect(() => broken.stop()).not.toThrow();
  });

  it('by default plays the bundled call-ring.mp3 through an audio element', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    const chime = createCallChime();

    expect(() => chime.play()).not.toThrow();

    expect(play).toHaveBeenCalledTimes(1);
    const element = play.mock.contexts[0] as HTMLMediaElement;
    expect(element).toBeInstanceOf(HTMLAudioElement);
    expect(element.src).toMatch(/call-ring.*\.mp3$/);
  });
});
