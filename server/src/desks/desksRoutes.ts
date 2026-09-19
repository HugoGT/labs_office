/**
 * Adaptador HTTP de los escritorios asignables (#7, slice 5). Handlers puros
 * que devuelven `{ status, body }`, mismo contrato que `adminRoutes.ts`,
 * `spacesRoutes.ts` y `decorRoutes.ts`: aqui no hay Express, asi que el
 * cableado no tiene ninguna decision que tomar y estas reglas se prueban sin
 * levantar servidor.
 *
 * Las guardas NO se reimplementan: se importan de `adminRoutes.ts`, que ya son
 * los pasos de verdad. Una copia aqui es como se separan dos superficies de
 * administracion -- un dia una aprende a rechazar a un invitado caducado y la
 * otra no.
 *
 * ## Dos superficies con dos guardas distintas, a proposito
 *
 *   - `/admin/desks` (crear, mover, renombrar, borrar) corre `authorize`:
 *     credencial, cuenta que la oficina admite, y rol que administra. Quien
 *     administra decide CUANTOS escritorios hay y DONDE estan.
 *   - `/desks`, `/desks/:id/claim` y `/me/desk/release` corren `authenticate`:
 *     los dos primeros pasos pero NO el tercero. Elegir sitio es de quien se
 *     sienta; exigir rol aqui dejaria la funcion sin usuarios.
 *
 * Quien administra NO reparte sitios, y eso no es una omision: es la mitad del
 * diseno. Por eso no hay ninguna ruta de administracion que escriba
 * `occupant_id`, ni un campo del cuerpo que lo haga por la puerta de atras.
 *
 * ## `GET /desks` SI exige credencial, a diferencia de `GET /spaces`
 *
 * `/spaces` va abierta porque no publica nada que no este ya dentro del bundle
 * del cliente: los rectangulos viajan en `BUILT_IN_SPACES`, asi que pedir un
 * token protegeria un secreto que no existe. Aqui la pregunta no es la misma.
 * Quien se sienta donde es informacion del DIRECTORIO sobre personas reales --
 * nombres, quien vino hoy, quien esta al lado de quien -- y nada de eso viaja
 * en ningun bundle. Sin credencial no se contesta.
 *
 * Sin directorio configurado estas rutas responden `503 desks-not-configured`
 * y nunca 404 (ver `createOfficeServer.ts`): el cliente degrada a no pintar
 * ningun escritorio asignable, que es exactamente lo que hay.
 *
 * ## El ocupante es SIEMPRE la identidad verificada de quien llama
 *
 * Misma regla y misma razon que `/me/desk` en `decorRoutes.ts`. Estas rutas
 * viven en una url publica y cualquiera con un ID token valido puede llamarlas
 * a mano con curl, sin pasar por ninguna pantalla. Si el cuerpo pudiese decir
 * a quien se sienta o a quien se levanta, "cada quien elige su sitio" seria
 * una costumbre del cliente y no una propiedad del servidor.
 *
 * Por eso `handleClaimDesk` y `handleReleaseDesk` NO reciben cuerpo. No es que
 * no lo validen: es que no lo tienen. Compararlo con el del token daria un 403
 * que confirma que ese id existe, y ademas seria una guarda que alguien podria
 * quitar sin que ninguna ruta dejase de funcionar. Lo que no se lee no se
 * puede olvidar de comprobar.
 */

import {
  authenticate,
  authorize,
  INVALID_REQUEST,
  NOT_FOUND,
  type AdminDeps,
  type AdminResult,
} from '../admin/adminRoutes.ts';
import { DESK_SIDE, DeskOverlapError, DeskTakenError, InvalidDeskError } from './deskRules.ts';
import type { Desk, DeskDirectory, OfficeDesk, UpdateDeskInput } from './desksPort.ts';

export interface DesksDeps extends AdminDeps {
  desks: DeskDirectory;
}

/**
 * Los DOS 409 de esta slice, separados a proposito. Los provocan dos personas
 * distintas haciendo dos cosas distintas, y se arreglan de formas distintas:
 * uno eligiendo otro escritorio y el otro corrigiendo unas coordenadas. Un
 * cuerpo comun obligaria al cliente a adivinar cual de las dos cosas decirle a
 * quien esta mirando la pantalla.
 */
