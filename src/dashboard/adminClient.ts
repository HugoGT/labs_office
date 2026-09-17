/**
 * Adaptador HTTP del puerto de administracion (#24). Unico modulo del panel
 * que conoce `fetch`, igual que `firebaseAuthAdapter.ts` es el unico que
 * conoce firebase. `fetch` se inyecta, como en `livekitTokenClient.ts`, para
 * probar el contrato entero sin red.
 */

import {
  AdminError,
  type AdminErrorCode,
  type AdminPort,
  type AdminSession,
  type CreatedInvitation,
  type Invitation,
} from './adminPort';

export interface AdminBaseUrlSources {
  /** El endpoint de Colyseus ya resuelto (`resolveOfficeEndpoint`). */
  officeEndpoint?: string | null;
}

/**
 * Misma derivacion que `resolveLivekitConfig`: el panel vive en el mismo
 * `http.Server` que la sala, asi que basta con cambiar de esquema y colgar el
 * prefijo. Puro y sin `import.meta` dentro, para probarlo sin montar Vite.
 *
 * `null` cuando no hay servidor: sin el no hay invitaciones que administrar,
 * y una URL inventada solo produciria un fallo de red confuso.
 */
export function resolveAdminBaseUrl({ officeEndpoint }: AdminBaseUrlSources): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;

  const httpBase = officeEndpoint
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
  return `${httpBase}/admin`;
}

export interface AdminClientOptions {
  /** Ya resuelto con `resolveAdminBaseUrl`, sin barra final. */
  baseUrl: string;
  /**
   * Se llama en CADA peticion y nunca se guarda el resultado: el ID token
   * caduca cada hora (mismo motivo que documenta `AuthGate`), y una copia
   * dejaria de valer a mitad de una sesion del panel sin que nada avisase.
   */
  getIdToken: () => Promise<string | null>;
}

/**
 * Traduccion fija del contrato del servidor. Cualquier estado no listado es
 * `unknown` a proposito: inventarle un significado a un 500 haria que la
 * pantalla contase una historia que el servidor no conto.
 */
function codeForStatus(status: number): AdminErrorCode {
  switch (status) {
    case 400:
      return 'invalid-request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 409:
      return 'conflict';
    case 503:
      return 'identity-admin-not-configured';
    default:
      return 'unknown';
  }
}

export function createAdminClient(
  { baseUrl, getIdToken }: AdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): AdminPort {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getIdToken();
    // Sin token no hay nada que probar: salir aqui evita una peticion que el
    // servidor solo puede rechazar, y deja el mismo motivo que daria el 401.
    if (token === null) throw new AdminError('unauthorized');

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
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

    if (!response.ok) throw new AdminError(codeForStatus(response.status));

    try {
      return (await response.json()) as T;
    } catch {
      // Un 200 que no es JSON es el sintoma exacto de #24 punto 3: una ruta
      // `/admin/...` sin bloque propio en el proxy devuelve el index.html del
      // SPA. Tragarlo dejaria la tabla vacia y sin explicacion.
      throw new AdminError('unknown');
    }
  }

  function jsonBody(body: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  return {
    session(): Promise<AdminSession> {
      return request<AdminSession>('/session');
    },

    async listInvitations(): Promise<Invitation[]> {
      // El servidor envuelve la lista en un objeto (contrato fijo); el puerto
      // promete el array, asi que el desempaquetado vive aqui y no en la
      // pantalla.
      const { invitations } = await request<{ invitations: Invitation[] }>('/invitations');
      return invitations;
    },

    createInvitation(email: string, days: number): Promise<CreatedInvitation> {
      return request<CreatedInvitation>('/invitations', jsonBody({ email, days }));
    },

    async revoke(id: string): Promise<void> {
      // `encodeURIComponent` y no interpolacion cruda: un id con barra
      // inventaria un segmento de ruta que el servidor no tiene.
      await request<{ id: string; status: 'revoked' }>(
        `/invitations/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
      );
    },
  };
}
