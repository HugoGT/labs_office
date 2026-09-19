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
   * El UNICO 409 que estas rutas pueden dar. En escritorios es un solape de
   * coordenadas; el otro 409 del servidor (`desk-taken`) lo provoca alguien
   * cogiendo sitio desde la oficina y por estas rutas no puede llegar.
   */
  conflict: AdminErrorCode;
}

/**
 * Traduccion fija del contrato del servidor. Cualquier estado no listado es
 * `unknown` a proposito: inventarle un significado a un 500 haria que la
 * pantalla contase una historia que el servidor no conto.
 */
function codeForStatus(status: number, { notConfigured, conflict }: OfficeAdminRequestOptions) {
  switch (status) {
    case 400:
      return 'invalid-request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      return conflict;
    case 503:
      return notConfigured;
    default:
      return 'unknown';
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

    if (!response.ok) throw new AdminError(codeForStatus(response.status, options));

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
