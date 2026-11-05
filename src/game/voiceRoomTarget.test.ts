import { describe, expect, it } from 'vitest';
import {
  MAX_SLOW_RETRIES,
  REBUILD_BASE_DELAY_MS,
  REBUILD_MAX_DELAY_MS,
  SLOW_RETRY_MS,
  decideVoiceTransition,
  rebuildDelay,
  tokenRetryDelay,
} from './voiceRoomTarget';

describe('decideVoiceTransition (D7: reconnect keyed on (sessionId, spaceId))', () => {
  it('sessionId nulo en el proximo objetivo siempre es teardown, con o sin objetivo actual', () => {
    expect(decideVoiceTransition(null, { sessionId: null, spaceId: null })).toBe('teardown');
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: 's1' }, { sessionId: null, spaceId: null }),
    ).toBe('teardown');
  });

  it('mismo sessionId y mismo spaceId es forward: no hay conexion nueva de LiveKit', () => {
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: null }, { sessionId: 'yo', spaceId: null }),
    ).toBe('forward');
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: 's1' }, { sessionId: 'yo', spaceId: 's1' }),
    ).toBe('forward');
  });

  it('sin objetivo actual (primera conexion) siempre es reconnect', () => {
    expect(decideVoiceTransition(null, { sessionId: 'yo', spaceId: null })).toBe('reconnect');
    expect(decideVoiceTransition(null, { sessionId: 'yo', spaceId: 's1' })).toBe('reconnect');
  });

  it('mismo sessionId pero spaceId distinto es reconnect: cambiar de espacio exige sala nueva', () => {
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: null }, { sessionId: 'yo', spaceId: 's1' }),
    ).toBe('reconnect');
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: 's1' }, { sessionId: 'yo', spaceId: 's2' }),
    ).toBe('reconnect');
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: 's1' }, { sessionId: 'yo', spaceId: null }),
    ).toBe('reconnect');
  });

  it('sessionId distinto (reconexion manual, #52) es reconnect aunque el spaceId coincida', () => {
    expect(
      decideVoiceTransition({ sessionId: 'yo', spaceId: 's1' }, { sessionId: 'yo-nuevo', spaceId: 's1' }),
    ).toBe('reconnect');
  });
});

describe('tokenRetryDelay (secuencia de reintento rapido 150/300/600, luego null)', () => {
  it('devuelve 150, 300 y 600 ms para los tres primeros intentos, en ese orden', () => {
    expect(tokenRetryDelay(0)).toBe(150);
    expect(tokenRetryDelay(1)).toBe(300);
    expect(tokenRetryDelay(2)).toBe(600);
  });

  it('devuelve null desde el cuarto intento en adelante: ahi se agotan los reintentos rapidos', () => {
    expect(tokenRetryDelay(3)).toBeNull();
    expect(tokenRetryDelay(4)).toBeNull();
    expect(tokenRetryDelay(100)).toBeNull();
  });
});

describe('constantes del reintento lento (fallback al corredor)', () => {
  it('SLOW_RETRY_MS es 5 segundos y MAX_SLOW_RETRIES es 6', () => {
    expect(SLOW_RETRY_MS).toBe(5000);
    expect(MAX_SLOW_RETRIES).toBe(6);
  });
});

describe('rebuildDelay (#283): a lost room is rebuilt with capped exponential backoff and jitter', () => {
  it('the first rebuild already waits: never immediate, so a LiveKit outage is not a stampede', () => {
    expect(rebuildDelay(0, 0)).toBe(REBUILD_BASE_DELAY_MS / 2);
    expect(rebuildDelay(0, 0)).toBeGreaterThan(0);
  });

  it('doubles with every failed attempt', () => {
    const lowest = [0, 1, 2, 3].map((attempt) => rebuildDelay(attempt, 0));
    expect(lowest).toEqual([1000, 2000, 4000, 8000]);
    const highest = [0, 1, 2, 3].map((attempt) => rebuildDelay(attempt, 0.999999));
    expect(highest).toEqual([1999, 3999, 7999, 15999]);
  });

  it('never waits more than the cap, however many attempts failed', () => {
    for (const attempt of [5, 10, 50, 1000]) {
      expect(rebuildDelay(attempt, 0.999999)).toBeLessThan(REBUILD_MAX_DELAY_MS);
      expect(rebuildDelay(attempt, 0)).toBe(REBUILD_MAX_DELAY_MS / 2);
    }
  });

  it('spreads clients that dropped together over half of each step', () => {
    const delays = Array.from({ length: 60 }, (_, i) => rebuildDelay(2, i / 60));
    expect(new Set(delays).size).toBe(60);
    expect(Math.min(...delays)).toBe(4000);
    expect(Math.max(...delays)).toBeLessThan(8000);
  });
});
