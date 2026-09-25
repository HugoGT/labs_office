/**
 * Adaptador HTTP del nombre visible auto-elegido en login (#100). Handlers
 * puros que devuelven `{ status, body }`, mismo contrato que `adminRoutes.ts`
 * y `decorRoutes.ts`: aqui no hay Express, asi que el cableado no tiene
 * ninguna decision que tomar y estas reglas se prueban sin levantar servidor.
 *
 * `authenticate` y no `authorize`: elegir el propio nombre es de quien se
 * sienta, no de quien administra -- exigir rol aqui dejaria la funcion sin
 * usuarios. Mismo criterio que `/me/desk` en `decorRoutes.ts`.
 *
 * ## El `id` que se escribe sale SIEMPRE del token, nunca del cuerpo
 *
 * Estas rutas viven en una url publica y cualquiera con un ID token valido
 * puede llamarlas a mano con curl. Si el cuerpo pudiese decir a quien
 * pertenece la escritura, bastaria un id ajeno para renombrarle la cuenta a
 * otra persona. Por eso `handleSetDisplayName` solo lee `name` del cuerpo, y
 * el `id` de `authenticated.user.id`.
 *
 * ## La canonicalizacion vive ANTES del puerto (D10)
 *
 * `canonicalizeDisplayName` corre aqui, no dentro del adaptador: asi un 400
 * (nombre invalido) nunca llega a abrir una consulta a la base de datos. Los
 * adaptadores vuelven a aplicarla por su cuenta (idempotente) como segunda
 * linea, nunca como la primera.
 */

import {
  authenticate,
  type AdminDeps,
  type AdminResult,
} from '../admin/adminRoutes.ts';
import { canonicalizeDisplayName, DisplayNameTakenError, InvalidDisplayNameError } from './displayNameRules.ts';

/** Cuerpo propio y no el `invalid-request` compartido: el cliente distingue este 400 por su codigo (ver el diseno). */
const INVALID_NAME: AdminResult = { status: 400, body: { error: 'invalid-display-name' } };
const TAKEN: AdminResult = { status: 409, body: { error: 'display-name-taken' } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee el nombre guardado de quien pregunta. Sin nombre elegido devuelve
 * `null`, no un error: no haber elegido nombre todavia es un estado legitimo
 * (session restore, o alguien que nunca paso por la ruta de reclamo).
 */
export async function handleGetDisplayName(
  authorization: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  return { status: 200, body: { displayName: authenticated.user.displayName } };
}

/**
 * Reclama un nombre. `translating` no hace falta como funcion propia -- solo
 * hay un error de dominio que traducir aqui, a diferencia de `decorRoutes.ts`.
 */
export async function handleSetDisplayName(
  authorization: unknown,
  body: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  if (!isPlainObject(body) || typeof body.name !== 'string') return INVALID_NAME;

  let canonical: string;
  try {
    canonical = canonicalizeDisplayName(body.name);
  } catch (error) {
    if (error instanceof InvalidDisplayNameError) return INVALID_NAME;
    throw error;
  }

  try {
    const updated = await deps.directory.setDisplayName(authenticated.user.id, canonical);
    // La fila viene de `authenticated.user.id`, que `authenticate` acaba de
    // resolver: que no exista aqui seria una carrera imposible de reproducir
    // (la cuenta se borro entre el paso 2 y este), no un dato malo del
    // cliente. `INVALID_NAME` es la salida mas honesta que hay sin inventar un
    // codigo nuevo para un caso que no deberia poder darse.
    if (updated === null) return INVALID_NAME;
    return { status: 200, body: { displayName: updated.displayName } };
  } catch (error) {
    if (error instanceof DisplayNameTakenError) return TAKEN;
    throw error;
  }
}
