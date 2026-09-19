/**
 * Adaptador HTTP de los espacios (#7, slice 3). Handlers puros que devuelven
 * `{ status, body }`, mismo contrato que `adminRoutes.ts` y
 * `handleLivekitToken`: aqui no hay Express, asi que el cableado no tiene
 * ninguna decision que tomar y estas reglas se prueban sin levantar servidor.
 *
 * La guarda de rol NO se reimplementa: se importa `authorize` de
 * `adminRoutes.ts`, que ya son los tres pasos (credencial valida, cuenta que
 * esta oficina admite ahora mismo, rol que administra). Una copia aqui seria
 * como se separan dos superficies de administracion -- un dia una aprende a
 * rechazar a un invitado caducado y la otra no.
 *
 * `GET /spaces` es la excepcion y va SIN autenticar, a proposito:
 *
 *   - No publica nada que no este ya publicado. Hoy los rectangulos viajan
 *     dentro del bundle del cliente (`BUILT_IN_SPACES` en `mapData.ts`), asi
 *     que pedir un token protegeria un secreto que no existe.
 *   - Exigirlo romperia el modo sin auth. El servidor arranca sin
 *     `FIREBASE_PROJECT_ID` (ver `createOfficeServer`), y de ese modo viven el
 *     desarrollo local y la suite e2e; un cliente sin token que no pudiese leer
 *     la config caeria al fallback y divergiria en `spacesVersion` de cualquier
 *     otro que si la leyese -- que es justo el silencio mutuo que el predicado
 *     de `proximityAudio.ts` produce (D4).
 */

import {
  authorize,
  INVALID_REQUEST,
  NOT_FOUND,
  type AdminDeps,
  type AdminResult,
} from '../admin/adminRoutes.ts';
import { InvalidSpaceError, SpaceOverlapError } from './spaceRules.ts';
import type { Space, SpacesDirectory, UpdateSpaceInput } from './spacesPort.ts';

export interface SpacesDeps extends AdminDeps {
  spaces: SpacesDirectory;
}

const CONFLICT: AdminResult = { status: 409, body: { error: 'space-overlap' } };

/**
 * Los mismos ocho campos que entran en el hash de version (`CanonicalSpace`),
 * y ni uno mas. `createdAt`/`updatedAt` se quedan fuera porque no afectan a la
 * pertenencia y porque, si viajasen, invitarian a que alguien los metiese en su
 * propio calculo de version y divergiese del servidor (D4).
 */
function toConfigBody(space: Space): Record<string, unknown> {
  const { id, slug, name, x, y, w, h, capacity } = space;
  return { id, slug, name, x, y, w, h, capacity };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Traduce los errores de dominio de `spaceRules.ts` a HTTP. Cualquier otra cosa
 * se relanza para que el cableado responda 500 y lo registre: tragarse un fallo
 * desconocido como 400 le diria al administrador que se equivoco el, cuando el
 * que se rompio fue el servidor.
 */
async function translating(run: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidSpaceError) return INVALID_REQUEST;
    if (error instanceof SpaceOverlapError) return CONFLICT;
    throw error;
  }
}

/**
 * Config que lee cada cliente al arrancar. Sin autenticar (ver la cabecera).
 *
 * Nunca degrada a los espacios incorporados: un despliegue con la tabla vacia
 * responde una lista vacia y la version del hash vacio. Fingir las dos salas de
 * siempre haria que el cliente derivase pertenencia de unos rectangulos que el
 * servidor no tiene, y los dos lados publicarian versiones distintas del mismo
 * estado.
 */
export async function handleGetSpacesConfig(
  deps: Pick<SpacesDeps, 'spaces'>,
): Promise<AdminResult> {
  const [spaces, version] = await Promise.all([deps.spaces.listSpaces(), deps.spaces.version()]);
  return { status: 200, body: { spaces: spaces.map(toConfigBody), version } };
}

export async function handleCreateSpace(
  authorization: unknown,
  body: unknown,
  deps: SpacesDeps,
): Promise<AdminResult> {
  // La credencial ANTES del cuerpo: un 400 aqui le confirmaria a quien sondea
  // que su peticion llego hasta la logica.
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (!isPlainObject(body)) return INVALID_REQUEST;

  // Se leen solo los campos declarados. Un `id` o un `slug` puestos a mano se
  // caen aqui: el id es la clave de pertenencia (rebanada 2) y el slug se
  // DERIVA del nombre, asi que dejar que el cuerpo los fije seria dejar que
  // quien llama eligiese a que espacio pertenece la gente.
  return translating(async () => {
    const created = await deps.spaces.createSpace({
      name: body.name as string,
      x: body.x as number,
      y: body.y as number,
      w: body.w as number,
      h: body.h as number,
      // Ausente es "sin limite". Aqui no hay que distinguirlo de `null`, a
      // diferencia de `handleUpdateSpace`: un espacio que nace no tiene aforo
      // previo que conservar.
      capacity: (body.capacity as number | null | undefined) ?? null,
    });
    return { status: 201, body: toConfigBody(created) };
  });
}

export async function handleUpdateSpace(
  authorization: unknown,
  id: unknown,
  body: unknown,
  deps: SpacesDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string' || !isPlainObject(body)) return INVALID_REQUEST;

  // Se copian solo las claves PRESENTES: `UpdateSpaceInput` distingue "no lo
  // toques" (ausente) de "quitale el limite" (`null` presente), y colapsarlas
  // dejaria un aforo imposible de retirar.
  const patch: UpdateSpaceInput = {};
  if ('name' in body) patch.name = body.name as string;
  if ('x' in body) patch.x = body.x as number;
  if ('y' in body) patch.y = body.y as number;
  if ('w' in body) patch.w = body.w as number;
  if ('h' in body) patch.h = body.h as number;
  if ('capacity' in body) patch.capacity = body.capacity as number | null;

  return translating(async () => {
    const updated = await deps.spaces.updateSpace(id, patch);
    if (updated === null) return NOT_FOUND;
    return { status: 200, body: toConfigBody(updated) };
  });
}

export async function handleDeleteSpace(
  authorization: unknown,
  id: unknown,
  deps: SpacesDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof id !== 'string') return INVALID_REQUEST;

  const deleted = await deps.spaces.deleteSpace(id);
  if (!deleted) return NOT_FOUND;
  // El layout del espacio se va con el por la cascada de `schema.sql`; el
  // adaptador no lo borra a mano (D1b).
  return { status: 200, body: { deleted: true } };
}
