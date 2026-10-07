import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { resolveAuthConfig } from './auth/authConfig';
import { describeAccessDenied } from './auth/authErrors';
import { createCharacterClient } from './auth/characterClient';
import type { CharacterPort } from './auth/characterPort';
import { createDisplayNameClient, deriveDisplayNameBaseUrl } from './auth/displayNameClient';
import type { DisplayNamePort } from './auth/displayNamePort';
import { createFirebaseAuthAdapter } from './auth/firebaseAuthAdapter';
import { createLastDisplayNameStore } from './auth/lastDisplayNameStore';
import { withSessionExpiry } from './auth/sessionExpiry';
import { AuthGate } from './components/AuthGate';
import { LeftOfficeNotice, type LeftOfficeReason } from './components/LeftOfficeNotice';
import { OfficeEntry } from './components/OfficeEntry';
import { ART_PACK_MANIFEST_URL, artUploadsManifestUrl } from './game/artPack';
import { resolveOfficeEndpoint } from './game/officeEndpoint';
import type { AccessDeniedReason } from './game/officeProtocol';
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
   * Endpoint del servidor de avatares, resuelto UNA vez y por separado del que
   * calcula `OfficeShell` (#100): son dos copias deliberadas, no una
   * importada de la otra, por la misma razon que documenta la cabecera de
   * `desksClient.ts` -- traer el modulo del juego aqui meteria su chunk en el
   * bundle que se carga ANTES del login, justo lo que la carga diferida de
   * `OfficeShell` existe para evitar.
   */
  const [officeEndpoint] = useState(() =>
    resolveOfficeEndpoint({
      configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    }),
  );
  /**
   * The server refused the join (#129): the account is out, so it signs out
   * here and the login says why. Unlike `leftOffice`, coming back is a new
   * sign-in, which is what dismisses the notice.
   *
   * A stable callback on purpose: `OfficeShell` hands the refusal up from an
   * effect that depends on it, and a new one per render would sign out again.
   * Without auth nothing can sign out, and the bar says "Acceso denegado".
   *
   * A login older than the server's maximum session age (#128) takes the same
   * path, from the join or from any HTTP answer (`sessionFetch`).
   */
  const [accessDenied, setAccessDenied] = useState<AccessDeniedReason | null>(null);
  const handleAccessDenied = useCallback(
    (reason: AccessDeniedReason) => {
      setAccessDenied(reason);
      void auth?.signOut();
    },
    [auth],
  );
  const dismissAccessDenied = useCallback(() => setAccessDenied(null), []);
  /**
   * Dashboard HTTP session expiry still goes through App (#128). Entrance
   * ports now preserve denials for AuthGate, which owns their sign-out; using
   * this decorator there too would sign out twice for the same response.
   */
  const sessionFetch = useMemo(
    () => withSessionExpiry(() => handleAccessDenied('session-expired')),
    [handleAccessDenied],
  );
  /**
   * Cliente del nombre visible auto-elegido (#100). `null` sin servidor
   * (`officeEndpoint`) o sin autenticacion: sin `auth` no hay ID token que
   * mandar, y `AuthGate` nunca llega a mostrar el formulario en ese caso de
   * todos modos.
   */
  const displayNamePort = useMemo<DisplayNamePort | null>(() => {
    if (officeEndpoint === null || auth === null) return null;
    return createDisplayNameClient(
      {
        baseUrl: deriveDisplayNameBaseUrl(officeEndpoint),
        getIdToken: () => auth.getIdToken(),
      },
    );
  }, [officeEndpoint, auth]);
  /**
   * Ultimo nombre elegido con exito en este dispositivo (#100, D8). Se lee UNA
   * vez para prellenar "Nombre"; `AuthGate` escribe en el mismo almacen a
   * traves de `onNameClaimed` tras cada reclamo con exito.
   */
  const [lastDisplayName] = useState(() => createLastDisplayNameStore());
  const [initialName] = useState(() => lastDisplayName.read() ?? undefined);
  /**
   * Tambien una sola vez: no hay navegacion en cliente entre la oficina y el
   * panel -- al panel se llega escribiendo la URL, y no hay ni un enlace ni un
   * boton que lleve a el -- asi que la ruta no puede cambiar sin recargar.
   */
  const [route] = useState(() => resolveRoute(window.location.pathname));
  /**
   * Character chosen at the office entrance (art migration, step 5). Same
   * conditions as `displayNamePort`, plus the route: `/dashboard` gets `null`
   * so administrative access never waits on the selector.
   */
  const characterPort = useMemo<CharacterPort | null>(() => {
    if (route !== 'office' || officeEndpoint === null || auth === null) return null;
    return createCharacterClient(
      {
        baseUrl: deriveDisplayNameBaseUrl(officeEndpoint),
        getIdToken: () => auth.getIdToken(),
        manifestUrl: ART_PACK_MANIFEST_URL,
        // Characters an Admin uploaded (#121) join the pack's in the selector.
        uploadsManifestUrl: artUploadsManifestUrl(officeEndpoint),
      },
    );
  }, [route, officeEndpoint, auth]);
  /**
   * Leaving the office (#66) unmounts it rather than hiding it: tearing the
   * shell down is what leaves the Colyseus and LiveKit rooms, so nobody keeps
   * seeing or hearing someone who believes they left. It lives here, above
   * `AuthGate`'s session, so coming back needs no login.
   *
   * Being replaced by another tab of the same account (#78) takes the same
   * path with its own wording; `null` means the office is mounted.
   */
  const [leftOffice, setLeftOffice] = useState<LeftOfficeReason | null>(null);

  return (
    <main style={{ position: 'relative', width: '100%', height: '100%' }}>
      <AuthGate
        auth={auth}
        displayName={displayNamePort}
        character={characterPort}
        initialName={initialName}
        onNameClaimed={lastDisplayName.write}
        notice={accessDenied === null ? null : describeAccessDenied(accessDenied)}
        onDismissNotice={dismissAccessDenied}
      >
        {(session) => (
          // The dashboard keeps its quiet lazy load; office entry owns its background status.
          <Suspense fallback={null}>
            {route === 'dashboard' ? (
              <DashboardRoute session={session} fetchImpl={sessionFetch} />
            ) : leftOffice ? (
              <LeftOfficeNotice reason={leftOffice} onReenter={() => setLeftOffice(null)} />
            ) : (
              <OfficeEntry>
                {(onEntryState) => (
                  <OfficeShell
                    session={session}
                    onEntryState={onEntryState}
                    onLeaveOffice={() => setLeftOffice('left')}
                    onSessionReplaced={() => setLeftOffice('replaced')}
                    onAccessRevoked={() => setLeftOffice('revoked')}
                    onAccessDenied={handleAccessDenied}
                  />
                )}
              </OfficeEntry>
            )}
          </Suspense>
        )}
      </AuthGate>
    </main>
  );
}
