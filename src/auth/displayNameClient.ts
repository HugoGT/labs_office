/**
 * Adaptador HTTP de `POST/GET /me/display-name` (#100). Unico modulo del
 * cliente que conoce `fetch` para esta ruta, igual que `desksClient.ts` lo es
 * para escritorios. `fetch` se inyecta para probar el contrato entero sin
 * montar Vite ni levantar servidor.
 *
 * ## Por que `claim` nunca lanza
 *
 * Quien acaba de escribir su nombre en el formulario esta esperando una
 * respuesta concreta -- taken, invalid, o que se guardo --, no una excepcion
 * que alguien arriba tenga que capturar. El outcome discriminado de
 * `displayNamePort.ts` es la forma de decirlo sin perder ningun caso: red
 * caida, 401, 503 y "otra cosa" caen todos en `failed`, que es la unica salida
 * que no distingue nada mas util para quien mira el formulario.
 */

import type { ClaimDisplayNameResult, DisplayNamePort, ReadDisplayNameResult } from './displayNamePort';

/** Plazo por defecto, mismo valor que `desksClient.ts`: un servidor colgado no puede dejar la vista sin resolverse. */
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * La ruta cuelga de la RAIZ (`/me/display-name`), no de `/admin`: la misma
 * derivacion que `desksClient.deriveDesksBaseUrl`, repetida aqui y no
 * importada de alli para no meter el chunk de la oficina en el bundle que se
 * carga ANTES de entrar (`AuthGate` corre antes de que `OfficeShell` exista).
 */
export function deriveDisplayNameBaseUrl(officeEndpoint: string): string {
  return officeEndpoint.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

export interface DisplayNameClientOptions {
  /** Ya resuelta con `deriveDisplayNameBaseUrl`, sin barra final. */
  baseUrl: string;
  /** Se llama en CADA peticion y nunca se guarda: el ID token caduca cada hora. */
  getIdToken: () => Promise<string | null>;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createDisplayNameClient(
  { baseUrl, getIdToken, timeoutMs = DEFAULT_TIMEOUT_MS }: DisplayNameClientOptions,
  fetchImpl: typeof fetch = fetch,
): DisplayNamePort {
  /** `null` cuando no llego a hacerse: sin token, red caida o plazo agotado. */
  async function request(method: 'GET' | 'POST', body?: unknown): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = await getIdToken();
      if (token === null) return null;

      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      return await fetchImpl(`${baseUrl}/me/display-name`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async claim(name): Promise<ClaimDisplayNameResult> {
      const response = await request('POST', { name });
      if (response === null) return { outcome: 'failed' };
      if (response.status === 409) return { outcome: 'taken' };
      if (response.status === 400) return { outcome: 'invalid' };
      if (response.status === 503) return { outcome: 'unavailable' };
      if (!response.ok) return { outcome: 'failed' };

      try {
        const body: unknown = await response.json();
        if (!isRecord(body) || typeof body.displayName !== 'string') return { outcome: 'failed' };
        return { outcome: 'ok', displayName: body.displayName };
      } catch {
        return { outcome: 'failed' };
      }
    },

    async read(): Promise<ReadDisplayNameResult> {
      const response = await request('GET');
      if (response === null) return { outcome: 'failed' };
      if (response.status === 503) return { outcome: 'unavailable' };
      if (!response.ok) return { outcome: 'failed' };

      try {
        const body: unknown = await response.json();
        if (!isRecord(body) || (body.displayName !== null && typeof body.displayName !== 'string')) {
          return { outcome: 'failed' };
        }
        return { outcome: 'ok', displayName: (body.displayName as string | null) ?? null };
      } catch {
        return { outcome: 'failed' };
      }
    },
  };
}
