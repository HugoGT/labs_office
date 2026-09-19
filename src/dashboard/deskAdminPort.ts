/**
 * Puerto de administracion de escritorios asignables (#7, slice 5). Solo
 * tipos: aqui no hay ni `fetch` ni React, misma regla que `adminPort.ts` y que
 * `server/src/desks/desksPort.ts`. El unico adaptador es `deskAdminClient.ts`.
 *
 * ## Que decide quien administra, y que NO
 *
 * CUANTOS escritorios hay y DONDE estan: crear, mover, renombrar y borrar. Y
 * nada mas. No sienta ni levanta a nadie -- eso lo hace cada persona desde la
 * oficina con `claim`/`release`, y el servidor no tiene ninguna ruta de
 * administracion que escriba el ocupante. Por eso este puerto no tiene un
 * `assignDesk` que "solo faltaria cablear": la funcion no existe a proposito.
 *
 * ## TILES, no pixeles
 *
 * Al reves que `game/desksPort.ts`, que convierte al leer porque la escena
 * dibuja en pixeles. Aqui la unidad es la que escribe quien administra en el
 * formulario y la que guarda el servidor; convertir de ida y vuelta solo
 * anadiria dos sitios donde perder un redondeo.
 */

/**
 * Quien ocupa un escritorio, con lo justo para decirlo en una tabla.
 *
 * `items` NO viaja aunque el servidor lo mande: la decoracion es de la
 * persona, se edita desde su propio escritorio y este panel no la toca.
 * Declararla aqui prometeria una edicion que este panel no hace.
 */
export interface AdminDeskOccupant {
  id: string;
  /** Puede faltar: el directorio no obliga a tener nombre visible. */
  displayName: string | null;
}

export interface AdminDesk {
  id: string;
  /** Como lo llama la oficina ("Mesa 4"). Se pinta en el mapa. */
  label: string;
  /** Origen en TILES. Ver la cabecera. */
  x: number;
  y: number;
  /**
   * Siempre `DESK_SIDE`, y viajan igualmente porque los sirve el servidor: un
   * 3 escrito aqui seria una segunda copia que un dia discrepa de la suya.
   */
  w: number;
  h: number;
  /** `null` mientras este libre. */
  occupant: AdminDeskOccupant | null;
}

export interface CreateDeskInput {
  label: string;
  x: number;
  y: number;
}

/**
 * Cambio PARCIAL: renombrar sin mover y mover sin renombrar son dos peticiones
 * distintas. El servidor copia solo las claves presentes, asi que mandar la
 * posicion al renombrar devolveria el escritorio a la ultima que se leyo si
 * alguien lo movio mientras tanto.
 *
 * `x` e `y` van juntas o no van: media coordenada no es una posicion, y el
 * servidor la rechaza con un 400.
 */
export interface UpdateDeskInput {
  label?: string;
  x?: number;
  y?: number;
}

export interface DeskAdminPort {
  /**
   * La unica lectura que el servidor ofrece, y no cuelga de `/admin`: ver la
   * cabecera de `deskAdminClient.ts`. Trae el ocupante ya resuelto, que es lo
   * que permite decir en la misma tabla cuales estan libres y quien esta en
   * los demas.
   */
  listDesks(): Promise<AdminDesk[]>;
  createDesk(input: CreateDeskInput): Promise<AdminDesk>;
  updateDesk(id: string, input: UpdateDeskInput): Promise<AdminDesk>;
  /**
   * Borrado de verdad. Se lleva la ocupacion con el: quien estuviese sentado
   * se queda sin sitio y puede coger otro. El servidor lo permite a proposito,
   * asi que el panel no puede fingir que lo impide.
   */
  deleteDesk(id: string): Promise<void>;
}
