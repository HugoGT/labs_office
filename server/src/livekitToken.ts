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
 * El adaptador de `createOfficeServer.ts` emite token si el `sessionId` esta en
 * el registro de sesiones vivas y, cuando la auth esta activa, si ademas el
 * cuerpo trae un ID token verificado cuyo uid es el que `OfficeRoom.onAuth`
 * ligo a ese `sessionId` al entrar (#8).
 *
 * Lo que SI bloquea con la auth activa: ids inventados, ids caducados, el
 * replay despues de `leave()`, y -- esto es lo nuevo -- que un participante lea
 * el `sessionId` de otro en el estado de la sala y pida un token en su nombre.
 * Eso ahora responde 403 `forbidden-session` aunque quien pregunte tenga un
 * token perfectamente valido: la guarda es de propiedad, no solo de identidad.
 *
 * Lo que sigue SIN estar resuelto, incluso con la auth activa:
 *
 * - Una misma persona con dos pestanas tiene dos sesiones y el mismo uid, asi
 *   que puede pedir el token de cualquiera de sus dos sesiones. No es un
 *   agujero de suplantacion, pero tampoco es aislamiento por conexion.
 * - No hay roles ni permisos: todo el que entra recibe los mismos grants de
 *   LiveKit. Quien puede publicar audio en que sitio es la issue #7.
 * - No hay invitaciones: basta con tener cuenta en el proyecto de Identity
 *   Platform, y hoy esas cuentas las crea un administrador a mano (issue #7).
 * - El CORS de `createOfficeServer.ts` sigue abierto en `*` (issue #9).
 *
 * Y lo que desaparece del todo si no hay `FIREBASE_PROJECT_ID`: sin config no
 * hay verificador, la guarda vuelve a ser solo "la sesion esta viva", y todo lo
 * de arriba deja de aplicar. Ver `authConfig.ts`.
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
