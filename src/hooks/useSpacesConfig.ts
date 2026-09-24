/**
 * Resuelve UNA vez la config de espacios que este cliente va a usar durante
 * toda la sesion (#7, slice 3).
 *
 * Devuelve `null` mientras esta en vuelo, y ese `null` significa "todavia no",
 * no "no hay". Quien lo consume debe ESPERAR. Las dos alternativas son peores:
 *
 *   - Arrancar con el fallback y cambiar al llegar la servida recrearia Phaser
 *     entero a los pocos cientos de milisegundos de entrar.
 *   - Arrancar con el fallback y NO cambiar dejaria a este cliente publicando
 *     una `spacesVersion` distinta de la del resto para siempre, y el predicado
 *     mutuo de `proximityAudio.ts` lo aislaria en silencio.
 *
 * La espera esta acotada: `fetchSpacesConfig` nunca lanza y tiene plazo propio,
 * asi que este enganche siempre acaba entregando algo.
 *
 * `refresh()` (#74, PR3a) cierra el hueco que la nota de arriba daba por
 * definitivo: `OfficeShell` lo llama cuando un par reporta una version
 * distinta de la mia (ver `spacesConfig.createStaleSpacesVersionTracker`),
 * asi que un cambio del Admin ya NO espera a una recarga manual.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BUILT_IN_SPACES_CONFIG,
  deriveSpacesUrl,
  fetchSpacesConfig,
  type SpacesConfig,
} from '../game/spacesConfig';

export interface UseSpacesConfigOptions {
  /** Inyectable para los tests; por defecto la lectura real de `/spaces`. */
  fetchConfig?: (url: string) => Promise<SpacesConfig>;
}

/**
 * El valor por defecto vive AQUI y no dentro de la firma. Construido en la
 * firma seria una funcion nueva en cada render, la dependencia del efecto
 * cambiaria siempre, y el cliente pediria `/spaces` en bucle mientras la
 * oficina estuviese abierta. Un test que inyecta su propio doble nunca lo
 * veria, porque el doble que pasa si es estable.
 */
const DEFAULT_FETCH_CONFIG = (url: string): Promise<SpacesConfig> => fetchSpacesConfig({ url });

export interface UseSpacesConfigResult {
  /** `null` mientras no se sabe. Ver la cabecera. */
  config: SpacesConfig | null;
  /** Vuelve a pedir `/spaces` (#74, PR3a). Sin degradar: ver la cabecera. */
  refresh: () => void;
}

export function useSpacesConfig(
  officeEndpoint: string | null,
  { fetchConfig = DEFAULT_FETCH_CONFIG }: UseSpacesConfigOptions = {},
): UseSpacesConfigResult {
  // La oficina en solitario no tiene servidor al que preguntar, asi que su
  // config es la incorporada desde el primer render: esperar a un fetch que no
  // va a ocurrir la dejaria sin arrancar.
  const [config, setConfig] = useState<SpacesConfig | null>(
    officeEndpoint === null ? BUILT_IN_SPACES_CONFIG : null,
  );
  /**
   * Mismo contador que `useDesks.reads` y misma razon: cada relectura es un
   * valor nuevo, no una llamada suelta, para que la siga lanzando el MISMO
   * efecto -- que ya sabe cancelarse al desmontar o al cambiar de endpoint.
   */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (officeEndpoint === null) {
      setConfig(BUILT_IN_SPACES_CONFIG);
      return;
    }

    let cancelled = false;
    void (async () => {
      const resolved = await fetchConfig(deriveSpacesUrl(officeEndpoint));
      // Una respuesta que llega tras desmontar (o tras cambiar de endpoint) no
      // toca el estado: el fetch tardio de un endpoint viejo pisaria al nuevo.
      if (cancelled) return;
      // Chequeo de IDENTIDAD y no de forma (#74, PR3a): `fetchSpacesConfig`
      // nunca lanza, asi que un refetch fallido (red caida, 503) devuelve el
      // mismo objeto `BUILT_IN_SPACES_CONFIG` en vez de tirar. Adoptarlo aqui
      // desharia una config servida real por la incorporada, que es una
      // degradacion peor que simplemente no haber refrescado -- ver la nota de
      // "Failed refresh keeps the current config" en la spec.
      if (resolved === BUILT_IN_SPACES_CONFIG && config !== null) return;
      setConfig(resolved);
    })();

    return () => {
      cancelled = true;
    };
    // `config` no entra en las dependencias a proposito: solo se lee dentro
    // del efecto para el chequeo de identidad de arriba, y anadirlo relanzaria
    // el fetch cada vez que este mismo efecto acaba de fijar una config nueva.
  }, [officeEndpoint, fetchConfig, reads]);

  const refresh = useCallback(() => setReads((count) => count + 1), []);

  return { config, refresh };
}
