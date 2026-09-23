/**
 * Cliente HTTP para `POST /livekit/token` (`server/src/createOfficeServer.ts`,
 * D5). `fetch` se inyecta, igual que `connect` en `officeRoomClient.ts`, para
 * poder probar las cuatro ramas del contrato sin red real.
 *
 * No traga errores: un 403/503 rechaza (`response.ok === false`), y quien
 * llama decide como degradar. Tragarlo aqui escondería el 503 "LiveKit no
 * configurado", que es el estado normal de un desarrollador sin el stack de
 * Docker levantado.
 */

export interface LivekitTokenResponse {
  token: string;
  url: string;
  identity: string;
  room: string;
}

/**
 * Peticion agrupada en un objeto y no en parametros sueltos (#8): el ID token
 * entro como tercer dato de la peticion, y una lista posicional que mezcla
 * datos con el `fetch` inyectado se lee mal y se equivoca facil.
 */
export interface LivekitTokenRequest {
  tokenUrl: string;
  /** La sesion de Colyseus; sigue siendo la `identity` que devuelve el servidor. */
  sessionId: string;
  /**
   * ID token de quien pide (#8). Ausente o nulo cuando no hay autenticacion
   * configurada: el servidor lo trata como el modo abierto de siempre.
   */
  token?: string | null;
  /** Espacio que se reclama (#10, #12). Ausente o `null` pide el corredor de siempre, sin el chequeo de contencion del servidor (D5) -- mismo criterio que `token`. */
  spaceId?: string | null;
}

/** Rechazo tipado de `fetchLivekitToken` (diseno sec.6): `status`/`code` dejan reaccionar (reintentar 403 `forbidden-space`, degradar en otro caso) sin parsear un `Error` generico. */
export class LivekitTokenError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`No se pudo obtener el token de LiveKit (status ${status}, ${code})`);
    this.name = 'LivekitTokenError';
    this.status = status;
    this.code = code;
  }
}

/** Codigo de error del cuerpo de una respuesta no-ok, o `'unknown'` si no se pudo leer. */
async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function fetchLivekitToken(
  { tokenUrl, sessionId, token, spaceId }: LivekitTokenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<LivekitTokenResponse> {
  // `token`/`spaceId` se omiten en vez de viajar como `null`: la ausencia es
  // el modo abierto/corredor que el servidor espera, no un valor a validar.
  const body: { sessionId: string; token?: string; spaceId?: string } = { sessionId };
  if (token) body.token = token;
  if (spaceId !== undefined && spaceId !== null) body.spaceId = spaceId;

  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new LivekitTokenError(response.status, await errorCodeOf(response));
  }

  return (await response.json()) as LivekitTokenResponse;
}
