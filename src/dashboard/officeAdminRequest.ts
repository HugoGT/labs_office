/**
 * La peticion autenticada que comparten los adaptadores de escritorios y de
 * catalogo (#7, slice 5). Es la misma que `adminClient.ts` hace para las
 * invitaciones, extraida para no tenerla tres veces: dos copias del manejo de
 * errores acaban divergiendo, y el dia que pase un mismo 401 dejaria de
 * significar lo mismo segun que panel lo recibiese.
 *
 * `adminClient.ts` NO la usa, y no por olvido: su contrato traduce el 404 a
 * `unknown` a proposito. Alli un 404 no es un id que ya no existe -- ninguna
 * ruta de invitaciones tiene ese caso -- sino una ruta de `/admin` que el
 * proxy no supo enrutar, que es un fallo de despliegue y no del dato. Forzar
 * las dos superficies al mismo mapa cambiaria esa frase por una mentira.
 *
 * `fetch` se inyecta, como en `adminClient.ts` y `game/desksClient.ts`: nada
 * de `import.meta` aqui dentro, para probar el contrato entero sin red.
 */

import { AdminError, type AdminErrorCode } from './adminPort';

export interface OfficeAdminRequestOptions {
  /**
   * La RAIZ del servidor de la oficina (`resolveOfficeApiBaseUrl`), sin barra
   * final y SIN `/admin`: cada camino se escribe entero en el sitio de la
   * llamada, porque `/desks` y `/admin/desks` son dos superficies con dos
   * guardas distintas y conviene que se lea.
   */
  baseUrl: string;
  /**
   * Se llama en CADA peticion y nunca se guarda el resultado: el ID token
   * caduca cada hora (mismo motivo que documenta `AuthGate`), y una copia
   * dejaria de valer a mitad de una sesion del panel sin que nada avisase.
   */
  getIdToken: () => Promise<string | null>;
  /**
   * El UNICO 503 que estas rutas pueden dar, que es distinto por superficie:
   * los escritorios dicen `desks-not-configured` y el catalogo
   * `decor-not-configured`. Lo decide el cableado del servidor antes de
   * mirar el camino (ver `desksRoute`/`decorRoute` en `createOfficeServer.ts`),
   * asi que no hace falta leer el cuerpo para saber cual es.
   */
  notConfigured: AdminErrorCode;
  /**
   * Los 409 que estas rutas pueden dar (issue #10, S2 3.5: antes era uno
   * solo). El cuerpo del 409 trae `{error: AdminErrorCode}`; se lee y se usa
   * SOLO si esta en esta lista -- un codigo ajeno a esta ruta, o un cuerpo
   * que no se puede leer, cae al primero de la lista (D-diseno seccion 7).
   */
  conflicts: readonly AdminErrorCode[];
}

/**
 * Traduccion fija del contrato del servidor. Cualquier estado no listado es
 * `unknown` a proposito: inventarle un significado a un 500 haria que la
 * pantalla contase una historia que el servidor no conto.
 *
 * El 409 es el unico que necesita el CUERPO de la respuesta, no solo el
 * estado: la misma ruta puede dar mas de un motivo (issue #10, S2 3.5), y
 * solo el servidor sabe cual de los declarados en `conflicts` es este.
 */
/** The 400s about appearance (art migration, step 7), keyed by the server's body. */
const APPEARANCE_REASONS: Readonly<Record<string, AdminErrorCode>> = {
  'unknown-piece': 'appearance-unknown-piece',
  'retired-piece': 'appearance-retired-piece',
  'color-not-allowed': 'appearance-color-not-allowed',
  'invalid-color': 'appearance-invalid-color',
};

/** The 400s of an art upload (#121), passed through with the file or field the body names. */
const UPLOAD_REFUSALS: ReadonlySet<string> = new Set<AdminErrorCode>([
  'not-png',
  'invalid-png',
  'unsupported-png',
  'invalid-dimensions',
  'too-many-colors',
  'not-opaque',
  'background-present',
  'too-large',
  'invalid-metadata',
  'missing-file',
]);

/**
 * A 400 is `invalid-request` unless its body names an appearance or upload
 * refusal: those are fixed by picking another material or color, or another
 * file, not by retyping the coordinates. An unreadable body or an unknown
 * reason keeps the generic code.
 */
async function errorForInvalidRequest(response: Response): Promise<AdminError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new AdminError('invalid-request');
  }
  if (typeof body !== 'object' || body === null) return new AdminError('invalid-request');
  const { error, reason, field } = body as Record<string, unknown>;
  if (error === 'appearance-immutable') return new AdminError('appearance-immutable');
  if (error === 'invalid-appearance' && typeof reason === 'string') {
    return new AdminError(APPEARANCE_REASONS[reason] ?? 'invalid-request');
  }
  if (typeof error === 'string' && UPLOAD_REFUSALS.has(error)) {
    return new AdminError(error as AdminErrorCode, typeof field === 'string' ? field : null);
  }
  return new AdminError('invalid-request');
}

async function errorForStatus(
  response: Response,
  { notConfigured, conflicts }: OfficeAdminRequestOptions,
): Promise<AdminError> {
  switch (response.status) {
    case 400:
      return errorForInvalidRequest(response);
    case 401:
      return new AdminError('unauthorized');
    case 403:
      return new AdminError('forbidden');
    case 404:
      return new AdminError('not-found');
    case 409: {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return new AdminError(conflicts[0]);
      }
      const error =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>).error : undefined;
      return new AdminError(
        typeof error === 'string' && (conflicts as readonly string[]).includes(error)
          ? (error as AdminErrorCode)
          : conflicts[0],
      );
    }
    // Only the upload route accepts a body big enough to hit the limit (#121).
    case 413:
      return new AdminError('too-large');
    case 503:
      return new AdminError(notConfigured);
    default:
      return new AdminError('unknown');
  }
}

export interface OfficeAdminRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createOfficeAdminRequest(
  options: OfficeAdminRequestOptions,
  fetchImpl: typeof fetch = fetch,
): OfficeAdminRequest {
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await options.getIdToken();
    // Sin token no hay nada que probar: salir aqui evita una peticion que el
    // servidor solo puede rechazar, y deja el mismo motivo que daria el 401.
    if (token === null) throw new AdminError('unauthorized');

    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // El servidor caido y el servidor que rechaza son problemas distintos y
      // se arreglan distinto; el panel los cuenta por separado.
      throw new AdminError('network');
    }

    if (!response.ok) throw await errorForStatus(response, options);

    try {
      return (await response.json()) as T;
    } catch {
      // Un 200 que no es JSON es el sintoma de una ruta sin bloque propio en
      // el proxy: devuelve el index.html del SPA. Tragarlo dejaria la tabla
      // vacia y sin explicacion.
      throw new AdminError('unknown');
    }
  };
}

/** Cuerpo JSON de una escritura. Las cuatro van por POST: ver `deskAdminClient.ts`. */
export function jsonBody(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
