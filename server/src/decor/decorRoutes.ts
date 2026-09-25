/**
 * Adaptador HTTP del catalogo de decoracion (#7, slice 4). Handlers puros que
 * devuelven `{ status, body }`, mismo contrato que `adminRoutes.ts` y
 * `spacesRoutes.ts`: aqui no hay Express, asi que el cableado no tiene ninguna
 * decision que tomar y estas reglas se prueban sin levantar servidor.
 *
 * Las guardas NO se reimplementan: se importan de `adminRoutes.ts`, que ya son
 * los pasos de verdad. Una copia aqui es como se separan dos superficies de
 * administracion.
 *
 * ## Dos superficies con dos guardas distintas, a proposito
 *
 *   - `/admin/assets` (listar, crear, archivar, marcar `aboveAvatars`) corre `authorize`: credencial,
 *     cuenta que la oficina admite, y rol que administra. El catalogo lo CURA
 *     alguien; que cualquiera pudiese dar de alta una pieza convertiria una
 *     lista revisada en un vertedero.
 *   - `/me/desk` (leer, guardar) corre `authenticate`: los dos primeros pasos
 *     pero NO el tercero. El escritorio es de quien lo usa, no de quien
 *     administra; exigir rol aqui dejaria la funcion sin usuarios.
 *
 * ## El `userId` sale del token y NUNCA del cuerpo
 *
 * Es la propiedad que sostiene la mitad de `/me/desk`. Estas rutas viven en
 * una url publica y cualquiera con un ID token valido puede llamarlas a mano
 * con curl, sin pasar por ninguna pantalla. Si el cuerpo pudiese decir a quien
 * pertenece la escritura, "cada quien edita su escritorio" seria una costumbre
 * del cliente y no una propiedad del servidor: bastaria un `userId` ajeno para
 * redecorarle el sitio a otra persona.
 *
 * Por eso no se valida un `userId` del cuerpo ni se compara con el del token:
 * simplemente NO SE LEE. Compararlos daria un 403 que confirma que ese id
 * existe, y ademas seria una guarda que alguien podria quitar sin que ninguna
 * ruta dejase de funcionar. Lo que no se lee no se puede olvidar de comprobar.
 */

import {
  authenticate,
  authorize,
  INVALID_REQUEST,
  NOT_FOUND,
  type AdminDeps,
  type AdminResult,
} from '../admin/adminRoutes.ts';
import type { Asset, DecorCatalog, DeskItem, DeskItemInput } from './decorPort.ts';
import { AssetNameTakenError, InvalidAssetError, InvalidDeskConfigError } from './decorRules.ts';

export interface DecorDeps extends AdminDeps {
  decor: DecorCatalog;
}

/**
 * El unico 409 de esta slice, con cuerpo PROPIO y no uno reciclado de otra. El
 * codigo del cuerpo es lo unico que le dice al panel que hay que arreglar, y
 * `space-overlap`, `desk-overlap` y `desk-taken` se arreglan cada uno de una
 * forma que no tiene nada que ver con elegir otro nombre para una pieza.
 */
const NAME_TAKEN: AdminResult = { status: 409, body: { error: 'asset-name-taken' } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Proyeccion de un asset a lo que ve el panel. Se enumeran los campos uno a
 * uno en vez de esparcir la fila, misma razon que `toInvitationBody`.
 *
 * `createdAt` se queda fuera: no lo necesita nadie para pintar ni para elegir.
 * `archivedAt` SI viaja, porque es lo unico que distingue una pieza retirada
 * de una viva cuando el panel pide el historico.
 */
function toAssetBody(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    slug: asset.slug,
    name: asset.name,
    kind: asset.kind,
    textureKey: asset.textureKey,
    w: asset.w,
    h: asset.h,
    placeableOnDesk: asset.placeableOnDesk,
    aboveAvatars: asset.aboveAvatars,
    archivedAt: asset.archivedAt === null ? null : asset.archivedAt.toISOString(),
  };
}

/** Lo justo para pintar la pieza. `createdAt` no dice nada al cliente y no viaja. */
function toDeskItemBody(item: DeskItem): Record<string, unknown> {
  return {
    id: item.id,
    assetId: item.assetId,
    slot: item.slot,
    rotation: item.rotation,
    textureKey: item.textureKey,
    w: item.w,
    h: item.h,
    name: item.name,
    aboveAvatars: item.aboveAvatars,
  };
}

/**
 * Traduce los errores de dominio de `decorRules.ts` a HTTP. Cualquier otra
 * cosa se relanza para que el cableado responda 500 y lo registre: tragarse un
 * fallo desconocido como 400 le diria a quien llama que se equivoco el, cuando
 * el que se rompio fue el servidor.
 */
async function translating(run: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidAssetError) return INVALID_REQUEST;
    if (error instanceof InvalidDeskConfigError) return INVALID_REQUEST;
    if (error instanceof AssetNameTakenError) return NAME_TAKEN;
    throw error;
  }
}

