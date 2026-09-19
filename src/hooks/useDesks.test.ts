/**
 * El enganche de React que resuelve los escritorios asignables y los reparte
 * (#7, slice 5). Las reglas de lectura y de degradacion ya las cubre
 * `desksClient.test.ts`; lo que se prueba aqui es el CICLO DE VIDA -- cuando
 * hay lista, cuando no, que no se pida dos veces, y cuando se vuelve a leer.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimDesk, fetchOfficeDesks, releaseDesk } from '../game/desksClient';
import { NO_DESKS, type OfficeDesk } from '../game/desksPort';
import { useDesks } from './useDesks';

vi.mock('../game/desksClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/desksClient')>()),
  fetchOfficeDesks: vi.fn(),
  claimDesk: vi.fn(),
  releaseDesk: vi.fn(),
}));

const fetchOfficeDesksMock = vi.mocked(fetchOfficeDesks);
const claimDeskMock = vi.mocked(claimDesk);
const releaseDeskMock = vi.mocked(releaseDesk);

const ENDPOINT = 'ws://oficina.local:2567';

const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

const MESA: OfficeDesk = {
  id: 'id-mesa',
  label: 'Mesa 4',
  x: 320,
  y: 384,
  w: 96,
  h: 96,
  occupant: null,
};

/**
 * Los dobles de lectura se declaran FUERA del render y no como lambda en
 * linea: una funcion nueva por render cambiaria la dependencia del efecto y el
 * enganche releeria en bucle, que es la misma trampa que documenta
 * `DEFAULT_FETCH_DESKS`.
 */
const FETCH_MESA = async (): Promise<readonly OfficeDesk[]> => [MESA];
const FETCH_NINGUNO = async (): Promise<readonly OfficeDesk[]> => NO_DESKS;

beforeEach(() => {
  vi.clearAllMocks();
  fetchOfficeDesksMock.mockResolvedValue([MESA]);
  claimDeskMock.mockResolvedValue('claimed');
  releaseDeskMock.mockResolvedValue('released');
});

