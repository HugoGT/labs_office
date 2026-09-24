/**
 * Lectura de la config de espacios servida por `GET /spaces` (#7, slice 3).
 * Puro y con `fetch` inyectado, mismo espiritu que `livekitEndpoint.ts` y
 * `livekitTokenClient.ts`: nada de `import.meta` aqui dentro, para poder
 * probarlo sin montar Vite ni levantar servidor.
 *
 * Este modulo corre ANTES de que exista la escena, asi que no tiene a quien
 * reportarle un fallo. Su contrato es por tanto total: SIEMPRE devuelve una
 * config utilizable, y cuando algo va mal devuelve la incorporada, que es
 * exactamente como se comportaba el cliente antes de esta slice.
 *
 * Por que caer al fallback es seguro y no una degradacion escondida: todos los
 * clientes de un despliegue sin `DATABASE_URL` reciben el mismo 503 y caen al
 * mismo `BUILT_IN_SPACES_CONFIG`, asi que coinciden en `spacesVersion` y se
 * siguen oyendo entre ellos. Lo que el predicado mutuo de `proximityAudio.ts`
 * silencia es la MEZCLA -- uno con config servida y otro sin ella -- y ese
 * silencio es mutuo y por tanto correcto.
 */

import {
  BUILT_IN_SPACES,
  BUILT_IN_SPACES_VERSION,
  TILE,
  type SpaceArea,
} from './mapData';

export interface SpacesConfig {
  spaces: readonly SpaceArea[];
  /** Hash opaco calculado por el servidor. El cliente NUNCA lo recalcula (D4). */
  version: string;
}

/** Lo que el cliente usaba antes de esta slice, y su salida ante cualquier fallo. */
export const BUILT_IN_SPACES_CONFIG: SpacesConfig = {
  spaces: BUILT_IN_SPACES,
  version: BUILT_IN_SPACES_VERSION,
};

/** Plazo por defecto. Un servidor colgado no puede dejar la oficina sin arrancar. */
const DEFAULT_TIMEOUT_MS = 3000;

export function deriveSpacesUrl(officeEndpoint: string): string {
  // El mismo `http.Server` sirve WebSocket (Colyseus) y HTTP (`/spaces`), asi
  // que basta con cambiar de esquema -- igual que `deriveTokenUrl`.
  const httpBase = officeEndpoint
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
  return `${httpBase}/spaces`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Una fila servida a un `SpaceArea`, o `null` si no cumple la forma.
 *
 * Aqui es donde se convierten las unidades: la tabla `spaces` guarda TILES y
 * la escena trabaja en PIXELES, igual que `BUILT_IN_SPACES`. Es la misma
 * relacion que ya documenta la cabecera de `server/src/spaces/builtInSeed.ts`.
 */
function toSpaceArea(raw: unknown): SpaceArea | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  // El `id` es la clave de pertenencia desde la rebanada 2: sin el, este
  // espacio no puede decidir quien oye a quien.
  if (!isNonEmptyString(row.id) || typeof row.name !== 'string') return null;
  if (!isFiniteNumber(row.x) || !isFiniteNumber(row.y)) return null;
  if (!isFiniteNumber(row.w) || !isFiniteNumber(row.h)) return null;

  return {
    id: row.id,
    name: row.name,
    x: row.x * TILE,
    y: row.y * TILE,
    w: row.w * TILE,
    h: row.h * TILE,
  };
}

/**
 * Valida la respuesta ENTERA o la rechaza entera. No hay termino medio, y es
 * la propiedad mas importante de este modulo.
 *
 * `version` es un hash de la lista COMPLETA que tiene el servidor. Quedarse
 * con las filas bien formadas y publicar aun asi esa version dejaria a este
 * cliente afirmando una config que no tiene: coincidiria en `spacesVersion`
 * con otro cliente que si la tiene entera, el predicado mutuo de
 * `proximityAudio.ts` los daria por acordes, y los dos derivarian pertenencias
 * distintas sobre rectangulos distintos. Seria exactamente la audibilidad de
 * un solo sentido que ese predicado existe para impedir, pero enmascarada por
 * una version que coincide. Descartar entero devuelve el desacuerdo a donde el
 * predicado puede verlo.
 *
 * Una lista VACIA si es valida: un despliegue puede tener la tabla vacia, y
 * fingir las dos salas incorporadas haria que el cliente derivase pertenencia
 * de rectangulos que el servidor no tiene.
 */
function parseSpacesConfig(payload: unknown): SpacesConfig | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;

  if (!isNonEmptyString(body.version)) return null;
  if (!Array.isArray(body.spaces)) return null;

  const spaces: SpaceArea[] = [];
  for (const raw of body.spaces) {
    const space = toSpaceArea(raw);
    if (space === null) return null;
    spaces.push(space);
  }

  return { spaces, version: body.version };
}

/**
 * Predicado de obsolescencia para la version de un PAR (#74, PR3a), acotado a
 * UN refetch por version distinta observada. `spacesVersion` no es un push de
 * cambios de layout -- es el propio cliente reportando su hash (ver
 * `OfficeScene.applySpacesConfig`) -- asi que un par con una version distinta
 * es la unica senal de que hay algo nuevo que pedir. `Set`-backed: una vez
 * marcada obsoleta una version, DEJA de estarlo para siempre, sin importar
 * cuantos pares distintos la repitan despues (no es un refetch por par, es
 * uno por version).
 *
 * La version incorporada (`BUILT_IN_SPACES_VERSION`) nunca se marca obsoleta:
 * es lo que reporta quien no tiene nada mejor que ofrecer (503, red caida), y
 * pedirle `/spaces` a ese par no traeria una config mas nueva, solo repetiria
 * la misma llamada que ya fallo para el.
 */
export type StaleSpacesVersionPredicate = (peerVersion: string, myVersion: string) => boolean;

export function createStaleSpacesVersionTracker(): StaleSpacesVersionPredicate {
  const seen = new Set<string>();

  return function isStaleSpacesVersion(peerVersion, myVersion) {
    if (peerVersion === myVersion) return false;
    if (peerVersion === BUILT_IN_SPACES_VERSION) return false;
    if (seen.has(peerVersion)) return false;

    seen.add(peerVersion);
    return true;
  };
}

export interface FetchSpacesConfigOptions {
  url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Nunca lanza y nunca deja colgado al llamante: cualquier fallo -- red caida,
 * 503, JSON ilegible, forma inesperada, servidor que no contesta -- devuelve
 * `BUILT_IN_SPACES_CONFIG`.
 */
export async function fetchSpacesConfig({
  url,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FetchSpacesConfigOptions): Promise<SpacesConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return BUILT_IN_SPACES_CONFIG;
    return parseSpacesConfig(await response.json()) ?? BUILT_IN_SPACES_CONFIG;
  } catch {
    // Incluye el abort del plazo. No se distingue del resto a proposito: la
    // salida util es la misma y una rama mas seria una rama mas que leer.
    return BUILT_IN_SPACES_CONFIG;
  } finally {
    clearTimeout(timer);
  }
}
