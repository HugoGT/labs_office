import { describe, expect, it } from 'vitest';
import {
  MAX_SLOW_RETRIES,
  SLOW_RETRY_MS,
  decideVoiceTransition,
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
