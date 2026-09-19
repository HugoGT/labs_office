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
 * No hay recarga en vivo en esta slice: un cambio del Admin llega en la
 * siguiente recarga del cliente. Mientras tanto, el par desacompasado queda
 * mutuamente inaudible, que es seguro pero silencioso.
 */

import { useEffect, useState } from 'react';
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

export function useSpacesConfig(
  officeEndpoint: string | null,
  { fetchConfig = DEFAULT_FETCH_CONFIG }: UseSpacesConfigOptions = {},
): SpacesConfig | null {
  // La oficina en solitario no tiene servidor al que preguntar, asi que su
  // config es la incorporada desde el primer render: esperar a un fetch que no
  // va a ocurrir la dejaria sin arrancar.
  const [config, setConfig] = useState<SpacesConfig | null>(
    officeEndpoint === null ? BUILT_IN_SPACES_CONFIG : null,
  );

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
      if (!cancelled) setConfig(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [officeEndpoint, fetchConfig]);

  return config;
}
