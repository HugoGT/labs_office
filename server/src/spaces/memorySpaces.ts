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
  boundsOverlap,
  hashSpaces,
  normalizeCreateSpaceInput,
  normalizeUpdateSpaceInput,
  type CanonicalSpace,
} from './spaceRules.ts';

export interface MemorySpacesOptions {
  /** Espacios de partida, en la forma canonica de `builtInSeed.ts`. */
  seed?: readonly CanonicalSpace[];
  /** Reloj inyectado: sin el, `createdAt` dependeria de la hora de la maquina. */
  now?: () => Date;
  /** Generador de ids inyectable, para que un test pueda fijarlos. */
  newId?: () => string;
}

export function createMemorySpaces(options: MemorySpacesOptions = {}): SpacesDirectory {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const spaces = new Map<string, Space>();
  const layouts = new Map<string, SpaceLayout[]>();

  for (const seeded of options.seed ?? []) {
    const at = now();
    spaces.set(seeded.id, { ...seeded, createdAt: at, updatedAt: at });
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
      if (existing.slug.toLowerCase() === slug || existing.name.toLowerCase() === name) {
        throw new SpaceNameTakenError('ya existe un espacio con ese nombre');
      }
    }
  }

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
      const space: Space = { id: newId(), ...normalized, createdAt: at, updatedAt: at };
      spaces.set(space.id, space);
      return space;
    },

    async updateSpace(id: string, input: UpdateSpaceInput) {
      const patch = normalizeUpdateSpaceInput(input);
      const current = spaces.get(id);
      if (!current) return null;

      // El patch vacio relee sin tocar `updatedAt`, igual que `pgSpaces`.
      if (Object.keys(patch).length === 0) return current;

      const next: Space = { ...current, ...patch, updatedAt: now() };
      assertNameFree(next, id);
      assertNoOverlap(next, id);
      spaces.set(id, next);
      return next;
    },

    async deleteSpace(id: string) {
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
  };
}
