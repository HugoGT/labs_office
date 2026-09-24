/**
 * Adaptador de `SpacesDirectory` en memoria (#7, slice 3). Mismo papel y misma
 * justificacion que `memoryDirectory.ts`: no es un mock de conveniencia, es el
 * segundo adaptador del puerto.
 *
 * Existe porque las rutas HTTP de espacios tienen tres salidas de error que
 * solo valen algo si se prueban de verdad -- 400 por rectangulo invalido, 409
 * por solape y 404 por id inexistente -- y un doble que devolviese siempre lo
 * que al test le conviene nunca las recorreria. Comparte `spaceRules.ts` con
 * `pgSpaces.ts` para que ambos deriven el mismo slug, validen lo mismo y
 * hasheen lo mismo: sin eso, una ruta probada contra este adaptador no diria
 * nada sobre la misma ruta corriendo contra Postgres.
 *
 * Lo unico que NO reproduce es el arbitraje real de la concurrencia. La
 * garantia de no solape en produccion es `EXCLUDE USING gist` en `schema.sql`,
 * que es atomica; aqui el pre-chequeo de `boundsOverlap` corre sobre un array
 * de un solo hilo. Es la misma diferencia que ya hay entre `memoryDirectory` y
 * el indice parcial del superadmin, y por la misma razon es aceptable: lo que
 * estas pruebas cubren es la traduccion a HTTP, no el aislamiento del motor.
 *
 * `seed` y `newId` NO son del puerto: son afordancias de este adaptador para
 * los tests, igual que `seed`/`auditLog` en `memoryDirectory.ts`.
 */

import { randomUUID } from 'node:crypto';
import { DESK_SIDE, DeskSpaceOverlapError } from '../desks/deskRules.ts';
import type { MemoryDeskSpaces } from '../desks/memoryDesks.ts';
import type {
  CreateSpaceInput,
  LayoutItemInput,
  Space,
  SpaceLayout,
  SpacesDirectory,
  UpdateSpaceInput,
} from './spacesPort.ts';
import {
  SpaceNameTakenError,
  SpaceOverlapError,
  SpaceOwnedByDeskError,
  boundsOverlap,
  hashSpaces,
  normalizeCreateSpaceInput,
  normalizeUpdateSpaceInput,
  type CanonicalSpace,
  type SpaceBounds,
} from './spaceRules.ts';

export interface MemorySpacesOptions {
  /** Espacios de partida, en la forma canonica de `builtInSeed.ts`. */
  seed?: readonly CanonicalSpace[];
  /** Reloj inyectado: sin el, `createdAt` dependeria de la hora de la maquina. */
  now?: () => Date;
  /** Generador de ids inyectable, para que un test pueda fijarlos. */
  newId?: () => string;
}

