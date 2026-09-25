/**
 * Adaptador de Postgres de `DeskDirectory` (#7, slice 5). Es el unico fichero
 * de la carpeta que sabe SQL, igual que `pgSpaces.ts` y `pgDecor.ts` lo son de
 * lo suyo. Consume la misma forma minima de `pg`
 * (`DirectoryPool`/`DirectoryQueryable`) que ya declara `pgDirectory.ts`, en
 * vez de redeclararla: mismo doble en los tests, mismo `fakePool` posible sin
 * levantar Postgres.
 *
 * ## Coger un escritorio es una CARRERA, no una lectura
 *
 * Dos personas pueden pedir el mismo sitio libre en el mismo instante. Un
 * `SELECT ... WHERE occupant_id IS NULL` seguido de un `UPDATE` tiene una
 * ventana entre las dos consultas: las dos leerian "libre", las dos
 * escribirian, y la unica razon de que no acaben las dos sentadas ahi seria
 * que `desks_single_occupant` mate a la segunda con un error de unicidad que
 * este adaptador no sabe distinguir de una averia.
 *
 * Por eso la condicion vive DENTRO del UPDATE y el numero de filas afectadas
 * ES la respuesta: una fila, es suyo; cero filas, llego tarde. El arbitro es
 * Postgres, y no hay nada entre la comprobacion y la escritura porque son la
 * misma sentencia. Es la misma idea que el `ON CONFLICT (uid)` de
 * `pgDirectory.resolveOnLogin`.
 */

import type {
  CreateDeskInput,
  Desk,
  DeskDirectory,
  DeskOccupant,
  OfficeDesk,
  UpdateDeskInput,
} from './desksPort.ts';
import {
  DESK_SIDE,
  DeskOverlapError,
  DeskSpaceOverlapError,
  DeskTakenError,
  normalizeCreateDeskInput,
  normalizeUpdateDeskInput,
} from './deskRules.ts';
import type { DeskItem } from '../decor/decorPort.ts';
import type { DirectoryPool, DirectoryQueryable } from '../directory/pgDirectory.ts';

/** Codigo de `exclusion_violation` de Postgres: lo que salta `desks_no_overlap`. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === EXCLUSION_VIOLATION;
}

/** Sin `w` ni `h`: no existen como columnas, el escritorio es 3x3 siempre. */
const DESK_COLUMNS = 'id, label, x, y, occupant_id, created_at, updated_at';

/**
 * La lectura de la oficina entera. El JOIN es LEFT y no INNER a proposito: un
 * escritorio libre no tiene fila en `users`, y son justo los que alguien esta
 * mirando para elegir sitio.
 */
const OFFICE_SELECT = `
  SELECT d.id, d.label, d.x, d.y, d.occupant_id, d.created_at, d.updated_at, u.display_name
  FROM desks d
  LEFT JOIN users u ON u.id = d.occupant_id
  ORDER BY d.x, d.y, d.id
`;

/**
 * La decoracion de todos los ocupantes de una vez. Sin `archived_at IS NULL`,
 * igual que `pgDecor.getDeskConfig` y por la misma razon (D1b): esto es una
 * lectura de COLOCACION, y quien ya tenia puesta una pieza retirada la sigue
 * viendo.
 */
const OFFICE_ITEMS_SELECT = `
  SELECT d.id, d.user_id, d.asset_id, d.slot, d.rotation, d.created_at,
         a.texture_key, a.w, a.h, a.name, a.above_avatars
  FROM user_desk_configs d
  JOIN assets a ON a.id = d.asset_id
  WHERE d.user_id = ANY($1::uuid[])
  ORDER BY d.slot
`;

