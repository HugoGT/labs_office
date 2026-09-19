/**
 * Adaptador de `DeskDirectory` en memoria (#7, slice 5). Mismo papel y misma
 * justificacion que `memorySpaces.ts` y `memoryDecor.ts`: no es un mock de
 * conveniencia, es el segundo adaptador del puerto.
 *
 * Existe porque las rutas de esta slice tienen salidas que solo valen algo si
 * se recorren de verdad -- 400 por coordenadas invalidas, 409 por solape, 409
 * por escritorio ya ocupado y 404 por id inexistente -- y un doble que
 * devolviese siempre lo que al test le conviene no recorreria ninguna.
 * Comparte `deskRules.ts` con `pgDesks.ts` para que los dos validen lo mismo.
 *
 * Lo que NO reproduce es el arbitraje real de la concurrencia: aqui no hay
 * transaccion, solo `Map`s de un hilo. La garantia de verdad de que dos
 * personas no acaban en el mismo escritorio es el UPDATE condicional de
 * `pgDesks.claimDesk` sobre `desks_single_occupant`; aqui se reproduce su
 * RESULTADO observable (el segundo recibe `DeskTakenError`) para que las
 * pruebas de las rutas digan algo, no su mecanismo. Es la misma diferencia que
 * ya hay entre `memorySpaces` y `EXCLUDE USING gist`.
 *
 * `seed`, `newId`, `directory` y `decor` NO son del puerto: son afordancias de
 * este adaptador para los tests, igual que `seed`/`newId` en `memorySpaces.ts`.
 * En Postgres el ocupante y su decoracion salen de un JOIN que siempre esta
 * ahi; aqui hay que inyectar de donde sale cada cosa.
 */

import { randomUUID } from 'node:crypto';
import type { DecorCatalog } from '../decor/decorPort.ts';
import type { UserDirectory } from '../directory/directoryPort.ts';
import type {
  CreateDeskInput,
  Desk,
  DeskDirectory,
  OfficeDesk,
  UpdateDeskInput,
} from './desksPort.ts';
import {
  DeskOverlapError,
  DeskTakenError,
  deskBoundsOverlap,
  normalizeCreateDeskInput,
  normalizeUpdateDeskInput,
} from './deskRules.ts';

export interface MemoryDesksOptions {
  /** Escritorios de partida. */
  seed?: readonly Desk[];
  /** Reloj inyectado: sin el, `createdAt` dependeria de la hora de la maquina. */
  now?: () => Date;
  /** Generador de ids inyectable, para que un test pueda fijarlos. */
  newId?: () => string;
  /**
   * De donde sale el nombre del ocupante en `listOfficeDesks`. Sin el, un
   * escritorio ocupado se resuelve con `displayName: null` -- que es lo mismo
   * que devuelve el JOIN de `pgDesks` cuando la fila del usuario no tiene
   * nombre, asi que no inventa un caso que Postgres no pueda dar.
   */
  directory?: Pick<UserDirectory, 'findById'>;
  /**
   * De donde sale la decoracion del ocupante en `listOfficeDesks`. Sin el, un
   * ocupante se resuelve sin items: exactamente lo que devuelve la consulta de
   * `pgDesks` para quien no ha decorado nada.
   */
  decor?: Pick<DecorCatalog, 'getDeskConfig'>;
}

