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

export async function fetchLivekitToken(
  tokenUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LivekitTokenResponse> {
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener el token de LiveKit (status ${response.status})`);
  }

  return (await response.json()) as LivekitTokenResponse;
}
