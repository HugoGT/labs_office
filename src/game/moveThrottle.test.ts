import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMoveThrottle, type Move } from './moveThrottle';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function move(x: number, y = 0, facing = 'down'): Move {
  return { x, y, facing };
}

describe('createMoveThrottle', () => {
  it('envia el primer movimiento al instante, sin esperar al intervalo', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));

    // Si el primero esperase, cada arranque tendria un retardo visible.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(move(10));
  });

  it('agrupa una rafaga dentro del intervalo y solo emite el ultimo estado', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));
    throttle.push(move(20));
    throttle.push(move(30));
    throttle.push(move(40));

    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    // Las posiciones intermedias no interesan a nadie: el destino final si.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(move(40));
  });

  it('no reenvia un movimiento identico al ultimo enviado', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));
    vi.advanceTimersByTime(500);
    throttle.push(move(10));
    vi.advanceTimersByTime(500);

    // Un jugador quieto emitiria trafico constante sin esta comparacion, que es
    // el caso mas comun en una oficina: casi todo el mundo esta parado.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('un cambio de solo facing si se envia: girarse es informacion visible', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10, 0, 'down'));
    vi.advanceTimersByTime(500);
    throttle.push(move(10, 0, 'left'));

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(move(10, 0, 'left'));
  });

  it('tras pasar el intervalo en silencio, el siguiente movimiento sale al instante', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));
    vi.advanceTimersByTime(300);
    throttle.push(move(20));

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('una rafaga que vuelve al punto de partida no emite nada al vencer el plazo', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));
    throttle.push(move(50));
    throttle.push(move(10)); // vuelve justo a donde ya estaba
    vi.advanceTimersByTime(200);

    // El agrupado revalida al vaciar, no solo al encolar: si no, un ida y vuelta
    // dentro del mismo intervalo mandaria un mensaje que no cambia nada.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(move(10));
  });

  it('dispose cancela el envio pendiente en vez de dispararlo tras desmontar', () => {
    const send = vi.fn();
    const throttle = createMoveThrottle({ intervalMs: 100, send });

    throttle.push(move(10));
    throttle.push(move(20));
    throttle.dispose();
    vi.advanceTimersByTime(1000);

    // Sin esto, salir de la oficina dejaria un ultimo `move` viajando hacia una
    // conexion ya cerrada.
    expect(send).toHaveBeenCalledTimes(1);
  });
});
