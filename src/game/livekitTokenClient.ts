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
}

export async function fetchLivekitToken(
  { tokenUrl, sessionId, token }: LivekitTokenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<LivekitTokenResponse> {
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // El token se omite en vez de viajar como `null`: sin sesion no hay nada
    // que probar, y un `null` explicito seria un intento de autenticacion con
    // un valor invalido (400) en vez de la ausencia que el servidor espera.
    body: JSON.stringify(token ? { sessionId, token } : { sessionId }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener el token de LiveKit (status ${response.status})`);
  }

  return (await response.json()) as LivekitTokenResponse;
}
