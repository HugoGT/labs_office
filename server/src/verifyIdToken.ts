/**
 * Verificacion de ID tokens de Firebase / GCP Identity Platform (#8). Funcion
 * pura con dependencias inyectadas, sin tipos de Express ni de Colyseus: el
 * adaptador HTTP vive en `createOfficeServer.ts` y el hook de sala en
 * `OfficeRoom.ts`, igual que `livekitToken.ts` se mantiene aparte de su ruta.
 *
 * El contrato es el oficial de
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens :
 * algoritmo `RS256` y solo ese, `iss` igual a
 * `https://securetoken.google.com/<projectId>`, `aud` igual al projectId,
 * `exp` en el futuro, `iat` en el pasado, `auth_time` en el pasado cuando
 * viene, y `sub` un texto no vacio que es el uid.
 *
 * Se usa `jose` y no `firebase-admin`: lo unico que necesita el servidor es
 * verificar una firma contra un JWKS publico. `firebase-admin` arrastraria gRPC
 * y credenciales de servicio que este proceso no tiene ni debe tener.
 *
 * ## Por que `jose` no basta por si solo
 *
 * `jwtVerify` comprueba la firma, `iss`, `aud` y `exp`, pero NO comprueba que
 * `iat` este en el pasado (solo lo mira si se le pasa `maxTokenAge`) ni conoce
 * `auth_time`, que es un claim propio de Firebase. Esas dos van a mano abajo.
 *
 * ## Por que `verify` nunca dice por que AL CLIENTE
 *
 * Todo rechazo colapsa en `null` y la ruta responde siempre lo mismo: un
 * atacante que pudiese distinguir "caducado" de "firmado por otro proyecto" de
 * "firma invalida" tendria un oraculo para ir afinando el token forjado.
 *
 * El LOG del servidor es otra cosa: nadie de fuera lo lee, asi que callar ahi
 * no defiende de nada y cuesta caro. Si Google deja de responder al JWKS, todos
 * los tokens fallan a la vez y sin esta linea el sintoma seria "nadie puede
 * entrar" sin una sola pista. Se registra el NOMBRE del error, nunca su mensaje
 * ni el token: el nombre separa `JWKSTimeout` (la infraestructura) de
 * `JWTExpired` (un usuario normal con la pestana abierta de ayer), que es
 * exactamente la distincion que hace falta a las tres de la manana.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from './authConfig.ts';

/**
 * JWKS publico de Google para los ID tokens de Identity Platform. Formato JWK,
 * que es el unico que entiende `jose`; el endpoint hermano bajo `/x509/`
 * devuelve certificados PEM y no sirve aqui.
 */
export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface VerifiedIdentity {
  /** `sub` del token. Es el identificador estable del usuario en el proyecto. */
  uid: string;
  email: string | null;
  name: string | null;
}

export interface IdTokenVerifier {
  verify(token: unknown): Promise<VerifiedIdentity | null>;
}

/** Devuelve el claim solo si es texto; un claim viene firmado, no validado. */
function asText(claim: unknown): string | null {
  return typeof claim === 'string' && claim.length > 0 ? claim : null;
}

/**
 * Comprueba que una marca de tiempo del token no este en el futuro. Ausente
 * cuenta como valida (`auth_time` es opcional); presente pero no numerica no,
 * porque entonces no se puede afirmar nada sobre ella.
 */
function isNotInTheFuture(seconds: unknown, now: number, required: boolean): boolean {
  if (seconds === undefined) return !required;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds <= now;
}

/** Inyectable para que los tests afirmen sobre lo que se registra, sin ruido. */
export type VerifyFailureLogger = (errorName: string) => void;

export function createIdTokenVerifier(
  config: AuthConfig,
  keys?: JWTVerifyGetKey,
  logFailure: VerifyFailureLogger = (errorName) =>
    console.warn(`[auth] ID token rechazado: ${errorName}`),
): IdTokenVerifier {
  /**
   * `createRemoteJWKSet` se construye una sola vez por verificador: mantiene su
   * propia cache de claves (10 minutos por defecto en jose 6, con un enfriado
   * de 30 s antes de reintentar por un `kid` desconocido). No honra el
   * `Cache-Control` que manda Google, usa sus propios plazos; para este uso da
   * igual, porque Google rota las claves cada pocos dias y un `kid` nuevo
   * dispara la recarga. Construirlo por peticion si seria un problema: cada
   * token pagaria una descarga.
   *
   * Se inyecta en tests para firmar con un par local y no tocar la red.
   */
  const resolveKey = keys ?? createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  const issuer = `https://securetoken.google.com/${config.projectId}`;

  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length === 0) return null;

      try {
        const { payload } = await jwtVerify(token, resolveKey, {
          // Lista blanca, no lista negra: sin ella `jose` aceptaria cualquier
          // algoritmo que la clave resuelta soporte, y el JWKS de Google es
          // publico, asi que un HMAC con el modulo RSA como secreto pasaria.
          algorithms: ['RS256'],
          issuer,
          audience: config.projectId,
        });

        const now = Math.floor(Date.now() / 1000);
        if (!isNotInTheFuture(payload.iat, now, true)) return null;
        if (!isNotInTheFuture(payload.auth_time, now, false)) return null;

        const uid = asText(payload.sub);
        if (uid === null) return null;

        return { uid, email: asText(payload.email), name: asText(payload.name) };
      } catch (error) {
        // El llamante sigue recibiendo `null` pase lo que pase (ver cabecera);
        // lo unico que cambia es que el operador se entera. Solo el nombre:
        // `error.message` de `jose` si detalla claims y no tiene por que
        // acabar en un agregador de logs de terceros.
        logFailure(error instanceof Error ? error.name : 'UnknownError');
        return null;
      }
    },
  };
}