describe('useDesks', () => {
  it('empieza en null: todavia no se sabe que escritorios hay', () => {
    // `null` no es "no hay", es "todavia no". Quien lo consume no debe mandar
    // una lista vacia a la escena antes de tiempo: pintaria la oficina sin
    // escritorios y luego con ellos, parpadeando en cada entrada.
    const { result } = renderHook(() =>
      useDesks(ENDPOINT, SESION, { fetchDesks: FETCH_MESA }),
    );

    expect(result.current.desks).toBeNull();
  });

  it('entrega la lista servida cuando llega', async () => {
    const { result } = renderHook(() =>
      useDesks(ENDPOINT, SESION, { fetchDesks: FETCH_MESA }),
    );

    await waitFor(() => expect(result.current.desks).toEqual([MESA]));
  });

  it('deriva la base del endpoint de la oficina', async () => {
    const fetchDesks = vi.fn(async () => [MESA]);

    renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));

    await waitFor(() =>
      expect(fetchDesks).toHaveBeenCalledWith('http://oficina.local:2567', SESION.getIdToken),
    );
  });

  it('sin endpoint no hay escritorios y no se pide nada', async () => {
    // La oficina en solitario no tiene servidor al que preguntar.
    const fetchDesks = vi.fn(async () => [MESA]);

    const { result } = renderHook(() => useDesks(null, SESION, { fetchDesks }));

    expect(result.current.desks).toBe(NO_DESKS);
    expect(fetchDesks).not.toHaveBeenCalled();
  });

  it('sin sesion no hay escritorios y no se pide nada', async () => {
    // `GET /desks` exige credencial: quien se sienta donde es informacion del
    // directorio sobre personas reales. Sin sesion la peticion solo puede
    // acabar en 401, asi que no se hace.
    const fetchDesks = vi.fn(async () => [MESA]);

    const { result } = renderHook(() => useDesks(ENDPOINT, null, { fetchDesks }));

    expect(result.current.desks).toBe(NO_DESKS);
    expect(fetchDesks).not.toHaveBeenCalled();
  });

  it('no vuelve a pedirlos en cada render', async () => {
    const fetchDesks = vi.fn(async () => [MESA]);

    const { rerender, result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());
    rerender();
    rerender();

    expect(fetchDesks).toHaveBeenCalledTimes(1);
  });

  it('sin `fetchDesks` inyectado tampoco los pide en cada render', async () => {
    // La trampa: si el valor por defecto se construye dentro de la firma, cada
    // render crea una funcion nueva, la dependencia del efecto cambia, y el
    // cliente pide `/desks` en bucle mientras la oficina este abierta. Con
    // `fetchDesks` inyectado el test anterior nunca lo veria, porque el doble
    // que le pasa es estable.
    const { rerender, result } = renderHook(() => useDesks(ENDPOINT, SESION));
    await waitFor(() => expect(result.current.desks).not.toBeNull());
    rerender();
    rerender();

    expect(fetchOfficeDesksMock).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que llega tras desmontar no toca el estado', async () => {
    let resolver: ((desks: readonly OfficeDesk[]) => void) | undefined;
    const fetchDesks = () =>
      new Promise<readonly OfficeDesk[]>((resolve) => {
        resolver = resolve;
      });

    const { unmount } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    unmount();

    expect(() => resolver?.([MESA])).not.toThrow();
  });

  it('`refresh` vuelve a leer la lista', async () => {
    const fetchDesks = vi.fn(async () => [MESA]);
    const { result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    await act(async () => result.current.refresh());

    expect(fetchDesks).toHaveBeenCalledTimes(2);
  });

  it('`refresh` y `claim` no cambian de identidad entre renders', async () => {
    // Quien los use estara dentro de un efecto suscrito al puente: una
    // identidad nueva por render volveria a suscribir y desuscribir sin parar.
    const { rerender, result } = renderHook(() =>
      useDesks(ENDPOINT, SESION, { fetchDesks: FETCH_MESA }),
    );
    const first = result.current;
    rerender();

    expect(result.current.refresh).toBe(first.refresh);
    expect(result.current.claim).toBe(first.claim);
    expect(result.current.release).toBe(first.release);
  });

  it('`claim` pide el sitio y devuelve lo que contesto el servidor', async () => {
    const { result } = renderHook(() =>
      useDesks(ENDPOINT, SESION, { fetchDesks: FETCH_MESA }),
    );
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    const outcome = await act(async () => result.current.claim('id-mesa'));

    expect(claimDeskMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://oficina.local:2567', deskId: 'id-mesa' }),
    );
    expect(outcome).toBe('claimed');
  });

  it('un claim conseguido vuelve a leer la lista', async () => {
    // Para que el resto de la oficina converja: la vista propia ya no es la
    // que se dibujo.
    const fetchDesks = vi.fn(async () => [MESA]);
    const { result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    await act(async () => result.current.claim('id-mesa'));

    expect(fetchDesks).toHaveBeenCalledTimes(2);
  });

  it('un 409 tambien vuelve a leer la lista: la vista propia quedo vieja', async () => {
    // Es el caso que MAS necesita releer. Alguien se adelanto, asi que el
    // escritorio que este cliente pinta como libre ya no lo esta; dejarlo como
    // estaba invitaria a volver a pedir el mismo sitio.
    claimDeskMock.mockResolvedValue('taken');
    const fetchDesks = vi.fn(async () => [MESA]);
    const { result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    const outcome = await act(async () => result.current.claim('id-mesa'));

    expect(outcome).toBe('taken');
    expect(fetchDesks).toHaveBeenCalledTimes(2);
  });

  it('un claim que falla no vuelve a leer: no ha cambiado nada que leer', async () => {
    claimDeskMock.mockResolvedValue('failed');
    const fetchDesks = vi.fn(async () => [MESA]);
    const { result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    await act(async () => result.current.claim('id-mesa'));

    expect(fetchDesks).toHaveBeenCalledTimes(1);
  });

  it('`release` suelta el propio y vuelve a leer la lista', async () => {
    const fetchDesks = vi.fn(async () => [MESA]);
    const { result } = renderHook(() => useDesks(ENDPOINT, SESION, { fetchDesks }));
    await waitFor(() => expect(result.current.desks).not.toBeNull());

    const outcome = await act(async () => result.current.release());

    expect(releaseDeskMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://oficina.local:2567' }),
    );
    expect(outcome).toBe('released');
    expect(fetchDesks).toHaveBeenCalledTimes(2);
  });

  it('sin sesion no se pide ni se suelta nada', async () => {
    // Sin credencial no hay a quien sentar ni a quien levantar.
    const { result } = renderHook(() => useDesks(ENDPOINT, null, { fetchDesks: FETCH_NINGUNO }));

    const claimed = await act(async () => result.current.claim('id-mesa'));
    const released = await act(async () => result.current.release());

    expect(claimed).toBe('failed');
    expect(released).toBe('failed');
    expect(claimDeskMock).not.toHaveBeenCalled();
    expect(releaseDeskMock).not.toHaveBeenCalled();
  });
});
