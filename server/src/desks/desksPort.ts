/**
 * Puerto de los escritorios asignables (#7, slice 5). Solo tipos: aqui no hay
 * ni SQL ni `pg` ni Express ni Colyseus, misma regla que `directoryPort.ts`,
 * `spacesPort.ts` y `decorPort.ts`. Los adaptadores son `pgDesks.ts` (el de
 * produccion) y `memoryDesks.ts` (para probar las rutas sin base de datos).
 *
 * ## Dos personas, dos superficies
 *
 * Lo que este puerto separa no son dos entidades sino dos ROLES, y esa es la
 * razon de que `claimDesk`/`releaseDesk` no sean un `updateDesk` mas:
 *
 *   - El administrador decide CUANTOS escritorios hay y DONDE estan:
 *     `createDesk`, `updateDesk`, `deleteDesk`. Y nada mas: no reparte sitios.
 *   - Cada persona elige el SUYO entre los libres y lo deja cuando quiere,
 *     tipicamente para sentarse cerca de su grupo: `claimDesk`, `releaseDesk`.
 *     Por orden de llegada, sin cola ni reserva.
 *
 * Un `updateDesk({ occupantId })` haria que el administrador pudiese sentar y
 * levantar gente, que es exactamente la funcion que este diseno no quiere
 * tener, y ademas dejaria la carrera de `claimDesk` (dos personas pidiendo el
 * mismo sitio en el mismo instante) escondida dentro de un patch generico.
 *
 * ## La decoracion NO cuelga de aqui
 *
 * `user_desk_configs` esta indexada por `user_id`, asi que la decoracion de
 * alguien le SIGUE al escritorio que ocupe. Es una propiedad del esquema que
 * ya existia y que esta slice se limita a no romper: una columna `desk_id`
 * alla anclaria la decoracion a un sitio y se la borraria a esa persona en
 * cuanto se mudase a otro. Por eso `DeskOccupant` TRAE los items en vez de
 * apuntar a ellos: quien los resuelve es el ocupante, no el escritorio.
 */

import type { DeskItem } from '../decor/decorPort.ts';

export interface Desk {
  id: string;
  /** Como lo llama la oficina ("Mesa 4"). Se pinta en el mapa. */
  label: string;
  /**
   * Origen en TILES, no en pixeles. Misma unidad que `Space`. El tamano NO
   * viaja: son `DESK_SIDE` x `DESK_SIDE` siempre (ver `deskRules.ts`).
   */
  x: number;
  y: number;
  /** `null` mientras este libre. Una persona ocupa como mucho uno (`desks_single_occupant`). */
  occupantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Quien ocupa un escritorio, con su decoracion ya resuelta.
 *
 * `displayName` viaja porque el cliente no tiene otra forma de casar esta fila
 * con el avatar que ya esta pintando: el estado de Colyseus identifica a cada
 * jugador por su nombre, y `occupantId` es el id del directorio, que alli no
 * aparece.
 */
export interface DeskOccupant {
  id: string;
  displayName: string | null;
  /** Su decoracion. Le sigue de escritorio en escritorio: ver la cabecera. */
  items: DeskItem[];
}

/**
 * Un escritorio con su ocupante resuelto. Es lo que devuelve
 * `listOfficeDesks`, y lo que el cliente necesita para pintar la oficina de
 * una sola vez.
 */
export interface OfficeDesk extends Desk {
  occupant: DeskOccupant | null;
}

export interface CreateDeskInput {
  label: string;
  x: number;
  y: number;
}

/**
 * Los dos campos son opcionales: `updateDesk` acepta un cambio parcial
 * (renombrar sin mover, mover sin renombrar). `occupantId` NO esta, y su
 * ausencia es deliberada: ver la cabecera.
 */
export interface UpdateDeskInput {
  label?: string;
  x?: number;
  y?: number;
}

export interface DeskDirectory {
  /** Orden deterministico (x, y, id), igual que `listSpaces`. */
  listDesks(): Promise<Desk[]>;
  /**
   * Todo lo que hace falta para dibujar la oficina: cada escritorio, su
   * ocupante y la decoracion de ese ocupante. En una llamada y no en tres,
   * porque partirla obligaria al cliente a cruzar las tres listas y a decidir
   * el que hacer cuando lleguen desfasadas.
   */
  listOfficeDesks(): Promise<OfficeDesk[]>;
  getDesk(id: string): Promise<Desk | null>;
  createDesk(input: CreateDeskInput): Promise<Desk>;
  /** Devuelve null si ese id no existe. */
  updateDesk(id: string, input: UpdateDeskInput): Promise<Desk | null>;
  /**
   * Borrado de verdad, sin `archived_at` (mismo criterio que `deleteSpace`).
   * Se lleva la ocupacion con el: quien estuviese sentado se queda sin sitio,
   * que es lo correcto -- el escritorio ya no existe. Devuelve false si ese id
   * no existia.
   */
  deleteDesk(id: string): Promise<boolean>;
  /**
   * Sienta a `userId` en `deskId`, soltando en la MISMA transaccion el que
   * tuviese antes. Tres salidas y ninguna ambigua:
   *
   *   - el escritorio, cuando lo consigue (o cuando ya era suyo: pedir el
   *     propio es un exito sin efecto, no un conflicto contra uno mismo);
   *   - `null` cuando ese id no existe;
   *   - `DeskTakenError` cuando lo tiene otra persona. Es una CARRERA, no un
   *     estado que se pueda leer antes: ver `pgDesks.claimDesk`.
   */
  claimDesk(deskId: string, userId: string): Promise<Desk | null>;
  /** Suelta lo que tenga esa persona. Idempotente: soltar dos veces no es un error. */
  releaseDesk(userId: string): Promise<void>;
}
