/**
 * Configuracion de autenticacion del servidor (#8). Una sola variable de
 * entorno: el projectId de Firebase / GCP Identity Platform, que es lo unico
 * que hace falta para verificar un ID token (las claves publicas se descargan,
 * ver `verifyIdToken.ts`).
 *
 * Degrada igual que LiveKit en `createOfficeServer.ts`: sin credenciales, esa
 * ruta responde 503 en vez de reventar el arranque. Aqui el equivalente es
 * `null`, que significa "auth desactivada" y preserva exactamente el
 * comportamiento de hoy (nadie autentica, nadie queda fuera). Es lo que
 * permite seguir levantando el servidor en local sin un proyecto de Firebase.
 *
 * Eso NO es un default aceptable en un despliegue: un entorno desplegado DEBE
 * definir `FIREBASE_PROJECT_ID`. Sin el, `POST /livekit/token` vuelve a emitir
 * tokens para cualquier `sessionId` que el llamante sepa leer del estado de la
 * sala, que es justo el agujero que este cambio cierra. `/health` expone el
 * modo efectivo (`auth: 'enabled' | 'disabled'`) para poder comprobarlo desde
 * fuera sin adivinar.
 *
 * `resolveServerAuthConfig` below picks between that mode and the local one
 * (`localAuth/localAuthConfig.ts`); `resolveAuthConfig` stays the Firebase
 * half of it.
 */

import { AuthConfigError } from './authConfigError.ts';
import {
  resolveLocalAuthConfig,
  type LocalAuthConfig,
  type LocalAuthEnv,
} from './localAuth/localAuthConfig.ts';

export interface AuthConfig {
  projectId: string;
}

export function resolveAuthConfig(env: { FIREBASE_PROJECT_ID?: string }): AuthConfig | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) return null;
  return { projectId };
}

/**
 * The auth mode the server runs in: Firebase / Identity Platform, the local
 * env-based accounts of `localAuth/localAuthConfig.ts` (local and test use
 * only), or `null` for no auth at all.
 */
export type ServerAuthConfig =
  | ({ kind: 'firebase' } & AuthConfig)
  | ({ kind: 'local' } & LocalAuthConfig);

export type ServerAuthEnv = { FIREBASE_PROJECT_ID?: string } & LocalAuthEnv;

/**
 * Throws `AuthConfigError` when the variables cannot be honored, so the server
 * refuses to start. Firebase next to any local auth variable is one of those:
 * guessing which one was meant could open a deployed office to the local
 * accounts, and the deployed compose never passes the local ones anyway.
 */
export function resolveServerAuthConfig(env: ServerAuthEnv): ServerAuthConfig | null {
  const firebase = resolveAuthConfig(env);
  const localSet = Boolean(env.LOCAL_AUTH_USERS?.trim() || env.LOCAL_AUTH_SECRET?.trim());
  if (firebase !== null && localSet) {
    throw new AuthConfigError(
      'FIREBASE_PROJECT_ID and LOCAL_AUTH_USERS/LOCAL_AUTH_SECRET are mutually exclusive: unset one',
    );
  }
  if (firebase !== null) return { kind: 'firebase', ...firebase };

  const local = resolveLocalAuthConfig(env);
  return local === null ? null : { kind: 'local', ...local };
}