export function createMemorySpaces(
  options: MemorySpacesOptions = {},
): SpacesDirectory & { deskSpaces: MemoryDeskSpaces } {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const spaces = new Map<string, Space>();
  const layouts = new Map<string, SpaceLayout[]>();

  for (const seeded of options.seed ?? []) {
    const at = now();
    // Los espacios de partida son siempre salas: este adaptador todavia no
    // sabe crear cubiculos de escritorio (llega en S1b, tarea 2.5).
    spaces.set(seeded.id, { ...seeded, deskId: null, createdAt: at, updatedAt: at });
  }

  function canonical(): CanonicalSpace[] {
    return [...spaces.values()].map(({ id, slug, name, x, y, w, h, capacity }) => ({
      id,
      slug,
      name,
      x,
      y,
      w,
      h,
      capacity,
    }));
  }

  /**
   * `exceptId` existe para `updateSpace`: mover un espacio a un sitio que se
   * solapa con SU PROPIA posicion previa es legal, porque el rectangulo viejo
   * deja de existir en el mismo movimiento. Sin esta exclusion, mover un
   * espacio un tile a la derecha chocaria consigo mismo.
   */
  function assertNoOverlap(bounds: { x: number; y: number; w: number; h: number }, exceptId?: string): void {
    for (const existing of spaces.values()) {
      if (existing.id === exceptId) continue;
      if (boundsOverlap(bounds, existing)) {
        throw new SpaceOverlapError('el rectangulo solicitado se solapa con un espacio existente');
      }
    }
  }

  /**
   * El equivalente de `spaces_slug_unique` y `spaces_name_unique`, los dos
   * sobre `lower(...)`. Se reproducen aqui por la misma razon que
   * `assertNoOverlap` reproduce `EXCLUDE USING gist`: sin esto, un test de ruta
   * pasaria contra este adaptador y la misma peticion daria un 500 contra
   * Postgres, que es justo el desfase que este fichero existe para evitar.
   *
   * Se comprueban los DOS y no solo el slug aunque casi siempre coincidan: son
   * dos indices distintos en `schema.sql`, y reproducir uno solo seria dar por
   * bueno un alta que la base de datos puede rechazar.
   *
   * `exceptId` existe por lo mismo que en `assertNoOverlap`: en Postgres el
   * UPDATE reemplaza la entrada de indice de su propia fila, asi que
   * renombrarse a si mismo no choca. Sin la exclusion, un nombre mal escrito
   * seria imposible de corregir.
   */
  function assertNameFree(candidate: { slug: string; name: string }, exceptId?: string): void {
    const slug = candidate.slug.toLowerCase();
    const name = candidate.name.toLowerCase();
    for (const existing of spaces.values()) {
      if (existing.id === exceptId) continue;
      // `spaces_room_name_unique` (schema.sql, S1a) es `WHERE desk_id IS
      // NULL`: solo compara SALAS entre si. Un cubiculo de escritorio se
      // llama como se llame el escritorio, y eso nunca deberia bloquear (ni
      // ser bloqueado por) el nombre de una sala nueva (#10 + #12).
      if (existing.deskId !== null) continue;
      if (existing.slug.toLowerCase() === slug || existing.name.toLowerCase() === name) {
        throw new SpaceNameTakenError('ya existe un espacio con ese nombre');
      }
    }
  }

  /** El area fija de un cubiculo de escritorio: DESK_SIDE x DESK_SIDE, mismo tamano que `pgDesks.syncDeskSpace`. */
  function deskBounds(desk: { x: number; y: number }): SpaceBounds {
    return { x: desk.x, y: desk.y, w: DESK_SIDE, h: DESK_SIDE };
  }

  function findDeskSpace(deskId: string): Space | undefined {
    return [...spaces.values()].find((space) => space.deskId === deskId);
  }

  /**
   * Espejo en memoria de `pgDesks.syncDeskSpace` (#10 + #12, tarea 2.5):
   * comparte el `spaces` Map de este adaptador, asi que lo que escribe aqui lo
   * ve inmediatamente `listSpaces`/`getSpace`. No es del puerto
   * `SpacesDirectory` -- es la afordancia que `memoryDesks` necesita para
   * mantener el cubiculo de un escritorio sincronizado sin depender de
   * Postgres.
   */
  const deskSpaces: MemoryDeskSpaces = {
    assertDeskFits(desk) {
      const bounds = deskBounds(desk);
      for (const existing of spaces.values()) {
        // El cubiculo ANTERIOR de este mismo escritorio no cuenta: moverse
        // dentro de su propia area vieja es legal, mismo argumento que
        // `assertNoOverlap`/`exceptId`.
        if (existing.deskId === desk.id) continue;
        if (boundsOverlap(bounds, existing)) {
          throw new DeskSpaceOverlapError('el escritorio solicitado se solapa con una sala existente');
        }
      }
    },

    upsertDeskSpace(desk) {
      const at = now();
      const current = findDeskSpace(desk.id);
      const bounds = deskBounds(desk);
      if (current) {
        spaces.set(current.id, { ...current, name: desk.label, ...bounds, updatedAt: at });
        return;
      }
      const space: Space = {
        id: newId(),
        slug: `desk-${desk.id}`,
        name: desk.label,
        ...bounds,
        capacity: null,
        deskId: desk.id,
        createdAt: at,
        updatedAt: at,
      };
      spaces.set(space.id, space);
    },

    removeDeskSpace(deskId) {
      const current = findDeskSpace(deskId);
      if (!current) return;
      // Misma cascada a mano que `deleteSpace`: sin ella el layout de un
      // cubiculo borrado quedaria huerfano en el Map.
      layouts.delete(current.id);
      spaces.delete(current.id);
    },
  };

  return {
    async listSpaces() {
      // Mismo orden que `pgSpaces`: (x, y, id).
      return [...spaces.values()].sort(
        (a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id),
      );
    },

    async getSpace(id: string) {
      return spaces.get(id) ?? null;
    },

    async createSpace(input: CreateSpaceInput) {
      const normalized = normalizeCreateSpaceInput(input);
      assertNameFree(normalized);
      assertNoOverlap(normalized);

      const at = now();
      // `createSpace` solo crea salas (deskId: null): un cubiculo de
      // escritorio nunca nace por esta ruta, solo como efecto secundario del
      // CRUD de escritorios (`pgDesks`, S1b).
      const space: Space = { id: newId(), ...normalized, deskId: null, createdAt: at, updatedAt: at };
      spaces.set(space.id, space);
      return space;
    },

    async updateSpace(id: string, input: UpdateSpaceInput) {
      const patch = normalizeUpdateSpaceInput(input);
      const current = spaces.get(id);
      if (!current) return null;

      // El patch vacio relee sin tocar `updatedAt`, igual que `pgSpaces`
      // (mismo comportamiento: la relectura de un patch vacio NO comprueba
      // `deskId`, mirroring exacto de `pgSpaces.updateSpace`, S1a).
      if (Object.keys(patch).length === 0) return current;

      // Un cubiculo de escritorio NO se administra por esta ruta -- solo como
      // efecto secundario del CRUD de escritorios (#10 + #12, tarea 1.4,
      // mirroring de `pgSpaces.updateSpace`, pgSpaces.ts:164-208).
      if (current.deskId !== null) {
        throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio y no se administra aqui');
      }

      const next: Space = { ...current, ...patch, updatedAt: now() };
      assertNameFree(next, id);
      assertNoOverlap(next, id);
      spaces.set(id, next);
      return next;
    },

    async deleteSpace(id: string) {
      const current = spaces.get(id);
      if (!current) return false;

      // Misma exclusion que `updateSpace`, mirroring de `pgSpaces.deleteSpace`.
      if (current.deskId !== null) {
        throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio y no se administra aqui');
      }

      // La cascada de `space_layouts` la hace `ON DELETE CASCADE` en
      // `schema.sql`; aqui se reproduce a mano para que el comportamiento
      // observable sea el mismo.
      layouts.delete(id);
      return spaces.delete(id);
    },

    async listLayout(spaceId: string) {
      return [...(layouts.get(spaceId) ?? [])].sort(
        (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
      );
    },

    async replaceLayout(spaceId: string, items: readonly LayoutItemInput[]) {
      const at = now();
      const rows = items.map((item) => ({ id: newId(), spaceId, ...item, createdAt: at }));
      layouts.set(spaceId, rows);
      return rows;
    },

    async version() {
      return hashSpaces(canonical());
    },

    deskSpaces,
  };
}
