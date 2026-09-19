/**
 * Resuelve los escritorios asignables que este cliente dibuja, y reparte sitio
 * (#7, slice 5).
 *
 * Es el gemelo de `useSpacesConfig` con una diferencia que gobierna todo lo
 * demas: la config de espacios se lee UNA vez por sesion, y esta lista se
 * relee cada vez que alguien coge o suelta un sitio. Por eso sale un `refresh`
 * y por eso `claim`/`release` viven aqui y no en el componente -- quien acaba
 * de escribir es quien sabe que lo leido ya no vale.
 *
 * Devuelve `null` mientras esta en vuelo, y ese `null` significa "todavia no",
 * no "no hay": mandar una lista vacia a la escena antes de tiempo la pintaria
 * sin escritorios y luego con ellos, parpadeando en cada entrada.
 *
 * La espera esta acotada: `fetchOfficeDesks` nunca lanza y tiene plazo propio,
 * asi que este enganche siempre acaba entregando algo. Cuando ese algo es
 * `NO_DESKS` -- 503 sin directorio, red caida, sin credencial -- la oficina se
 * dibuja como antes de esta slice y no ofrece donde sentarse, que es
 * exactamente lo que hay.
 */

import { useCallback, useEffect, useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { claimDesk, deriveDesksBaseUrl, fetchOfficeDesks, releaseDesk } from '../game/desksClient';
import {
  NO_DESKS,
  type DeskClaimOutcome,
  type DeskReleaseOutcome,
  type OfficeDesk,
} from '../game/desksPort';

export type GetIdToken = () => Promise<string | null>;

export interface UseDesksOptions {
  /** Inyectable para los tests; por defecto la lectura real de `/desks`. */
  fetchDesks?: (baseUrl: string, getIdToken: GetIdToken) => Promise<readonly OfficeDesk[]>;
}

export interface UseDesksResult {
  /** `null` mientras no se sabe. Ver la cabecera. */
  desks: readonly OfficeDesk[] | null;
  /** Coge un sitio libre. Vuelve a leer la lista salvo que la peticion fallase. */
  claim: (deskId: string) => Promise<DeskClaimOutcome>;
  /** Suelta el propio. Sin id: el servidor suelta el de quien llama. */
  release: () => Promise<DeskReleaseOutcome>;
  refresh: () => void;
}

/**
 * El valor por defecto vive AQUI y no dentro de la firma, misma trampa que
 * documenta `useSpacesConfig`: construido en la firma seria una funcion nueva
 * en cada render, la dependencia del efecto cambiaria siempre, y el cliente
 * pediria `/desks` en bucle mientras la oficina estuviese abierta.
 */
const DEFAULT_FETCH_DESKS = (
  baseUrl: string,
  getIdToken: GetIdToken,
): Promise<readonly OfficeDesk[]> => fetchOfficeDesks({ baseUrl, getIdToken });

export function useDesks(
  officeEndpoint: string | null,
  session: OfficeSession | null,
  { fetchDesks = DEFAULT_FETCH_DESKS }: UseDesksOptions = {},
): UseDesksResult {
  /**
   * Sin servidor o sin credencial no hay lista que pedir, y tampoco hay espera
   * que hacer: `/desks` exige token, asi que sin sesion la peticion solo puede
   * acabar en 401. `null` de arranque solo para quien SI va a preguntar.
   */
  const unavailable = officeEndpoint === null || session === null;
  const baseUrl = officeEndpoint === null ? null : deriveDesksBaseUrl(officeEndpoint);
  const getIdToken = session?.getIdToken ?? null;

  const [desks, setDesks] = useState<readonly OfficeDesk[] | null>(unavailable ? NO_DESKS : null);
  /**
   * Cada relectura es un valor nuevo de este contador, no una llamada suelta:
   * asi la peticion la sigue lanzando el MISMO efecto, que es quien ya sabe
   * cancelarse al desmontar. Un fetch disparado desde el manejador del clic
   * se quedaria fuera de esa cancelacion.
   */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (baseUrl === null || getIdToken === null) {
      setDesks(NO_DESKS);
      return;
    }

    let cancelled = false;
    void (async () => {
      const resolved = await fetchDesks(baseUrl, getIdToken);
      // Una respuesta que llega tras desmontar (o tras cambiar de endpoint) no
      // toca el estado: el fetch tardio de un endpoint viejo pisaria al nuevo.
      if (!cancelled) setDesks(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, getIdToken, fetchDesks, reads]);

  const refresh = useCallback(() => setReads((count) => count + 1), []);

  const claim = useCallback(
    async (deskId: string): Promise<DeskClaimOutcome> => {
      if (baseUrl === null || getIdToken === null) return 'failed';

      const outcome = await claimDesk({ baseUrl, deskId, getIdToken });
      // `taken` relee tanto como `claimed`, y es el caso que mas lo necesita:
      // alguien se adelanto, asi que el sitio que este cliente pinta libre ya
      // no lo esta. `failed` no relee -- no cambio nada que volver a leer.
      if (outcome !== 'failed') refresh();
      return outcome;
    },
    [baseUrl, getIdToken, refresh],
  );

  const release = useCallback(async (): Promise<DeskReleaseOutcome> => {
    if (baseUrl === null || getIdToken === null) return 'failed';

    const outcome = await releaseDesk({ baseUrl, getIdToken });
    if (outcome === 'released') refresh();
    return outcome;
  }, [baseUrl, getIdToken, refresh]);

  return { desks, claim, release, refresh };
}
