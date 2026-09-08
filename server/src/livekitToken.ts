/**
 * Emite tokens de LiveKit (PRD 6.3). Funcion pura, sin tipos de Express: el
 * adaptador HTTP vive en `createOfficeServer.ts`, para que esta pieza migre
 * sin cambios al futuro backend NestJS (PRD 6.1).
 *
 * El secreto nunca sale de aqui: entra por `config.apiSecret`, se usa para
 * firmar y no vuelve a aparecer en ningun valor devuelto.
 *
 * ## El limite exacto de la guarda de sesion (referida desde `liveSessions.ts`)
 *
 * El adaptador de `createOfficeServer.ts` solo emite token si el `sessionId`
 * esta en el registro de sesiones vivas. Eso es todo lo que comprueba.
 *
 * Lo que SI bloquea: ids inventados, ids caducados, y el replay despues de
 * que el cliente haga `leave()`.
 *
 * Lo que NO bloquea: el `sessionId` de cada participante es visible en el
 * estado de la sala, asi que cualquier cliente puede leer el de otro y pedir
 * un token en su nombre. Nada aqui demuestra la propiedad del WebSocket.
 *
 * **Esto NO es autenticacion.** Es una barrera contra el reclamo accidental
 * de identidad, no contra un atacante. La frontera de verdad llega con Google
 * OAuth (PRD 10), fuera de alcance en este cambio. No anotar esto como
 * "auth resuelta".
 */

import { AccessToken } from 'livekit-server-sdk';

export interface LivekitTokenConfig {
  apiKey: string;
  apiSecret: string;
  ttlSeconds?: number;
}

export interface OfficeTokenClaims {
  identity: string;
  room: string;
  permissions: {
    canPublish: boolean;
    canSubscribe: boolean;
    canPublishData: boolean;
  };
}

/** Igual al default del propio SDK; explicito para no depender de el en silencio. */
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

export async function mintOfficeToken(
  config: LivekitTokenConfig,
  claims: OfficeTokenClaims,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: claims.identity,
    ttl: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });

  token.addGrant({
    room: claims.room,
    roomJoin: true,
    canPublish: claims.permissions.canPublish,
    canSubscribe: claims.permissions.canSubscribe,
    canPublishData: claims.permissions.canPublishData,
  });

  // `toJwt()` devuelve una Promise: confirmado por ejecucion en el spike de
  // slice 1 (#327), no asumido de la documentacion (context7 no estaba
  // disponible en el momento del diseno).
  return token.toJwt();
}
