import { useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { resolveOfficeEndpoint } from '../game/officeEndpoint';
import { createAdminClient, resolveAdminBaseUrl } from './adminClient';
import type { AdminPort } from './adminPort';
import { createAssetAdminClient } from './assetAdminClient';
import type { AssetAdminPort } from './assetAdminPort';
import { AssetsPanel } from './AssetsPanel';
import { createDeskAdminClient } from './deskAdminClient';
import type { DeskAdminPort } from './deskAdminPort';
import { DesksPanel } from './DesksPanel';
import { DashboardScreen } from './DashboardScreen';
import styles from './DashboardScreen.module.css';
import { resolveOfficeApiBaseUrl } from './officeApiBaseUrl';

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
/**
 * Los tres puertos del panel, construidos de una vez. Van juntos porque
 * dependen de lo mismo -- el endpoint de la oficina y la sesion -- y porque
 * ninguno se puede construir si el otro no: o hay servidor y sesion para los
 * tres, o no hay panel.
 */
interface DashboardPorts {
  admin: AdminPort;
  desks: DeskAdminPort;
  assets: AssetAdminPort;
}

export default function DashboardRoute({ session }: DashboardRouteProps) {
  // Se resuelven una sola vez, en el mismo espiritu que `endpoint` en
  // `OfficeShell`: un puerto nuevo por render volveria a disparar la carga de
  // la sesion y de cada lista en bucle, porque es la dependencia del efecto de
  // `DashboardScreen` y de la de cada panel.
  const [ports] = useState<DashboardPorts | null>(() => {
    if (session === null) return null;

    const officeEndpoint = resolveOfficeEndpoint({
      configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    });
    const adminBaseUrl = resolveAdminBaseUrl({ officeEndpoint });
    // Las dos bases salen del MISMO endpoint y solo se diferencian en el
    // prefijo: las invitaciones viven enteras bajo `/admin`, pero la unica
    // lectura de escritorios (`GET /desks`) cuelga de la raiz.
    const apiBaseUrl = resolveOfficeApiBaseUrl({ officeEndpoint });
    if (adminBaseUrl === null || apiBaseUrl === null) return null;

    // `getIdToken` delega SIEMPRE en la sesion en vez de copiar el token: el
    // token caduca cada hora y una copia dejaria de valer a mitad de una
    // sesion del panel sin que nada avisase (mismo motivo que `AuthGate`).
    const getIdToken = () => session.getIdToken();

    return {
      admin: createAdminClient({ baseUrl: adminBaseUrl, getIdToken }),
      desks: createDeskAdminClient({ baseUrl: apiBaseUrl, getIdToken }),
      assets: createAssetAdminClient({ baseUrl: apiBaseUrl, getIdToken }),
    };
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

  if (ports === null) {
    return (
      <div className={styles.screen}>
        <div className={styles.notice}>
          <p>No hay servidor de oficina configurado, así que no hay nada que administrar.</p>
        </div>
      </div>
    );
  }

  /**
   * Los paneles se pasan como HIJOS y no como puertos de `DashboardScreen`:
   * aquella pantalla no tiene que saber que existen, y cada panel sigue siendo
   * el unico dueno de su puerto y de su estado (D3). Solo se montan cuando el
   * servidor ha dicho que quien mira administra, porque la guarda de rol de
   * `DashboardScreen` vale para todo lo que cuelgue de ella.
   */
  return (
    <DashboardScreen admin={ports.admin}>
      <DesksPanel desks={ports.desks} />
      <AssetsPanel assets={ports.assets} />
    </DashboardScreen>
  );
}
