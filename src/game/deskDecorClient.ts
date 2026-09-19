/**
 * Adaptador HTTP del editor de decoracion (#7, slice 6). Unico modulo del
 * cliente que conoce `fetch` para `/assets` y `/me/desk`, igual que
 * `desksClient.ts` lo es de `/desks`. `fetch` se inyecta y el token se pide en
 * CADA peticion, por las mismas dos razones que documenta aquel: probar el
 * contrato entero sin Vite ni servidor, y no guardar una credencial que caduca
 * cada hora.
 *
 * La base es la misma raiz que la de los escritorios, asi que la derivacion no
 * se copia: se importa `deriveDesksBaseUrl`. Dos derivaciones separadas acaban
 * discrepando el dia que el despliegue cambie de esquema.
 *
 * ## Leer el catalogo degrada; leer el escritorio propio NO puede
 *
 * `fetchDeskCatalog` tiene contrato total: cualquier fallo devuelve
 * `NO_DESK_ASSETS` y el editor simplemente no tiene nada que ofrecer, que es
 * como se ve una oficina sin catalogo.
 *
 * `fetchMyDeskItems` no puede hacer lo mismo, y esta es LA decision de este
 * modulo: `POST /me/desk` reemplaza el escritorio ENTERO. Si una lectura
 * fallida se leyese como "no tienes nada", el primer guardado le borraria la
 * decoracion a quien si la tenia, sin que nadie hubiese pedido eso. Por eso
 * devuelve `null` -- "no se sabe" -- y quien lo recibe no ofrece guardar.
 *
 * `saveMyDesk` tampoco adivina: quien acaba de pulsar espera una respuesta, y
 * decirle "guardado" tras un 503 dejaria la pantalla contando una decoracion
 * que el servidor no tiene.
 */

import { DESK_ROTATIONS, NO_DESK_ASSETS } from './deskDecorPort';
import type {
  DeskAssetKind,
  DeskDecorAsset,
  DeskItemPlacement,
  DeskRotation,
  PlacedDeskItem,
  SaveDeskOutcome,
} from './deskDecorPort';

/** Plazo por defecto, el mismo que `desksClient`: un servidor colgado no deja la vista sin resolverse. */
const DEFAULT_TIMEOUT_MS = 3000;

/** Nueve cajas, de la 0 a la 8. El mismo `CHECK` que `decorRules.DESK_SLOT_MAX`. */
const SLOT_MIN = 0;
const SLOT_MAX = 8;

const ASSET_KINDS: readonly DeskAssetKind[] = ['furniture', 'decor', 'plant'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAssetKind(value: unknown): value is DeskAssetKind {
  return typeof value === 'string' && (ASSET_KINDS as readonly string[]).includes(value);
}

function isRotation(value: unknown): value is DeskRotation {
  return typeof value === 'number' && (DESK_ROTATIONS as readonly number[]).includes(value);
}

/**
 * Una fila de `/assets` a lo que el selector ofrece, `null` si no cumple la
 * forma, y `'not-placeable'` si la cumple pero esa pieza no va en un
 * escritorio.
 *
 * Los dos ultimos se distinguen a proposito: una fila rota significa que esta
 * no es la respuesta de este servidor y tumba la lectura entera; una pieza que
 * no admite escritorio es una fila perfectamente buena de un catalogo que
 * tambien amuebla otras cosas, y lo unico que toca es no ofrecerla.
 */
function toDeskAsset(raw: unknown): DeskDecorAsset | 'not-placeable' | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.name)) return null;
  if (!isAssetKind(row.kind)) return null;
  // Sin `textureKey` no hay sprite que dibujar: ofrecerla seria ofrecer algo
  // que nadie podria ver colocado.
  if (!isNonEmptyString(row.textureKey)) return null;
  // Ausente NO se da por `true`: el servidor lo rechazaria con un 400 y quien
  // coloca no sabria por que.
  if (typeof row.placeableOnDesk !== 'boolean') return null;

  if (!row.placeableOnDesk) return 'not-placeable';
  return { id: row.id, name: row.name, kind: row.kind, textureKey: row.textureKey };
}

/**
 * Valida la respuesta ENTERA o la rechaza entera, mismo criterio que
 * `parseOfficeDesks`: media lista es media verdad sobre lo que se puede
 * colocar, y una pieza que falta se lee igual que una que nunca existio.
 */
function parseDeskCatalog(payload: unknown): readonly DeskDecorAsset[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.assets)) return null;

  const assets: DeskDecorAsset[] = [];
  for (const raw of body.assets) {
    const asset = toDeskAsset(raw);
    if (asset === null) return null;
    if (asset === 'not-placeable') continue;
    assets.push(asset);
  }

  return assets;
}

