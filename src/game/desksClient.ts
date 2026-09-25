/**
 * Adaptador HTTP de los escritorios asignables (#7, slice 5). Unico modulo del
 * cliente que conoce `fetch` para estas rutas, igual que `adminClient.ts` lo es
 * del panel. `fetch` se inyecta, como en `spacesConfig.ts` y
 * `livekitTokenClient.ts`: nada de `import.meta` aqui dentro, para poder
 * probar el contrato entero sin montar Vite ni levantar servidor.
 *
 * ## La lectura no lanza; las escrituras no adivinan
 *
 * `fetchOfficeDesks` tiene contrato TOTAL: cualquier fallo -- red caida, 401,
 * 503 sin directorio, JSON ilegible, forma inesperada, servidor que no
 * contesta -- devuelve `NO_DESKS`, y la oficina se dibuja sin escritorios
 * asignables, que es exactamente como se veia antes de esta slice.
 *
 * `claimDesk` y `releaseDesk` NO pueden degradar igual: quien acaba de hacer
 * clic esta esperando una respuesta, y decirle "hecho" cuando el servidor dijo
 * 409 dejaria el escritorio pintado como suyo sin serlo. Por eso devuelven un
 * resultado discriminado en vez de tragarse el estado.
 *
 * ## El token se pide en CADA peticion
 *
 * Nunca se guarda: el ID token caduca cada hora (misma razon que documenta
 * `adminClient.ts`), y una copia dejaria de valer a mitad de sesion sin que
 * nada avisase.
 */

import {
  NO_DESKS,
  type DeskClaimOutcome,
  type DeskDecorItem,
  type DeskOccupant,
  type DeskReleaseOutcome,
  type OfficeDesk,
} from './desksPort';
import { TILE } from './mapData';

/** Plazo por defecto. Un servidor colgado no puede dejar la vista sin resolverse. */
const DEFAULT_TIMEOUT_MS = 3000;

/** Nueve cajas, de la 0 a la 8. El mismo `CHECK` que `decorRules.DESK_SLOT_MAX`. */
const SLOT_MIN = 0;
const SLOT_MAX = 8;

/**
 * Las rutas de escritorio cuelgan de la RAIZ (`/desks`, `/desks/:id/claim`,
 * `/me/desk/release`) y no de un prefijo propio como `/admin`, asi que la base
 * es la raiz y cada camino se cuelga aqui dentro. La derivacion es la misma
 * que `deriveSpacesUrl` y `resolveAdminBaseUrl`: el mismo `http.Server` sirve
 * WebSocket y HTTP, asi que basta con cambiar de esquema.
 */
export function deriveDesksBaseUrl(officeEndpoint: string): string {
  return officeEndpoint.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function toDecorItem(raw: unknown): DeskDecorItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.textureKey)) return null;
  // Un slot fuera del area no cabe en el escritorio: pintarlo dejaria la pieza
  // flotando fuera de su sitio o encima de la caja de al lado.
  if (!isFiniteNumber(row.slot) || row.slot < SLOT_MIN || row.slot > SLOT_MAX) return null;
  if (!isFiniteNumber(row.rotation)) return null;

  return {
    id: row.id,
    slot: row.slot,
    rotation: row.rotation,
    textureKey: row.textureKey,
    // Only a render layer (#71): anything but `true` (an older server that
    // does not send it, a malformed value) degrades to a normal piece instead
    // of discarding the whole list like a bad slot does.
    aboveAvatars: row.aboveAvatars === true,
  };
}

function toOccupant(raw: unknown): DeskOccupant | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id)) return null;
  if (row.displayName !== null && typeof row.displayName !== 'string') return null;
  if (!Array.isArray(row.items)) return null;

  const items: DeskDecorItem[] = [];
  for (const rawItem of row.items) {
    const item = toDecorItem(rawItem);
    if (item === null) return null;
    items.push(item);
  }

  return { id: row.id, displayName: row.displayName, items };
}

/**
 * Una fila servida a un `OfficeDesk`, o `null` si no cumple la forma. Aqui es
 * donde se convierten las unidades: el servidor guarda TILES y la escena
 * trabaja en PIXELES, igual que en `spacesConfig.toSpaceArea`.
 */
