/**
 * Puerto de autenticacion (#8). Describe lo que la oficina necesita de una
 * sesion, no como se consigue: este archivo NO importa firebase, y esa es su
 * unica regla dura. El adaptador (`firebaseAuthAdapter.ts`) es el unico lugar
 * del repo que habla con el SDK, asi que todo lo demas -- hooks, componentes,
 * tests -- se prueba sin montarlo.
 */

import { DEFAULT_NAME } from '../game/officeProtocol';

export interface AuthUser {
  uid: string;
  email: string | null;
  /** Ya derivado con `deriveDisplayName`: nunca vacio. */
  displayName: string;
}

export interface AuthPort {
  /**
   * Se notifica tambien en el arranque, con `null` si no hay nadie. Devuelve
   * la desuscripcion: sin llamarla, un listener sobrevive al desmontaje.
   */
  onChange(listener: (user: AuthUser | null) => void): () => void;
  /**
   * Deja propagar el error del proveedor; el llamante lo traduce
   * (`authErrors.ts`). El puerto sigue lanzando -- es `useAuth.signIn` quien
   * lo atrapa y lo convierte en el `Promise<boolean>` que consume `AuthGate`
   * (#100, D9): el proveedor real no sabe nada del reclamo de nombre que viene
   * despues, asi que no tiene por que cambiar su contrato.
   */
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** `null` cuando no hay sesion: la oficina sigue siendo jugable sin ella. */
  getIdToken(): Promise<string | null>;
  /**
   * Asks the provider to email a password-reset link (#94). Lets the provider
   * error through like `signIn`; the caller translates it with
   * `describePasswordResetError`, which also hides whether the account exists.
   */
  sendPasswordReset(email: string): Promise<void>;
}

/**
 * Lo unico que la oficina necesita de una sesion ya iniciada: como llamar a
 * quien juega y como conseguir un token fresco en cada peticion. Vive en el
 * puerto y no en `AuthGate.tsx` para que el hook de audio pueda tiparlo sin
 * depender de un componente; `AuthGate` lo reexporta.
 */
export interface OfficeSession {
  displayName: string;
  getIdToken(): Promise<string | null>;
  /**
   * Ends the auth session (#66). Optional because only the office offers it;
   * the port's listener then reports `null` and `AuthGate` shows the login.
   */
  signOut?(): Promise<void>;
}

/**
 * Nombre visible a partir del perfil del proveedor.
 *
 * Es solo lo que TU ves mientras el estado de la sala no ha llegado: el
 * SERVIDOR vuelve a derivarlo del token verificado (`deriveIdentityName` en
 * `server/src/OfficeRoom.ts`) y ese es el que llega a los demas. Por eso los
 * dos criterios son el mismo en orden y en espiritu -- perfil, parte local del
 * correo, defecto --: si divergieran, cada persona se veria con un nombre
 * distinto al que ensena a la oficina.
 */
export function deriveDisplayName(profile: {
  displayName?: string | null;
  email?: string | null;
}): string {
  const name = profile.displayName?.trim();
  if (name) return name;

  const localPart = profile.email?.split('@')[0]?.trim();
  if (localPart) return localPart;

  return DEFAULT_NAME;
}
