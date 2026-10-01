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
 * On top of that contract the office caps a session (#128): `auth_time` must be
 * present and at most `MAX_SESSION_AGE_DAYS` old, or the answer is
 * `SESSION_EXPIRED`. See `verify` below for why that one rejection does have a
 * name.
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
 * Todo rechazo colapsa en `null` (except `SESSION_EXPIRED`, which only a
 * validly signed token can earn) y la ruta responde siempre lo mismo: un
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

/**
 * Longest a browser session lives since the last email and password login
 * (#128). Firebase keeps a session forever and refreshes its ID token on its
 * own; the directory (`expires_at` NULL for employees and admins) is about
 * whether the account may enter, not about how old this browser's login is,
 * and stays as it is. Guests notice nothing: an invitation already lasts at
 * most `MAX_INVITATION_DAYS`, the same 90.
 */
export const MAX_SESSION_AGE_DAYS = 90;

const MAX_SESSION_AGE_SECONDS = MAX_SESSION_AGE_DAYS * 24 * 60 * 60;

/**
 * The one rejection `verify` names (#128): a validly signed token whose login
 * is too old. The client has to tell it apart to sign out and ask for email
 * and password again; a plain `null` would have it retry the same token.
 */
export const SESSION_EXPIRED = 'session-expired';

export type SessionExpired = typeof SESSION_EXPIRED;

/**
 * How every HTTP route says it (#128): the same `error` as any other 401, so a
 * client that only reads `error` behaves as before, plus the reason the
 * entrance and the dashboard read to send the person back to the login.
 */
export const SESSION_EXPIRED_BODY = { error: 'unauthorized', reason: SESSION_EXPIRED } as const;

export interface VerifiedIdentity {
  /** `sub` del token. Es el identificador estable del usuario en el proyecto. */
  uid: string;
  email: string | null;
  name: string | null;
}

export interface IdTokenVerifier {
  verify(token: unknown): Promise<VerifiedIdentity | SessionExpired | null>;
}

/** Devuelve el claim solo si es texto; un claim viene firmado, no validado. */
function asText(claim: unknown): string | null {
  return typeof claim === 'string' && claim.length > 0 ? claim : null;
}

/**
 * Comprueba que una marca de tiempo del token no este en el futuro. Ausente
 * cuenta como valida aqui (`auth_time` es opcional en el contrato de Firebase,
 * and its absence is the session age check's to refuse); presente pero no
 * numerica no, porque entonces no se puede afirmar nada sobre ella.
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

        // Only now, with signature and claims checked, may a rejection have a
        // name: whoever gets `session-expired` holds a token Google signed for
        // this project, so it tells a forger nothing (see the header). A token
        // without `auth_time` is refused the same way, failing closed: its age
        // cannot be asserted, and the remedy, one more login, yields a token
        // that carries the claim. Firebase keeps `auth_time` across ID token
        // refreshes, which is what makes it the age of the login.
        const authTime = payload.auth_time;
        if (typeof authTime !== 'number' || now - authTime > MAX_SESSION_AGE_SECONDS) {
          logFailure('SessionExpired');
          return SESSION_EXPIRED;
        }

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