function toOfficeDesk(raw: unknown): OfficeDesk | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  // Sin `id` no se puede pedir el sitio, y sin `label` no se puede nombrar en
  // el mapa lo que se esta pidiendo.
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.label)) return null;
  if (!isFiniteNumber(row.x) || !isFiniteNumber(row.y)) return null;
  if (!isFiniteNumber(row.w) || !isFiniteNumber(row.h)) return null;
  // Ausente NO se da por `false`: quien mira se quedaria sin su propio
  // escritorio y sin saber por que, que es la degradacion silenciosa que este
  // campo existe para quitar de en medio. Y no se deduce del nombre del
  // ocupante -- ver `desksPort.OfficeDesk.mine`.
  if (typeof row.mine !== 'boolean') return null;

  // `undefined` no vale: un escritorio libre llega con `occupant: null`
  // explicito, y una respuesta a la que le falta el campo no es la de este
  // servidor.
  const occupant = row.occupant === null ? null : toOccupant(row.occupant);
  if (row.occupant !== null && occupant === null) return null;

  return {
    id: row.id,
    label: row.label,
    x: row.x * TILE,
    y: row.y * TILE,
    w: row.w * TILE,
    h: row.h * TILE,
    occupant,
    mine: row.mine,
  };
}

/**
 * Valida la respuesta ENTERA o la rechaza entera, mismo criterio que
 * `parseSpacesConfig` y por una razon propia: un directorio que solo se puede
 * leer a medias es media verdad sobre quien se sienta donde. Quedarse con las
 * filas buenas pintaria sitio libre justo encima de un escritorio que el
 * servidor SI tiene, y ese escritorio no seria clicable porque su id nunca
 * llego. La degradacion segura ya existe y conviene que sea una sola: no
 * dibujar ninguno.
 */
function parseOfficeDesks(payload: unknown): readonly OfficeDesk[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;

  if (!Array.isArray(body.desks)) return null;

  const desks: OfficeDesk[] = [];
  for (const raw of body.desks) {
    const desk = toOfficeDesk(raw);
    if (desk === null) return null;
    desks.push(desk);
  }

  return desks;
}

export interface DesksRequestOptions {
  /** Ya resuelta con `deriveDesksBaseUrl`, sin barra final. */
  baseUrl: string;
  /** Se llama en CADA peticion y nunca se guarda: ver la cabecera. */
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Una peticion autenticada con plazo, o `null` si no llego a hacerse. `null`
 * cubre los tres casos que no distinguen a quien llama: sin token, red caida y
 * plazo agotado. Ninguno tiene una salida util distinta de los demas.
 */
async function authenticatedRequest(
  { baseUrl, getIdToken, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: DesksRequestOptions,
  path: string,
  method: 'GET' | 'POST',
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getIdToken();
    // Sin token el servidor solo puede contestar 401: salir aqui ahorra una
    // peticion cuya respuesta ya sabemos.
    if (token === null) return null;

    return await fetchImpl(`${baseUrl}${path}`, {
      method,
      // Sin cuerpo, y no por olvido: ni `claim` ni `release` lo leen. El
      // ocupante es siempre la identidad verificada de quien llama.
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    // Incluye el abort del plazo. No se distingue del resto a proposito: la
    // salida util es la misma y una rama mas seria una rama mas que leer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Todo lo que hace falta para dibujar los escritorios asignables, en UNA
 * llamada: cada escritorio, su ocupante y la decoracion de ese ocupante. El
 * servidor lo sirve junto a proposito -- partirlo obligaria a cruzar tres
 * listas que pueden llegar desfasadas.
 *
 * Nunca lanza: ver la cabecera.
 */
export async function fetchOfficeDesks(
  options: DesksRequestOptions,
): Promise<readonly OfficeDesk[]> {
  const response = await authenticatedRequest(options, '/desks', 'GET');
  if (response === null || !response.ok) return NO_DESKS;

  try {
    return parseOfficeDesks(await response.json()) ?? NO_DESKS;
  } catch {
    return NO_DESKS;
  }
}

export interface ClaimDeskOptions extends DesksRequestOptions {
  deskId: string;
}

/**
 * Coge un escritorio libre. `taken` es la salida que importa: el servidor
 * resuelve la carrera con un UPDATE condicional, asi que "esta libre" no se
 * puede saber leyendo antes -- solo pidiendolo.
 */
export async function claimDesk({
  deskId,
  ...options
}: ClaimDeskOptions): Promise<DeskClaimOutcome> {
  // `encodeURIComponent` y no interpolacion cruda: un id con barra inventaria
  // un segmento de ruta que el servidor no tiene.
  const path = `/desks/${encodeURIComponent(deskId)}/claim`;
  const response = await authenticatedRequest(options, path, 'POST');
  if (response === null) return 'failed';
  if (response.ok) return 'claimed';
  // El otro 409 del servidor (`desk-overlap`) lo provoca mover un escritorio
  // desde el panel, no pedirlo: por esta ruta no puede llegar.
  return response.status === 409 ? 'taken' : 'failed';
}

/** Suelta el escritorio PROPIO. Sin id: un id ajeno bastaria para echar a alguien de su sitio. */
export async function releaseDesk(options: DesksRequestOptions): Promise<DeskReleaseOutcome> {
  const response = await authenticatedRequest(options, '/me/desk/release', 'POST');
  return response !== null && response.ok ? 'released' : 'failed';
}