/**
 * Una fila de `/me/desk` a una pieza colocada, o `null` si no cumple la forma.
 *
 * El `assetId` NO se cruza con el catalogo, y es deliberado: una pieza
 * retirada sigue puesta y se sirve con su textura resuelta (D1b). Descartarla
 * por no encontrarla entre lo ofrecible la borraria de la pantalla de su
 * dueno, y el siguiente guardado se la quitaria de verdad.
 */
function toPlacedItem(raw: unknown): PlacedDeskItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.assetId)) return null;
  if (!isNonEmptyString(row.textureKey) || !isNonEmptyString(row.name)) return null;
  // Un slot fuera del area no cabe en el escritorio, y una rotacion que el
  // servidor no acepta volveria como 400 en cuanto se guardase cualquier otra
  // cosa: lo que no se puede devolver tal cual no se puede editar.
  if (!isFiniteNumber(row.slot) || row.slot < SLOT_MIN || row.slot > SLOT_MAX) return null;
  if (!Number.isInteger(row.slot)) return null;
  if (!isRotation(row.rotation)) return null;

  return {
    id: row.id,
    assetId: row.assetId,
    slot: row.slot,
    rotation: row.rotation,
    textureKey: row.textureKey,
    name: row.name,
  };
}

function parseDeskItems(payload: unknown): readonly PlacedDeskItem[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.items)) return null;

  const items: PlacedDeskItem[] = [];
  for (const raw of body.items) {
    const item = toPlacedItem(raw);
    if (item === null) return null;
    items.push(item);
  }

  return items;
}

export interface DeskDecorRequestOptions {
  /** Ya resuelta con `deriveDesksBaseUrl`, sin barra final. */
  baseUrl: string;
  /** Se llama en CADA peticion y nunca se guarda: ver la cabecera. */
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Una peticion autenticada con plazo, o `null` si no llego a hacerse: sin
 * token, red caida o plazo agotado. Ninguno de los tres tiene una salida util
 * distinta de los demas, igual que en `desksClient`.
 */
async function authenticatedRequest(
  {
    baseUrl,
    getIdToken,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: DeskDecorRequestOptions,
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getIdToken();
    // Sin token el servidor solo puede contestar 401: salir aqui ahorra una
    // peticion cuya respuesta ya sabemos.
    if (token === null) return null;

    return await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    // Incluye el abort del plazo: la salida util es la misma.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lo que el selector puede ofrecer: el catalogo vivo, sin lo retirado (lo
 * filtra el servidor, D1b) y sin lo que no admite escritorio (lo filtra
 * `toDeskAsset`).
 *
 * Nunca lanza: cualquier fallo es `NO_DESK_ASSETS`, y sin nada que ofrecer no
 * hay editor que abrir.
 */
export async function fetchDeskCatalog(
  options: DeskDecorRequestOptions,
): Promise<readonly DeskDecorAsset[]> {
  const response = await authenticatedRequest(options, '/assets');
  if (response === null || !response.ok) return NO_DESK_ASSETS;

  try {
    return parseDeskCatalog(await response.json()) ?? NO_DESK_ASSETS;
  } catch {
    return NO_DESK_ASSETS;
  }
}

/**
 * La decoracion del escritorio PROPIO, o `null` cuando no se pudo leer.
 *
 * `null` no es una lista vacia y la diferencia no es de estilo: ver la
 * cabecera. Nunca lanza.
 */
export async function fetchMyDeskItems(
  options: DeskDecorRequestOptions,
): Promise<readonly PlacedDeskItem[] | null> {
  const response = await authenticatedRequest(options, '/me/desk');
  if (response === null || !response.ok) return null;

  try {
    return parseDeskItems(await response.json());
  } catch {
    return null;
  }
}

export interface SaveMyDeskOptions extends DeskDecorRequestOptions {
  /** El escritorio ENTERO: `POST /me/desk` borra e inserta, no parchea. */
  items: readonly DeskItemPlacement[];
}

/**
 * Guarda el escritorio propio entero. Sin `userId` en el cuerpo, y no por
 * olvido: el servidor no lo lee, y mandarlo sugeriria que si.
 */
export async function saveMyDesk({ items, ...options }: SaveMyDeskOptions): Promise<SaveDeskOutcome> {
  const response = await authenticatedRequest(options, '/me/desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (response === null) return 'failed';
  if (response.ok) return 'saved';
  // El 400 lo provoca lo que se mando -- una pieza retirada que se intento
  // anadir, un slot repetido -- y es lo unico que quien guarda puede corregir.
  return response.status === 400 ? 'rejected' : 'failed';
}
