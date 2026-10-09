/**
 * Resolucion de la configuracion de Firebase Auth en el cliente (#8), en el
 * mismo espiritu que `officeEndpoint.ts`: puro y sin `import.meta` dentro,
 * para poder probarlo sin montar Vite.
 *
 * `null` significa "sin autenticacion", y eso NO es un accidente: es el
 * interruptor de apagado. Una variable puesta a vacio es tan deliberada como
 * una puesta a un valor, y `.env.e2e` fija estas dos a vacio a proposito para
 * que el desarrollo local y la suite e2e sigan entrando a la oficina sin
 * pantalla de login, exactamente igual que antes de este cambio.
 *
 * La `apiKey` de Firebase no es un secreto: es un identificador publico del
 * proyecto y viaja en el bundle por diseno. Quien protege el acceso son las
 * cuentas y la verificacion del ID token en el servidor
 * (`server/src/verifyIdToken.ts`).
 *
 * `resolveAuthSelection` adds the local auth mode (`VITE_AUTH_MODE=local`,
 * local and test use only): accounts from the server's `LOCAL_AUTH_USERS`,
 * signed in through `POST /auth/local/sign-in` (`localAuthAdapter.ts`).
 */

import { deriveDisplayNameBaseUrl } from './displayNameClient';

export interface AuthConfigSources {
  /** `import.meta.env.VITE_FIREBASE_API_KEY`, si esta definida. */
  apiKey?: string;
  /** `import.meta.env.VITE_FIREBASE_PROJECT_ID`, si esta definida. */
  projectId?: string;
  /** `import.meta.env.VITE_FIREBASE_AUTH_DOMAIN`; se deduce si falta. */
  authDomain?: string;
}

export interface AuthConfig {
  apiKey: string;
  projectId: string;
  authDomain: string;
}

export function resolveAuthConfig({
  apiKey,
  projectId,
  authDomain,
}: AuthConfigSources): AuthConfig | null {
  const trimmedApiKey = apiKey?.trim();
  const trimmedProjectId = projectId?.trim();
  // Las dos son imprescindibles para hablar con Identity Platform: faltando
  // cualquiera, la unica alternativa honesta es no autenticar a nadie.
  if (!trimmedApiKey || !trimmedProjectId) return null;

  const trimmedAuthDomain = authDomain?.trim();
  return {
    apiKey: trimmedApiKey,
    projectId: trimmedProjectId,
    // El dominio que crea GCP al habilitar el proyecto; solo hace falta
    // configurarlo cuando se usa uno propio.
    authDomain: trimmedAuthDomain ? trimmedAuthDomain : `${trimmedProjectId}.firebaseapp.com`,
  };
}

export interface AuthSelectionSources extends AuthConfigSources {
  /** `import.meta.env.VITE_AUTH_MODE`: only `local` changes anything. */
  mode?: string;
  /** `resolveOfficeEndpoint`'s answer: `null` means multiplayer is off. */
  officeEndpoint: string | null;
}

export type AuthSelection =
  | { kind: 'firebase'; config: AuthConfig }
  | { kind: 'local'; baseUrl: string };

/**
 * Which `AuthPort` the SPA builds, or `null` for no auth. Any mode other than
 * `local` keeps the Firebase rule above exactly, so a deployed build that
 * never sets `VITE_AUTH_MODE` behaves as before. Local mode ignores the
 * Firebase variables (it never initializes the SDK), and without a server it
 * has nothing to sign in against, so it is "no auth", as with the server off.
 */
export function resolveAuthSelection({ mode, officeEndpoint, ...firebase }: AuthSelectionSources): AuthSelection | null {
  if (mode?.trim().toLowerCase() === 'local') {
    return officeEndpoint === null ? null : { kind: 'local', baseUrl: deriveDisplayNameBaseUrl(officeEndpoint) };
  }
  const config = resolveAuthConfig(firebase);
  return config === null ? null : { kind: 'firebase', config };
}
