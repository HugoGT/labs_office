/**
 * Sondeo del rol administrativo para gatear las secciones de edicion del
 * sidebar (#74, PR3a: Desks y Spaces llegan en PR3c/PR4). Es puramente
 * cosmetico -- decide que se OFRECE, nunca que se PERMITE -- porque `GET
 * /admin/session` es la excepcion deliberada que corre autenticacion y
 * directorio pero NO el chequeo de rol (ver la cabecera de `adminRoutes.ts`):
 * cualquier persona autenticada de la oficina puede llamarla y saber su
 * propio rol. La guarda de verdad para cualquier mutacion sigue viviendo en
 * el servidor, ruta por ruta.
 *
 * Importa `adminClient.ts` de forma ESTATICA a proposito, a diferencia del
 * contenedor del editor (`React.lazy` en PR3c): esto es una peticion HTTP
 * minuscula, y cargarlo con retraso solo anadiria un salto de red antes de
 * saber si hay algo que ofrecer. Lo que SI se difiere es la UI del editor.
 *
 * `null` cubre TRES estados a proposito: "todavia no se sabe" (en vuelo),
 * "no hay a quien preguntarle" (sin `endpoint` o sin `session`), y "la
 * pregunta fallo" (red caida, sin fila en el directorio). Los tres deben
 * comportarse igual para quien consume esto -- ninguno pinta una seccion de
 * administracion -- y colapsarlos evita que quien llama tenga que distinguir
 * "pendiente" de "fallido" para tomar la misma decision.
 */

import { useEffect, useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { createAdminClient, resolveAdminBaseUrl } from '../dashboard/adminClient';
import type { Role } from '../dashboard/adminPort';

export type GetIdToken = () => Promise<string | null>;

export interface UseOfficeAdminRoleOptions {
  /** Inyectable para los tests; por defecto la lectura real de `GET /admin/session`. */
  fetchRole?: (baseUrl: string, getIdToken: GetIdToken) => Promise<Role | null>;
}

/**
 * Valor por defecto FUERA de la firma, misma trampa que documentan
 * `DEFAULT_FETCH_DESKS`/`DEFAULT_FETCH_CONFIG`: construido dentro cambiaria en
 * cada render, la dependencia del efecto cambiaria siempre, y este enganche
 * pediria `/admin/session` en bucle mientras la oficina estuviese abierta.
 */
const DEFAULT_FETCH_ROLE = async (baseUrl: string, getIdToken: GetIdToken): Promise<Role | null> => {
  try {
    const { role } = await createAdminClient({ baseUrl, getIdToken }).session();
    return role;
  } catch {
    // Red caida, sin fila en el directorio (401), panel sin configurar: nada
    // de esto debe pintar una seccion de administracion que luego el servidor
    // rechazaria en cuanto se intentase usar.
    return null;
  }
};

export function useOfficeAdminRole(
  officeEndpoint: string | null,
  session: OfficeSession | null,
  { fetchRole = DEFAULT_FETCH_ROLE }: UseOfficeAdminRoleOptions = {},
): Role | null {
  const baseUrl = officeEndpoint === null ? null : resolveAdminBaseUrl({ officeEndpoint });
  const getIdToken = session?.getIdToken ?? null;

  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    if (baseUrl === null || getIdToken === null) {
      setRole(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const resolved = await fetchRole(baseUrl, getIdToken);
      // Una respuesta que llega tras desmontar (o tras cambiar de endpoint/
      // sesion) no toca el estado, mismo motivo que `useDesks`/`useSpacesConfig`.
      if (!cancelled) setRole(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, getIdToken, fetchRole]);

  return role;
}
