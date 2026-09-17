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
 */

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
