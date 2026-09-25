import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createAssetAdminClient } from './assetAdminClient';

const BASE_URL = 'http://localhost:2567';

const SERVED_ASSET = {
  id: 'asset-1',
  slug: 'planta-de-interior',
  name: 'Planta de interior',
  kind: 'plant',
  textureKey: 'plant-small',
  w: 1,
  h: 1,
  placeableOnDesk: true,
  aboveAvatars: false,
  archivedAt: null,
};

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      fakeResponse(status, body),
  );
}

function clientWith(
  fetchImpl: ReturnType<typeof fetchWith> | typeof fetch,
  getIdToken: () => Promise<string | null> = async () => 'id-token',
) {
  return createAssetAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as typeof fetch);
}

function sentBody(fetchImpl: ReturnType<typeof fetchWith>, call = 0): unknown {
  return JSON.parse((fetchImpl.mock.calls[call][1]?.body ?? 'null') as string);
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'no-error';
  }
}

describe('createAssetAdminClient: contrato del servidor', () => {
  it('lista con GET /admin/assets', async () => {
    const fetchImpl = fetchWith(200, { assets: [SERVED_ASSET] });

    await clientWith(fetchImpl).listAssets();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/assets');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('no pide los retirados: la ruta no sabe recibir esa peticion', async () => {
    // El PUERTO del servidor tiene `includeArchived`, pero `handleListAssets`
    // no lo lee de ningun sitio: no hay parametro de consulta ni cuerpo que lo
    // active. Mandarlo igualmente seria prometer un historico que el servidor
    // no puede servir.
    const fetchImpl = fetchWith(200, { assets: [] });

    await clientWith(fetchImpl).listAssets();

    expect(fetchImpl.mock.calls[0][0]).not.toMatch(/\?|archiv/i);
  });

  it('desempaqueta la lista tal cual la sirve el servidor', async () => {
    const fetchImpl = fetchWith(200, { assets: [SERVED_ASSET] });

    expect(await clientWith(fetchImpl).listAssets()).toEqual([SERVED_ASSET]);
  });

  it('crea con POST /admin/assets y solo con lo que el servidor lee', async () => {
    const fetchImpl = fetchWith(201, SERVED_ASSET);

    await clientWith(fetchImpl).createAsset({
      name: 'Planta de interior',
      kind: 'plant',
      textureKey: 'plant-small',
      w: 1,
      h: 1,
      placeableOnDesk: true,
      aboveAvatars: false,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/assets');
    expect(init?.method).toBe('POST');
    // Ni `slug` ni `archivedAt`: el slug se DERIVA del nombre en el servidor y
    // el archivado es una decision suya. Mandarlos seria elegir la identidad
    // de la fila desde el navegador.
    expect(sentBody(fetchImpl)).toEqual({
      name: 'Planta de interior',
      kind: 'plant',
      textureKey: 'plant-small',
      w: 1,
      h: 1,
      placeableOnDesk: true,
      aboveAvatars: false,
    });
  });

  it('sends aboveAvatars when creating an asset (#71)', async () => {
    const fetchImpl = fetchWith(201, { ...SERVED_ASSET, aboveAvatars: true });

    const asset = await clientWith(fetchImpl).createAsset({
      name: 'Arco',
      kind: 'decor',
      textureKey: 'arch',
      w: 1,
      h: 1,
      placeableOnDesk: true,
      aboveAvatars: true,
    });

    expect(sentBody(fetchImpl)).toMatchObject({ aboveAvatars: true });
    expect(asset.aboveAvatars).toBe(true);
  });

  it('marks and unmarks with POST /admin/assets/:id and only the flag in the body (#71)', async () => {
    // POST and not PATCH: the server CORS only announces `GET,POST,OPTIONS`.
    const fetchImpl = fetchWith(200, { ...SERVED_ASSET, aboveAvatars: true });

    const asset = await clientWith(fetchImpl).updateAsset('asset/1', { aboveAvatars: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/assets/asset%2F1');
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImpl)).toEqual({ aboveAvatars: true });
    expect(asset.aboveAvatars).toBe(true);
  });

  it('an older server without aboveAvatars reads as a normal asset (#71)', async () => {
    const { aboveAvatars: _omitted, ...older } = SERVED_ASSET;
    const fetchImpl = fetchWith(200, { assets: [older] });

    expect((await clientWith(fetchImpl).listAssets())[0].aboveAvatars).toBe(false);
  });

  it('a non-boolean aboveAvatars rejects the list, like placeableOnDesk (#71)', async () => {
    const client = clientWith(fetchWith(200, { assets: [{ ...SERVED_ASSET, aboveAvatars: 'si' }] }));

    expect(await codeOf(client.listAssets())).toBe('unknown');
  });

  it('no manda ninguna imagen: el catalogo es curado', async () => {
    // `textureKey` apunta a un sprite que el bundle del cliente YA trae. No
    // hay subida de ficheros en ninguna parte de esta superficie.
    const fetchImpl = fetchWith(201, SERVED_ASSET);

    await clientWith(fetchImpl).createAsset({
      name: 'Planta de interior',
      kind: 'plant',
      textureKey: 'plant-small',
      w: 1,
      h: 1,
      placeableOnDesk: true,
      aboveAvatars: false,
    });

    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(fetchImpl.mock.calls[0][1]?.body).toBeTypeOf('string');
  });

  it('retira con POST /admin/assets/:id/archive y devuelve la fecha', async () => {
    // POST y no DELETE: el CORS del servidor anuncia `GET,POST,OPTIONS`. Y el
    // verbo dice la verdad -- retirar no borra nada.
    const archivado = { ...SERVED_ASSET, archivedAt: '2026-09-19T10:00:00.000Z' };
    const fetchImpl = fetchWith(200, archivado);

    const asset = await clientWith(fetchImpl).archiveAsset('asset-1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/assets/asset-1/archive');
    expect(init?.method).toBe('POST');
    // La fecha viaja tal cual, sin reinterpretarla: el cliente no convierte
    // fechas (mismo criterio que `Invitation.expiresAt`).
    expect(asset.archivedAt).toBe('2026-09-19T10:00:00.000Z');
  });

  it('escapa el id al retirar', async () => {
    const fetchImpl = fetchWith(200, SERVED_ASSET);

    await clientWith(fetchImpl).archiveAsset('asset/1');

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:2567/admin/assets/asset%2F1/archive',
    );
  });
});

describe('createAssetAdminClient: como cuenta los fallos', () => {
  it('un despliegue sin catalogo responde 503 y no es una averia', async () => {
    const client = clientWith(fetchWith(503, { error: 'decor-not-configured' }));

    expect(await codeOf(client.listAssets())).toBe('decor-not-configured');
  });

  it('el 503 del catalogo no se confunde con el de los escritorios', async () => {
    // Son dos piezas distintas del despliegue y el panel esconde una u otra.
    const client = clientWith(fetchWith(503, { error: 'decor-not-configured' }));

    expect(await codeOf(client.listAssets())).not.toBe('desks-not-configured');
  });

  it('una pieza que ya no existe es un 404 y se cuenta como tal', async () => {
    const client = clientWith(fetchWith(404, {}));

    expect(await codeOf(client.archiveAsset('asset-1'))).toBe('not-found');
  });

  it('traduce el resto del contrato a motivos del panel', async () => {
    const casos: Array<[number, AdminErrorCode]> = [
      [400, 'invalid-request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [500, 'unknown'],
    ];

    for (const [status, code] of casos) {
      const client = clientWith(fetchWith(status, {}));
      expect(await codeOf(client.listAssets())).toBe(code);
    }
  });

  it('sin token no llega a preguntar', async () => {
    const fetchImpl = fetchWith(200, { assets: [] });
    const client = clientWith(fetchImpl, async () => null);

    expect(await codeOf(client.listAssets())).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('el servidor caido y el que rechaza son fallos distintos', async () => {
    const client = clientWith(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );

    expect(await codeOf(client.listAssets())).toBe('network');
  });

  it('una pieza con una forma que no se puede pintar tumba la lista entera', async () => {
    // Sin `textureKey` no hay sprite que dibujar, asi que ofrecerla en el
    // catalogo seria ofrecer algo que nadie podria ver colocado.
    const client = clientWith(
      fetchWith(200, { assets: [SERVED_ASSET, { ...SERVED_ASSET, textureKey: '' }] }),
    );

    expect(await codeOf(client.listAssets())).toBe('unknown');
  });

  it('un kind que este cliente no conoce tumba la lista', async () => {
    // El panel pinta una etiqueta por tipo. Uno desconocido saldria como hueco
    // en la tabla y como opcion imposible en el formulario.
    const client = clientWith(
      fetchWith(200, { assets: [{ ...SERVED_ASSET, kind: 'vehiculo' }] }),
    );

    expect(await codeOf(client.listAssets())).toBe('unknown');
  });
});
