import { useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { resolveOfficeEndpoint } from '../game/officeEndpoint';
import { createAdminClient, resolveAdminBaseUrl } from './adminClient';
import { DashboardScreen } from './DashboardScreen';
import styles from './DashboardScreen.module.css';

export interface DashboardRouteProps {
  /** Sesion de `AuthGate`; `null` con la autenticacion apagada. */
  session: OfficeSession | null;
}

/**
 * Raiz de composicion del panel (#24) y frontera del chunk: este modulo es lo
 * que `App` carga con `import()` diferido, asi que nada de lo que cuelga de
 * aqui -- ni el adaptador HTTP ni la pantalla -- entra en el bundle de quien
 * solo va a la oficina, y al reves, mirar una tabla no descarga Phaser.
 *
 * Es el unico sitio del panel que lee `import.meta.env` y construye el
 * adaptador; `DashboardScreen` recibe un puerto ya hecho (D3).
 *
 * Export por defecto a proposito: es lo que `React.lazy` espera, y ponerlo
 * aqui evita el envoltorio `.then(m => ({ default: m.X }))` en `App`.
 */
export default function DashboardRoute({ session }: DashboardRouteProps) {
  // Se resuelve una sola vez, en el mismo espiritu que `endpoint` en
  // `OfficeShell`: un puerto nuevo por render volveria a disparar la carga de
  // la sesion y de la lista en bucle, porque es la dependencia del efecto de
  // `DashboardScreen`.
  const [admin] = useState(() => {
    if (session === null) return null;

    const baseUrl = resolveAdminBaseUrl({
      officeEndpoint: resolveOfficeEndpoint({
        configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
        protocol: window.location.protocol,
        hostname: window.location.hostname,
      }),
    });
    if (baseUrl === null) return null;

    // `getIdToken` delega SIEMPRE en la sesion en vez de copiar el token: el
    // token caduca cada hora y una copia dejaria de valer a mitad de una
    // sesion del panel sin que nada avisase (mismo motivo que `AuthGate`).
    return createAdminClient({ baseUrl, getIdToken: () => session.getIdToken() });
  });

  if (session === null) {
    /**
     * Sin autenticacion no hay panel posible, y decirlo es mejor que una
     * tabla vacia: cada ruta de `/admin` exige un ID token, asi que sin
     * puerto de autenticacion todas responderian 401. Es el modo normal del
     * desarrollo local y de la suite e2e (`.env.e2e` deja las variables de
     * firebase vacias), donde la oficina si funciona.
     */
    return (
      <div className={styles.screen}>
        <div className={styles.notice}>
          <p>
            El panel sin autenticación no está disponible: arranca con la configuración de
            Identity Platform para administrar invitaciones.
          </p>
        </div>
      </div>
    );
  }

  if (admin === null) {
    return (
      <div className={styles.screen}>
        <div className={styles.notice}>
          <p>No hay servidor de oficina configurado, así que no hay invitaciones que administrar.</p>
        </div>
      </div>
    );
  }

  return <DashboardScreen admin={admin} />;
}
