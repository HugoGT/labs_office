/**
 * El enganche de React que resuelve la config de espacios una sola vez al
 * arrancar (#7, slice 3). Las reglas de lectura y de fallback ya las cubre
 * `spacesConfig.test.ts`; lo que se prueba aqui es el CICLO DE VIDA -- cuando
 * hay valor, cuando no, y que no se pida dos veces.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_SPACES_CONFIG, fetchSpacesConfig, type SpacesConfig } from '../game/spacesConfig';
import { useSpacesConfig } from './useSpacesConfig';

vi.mock('../game/spacesConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/spacesConfig')>()),
  fetchSpacesConfig: vi.fn(),
}));

const SERVIDA: SpacesConfig = {
  spaces: [{ id: 'id-sala', name: 'Sala', x: 32, y: 32, w: 128, h: 128 }],
  version: 'version-servida',
};

describe('useSpacesConfig', () => {
  it('empieza en null: aun no se sabe que config tiene este cliente', () => {
    const { result } = renderHook(() =>
      useSpacesConfig('ws://oficina.local:2567', { fetchConfig: async () => SERVIDA }),
    );

    // `null` no es "no hay config", es "todavia no". Quien lo consume debe
    // esperar en vez de arrancar con el fallback y cambiar despues: arrancar y
    // cambiar recrearia Phaser entero, y arrancar sin cambiar dejaria a este
    // cliente en una version distinta de la del resto para siempre.
    expect(result.current).toBeNull();
  });

  it('entrega la config servida cuando llega', async () => {
    const { result } = renderHook(() =>
      useSpacesConfig('ws://oficina.local:2567', { fetchConfig: async () => SERVIDA }),
    );

    await waitFor(() => expect(result.current).toEqual(SERVIDA));
  });

  it('deriva la url de /spaces del endpoint de la oficina', async () => {
    const fetchConfig = vi.fn(async () => SERVIDA);

    renderHook(() => useSpacesConfig('ws://oficina.local:2567', { fetchConfig }));

    await waitFor(() =>
      expect(fetchConfig).toHaveBeenCalledWith('http://oficina.local:2567/spaces'),
    );
  });

  it('sin endpoint entrega el fallback de inmediato y no pide nada', () => {
    // La oficina en solitario no tiene servidor al que preguntar. Esperar a un
    // fetch que no va a ocurrir la dejaria sin arrancar.
    const fetchConfig = vi.fn(async () => SERVIDA);

    const { result } = renderHook(() => useSpacesConfig(null, { fetchConfig }));

    expect(result.current).toBe(BUILT_IN_SPACES_CONFIG);
    expect(fetchConfig).not.toHaveBeenCalled();
  });

  it('no vuelve a pedirla en cada render', async () => {
    const fetchConfig = vi.fn(async () => SERVIDA);

    const { rerender, result } = renderHook(() =>
      useSpacesConfig('ws://oficina.local:2567', { fetchConfig }),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender();
    rerender();

    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que llega tras desmontar no toca el estado', async () => {
    // Sin la guarda, React avisaria de una actualizacion sobre un componente
    // desmontado y, peor, el fetch tardio de un endpoint viejo pisaria al nuevo.
    let resolver: ((config: SpacesConfig) => void) | undefined;
    const fetchConfig = () =>
      new Promise<SpacesConfig>((resolve) => {
        resolver = resolve;
      });

    const { unmount } = renderHook(() =>
      useSpacesConfig('ws://oficina.local:2567', { fetchConfig }),
    );
    unmount();

    expect(() => resolver?.(SERVIDA)).not.toThrow();
  });

  it('sin `fetchConfig` inyectado tampoco la pide en cada render', async () => {
    // La trampa: si el valor por defecto se construye dentro de la firma, cada
    // render crea una funcion nueva, la dependencia del efecto cambia, y el
    // cliente pide `/spaces` en bucle mientras la oficina este abierta. Con
    // `fetchConfig` inyectado el test anterior nunca lo veria, porque el doble
    // que le pasa es estable.
    const real = vi.mocked(fetchSpacesConfig);
    real.mockResolvedValue(SERVIDA);

    const { rerender, result } = renderHook(() => useSpacesConfig('ws://oficina.local:2567'));
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender();
    rerender();

    expect(real).toHaveBeenCalledTimes(1);
  });
});
