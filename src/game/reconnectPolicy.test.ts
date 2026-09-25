import { describe, expect, it } from 'vitest';
import { SESSION_REPLACED_CLOSE_CODE, SESSION_REVOKED_CLOSE_CODE } from './officeProtocol';
import {
  CONSENTED_CLOSE_CODE,
  DEVMODE_RESTART_CLOSE_CODE,
  RECONNECT_DELAYS_MS,
  decideReconnect,
} from './reconnectPolicy';

/**
 * La decision de reintentar se prueba aqui y no contra un socket porque es
 * justo la parte que no necesita uno: un codigo de cierre y un contador de
 * intentos entran, una decision sale. Lo que si necesita red -- que el
 * reintento llegue a reconectar de verdad -- vive en
 * `officeRoomClient.node.test.ts`, contra un Colyseus real.
 */
describe('decideReconnect', () => {
  it('una salida voluntaria no reintenta: nadie se cayo, alguien se fue', () => {
    // El caso que no puede fallar: reintentar aqui resucitaria una sesion que
    // el usuario acaba de cerrar, y el avatar volveria a aparecerle a todos.
    expect(decideReconnect({ closeCode: CONSENTED_CLOSE_CODE, attempt: 0 })).toEqual({
      kind: 'stop',
      reason: 'consented',
    });
  });

  it('una salida voluntaria no reintenta aunque queden intentos por gastar', () => {
    expect(decideReconnect({ closeCode: CONSENTED_CLOSE_CODE, attempt: 2 })).toEqual({
      kind: 'stop',
      reason: 'consented',
    });
  });

  it('a session replaced by a newer join of the same account never retries (#78)', () => {
    // Retrying would evict the newer tab, which would then retry and evict
    // this one back: two tabs taking the account from each other forever.
    expect(decideReconnect({ closeCode: SESSION_REPLACED_CLOSE_CODE, attempt: 0 })).toEqual({
      kind: 'stop',
      reason: 'replaced',
    });
  });

  it('a replaced session stops as replaced even past the last attempt, not as give-up (#78)', () => {
    // "Give up" offers a retry button; "replaced" must not.
    expect(
      decideReconnect({ closeCode: SESSION_REPLACED_CLOSE_CODE, attempt: RECONNECT_DELAYS_MS.length }),
    ).toEqual({ kind: 'stop', reason: 'replaced' });
  });

  it('a session whose access was revoked never retries, at any attempt (#93)', () => {
    // The directory refuses the join anyway, and "give up" would offer a
    // retry button that can only fail.
    for (const attempt of [0, RECONNECT_DELAYS_MS.length]) {
      expect(decideReconnect({ closeCode: SESSION_REVOKED_CLOSE_CODE, attempt })).toEqual({
        kind: 'stop',
        reason: 'revoked',
      });
    }
  });

  it('una caida reintenta con el retardo que toca a cada intento', () => {
    // 1006 es el cierre anormal que manda un socket que se muere sin decir
    // nada: el caso exacto de la issue #52 (wifi que parpadea, NAT que expira).
    RECONNECT_DELAYS_MS.forEach((delayMs, attempt) => {
      expect(decideReconnect({ closeCode: 1006, attempt })).toEqual({ kind: 'retry', delayMs });
    });
  });

  it('el reinicio de devmode tambien reintenta: el servidor volvera', () => {
    // No es un cierre voluntario del usuario, es el servidor pidiendo que se
    // vuelva a entrar. Tratarlo como una salida dejaria la oficina muda tras
    // cada recarga en caliente.
    expect(decideReconnect({ closeCode: DEVMODE_RESTART_CLOSE_CODE, attempt: 0 })).toEqual({
      kind: 'retry',
      delayMs: RECONNECT_DELAYS_MS[0],
    });
  });

  it('el intento siguiente al ultimo retardo se rinde en vez de reintentar para siempre', () => {
    expect(decideReconnect({ closeCode: 1006, attempt: RECONNECT_DELAYS_MS.length })).toEqual({
      kind: 'give-up',
    });
  });

  it('un intento muy por encima del ultimo sigue rindiendose, no da la vuelta al arreglo', () => {
    expect(decideReconnect({ closeCode: 1006, attempt: RECONNECT_DELAYS_MS.length + 7 })).toEqual({
      kind: 'give-up',
    });
  });
});

describe('RECONNECT_DELAYS_MS', () => {
  it('la escalera entera cabe holgada dentro de la ventana del servidor', () => {
    // La ventana del servidor es `RECONNECTION_WINDOW_SECONDS` (30 s, ver
    // `server/src/OfficeRoom.ts`). No se importa: este modulo es de navegador
    // y no debe arrastrar `@colyseus/core` al bundle. La cifra se duplica aqui
    // a proposito, y este test es lo que impide que las dos se separen sin que
    // nadie lo note -- una escalera mas larga que la ventana reintentaria
    // contra un asiento que el servidor ya solto.
    const total = RECONNECT_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThan(30_000);
  });

  it('cada retardo crece respecto al anterior: es backoff, no un reintento plano', () => {
    for (let i = 1; i < RECONNECT_DELAYS_MS.length; i++) {
      expect(RECONNECT_DELAYS_MS[i]).toBeGreaterThan(RECONNECT_DELAYS_MS[i - 1]);
    }
  });
});
