/**
 * Emite tokens de LiveKit (PRD 6.3). Funcion pura, sin tipos de Express: el
 * adaptador HTTP vive en `createOfficeServer.ts`, para que esta pieza migre
 * sin cambios al futuro backend NestJS (PRD 6.1).
 *
 * El secreto nunca sale de aqui: entra por `config.apiSecret`, se usa para
 * firmar y no vuelve a aparecer en ningun valor devuelto.
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
