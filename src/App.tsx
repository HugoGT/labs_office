import { useState } from 'react';
import { resolveAuthConfig } from './auth/authConfig';
import { createFirebaseAuthAdapter } from './auth/firebaseAuthAdapter';
import { AuthGate } from './components/AuthGate';
import { OfficeShell } from './components/OfficeShell';

/**
 * `OfficeShell` es el unico dueno del `OfficeBridge` (D3): `App` monta el
 * landmark de la pagina y decide quien entra (#8).
 *
 * La autenticacion se resuelve aqui y una sola vez porque es una decision de
 * arranque: sin `VITE_FIREBASE_API_KEY` y `VITE_FIREBASE_PROJECT_ID` no hay
 * puerto, `AuthGate` deja pasar y la oficina se comporta como antes de este
 * cambio. Eso es lo que mantiene vivos el desarrollo local y la suite e2e.
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

  return (
    <main style={{ position: 'relative', width: '100%', height: '100%' }}>
      <AuthGate auth={auth}>{(session) => <OfficeShell session={session} />}</AuthGate>
    </main>
  );
}
