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
 */

export interface AuthConfig {
  projectId: string;
}

export function resolveAuthConfig(env: { FIREBASE_PROJECT_ID?: string }): AuthConfig | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) return null;
  return { projectId };
}
