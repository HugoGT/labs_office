/**
 * El enganche que resuelve el editor de decoracion (#7, slice 6). Las reglas
 * de lectura y la degradacion de cada ruta ya las cubre
 * `deskDecorClient.test.ts`; lo que se prueba aqui es el CICLO DE VIDA -- con
 * que se abre el editor, con que NO se abre, y que pasa despues de guardar.
 *
 * La propiedad que sostiene este fichero es la de "no editor a medias": el
 * editor solo se ofrece cuando se saben las DOS cosas, lo que hay puesto y lo
 * que se puede poner. Con media verdad, guardar borraria lo que no se leyo --
 * `POST /me/desk` reemplaza el escritorio entero.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDeskCatalog, fetchMyDeskItems, saveMyDesk } from '../game/deskDecorClient';
import {
  NO_DESK_ASSETS,
  type DeskDecorAsset,
  type PlacedDeskItem,
} from '../game/deskDecorPort';
import { useDeskDecor } from './useDeskDecor';

vi.mock('../game/deskDecorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/deskDecorClient')>()),
  fetchDeskCatalog: vi.fn(),
  fetchMyDeskItems: vi.fn(),
  saveMyDesk: vi.fn(),
}));

const fetchDeskCatalogMock = vi.mocked(fetchDeskCatalog);
const fetchMyDeskItemsMock = vi.mocked(fetchMyDeskItems);
const saveMyDeskMock = vi.mocked(saveMyDesk);

const ENDPOINT = 'ws://oficina.local:2567';
const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

const PLANTA: DeskDecorAsset = {
  id: 'id-planta',
  name: 'Planta',
  kind: 'plant',
  textureKey: 'plant-small',
};

const PUESTA: PlacedDeskItem = {
  id: 'id-item',
  assetId: 'id-planta',
  slot: 4,
  rotation: 90,
  textureKey: 'plant-small',
  name: 'Planta',
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchDeskCatalogMock.mockResolvedValue([PLANTA]);
  fetchMyDeskItemsMock.mockResolvedValue([PUESTA]);
  saveMyDeskMock.mockResolvedValue('saved');
});

describe('useDeskDecor', () => {
  it('empieza cargando: todavia no se sabe si hay editor', async () => {
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));

    expect(result.current.phase).toBe('loading');
    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });

  it('entrega el catalogo y lo ya puesto cuando llegan los dos', async () => {
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.catalog).toEqual([PLANTA]);
    expect(result.current.items).toEqual([PUESTA]);
  });

  it('sin sesion no pregunta nada y no hay editor', async () => {
    // La oficina abierta (desarrollo local, e2e) no tiene a quien atribuirle
    // un escritorio: `/assets` y `/me/desk` solo podrian contestar 401.
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, null));

    await waitFor(() => expect(result.current.phase).toBe('unavailable'));
    expect(fetchDeskCatalogMock).not.toHaveBeenCalled();
    expect(fetchMyDeskItemsMock).not.toHaveBeenCalled();
  });

  it('sin catalogo no hay editor: no habria nada que colocar', async () => {
    // Es tambien la degradacion del 503: un despliegue sin `DATABASE_URL`
    // devuelve `NO_DESK_ASSETS` y la oficina se ve exactamente como antes de
    // esta slice.
    fetchDeskCatalogMock.mockResolvedValue(NO_DESK_ASSETS);

    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));

    await waitFor(() => expect(result.current.phase).toBe('unavailable'));
  });

  it('si no se pudo leer el escritorio propio NO hay editor', async () => {
    // LA propiedad del enganche. Guardar reemplaza el escritorio entero: con
    // el catalogo leido y lo puesto sin leer, el primer guardado borraria la
    // decoracion que no se llego a ver.
    fetchMyDeskItemsMock.mockResolvedValue(null);

    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));

    await waitFor(() => expect(result.current.phase).toBe('unavailable'));
    expect(result.current.items).toEqual([]);
  });

  it('un escritorio pelado SI abre el editor', async () => {
    // Vacio es el estado normal de quien todavia no ha colocado nada, y es
    // justo a quien sirve esta funcion.
    fetchMyDeskItemsMock.mockResolvedValue([]);

    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.items).toEqual([]);
  });

  it('guardar manda el escritorio entero y vuelve a leerlo', async () => {
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(fetchMyDeskItemsMock).toHaveBeenCalledTimes(1);

    const items = [{ assetId: 'id-planta', slot: 0, rotation: 180 } as const];
    await act(async () => {
      expect(await result.current.save(items)).toBe('saved');
    });

    expect(saveMyDeskMock).toHaveBeenCalledWith(expect.objectContaining({ items }));
    // Lo guardado se relee en vez de darse por bueno en local: el servidor es
    // quien asigna el id de cada colocacion, y quien decide si acepto.
    await waitFor(() => expect(fetchMyDeskItemsMock).toHaveBeenCalledTimes(2));
  });

  it('un guardado rechazado no relee: no cambio nada que volver a leer', async () => {
    saveMyDeskMock.mockResolvedValue('rejected');
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, SESION));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      expect(await result.current.save([])).toBe('rejected');
    });

    expect(fetchMyDeskItemsMock).toHaveBeenCalledTimes(1);
  });

  it('sin sesion guardar no llega ni a pedirse', async () => {
    const { result } = renderHook(() => useDeskDecor(ENDPOINT, null));
    await waitFor(() => expect(result.current.phase).toBe('unavailable'));

    await act(async () => {
      expect(await result.current.save([])).toBe('failed');
    });

    expect(saveMyDeskMock).not.toHaveBeenCalled();
  });

  it('no relee en bucle mientras nada cambia', async () => {
    // La misma trampa que documenta `useDesks`: una dependencia nueva en cada
    // render dejaria al cliente pidiendo `/assets` mientras la oficina este
    // abierta.
    const { result, rerender } = renderHook(() => useDeskDecor(ENDPOINT, SESION));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender();
    rerender();

    expect(fetchDeskCatalogMock).toHaveBeenCalledTimes(1);
    expect(fetchMyDeskItemsMock).toHaveBeenCalledTimes(1);
  });
});