const OVERLAP: AdminResult = { status: 409, body: { error: 'desk-overlap' } };
const TAKEN: AdminResult = { status: 409, body: { error: 'desk-taken' } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Proyeccion de un escritorio a lo que ve el cliente. Se enumeran los campos
 * uno a uno en vez de esparcir la fila, misma razon que `toConfigBody` en
 * `spacesRoutes.ts`.
 *
 * `w`/`h` viajan DERIVADOS de `DESK_SIDE` y no salen de ninguna columna: un
 * escritorio es 3x3 siempre. Van porque el cliente necesita el tamano para
 * pintarlo, y que lo guardase por su cuenta seria una segunda copia del 3 que
 * un dia discrepa de la de aqui.
 *
 * `createdAt`/`updatedAt` se quedan fuera: no dicen nada para pintar la
 * oficina. `occupantId` tampoco viaja suelto -- `occupant` ya lo trae dentro,
 * y dos formas de decir lo mismo en el mismo cuerpo invitan a que el cliente
 * use una cuando la otra dice algo distinto.
 */
function toDeskBody(desk: OfficeDesk): Record<string, unknown> {
  return {
    id: desk.id,
    label: desk.label,
    x: desk.x,
    y: desk.y,
    w: DESK_SIDE,
    h: DESK_SIDE,
    occupant: desk.occupant,
  };
}

/** Lo que devuelven las escrituras del panel: un escritorio sin resolver ocupante. */
function toAdminDeskBody(desk: Desk): Record<string, unknown> {
  return toDeskBody({ ...desk, occupant: null });
}

/**
 * Traduce los errores de dominio de `deskRules.ts` a HTTP. Cualquier otra cosa
 * se relanza para que el cableado responda 500 y lo registre: tragarse un
 * fallo desconocido como 400 le diria a quien llama que se equivoco el, cuando
 * el que se rompio fue el servidor.
 */
async function translating(run: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidDeskError) return INVALID_REQUEST;
    if (error instanceof DeskOverlapError) return OVERLAP;
    if (error instanceof DeskTakenError) return TAKEN;
    throw error;
  }
}

/**
 * Todo lo que hace falta para dibujar la oficina, en una llamada: cada
 * escritorio, su ocupante y la decoracion de ese ocupante.
 *
 * `authenticate` y no `authorize`: cualquiera de la oficina necesita ver donde
 * puede sentarse. Pero los pasos 1 y 2 si corren, asi que una cuenta caducada
 * o revocada no averigua quien esta hoy en la oficina.
 */
export async function handleListDesks(
  authorization: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  // Sin ningun escritorio se devuelve una lista vacia y no un error: una
  // oficina que todavia no ha colocado ninguno es un estado legitimo, y nadie
  // los siembra.
  const desks = await deps.desks.listOfficeDesks();
  return { status: 200, body: { desks: desks.map(toDeskBody) } };
}

export async function handleCreateDesk(
  authorization: unknown,
  body: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  // La credencial ANTES del cuerpo: un 400 aqui le confirmaria a quien sondea
  // que su peticion llego hasta la logica.
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (!isPlainObject(body)) return INVALID_REQUEST;

  // Se leen solo los campos declarados. Un `id` o un `occupantId` puestos a
  // mano se caen aqui: el id lo genera la base de datos, y quien se sienta lo
  // decide esa persona con `claimDesk`. Dejar que el cuerpo lo fijase seria
  // dejar que quien administra repartiese sitios.
  return translating(async () => {
    const created = await deps.desks.createDesk({
      label: body.label as string,
      x: body.x as number,
      y: body.y as number,
    });
    return { status: 201, body: toAdminDeskBody(created) };
  });
}

export async function handleUpdateDesk(
  authorization: unknown,
  id: unknown,
  body: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string' || !isPlainObject(body)) return INVALID_REQUEST;

  // Se copian solo las claves PRESENTES: renombrar sin mover y mover sin
  // renombrar son dos peticiones distintas. `occupantId` no esta entre ellas
  // -- mover un escritorio no levanta a quien lo ocupa.
  const patch: UpdateDeskInput = {};
  if ('label' in body) patch.label = body.label as string;
  if ('x' in body) patch.x = body.x as number;
  if ('y' in body) patch.y = body.y as number;

  return translating(async () => {
    const updated = await deps.desks.updateDesk(id, patch);
    if (updated === null) return NOT_FOUND;
    return { status: 200, body: toAdminDeskBody(updated) };
  });
}

export async function handleDeleteDesk(
  authorization: unknown,
  id: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string') return INVALID_REQUEST;

  const deleted = await deps.desks.deleteDesk(id);
  if (!deleted) return NOT_FOUND;
  // La ocupacion se va con la fila: quien estuviese sentado se queda sin sitio
  // y puede coger otro. Es lo correcto -- el escritorio ya no existe.
  return { status: 200, body: { deleted: true } };
}

/**
 * Coger un escritorio. Sin cuerpo: el ocupante es la identidad verificada de
 * quien llama y nada mas (ver la cabecera).
 *
 * `authenticate` y no `authorize`: el escritorio es de quien lo usa, no de
 * quien administra.
 */
export async function handleClaimDesk(
  authorization: unknown,
  id: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  if (typeof id !== 'string') return INVALID_REQUEST;

  return translating(async () => {
    const claimed = await deps.desks.claimDesk(id, authenticated.user.id);
    if (claimed === null) return NOT_FOUND;
    // El anterior se solto dentro de la misma operacion; no hay una segunda
    // llamada que pudiera quedarse a medias.
    return { status: 200, body: toAdminDeskBody(claimed) };
  });
}

/**
 * Dejar el escritorio propio. Idempotente: soltar sin tener nada responde 200,
 * porque el cliente no tiene por que acordarse de comprobarlo antes y un 404
 * aqui le diria que algo va mal cuando el estado es exactamente el que pidio.
 *
 * Tampoco recibe cuerpo, y la mitad que mas duele si faltase es esta: un id
 * ajeno bastaria para echar a alguien de su sitio.
 */
export async function handleReleaseDesk(
  authorization: unknown,
  deps: DesksDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  await deps.desks.releaseDesk(authenticated.user.id);
  return { status: 200, body: { released: true } };
}
