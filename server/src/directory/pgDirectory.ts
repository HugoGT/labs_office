/**
 * Adaptador de Postgres del directorio de usuarios (#24). Es el unico fichero
 * del directorio que sabe SQL; el puerto, la decision de acceso y las reglas de
 * la invitacion no lo saben, igual que `verifyIdToken.ts` no sabe nada de
 * Express.
 *
 * No recibe un `pg.Pool` concreto sino la forma minima que necesita
 * (`DirectoryPool`): asi los tests inyectan un ejecutor de mentira y afirman
 * sobre la forma del SQL y los parametros sin levantar una base de datos. Una
 * suite que exige infraestructura acaba sin correrse, y entonces no protege.
 *
 * ## La regla de bootstrap del superadmin, y por que es asi
 *
 * El primer login se promociona a `superadmin` SOLO si el email verificado del
 * token coincide (sin distinguir mayusculas) con `BOOTSTRAP_SUPERADMIN_EMAIL` Y
 * ademas no existe ya un superadmin. Todos los demas entran como `employee`.
 *
 * Lo tentador seria "el primero que entre manda", y es exactamente lo que no se
 * hace: la URL de la oficina es publica y el alta la controla Identity
 * Platform, asi que "el primero" seria una carrera por quedarse el mando, que
 * la gana quien este mirando en el momento del despliegue. Atarlo a un email
 * concreto convierte la promocion en una decision tomada de antemano por quien
 * configura el entorno.
 *
 * La segunda mitad (`NOT EXISTS`) es la que impide que sea una puerta trasera
 * permanente: una vez hay superadmin, volver a poner ese email en el entorno no
 * recupera nada. Y no vive solo aqui: `schema.sql` tiene un indice unico
 * parcial que hace fisicamente imposible un segundo superadmin. Este `CASE` es
 * la version amable y el indice es la garantia -- si dos logins simultaneos
 * pasan a la vez por el `NOT EXISTS`, Postgres deja entrar a uno y al otro le
 * devuelve 23505, que abajo se reintenta.
 *
 * ## Por que `resolveOnLogin` es UNA sentencia
 *
 * Un SELECT y luego un INSERT dejan una ventana entre los dos: dos pestanas
 * abriendo sesion a la vez pasan ambas por el "no existe" y la segunda revienta
 * contra el indice de `uid`. Con `ON CONFLICT (uid)` la carrera la resuelve
 * Postgres, que es el unico que puede.
 */

import type {
  AccountStatus,
  CreateInvitationInput,
  DirectoryUser,
  InvitationRow,
  Role,
  UserDirectory,
} from './directoryPort.ts';
import { normalizeEmail, normalizeInvitationInput } from './invitationRules.ts';

/**
 * La forma minima de `pg` que usa este fichero. Declararla aqui (en vez de
 * importar los tipos de `pg`) es lo que permite inyectar un doble en los tests
 * sin fingir un `Pool` entero, y deja claro de un vistazo cuanto de `pg` se
 * esta usando de verdad: consultar, tomar una conexion y cerrar.
 */
export interface DirectoryQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface DirectoryQueryable {
  query(text: string, values?: unknown[]): Promise<DirectoryQueryResult>;
}

export interface DirectoryPoolClient extends DirectoryQueryable {
  release(): void;
}

export interface DirectoryPool extends DirectoryQueryable {
  connect(): Promise<DirectoryPoolClient>;
  end(): Promise<void>;
}

/** Codigo de `unique_violation` de Postgres. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

/** Columnas de `users` en el orden y con el alias que espera `toDirectoryUser`. */
const USER_COLUMNS =
  'id, uid, email, display_name, role, status, expires_at, invited_by, created_at';

/**
 * Traduce la fila cruda de `pg` al tipo del puerto. `pg` ya devuelve `Date` para
 * `timestamptz` y `null` para los nulos, asi que aqui no se parsea nada: lo
 * unico que pasa es el cambio de snake_case a camelCase, que es precisamente el
 * detalle de almacenamiento que el resto de la aplicacion no tiene por que
 * conocer.
 */
