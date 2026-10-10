/**
 * Ring of an incoming call invitation, best effort (issue #2, D11; #187).
 * Plays `src/assets/sounds/call-ring.mp3` (about 3.7 s, see LICENSE.txt
 * there), imported through Vite so it ships under a hashed `/assets/` name.
 *
 * One audio element per chime, built on the first ring and reused: the
 * oscillator this replaced built a new `AudioContext` on every play, never
 * closed it, and stayed mute whenever that context was born `suspended`.
 *
 * Explicit degradation: no `Audio` (non-browser runtimes), a player that
 * fails to build, or an autoplay refusal (the `play()` promise rejects) all
 * leave the ring silent without throwing. On purpose it does NOT raise a
 * second "unblock audio" prompt: `AudioUnblockPrompt` belongs to LiveKit and
 * fires from `RoomEvent.AudioPlaybackStatusChanged`; reusing it here would
 * tell the person their colleagues cannot be heard when they can. The
 * visible card is the guaranteed notice; the sound is additive.
 */

import callRingUrl from '../assets/sounds/call-ring.mp3';

/** The part of `HTMLAudioElement` the chime uses, so tests inject a fake. */
export interface RingPlayer {
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface CallChime {
  /** Rings from the start (restarting a ring already playing). */
  play(): void;
  /** Silences a ring in progress; a no-op when nothing rings. */
  stop(): void;
}

function defaultMakePlayer(): RingPlayer | undefined {
  if (typeof Audio === 'undefined') return undefined;
  const audio = new Audio(callRingUrl);
  audio.preload = 'auto';
  return audio;
}

/**
 * `makePlayer` is injectable for tests (deterministic fakes). It runs at most
 * once successfully: the player it returns is reused for every ring.
 */
export function createCallChime(
  makePlayer: () => RingPlayer | undefined = defaultMakePlayer,
): CallChime {
  let player: RingPlayer | undefined;

  function ensurePlayer(): RingPlayer | undefined {
    if (player !== undefined) return player;
    try {
      player = makePlayer();
    } catch {
      // Building the player can fail (no support, site policy): no sound, no exception.
      player = undefined;
    }
    return player;
  }

  return {
    play(): void {
      const current = ensurePlayer();
      if (current === undefined) return;
      try {
        current.currentTime = 0;
        const result = current.play();
        // Autoplay refused: the browser rejects the promise. Handled here so
        // it is never an unhandled rejection.
        if (result !== undefined) result.catch(() => undefined);
      } catch {
        // Same: any failure to start the ring stays silent.
      }
    },
    stop(): void {
      if (player === undefined) return;
      try {
        player.pause();
        player.currentTime = 0;
      } catch {
        // Nothing to silence then.
      }
    },
  };
}