function toDesk(row: Record<string, unknown>): Desk {
  return {
    id: row.id as string,
    label: row.label as string,
    x: row.x as number,
    y: row.y as number,
    occupantId: (row.occupant_id as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toDeskItem(row: Record<string, unknown>): DeskItem {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    slot: row.slot as number,
    rotation: row.rotation as DeskItem['rotation'],
    textureKey: row.texture_key as string,
    w: row.w as number,
    h: row.h as number,
    name: row.name as string,
    // Same read as `pgDecor.toDeskItem`: anything but `true` is a normal asset (#71).
    aboveAvatars: row.above_avatars === true,
    createdAt: row.created_at as Date,
  };
}

export function createPgDesks(pool: DirectoryPool): DeskDirectory {
  /**
   * Misma razon que `pgDirectory.inTransaction`: `pool.query` reparte cada
   * consulta por la conexion que este libre, asi que el BEGIN y el resto de la
   * transaccion podrian acabar en conexiones distintas.
   */
  async function inTransaction<T>(run: (client: DirectoryQueryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function getDesk(id: string): Promise<Desk | null> {
    const result = await pool.query(`SELECT ${DESK_COLUMNS} FROM desks WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toDesk(row) : null;
  }

  /**
   * El cubiculo emparejado con `desk` (D1, D2): un UPSERT sobre `desk_id`, que
   * crea la fila la primera vez y la mueve/renombra las siguientes. La MISMA
   * sentencia sana un escritorio que el backfill de S1a dejo sin cubiculo
   * (tarea 2.4) -- sin fila previa que conflictue por `desk_id`, es
   * sencillamente un INSERT nuevo.
   *
   * `w`/`h`/`capacity` no vienen de `desk`: un cubiculo es SIEMPRE
   * `DESK_SIDE` x `DESK_SIDE` y sin limite de capacidad, igual que
   * `toDeskBody` en `desksRoutes.ts` los deriva y no los guarda.
   *
   * Se llama SIEMPRE dentro de la transaccion de `createDesk`/`updateDesk`, y
   * nunca sola: si `spaces_no_overlap` salta aqui, el ROLLBACK se lleva
   * tambien el escritorio que se acababa de escribir (D2).
   */
  async function syncDeskSpace(client: DirectoryQueryable, desk: Desk): Promise<void> {
    try {
      await client.query(
        `
          INSERT INTO spaces (desk_id, slug, name, x, y, w, h, capacity)
          VALUES ($1, $2, $3, $4, $5, $6, $6, NULL)
          ON CONFLICT (desk_id) DO UPDATE SET
            name = EXCLUDED.name, x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now()
        `,
        [desk.id, `desk-${desk.id}`, desk.label, desk.x, desk.y, DESK_SIDE],
      );
    } catch (error) {
      // `spaces_no_overlap` es la garantia real (aplica a TODAS las filas de
      // `spaces`, salas y cubiculos por igual); esto solo la traduce a un
      // error de dominio DISTINTO del que dispara `desks_no_overlap` (D3): la
      // sentencia que fallo es la que decide cual de los dos 409 es.
      if (isExclusionViolation(error)) {
        throw new DeskSpaceOverlapError('el escritorio solicitado se solapa con una sala existente');
      }
      throw error;
    }
  }

  return {
    async listDesks() {
      const result = await pool.query(`SELECT ${DESK_COLUMNS} FROM desks ORDER BY x, y, id`);
      return result.rows.map(toDesk);
    },

    async listOfficeDesks(): Promise<OfficeDesk[]> {
      const desks = await pool.query(OFFICE_SELECT);

      const occupantIds = [
        ...new Set(
          desks.rows
            .map((row) => row.occupant_id as string | null)
            .filter((id): id is string => id !== null),
        ),
      ];

      // Sin nadie sentado no hay decoracion que pedir. Y con gente sentada se
      // pide UNA vez para todos: una consulta por ocupante convertiria pintar
      // la oficina en tantas idas y vueltas como personas haya.
      const items = occupantIds.length === 0
        ? []
        : (await pool.query(OFFICE_ITEMS_SELECT, [occupantIds])).rows;

      const byUser = new Map<string, DeskItem[]>();
      for (const row of items) {
        const userId = row.user_id as string;
        const list = byUser.get(userId) ?? [];
        list.push(toDeskItem(row));
        byUser.set(userId, list);
      }

      return desks.rows.map((row) => {
        const desk = toDesk(row);
        if (desk.occupantId === null) return { ...desk, occupant: null };

        const occupant: DeskOccupant = {
          id: desk.occupantId,
          displayName: (row.display_name as string | null) ?? null,
          items: byUser.get(desk.occupantId) ?? [],
        };
        return { ...desk, occupant };
      });
    },

    getDesk,

    async createDesk(input: CreateDeskInput) {
      // Validar ANTES de pedir conexion, misma razon que `pgSpaces.createSpace`:
      // una posicion mal escrita no debe costar una consulta.
      const normalized = normalizeCreateDeskInput(input);

      // Dentro de una transaccion (D1): el escritorio y su cubiculo se
      // escriben juntos o ninguno de los dos queda en pie (tarea 2.1, 2.2).
      return inTransaction(async (client) => {
        let desk: Desk;
        try {
          const result = await client.query(
            `
              INSERT INTO desks (label, x, y)
              VALUES ($1, $2, $3)
              RETURNING ${DESK_COLUMNS}
            `,
            [normalized.label, normalized.x, normalized.y],
          );
          // `occupant_id` no se inserta: el DEFAULT es NULL y un escritorio
          // nace libre. Quien se sienta lo decide esa persona, no quien lo crea.
          desk = toDesk(result.rows[0]);
        } catch (error) {
          // `desks_no_overlap` es la garantia real; esto solo traduce su fallo
          // a un error de dominio en vez de un 500 pelado.
          if (isExclusionViolation(error)) {
            throw new DeskOverlapError('el escritorio solicitado se solapa con otro existente');
          }
          throw error;
        }

        await syncDeskSpace(client, desk);
        return desk;
      });
    },

    async updateDesk(id: string, input: UpdateDeskInput) {
      // Igual que en `createDesk`: valida ANTES de tocar el pool.
      const patch = normalizeUpdateDeskInput(input);

      if (Object.keys(patch).length === 0) {
        // Un patch vacio no tiene nada que cambiar: relee en vez de mandar un
        // UPDATE cuyo unico efecto seria pisar `updated_at` sin motivo, y sin
        // abrir ninguna transaccion -- nada cambio, asi que el cubiculo
        // tampoco tiene nada que resincronizar.
        return getDesk(id);
      }

      // `patch` solo puede traer `label`, `x` e `y` (lo garantiza
      // `normalizeUpdateDeskInput`), asi que `occupant_id` no entra nunca por
      // aqui: mover o renombrar un escritorio no levanta a quien lo ocupa.
      const fields = Object.keys(patch) as (keyof typeof patch)[];
      const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
      const values = fields.map((field) => patch[field]);

      // Igual que `createDesk`: cualquier escritura no vacia resincroniza el
      // cubiculo, no solo un movimiento (tarea 2.3). Es lo que autosana un
      // escritorio que el backfill dejo sin cubiculo en cuanto deja de chocar
      // (tarea 2.4): el UPSERT de `syncDeskSpace` no distingue "ya tenia uno"
      // de "nunca llego a tener uno".
      return inTransaction(async (client) => {
        let desk: Desk | null;
        try {
          const result = await client.query(
            `
              UPDATE desks SET ${setClause}, updated_at = now()
              WHERE id = $1
              RETURNING ${DESK_COLUMNS}
            `,
            [id, ...values],
          );
          const row = result.rows[0];
          desk = row ? toDesk(row) : null;
        } catch (error) {
          if (isExclusionViolation(error)) {
            throw new DeskOverlapError('el escritorio solicitado se solapa con otro existente');
          }
          throw error;
        }

        // Ese id no existe: nada que sincronizar, y el 404 lo decide la ruta.
        if (desk === null) return null;

        await syncDeskSpace(client, desk);
        return desk;
      });
    },

    async deleteDesk(id: string) {
      // Borrado de verdad, sin `archived_at` (mismo criterio que
      // `deleteSpace`). La ocupacion se va con la fila: quien estuviese
      // sentado se queda sin sitio, que es lo correcto -- el escritorio ya no
      // existe -- y puede coger otro sin chocar con `desks_single_occupant`.
      //
      // El cubiculo emparejado NO se borra aqui: `spaces.desk_id ... ON DELETE
      // CASCADE` (schema.sql, S1a) ya se lo lleva. Un DELETE aparte duplicaria
      // lo que la base de datos garantiza sola (tarea 2.3).
      const result = await pool.query('DELETE FROM desks WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async claimDesk(deskId: string, userId: string) {
      try {
        return await inTransaction(async (client) => {
          // El anterior se suelta PRIMERO y en esta misma transaccion.
          // `desks_single_occupant` es un indice unico que se comprueba al
          // vuelo, asi que reclamar el nuevo con el viejo todavia puesto
          // moriria con una violacion de unicidad y esa persona se quedaria
          // atrapada justo en el sitio que queria dejar.
          //
          // `id <> $2` excluye el que se esta pidiendo: soltarlo y volver a
          // cogerlo abriria una ventana en la que el sitio propio esta libre
          // para cualquiera, justo al refrescar la pagina.
          await client.query(
            'UPDATE desks SET occupant_id = NULL, updated_at = now() WHERE occupant_id = $1 AND id <> $2',
            [userId, deskId],
          );

          // El UPDATE condicional: la comprobacion y la escritura son la MISMA
          // sentencia, asi que no hay ventana entre ellas. `occupant_id = $1`
          // en la condicion es lo que hace que pedir el propio sea un exito
          // sin efecto en vez de un conflicto contra uno mismo, y va aqui y no
          // en una lectura previa para no reintroducir el read-then-write por
          // la puerta de atras.
          const claimed = await client.query(
            `
              UPDATE desks SET occupant_id = $1, updated_at = now()
              WHERE id = $2 AND (occupant_id IS NULL OR occupant_id = $1)
              RETURNING ${DESK_COLUMNS}
            `,
            [userId, deskId],
          );

          if (claimed.rows.length === 0) {
            // Cero filas es la respuesta de Postgres: llego tarde. Se lanza
            // para que el ROLLBACK devuelva el escritorio que se acaba de
            // soltar -- quedarse sin el viejo y sin el nuevo seria peor que no
            // haber pedido nada.
            throw new DeskTakenError('ese escritorio ya lo ocupa otra persona');
          }

          return toDesk(claimed.rows[0]);
        });
      } catch (error) {
        if (error instanceof DeskTakenError) {
          // Cero filas tambien es lo que devuelve un id que no existe, y eso
          // es un 404 y no un 409. La consulta que los separa va DESPUES y
          // fuera de la transaccion, ya deshecha: no decide nada, solo explica
          // un fallo que ya ocurrio, asi que no reintroduce ninguna carrera.
          if ((await getDesk(deskId)) === null) return null;
        }
        throw error;
      }
    },

    async releaseDesk(userId: string) {
      // Acotado por el OCUPANTE y nunca por un id de escritorio: quien suelta
      // solo puede soltar lo suyo. Cero filas afectadas es un exito -- soltar
      // sin tener nada tiene que poder pasar sin que el cliente se acuerde de
      // comprobarlo antes.
      await pool.query(
        'UPDATE desks SET occupant_id = NULL, updated_at = now() WHERE occupant_id = $1',
        [userId],
      );
    },
  };
}
