import { describe, expect, it, vi } from 'vitest';
import { onPageHide } from './pageLifecycle';

describe('onPageHide', () => {
  it('avisa cuando la pagina se va', () => {
    const handler = vi.fn();
    const stop = onPageHide(handler);

    window.dispatchEvent(new Event('pagehide'));

    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it('deja de avisar tras soltarlo', () => {
    // Sin esto, una escena que se apaga y vuelve a conectar acumularia un
    // manejador por sesion, y todos apuntando a salas ya muertas.
    const handler = vi.fn();
    const stop = onPageHide(handler);

    stop();
    window.dispatchEvent(new Event('pagehide'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('soltarlo dos veces no revienta', () => {
    // `leave()` puede correr despues de que el propio manejador ya se haya
    // soltado a si mismo: es el camino normal de cerrar la pestana.
    const stop = onPageHide(vi.fn());

    stop();

    expect(() => stop()).not.toThrow();
  });
});
