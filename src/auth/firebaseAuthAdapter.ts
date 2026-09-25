/**
 * Adaptador del puerto de autenticacion sobre el SDK de Firebase (#8). ES EL
 * UNICO archivo del repo que importa `firebase/app` y `firebase/auth`: todo lo
 * demas habla con `AuthPort`, y por eso se prueba sin montar el SDK. No tiene
 * suite propia a proposito -- probarlo exigiria un proyecto real de Identity
 * Platform, y lo que se probaria seria el SDK de Google, no este cableado.
 *
 * La `apiKey` que recibe no es un secreto: identifica al proyecto y viaja en
 * el bundle por diseno (ver `authConfig.ts`).
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { AuthConfig } from './authConfig';
import { deriveDisplayName, type AuthPort, type AuthUser } from './authPort';

export function createFirebaseAuthAdapter(config: AuthConfig): AuthPort {
  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
  });
  const auth = getAuth(app);

  return {
    onChange(listener: (user: AuthUser | null) => void): () => void {
      /**
       * `onIdTokenChanged` y no `onAuthStateChanged`: el ID token se renueva
       * mas o menos cada hora, y solo este avisa de esa renovacion. Con el
       * otro, la sesion parece intacta mientras el token que se manda al
       * servidor envejece, y el fallo aparece una hora despues de entrar, que
       * es el peor momento para descubrirlo.
       */
      return onIdTokenChanged(auth, (user) => {
        listener(
          user
            ? {
                uid: user.uid,
                email: user.email,
                displayName: deriveDisplayName(user),
              }
            : null,
        );
      });
    },

    /**
     * Deja escapar el error del SDK tal cual: quien llama (`useAuth`) lo
     * traduce con `describeAuthError`. Traducirlo aqui mezclaria el adaptador
     * con el idioma de la interfaz.
     */
    async signIn(email: string, password: string): Promise<void> {
      await signInWithEmailAndPassword(auth, email, password);
    },

    async signOut(): Promise<void> {
      await firebaseSignOut(auth);
    },

    /**
     * No `actionCodeSettings` (continue URL) on purpose: a continue URL must be
     * an authorized domain of the Identity Platform project, and a missing one
     * would make every reset fail. The default hosted page is enough; the
     * person comes back to the office by its usual URL.
     */
    async sendPasswordReset(email: string): Promise<void> {
      await sendPasswordResetEmail(auth, email);
    },

    async getIdToken(): Promise<string | null> {
      const user = auth.currentUser;
      if (!user) return null;
      // Sin argumento: el SDK devuelve el token cacheado y solo lo renueva si
      // ya caduco. Forzar la renovacion en cada llamada costaria un viaje a
      // Google por cada peticion al servidor.
      return user.getIdToken();
    },
  };
}
