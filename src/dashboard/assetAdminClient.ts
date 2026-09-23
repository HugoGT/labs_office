/**
 * Adaptador HTTP del catalogo de decoracion (#7, slice 5). Unico modulo del
 * panel que conoce `fetch` para estas rutas, igual que `adminClient.ts` lo es
 * del de invitaciones.
 *
 * Las tres rutas cuelgan de `/admin/assets` y corren la guarda de rol: el
 * catalogo lo CURA alguien, y que cualquiera pudiese dar de alta una pieza
 * convertiria una lista revisada en un vertedero. La base sigue siendo la RAIZ
 * para compartir derivacion con el panel de escritorios, cuya lectura no vive
 * bajo `/admin`; el prefijo se escribe entero en cada camino.
 *
 * Retirar va por POST y no por DELETE por dos razones que apuntan igual: el
 * CORS del servidor anuncia `GET,POST,OPTIONS`, y el verbo ademas diria algo
 * falso -- archivar no borra nada (D1b).
 */

import { AdminError } from './adminPort';
import {
  ASSET_KINDS,
  type AssetAdminPort,
  type AssetKind,
  type CatalogAsset,
  type CreateAssetInput,
} from './assetAdminPort';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';

export interface AssetAdminClientOptions {
  /** La RAIZ del servidor (`resolveOfficeApiBaseUrl`), sin `/admin`. */
  baseUrl: string;
  /** Se llama en CADA peticion y nunca se guarda: ver `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === 'string' && (ASSET_KINDS as readonly string[]).includes(value);
}

/** Una fila servida a un `CatalogAsset`, o `null` si no cumple la forma. */
function toCatalogAsset(raw: unknown): CatalogAsset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.slug)) return null;
  if (!isNonEmptyString(row.name)) return null;
  // Un `kind` que este cliente no conoce saldria como hueco en la tabla y como
  // una opcion imposible en el formulario.
  if (!isAssetKind(row.kind)) return null;
  // Sin `textureKey` no hay sprite que dibujar: ofrecerla en el catalogo seria
  // ofrecer algo que nadie podria ver colocado.
  if (!isNonEmptyString(row.textureKey)) return null;
  if (!isFiniteNumber(row.w) || !isFiniteNumber(row.h)) return null;
  if (typeof row.placeableOnDesk !== 'boolean') return null;
  // `undefined` no vale: una pieza viva llega con `archivedAt: null`
  // explicito. Darla por viva pintaria como disponible algo ya retirado.
  if (row.archivedAt !== null && typeof row.archivedAt !== 'string') return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    textureKey: row.textureKey,
    w: row.w,
    h: row.h,
    placeableOnDesk: row.placeableOnDesk,
    archivedAt: row.archivedAt,
  };
}

/**
 * Valida la respuesta ENTERA o la rechaza entera, mismo criterio que el resto
 * de lecturas de esta issue: media lista es media verdad sobre que se puede
 * colocar, y una pieza que falta se lee igual que una que nunca existio.
 */
function parseCatalogAsset(raw: unknown): CatalogAsset {
  const asset = toCatalogAsset(raw);
  if (asset === null) throw new AdminError('unknown');
  return asset;
}

export function createAssetAdminClient(
  { baseUrl, getIdToken }: AssetAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): AssetAdminPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      notConfigured: 'decor-not-configured',
      // Estas rutas no devuelven ningun 409 hoy. Se declara el generico para
      // no inventarle un motivo propio a un estado que el servidor no da.
      conflicts: ['conflict'],
    },
    fetchImpl,
  );

  return {
    async listAssets(): Promise<CatalogAsset[]> {
      // Sin parametros: `handleListAssets` no lee `includeArchived` de ningun
      // sitio, asi que por HTTP solo existe el catalogo vivo (ver el puerto).
      const { assets } = await request<{ assets: unknown[] }>('/admin/assets');
      if (!Array.isArray(assets)) throw new AdminError('unknown');
      return assets.map(parseCatalogAsset);
    },

    async createAsset(input: CreateAssetInput): Promise<CatalogAsset> {
      // Se manda solo lo que el servidor lee. Ni `slug` ni `archivedAt`: el
      // primero lo deriva del nombre y el segundo es una decision suya.
      return parseCatalogAsset(
        await request(
          '/admin/assets',
          jsonBody({
            name: input.name,
            kind: input.kind,
            textureKey: input.textureKey,
            w: input.w,
            h: input.h,
            placeableOnDesk: input.placeableOnDesk,
          }),
        ),
      );
    },

    async archiveAsset(id: string): Promise<CatalogAsset> {
      // `encodeURIComponent` y no interpolacion cruda: un id con barra
      // inventaria un segmento de ruta que el servidor no tiene.
      return parseCatalogAsset(
        await request(`/admin/assets/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
      );
    },
  };
}