export function createMemoryDesks(options: MemoryDesksOptions = {}): DeskDirectory {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const desks = new Map<string, Desk>();
  for (const seeded of options.seed ?? []) {
    desks.set(seeded.id, { ...seeded });
  }

  /**
   * `exceptId` existe para `updateDesk`: mover un escritorio a un sitio que se
   * solapa con SU PROPIA posicion previa es legal, porque el area vieja deja
   * de existir en el mismo movimiento. Sin esta exclusion, moverlo un tile a
   * la derecha chocaria consigo mismo. Mismo argumento que en `memorySpaces`.
   */
  function assertNoOverlap(position: { x: number; y: number }, exceptId?: string): void {
    for (const existing of desks.values()) {
      if (existing.id === exceptId) continue;
      if (deskBoundsOverlap(position, existing)) {
        throw new DeskOverlapError('el escritorio solicitado se solapa con otro existente');
      }
    }
  }

  /** Mismo orden que `pgDesks`: (x, y, id). */
  function sorted(): Desk[] {
    return [...desks.values()].sort(
      (a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id),
    );
  }

  function holderOf(userId: string): Desk | undefined {
    return [...desks.values()].find((desk) => desk.occupantId === userId);
  }

  return {
    async listDesks() {
      return sorted();
    },

    async listOfficeDesks(): Promise<OfficeDesk[]> {
      const office: OfficeDesk[] = [];

      for (const desk of sorted()) {
        if (desk.occupantId === null) {
          office.push({ ...desk, occupant: null });
          continue;
        }

        // El nombre y la decoracion se resuelven por separado porque vienen de
        // dos almacenes distintos; en `pgDesks` son un JOIN y una segunda
        // consulta acotada. Lo que tiene que coincidir es la FORMA del
        // resultado, no el numero de lecturas.
        const user = await options.directory?.findById(desk.occupantId);
        const items = (await options.decor?.getDeskConfig(desk.occupantId)) ?? [];
        office.push({
          ...desk,
          occupant: { id: desk.occupantId, displayName: user?.displayName ?? null, items },
        });
      }

      return office;
    },

    async getDesk(id: string) {
      return desks.get(id) ?? null;
    },

    async createDesk(input: CreateDeskInput) {
      const normalized = normalizeCreateDeskInput(input);
      assertNoOverlap(normalized);

      const at = now();
      // `occupantId: null` explicito: un escritorio NACE libre. Quien se
      // sienta lo decide esa persona con `claimDesk`, no quien lo crea.
      const desk: Desk = { id: newId(), ...normalized, occupantId: null, createdAt: at, updatedAt: at };
      desks.set(desk.id, desk);
      return desk;
    },

    async updateDesk(id: string, input: UpdateDeskInput) {
      const patch = normalizeUpdateDeskInput(input);
      const current = desks.get(id);
      if (!current) return null;

      // El patch vacio relee sin tocar `updatedAt`, igual que `pgDesks`.
      if (Object.keys(patch).length === 0) return current;

      // `occupantId` se arrastra del actual y nunca del patch: mover o
      // renombrar un escritorio no levanta a quien lo ocupa.
      const next: Desk = { ...current, ...patch, updatedAt: now() };
      assertNoOverlap(next, id);
      desks.set(id, next);
      return next;
    },

    async deleteDesk(id: string) {
      // La ocupacion se va con la fila, que es lo que hace Postgres al borrar:
      // esa persona se queda sin sitio y puede coger otro. Conservarla la
      // dejaria atrapada en un escritorio que ya no existe.
      return desks.delete(id);
    },

    async claimDesk(deskId: string, userId: string) {
      const desk = desks.get(deskId);
      if (!desk) return null;

      // Ocupado por OTRA persona. Por uno mismo no: pedir el propio es un
      // exito sin efecto, no un conflicto contra uno mismo.
      if (desk.occupantId !== null && desk.occupantId !== userId) {
        throw new DeskTakenError('ese escritorio ya lo ocupa otra persona');
      }

      // Soltar el anterior es parte de la MISMA operacion. En `pgDesks` es la
      // misma transaccion, y por la misma razon: `desks_single_occupant`
      // rechazaria el nuevo y esa persona se quedaria atrapada justo en el
      // sitio que queria dejar.
      const previous = holderOf(userId);
      if (previous && previous.id !== deskId) {
        desks.set(previous.id, { ...previous, occupantId: null, updatedAt: now() });
      }

      const claimed: Desk = { ...desk, occupantId: userId, updatedAt: now() };
      desks.set(deskId, claimed);
      return claimed;
    },

    async releaseDesk(userId: string) {
      const held = holderOf(userId);
      // Sin sitio no hay nada que soltar, y eso NO es un error: soltar dos
      // veces tiene que poder pasar sin que el cliente tenga que acordarse.
      if (!held) return;
      desks.set(held.id, { ...held, occupantId: null, updatedAt: now() });
    },
  };
}
