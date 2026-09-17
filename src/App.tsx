import { lazy, Suspense, useState } from 'react';
import { resolveAuthConfig } from './auth/authConfig';
import { createFirebaseAuthAdapter } from './auth/firebaseAuthAdapter';
import { AuthGate } from './components/AuthGate';
import { resolveRoute } from './routing/route';

/**
 * Las dos pantallas entran por `import()` y no por import estatico, y eso es
 * el punto (#24, punto 8): la oficina arrastra Phaser, ~1,2 MB en su propio
 * chunk, y mirar una tabla de invitaciones no deberia pagarlo. Con `lazy`,
 * Rolldown corta el grafo aqui y cada ruta descarga solo lo suyo; con un
 * import estatico, cualquier tree-shaking se rendiria ante un modulo que
 * `App` menciona en las dos ramas.
 *
 * `OfficeShell` se envuelve porque es un export con nombre y `lazy` espera un
 * modulo con `default`; `DashboardRoute` ya lo trae.
 */
const OfficeShell = lazy(async () => ({
  default: (await import('./components/OfficeShell')).OfficeShell,
}));
const DashboardRoute = lazy(() => import('./dashboard/DashboardRoute'));

/**
 * `OfficeShell` es el unico dueno del `OfficeBridge` (D3): `App` monta el
 * landmark de la pagina y decide quien entra (#8) y a donde (#24).
 *
 * La autenticacion se resuelve aqui y una sola vez porque es una decision de
 * arranque: sin `VITE_FIREBASE_API_KEY` y `VITE_FIREBASE_PROJECT_ID` no hay
 * puerto, `AuthGate` deja pasar y la oficina se comporta como antes de este
 * cambio. Eso es lo que mantiene vivos el desarrollo local y la suite e2e.
 *
 * El panel queda DENTRO de `AuthGate` a proposito: administrar invitaciones
 * exige sesion igual que entrar a la oficina. Con la autenticacion apagada
 * recibe `null` y lo dice (`DashboardRoute`), porque sin token cada ruta de
 * `/admin` responderia 401.
 */
export default function App() {
  // Se resuelve una sola vez, en el mismo espiritu que `endpoint` en
  // `OfficeShell`: rehacerlo por render reiniciaria firebase y tiraria la
  // sesion que acaba de restaurarse.
  const [authConfig] = useState(() =>
    resolveAuthConfig({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    }),
  );
  const [auth] = useState(() =>
    authConfig === null ? null : createFirebaseAuthAdapter(authConfig),
  );
  /**
   * Tambien una sola vez: no hay navegacion en cliente entre la oficina y el
   * panel -- al panel se llega escribiendo la URL, y no hay ni un enlace ni un
   * boton que lleve a el -- asi que la ruta no puede cambiar sin recargar.
   */
  const [route] = useState(() => resolveRoute(window.location.pathname));

  return (
    <main style={{ position: 'relative', width: '100%', height: '100%' }}>
      <AuthGate auth={auth}>
        {(session) => (
          // Nada mientras llega el chunk, por el mismo motivo que `AuthGate`
          // no ensena nada mientras no sabe si hay sesion: un cargador que
          // parpadea unos milisegundos molesta mas de lo que informa.
          <Suspense fallback={null}>
            {route === 'dashboard' ? (
              <DashboardRoute session={session} />
            ) : (
              <OfficeShell session={session} />
            )}
          </Suspense>
        )}
      </AuthGate>
    </main>
  );
}
