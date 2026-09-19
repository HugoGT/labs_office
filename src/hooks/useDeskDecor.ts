/**
 * Resuelve lo que el editor de decoracion necesita saber (#7, slice 6): que se
 * puede colocar y que hay colocado en el escritorio propio.
 *
 * Es primo de `useDesks` y comparte su forma -- lectura al montar, relectura
 * despues de escribir -- con una diferencia que gobierna todo lo demas: aqui
 * hacen falta DOS lecturas y el editor solo se abre con las dos.
 *
 * `POST /me/desk` reemplaza el escritorio ENTERO. Con el catalogo leido y lo
 * puesto sin leer, guardar cualquier cosa borraria la decoracion que nunca se
 * llego a ver. Por eso `phase` es una sola respuesta a "se puede editar" y no
 * dos banderas que alguien tendria que acordarse de mirar juntas:
 *
 *   - `loading`: todavia no se sabe. No es "no hay".
 *   - `unavailable`: sin sesion, sin catalogo que ofrecer, o sin poder leer lo
 *     puesto. Es tambien la degradacion del 503 sin `DATABASE_URL`: la oficina
 *     se ve exactamente como antes de esta slice, sin editor.
 *   - `ready`: se sabe lo uno y lo otro.
 *
 * Un escritorio vacio SI es `ready`: no haber colocado nada todavia es el
 * estado de quien mas necesita esta funcion.
 */

import { useCallback, useEffect, useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import { fetchDeskCatalog, fetchMyDeskItems, saveMyDesk } from '../game/deskDecorClient';
import {
  NO_DESK_ASSETS,
  type DeskDecorAsset,
  type DeskItemPlacement,
  type PlacedDeskItem,
  type SaveDeskOutcome,
} from '../game/deskDecorPort';
import { deriveDesksBaseUrl } from '../game/desksClient';

export type DeskDecorPhase = 'loading' | 'unavailable' | 'ready';

export interface UseDeskDecorResult {
  phase: DeskDecorPhase;
  /** Lo que el selector puede ofrecer. Vacio salvo en `ready`. */
  catalog: readonly DeskDecorAsset[];
  /** Lo que hay puesto. Vacio salvo en `ready` -- y en `ready` vacio significa vacio. */
  items: readonly PlacedDeskItem[];
  /** Guarda el escritorio entero. Relee lo puesto solo si el servidor lo acepto. */
  save: (items: readonly DeskItemPlacement[]) => Promise<SaveDeskOutcome>;
  reload: () => void;
}

/** Lo que devuelve el enganche cuando no hay nada que editar, en un solo sitio. */
const NO_ITEMS: readonly PlacedDeskItem[] = [];

export function useDeskDecor(
  officeEndpoint: string | null,
  session: OfficeSession | null,
): UseDeskDecorResult {
  /**
   * Sin servidor o sin credencial no hay nada que preguntar, y tampoco hay
   * espera que hacer: las dos rutas exigen token. Se resuelve ANTES del primer
   * render, misma forma que `useDesks`, para no arrancar en `loading` y
   * volver en el mismo instante -- ese render de mas lo pagaria la oficina
   * entera, incluida la abierta, que nunca va a tener editor.
   */
  const unavailable = officeEndpoint === null || session === null;
  const baseUrl = officeEndpoint === null ? null : deriveDesksBaseUrl(officeEndpoint);
  const getIdToken = session?.getIdToken ?? null;

  const [catalog, setCatalog] = useState<readonly DeskDecorAsset[]>(NO_DESK_ASSETS);
  /** `null` es "no se pudo leer", y NO un escritorio pelado: ver la cabecera. */
  const [items, setItems] = useState<readonly PlacedDeskItem[] | null>(null);
  const [loading, setLoading] = useState(!unavailable);
  /**
   * Cada relectura es un valor nuevo de este contador, misma razon que en
   * `useDesks`: asi la peticion la sigue lanzando el MISMO efecto, que es
   * quien sabe cancelarse al desmontar.
   */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (baseUrl === null || getIdToken === null) {
      // Sin credencial las dos rutas solo pueden contestar 401: no hay espera
      // que hacer ni peticion que gastar.
      setCatalog(NO_DESK_ASSETS);
      setItems(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      // Las dos a la vez y no en cadena: son independientes, y encadenarlas
      // sumaria dos viajes de red antes de poder abrir nada.
      const [servedCatalog, servedItems] = await Promise.all([
        fetchDeskCatalog({ baseUrl, getIdToken }),
        fetchMyDeskItems({ baseUrl, getIdToken }),
      ]);
      // Una respuesta que llega tras desmontar (o tras cambiar de endpoint) no
      // toca el estado: el fetch tardio de un endpoint viejo pisaria al nuevo.
      if (cancelled) return;

      setCatalog(servedCatalog);
      setItems(servedItems);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, getIdToken, reads]);

  const reload = useCallback(() => setReads((count) => count + 1), []);

  const save = useCallback(
    async (next: readonly DeskItemPlacement[]): Promise<SaveDeskOutcome> => {
      if (baseUrl === null || getIdToken === null) return 'failed';

      const outcome = await saveMyDesk({ baseUrl, getIdToken, items: next });
      // Solo se relee lo que el servidor acepto. Un rechazo no cambio nada que
      // volver a leer, y una averia tampoco; dar por bueno lo mandado seria
      // ademas inventarse el id de cada colocacion, que lo asigna el servidor.
      if (outcome === 'saved') reload();
      return outcome;
    },
    [baseUrl, getIdToken, reload],
  );

  const ready = !loading && items !== null && catalog.length > 0;
  const phase: DeskDecorPhase = loading ? 'loading' : ready ? 'ready' : 'unavailable';

  return {
    phase,
    catalog: ready ? catalog : NO_DESK_ASSETS,
    items: ready ? (items ?? NO_ITEMS) : NO_ITEMS,
    save,
    reload,
  };
}