function toDirectoryUser(row: Record<string, unknown>): DirectoryUser {
  return {
    id: row.id as string,
    uid: (row.uid as string | null) ?? null,
    email: row.email as string,
    displayName: (row.display_name as string | null) ?? null,
    role: row.role as Role,
    status: row.status as AccountStatus,
    expiresAt: (row.expires_at as Date | null) ?? null,
    invitedBy: (row.invited_by as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toInvitationRow(row: Record<string, unknown>): InvitationRow {
  return {
    ...toDirectoryUser(row),
    invitedByEmail: (row.invited_by_email as string | null) ?? null,
  };
}

/**
 * `lower($2)` aunque el email ya llegue normalizado desde `invitationRules`: la
 * normalizacion en JavaScript es la conveniencia y esta es la garantia, en el
 * unico sitio por el que pasan todas las escrituras. El email de bootstrap va
 * como PARAMETRO y no interpolado: viene del entorno, pero un entorno con una
 * comilla dentro no tiene por que poder reescribir la sentencia.
 */
const RESOLVE_ON_LOGIN_SQL = `
  INSERT INTO users (uid, email, display_name, role, status)
  VALUES ($1, lower($2), $3,
    CASE WHEN $4::text IS NOT NULL AND lower($2) = lower($4)
              AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin')
         THEN 'superadmin' ELSE 'employee' END,
    'active')
  ON CONFLICT (uid) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING ${USER_COLUMNS}
`;

export interface PgDirectoryConfig {
  bootstrapSuperadminEmail: string | null;
}

export function createPgDirectory(
  pool: DirectoryPool,
  config: PgDirectoryConfig,
): UserDirectory {
  const bootstrapEmail = config.bootstrapSuperadminEmail
    ? normalizeEmail(config.bootstrapSuperadminEmail)
    : null;

  async function findOne(where: string, value: string): Promise<DirectoryUser | null> {
    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE ${where} = $1`,
      [value],
    );
    const row = result.rows[0];
    return row ? toDirectoryUser(row) : null;
  }

  /**
   * Ejecuta dentro de una transaccion sobre UNA conexion tomada del pool.
   * `pool.query` no vale aqui: reparte cada consulta por la conexion que este
   * libre, asi que el BEGIN y el INSERT podrian acabar en conexiones distintas
   * y la transaccion no existiria -- con el agravante de que el codigo se leeria
   * como si si.
   *
   * Un cuerpo que devuelve `null` no ha cambiado nada (el UPDATE no encontro
   * fila), asi que se deshace en vez de confirmarse. Confirmar una transaccion
   * vacia daria el mismo resultado, pero el ROLLBACK deja dicho en el log de la
   * base de datos que ahi no paso nada, que es la pregunta que uno se hace
   * cuando investiga si una revocacion llego a aplicarse.
   */
  async function inTransaction<T>(
    run: (client: DirectoryQueryable) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query(result === null ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (error) {
      // El ROLLBACK puede fallar tambien (conexion caida); si lo hiciera,
      // tapariaria el error de verdad, que es el que explica lo ocurrido.
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      // Una conexion no devuelta por cada error agota el pool, y el sintoma
      // aparece horas despues y lejos del fallo que lo causo.
      client.release();
    }
  }

  return {
    async resolveOnLogin(identity) {
      // El directorio se indexa por email: es la clave con la que se invita y
      // con la que se compara el bootstrap. Una cuenta anonima o por telefono
      // no tiene nada con que casar, y antes que inventarle una fila sin clave
      // humana se le niega la entrada. No llega a tocar la base de datos.
      if (identity.email === null) return null;
      const values = [identity.uid, normalizeEmail(identity.email), identity.name, bootstrapEmail];

      try {
        const result = await pool.query(RESOLVE_ON_LOGIN_SQL, values);
        return toDirectoryUser(result.rows[0]);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        // Carrera del bootstrap: dos logins pasaron a la vez por el `NOT
        // EXISTS` y el indice parcial dejo entrar solo a uno. Repetir la misma
        // sentencia ya ve al superadmin y entra como empleado.
        try {
          const retry = await pool.query(RESOLVE_ON_LOGIN_SQL, values);
          return toDirectoryUser(retry.rows[0]);
        } catch (retryError) {
          if (!isUniqueViolation(retryError)) throw retryError;

          // El segundo choque ya no es esa carrera, sino el email unico: ese
          // email existe con otro uid. Releer devuelve `null` para este uid y
          // `decideAccess` lo tratara como no aprovisionado, que es el default
          // seguro -- ni se le inventa una fila ni se le deja entrar.
          return findOne('uid', identity.uid);
        }
      }
    },

    findByUid(uid) {
      return findOne('uid', uid);
    },

    findById(id) {
      return findOne('id', id);
    },

    async listInvitations() {
      // LEFT JOIN y no INNER: si el administrador que firmo la invitacion ya no
      // estuviese, un INNER borraria la invitacion entera del panel. Mostrarla
      // sin autor es peor informacion; hacerla desaparecer es perderla.
      const result = await pool.query(`
        SELECT ${USER_COLUMNS.split(', ')
          .map((column) => `u.${column}`)
          .join(', ')}, inviter.email AS invited_by_email
        FROM users u
        LEFT JOIN users inviter ON inviter.id = u.invited_by
        WHERE u.invited_by IS NOT NULL
        ORDER BY u.created_at DESC
      `);
      return result.rows.map(toInvitationRow);
    },

    async createInvitation(input: CreateInvitationInput) {
      // Validar ANTES de pedir conexion: si la guarda viviese dentro de la
      // transaccion, cada error de tecleo del administrador costaria una
      // conexion del pool y un BEGIN/ROLLBACK.
      const { email, days, invitedById, uid } = normalizeInvitationInput(input);

      return inTransaction(async (client) => {
        // La caducidad la calcula Postgres con SU reloj. Calcularla en Node
        // haria que dos relojes distintos (el del contenedor y el de la base)
        // dieran una fecha que ni el panel ni la comprobacion de acceso ven
        // igual.
        const inserted = await client.query(
          `
            INSERT INTO users (uid, email, display_name, role, status, expires_at, invited_by)
            VALUES ($1, lower($2), NULL, 'guest', 'active', now() + make_interval(days => $4::int), $3)
            RETURNING ${USER_COLUMNS}
          `,
          [uid, email, invitedById, days],
        );
        const guest = toDirectoryUser(inserted.rows[0]);

        // En la MISMA transaccion que el alta: una fila sin rastro dejaria el
        // panel diciendo que a alguien lo invito nadie, que es justo lo que la
        // seccion 10 del PRD pide poder responder.
        await client.query(
          'INSERT INTO audit_log (actor_id, action, subject_id) VALUES ($1, $2, $3)',
          [invitedById, 'invite', guest.id],
        );

        return guest;
      });
    },

    async revoke(id, actorId) {
      return inTransaction(async (client) => {
        // La guarda `invited_by IS NOT NULL` va en el WHERE y no en un `if` de
        // TypeScript: asi no hay ventana entre comprobar y actualizar, y no
        // existe forma de llamar a este metodo que expulse a un empleado.
        const updated = await client.query(
          `
            UPDATE users SET status = 'revoked'
            WHERE id = $1 AND invited_by IS NOT NULL
            RETURNING ${USER_COLUMNS}
          `,
          [id],
        );
        const row = updated.rows[0];
        if (!row) return null;

        await client.query(
          'INSERT INTO audit_log (actor_id, action, subject_id) VALUES ($1, $2, $3)',
          [actorId, 'revoke', id],
        );

        return toDirectoryUser(row);
      });
    },

    close() {
      // Sin esto, `shutdown()` deja conexiones vivas y el proceso de vitest no
      // termina despues de un test que levanta y apaga el servidor.
      return pool.end();
    },
  };
}