export async function handleListAssets(
  authorization: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  // Sin `includeArchived`: la lectura normal es "que se puede colocar hoy"
  // (D1b). Ofrecer las retiradas en la misma lista que las vivas haria que el
  // panel tuviese que filtrarlas otra vez, y ese es justo el filtro que un dia
  // se olvida.
  const assets = await deps.decor.listAssets();
  return { status: 200, body: { assets: assets.map(toAssetBody) } };
}

/**
 * El MISMO catalogo, para quien lo va a colocar y no lo administra (#7, slice
 * 6). Corre `authenticate` y no `authorize`, igual que `/me/desk` y por lo
 * mismo: decorar el escritorio propio no es administrar nada, y exigir rol
 * aqui dejaria el selector vacio para todo el mundo menos para quien no lo
 * necesita.
 *
 * Tampoco pasa `includeArchived`, y eso no es una omision: este es el selector
 * de quien anade, y `assertNotReAddingArchived` rechaza anadir una pieza
 * retirada (D1b). Ofrecerla aqui seria ofrecer un 400.
 *
 * El cuerpo es el de `handleListAssets` y no uno propio: dos formas del mismo
 * asset segun quien pregunte obligarian al cliente a aprender las dos.
 */
export async function handleListOfficeAssets(
  authorization: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  const assets = await deps.decor.listAssets();
  return { status: 200, body: { assets: assets.map(toAssetBody) } };
}

export async function handleCreateAsset(
  authorization: unknown,
  body: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  // La credencial ANTES del cuerpo: un 400 aqui le confirmaria a quien sondea
  // que su peticion llego hasta la logica.
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (!isPlainObject(body)) return INVALID_REQUEST;

  // Se leen solo los campos declarados. Un `id`, un `slug` o un `archivedAt`
  // puestos a mano se caen aqui: el slug se DERIVA del nombre y el archivado
  // es una decision del servidor, asi que dejar que el cuerpo los fije seria
  // dejar que quien llama eligiese la identidad de la fila y su retirada.
  return translating(async () => {
    const created = await deps.decor.createAsset({
      name: body.name as string,
      kind: body.kind as Asset['kind'],
      textureKey: body.textureKey as string,
      w: body.w as number,
      h: body.h as number,
      placeableOnDesk: body.placeableOnDesk as boolean,
      // Optional: a body without it creates a normal asset (#71).
      aboveAvatars: body.aboveAvatars as boolean | undefined,
    });
    return { status: 201, body: toAssetBody(created) };
  });
}

/**
 * Marks or unmarks an asset as drawn above avatars (#71). Same guard as the
 * rest of `/admin/assets`: which assets cover people is a curation decision.
 *
 * Only `aboveAvatars` is read from the body. Name, slug, size and archiving
 * have their own rules (derived slug, archive-not-delete) and are not editable
 * through this path, so a hand-written field for them is dropped here.
 */
export async function handleUpdateAsset(
  authorization: unknown,
  id: unknown,
  body: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string' || !isPlainObject(body)) return INVALID_REQUEST;

  return translating(async () => {
    const updated = await deps.decor.updateAsset(id, {
      aboveAvatars: body.aboveAvatars as boolean | undefined,
    });
    if (updated === null) return NOT_FOUND;
    return { status: 200, body: toAssetBody(updated) };
  });
}

export async function handleArchiveAsset(
  authorization: unknown,
  id: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string') return INVALID_REQUEST;

  const archived = await deps.decor.archiveAsset(id);
  if (archived === null) return NOT_FOUND;
  // Las colocaciones no se tocan: archivar habla de lo que se puede colocar
  // manana, no reescribe el escritorio de nadie (D1b).
  return { status: 200, body: toAssetBody(archived) };
}

export async function handleGetDeskConfig(
  authorization: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  // `authenticate` y no `authorize`: el escritorio es de quien lo usa. Los
  // pasos 1 y 2 siguen corriendo, asi que una cuenta caducada o revocada
  // tampoco lo lee.
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  const items = await deps.decor.getDeskConfig(authenticated.user.id);
  return { status: 200, body: { items: items.map(toDeskItemBody) } };
}

export async function handleReplaceDeskConfig(
  authorization: unknown,
  body: unknown,
  deps: DecorDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  if (!isPlainObject(body) || !Array.isArray(body.items)) return INVALID_REQUEST;

  // El `userId` sale de `authenticated.user`, que es la fila que el directorio
  // devolvio para el uid del token verificado. Un `userId` en el cuerpo NO se
  // lee -- ver la cabecera: lo que no se lee no se puede olvidar de comprobar.
  const userId = authenticated.user.id;

  return translating(async () => {
    const saved = await deps.decor.replaceDeskConfig(userId, body.items as DeskItemInput[]);
    return { status: 200, body: { items: saved.map(toDeskItemBody) } };
  });
}
