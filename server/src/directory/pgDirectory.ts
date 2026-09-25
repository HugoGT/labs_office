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
 * ## El login falla cerrado (#72)
 *
 * `resolveOnLogin` NO da de alta a nadie, con una unica excepcion: el
 * superadmin de bootstrap. Cualquier otra cuenta tiene que existir ya en
 * `users`, creada desde el panel (`createUser` o `createInvitation`); si no
 * existe, devuelve `null` y `decideAccess` la deniega como `not-provisioned`.
 *
 * Antes el login era un `INSERT ... ON CONFLICT` que convertia en empleado
 * permanente a CUALQUIER cuenta de Identity Platform con email. Cuando se perdio
 * la base de datos (#72), un invitado volvio a entrar y se recreo asi: sin
 * caducidad, fuera del panel de invitaciones y sin forma de revocarlo. Un token
 * firmado por Google prueba quien es alguien, no que esta oficina lo conozca.
 *
 * ## La regla de bootstrap del superadmin, y por que es asi
 *
 * El login crea la fila SOLO si el email verificado del token coincide (sin
 * distinguir mayusculas) con `BOOTSTRAP_SUPERADMIN_EMAIL` Y ademas no existe ya
 * un superadmin. Esa fila nace `superadmin`; no hay otro rol que el login pueda
 * escribir.
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
 * parcial que hace fisicamente imposible un segundo superadmin. El `WHERE` es
 * la version amable y el indice es la garantia -- si dos logins simultaneos
 * pasan a la vez por el `NOT EXISTS`, Postgres deja entrar a uno y al otro le
 * devuelve 23505, que abajo se resuelve releyendo por uid.
 *
 * ## Por que el camino normal es UN UPDATE
 *
 * Quien ya tiene fila se resuelve con `UPDATE ... WHERE uid = $1 RETURNING`:
 * refresca el nombre visible y devuelve la fila en una sola sentencia, sin
 * ventana entre leer y escribir, y sin ninguna forma de crear nada. Solo si no
 * hay fila Y el email es el de bootstrap se intenta el INSERT, con `ON CONFLICT
 * (uid)` para la carrera de dos pestanas de la misma persona.
 */

import type {
  AccountStatus,
  CreateInvitationInput,
  CreateUserInput,
  DirectoryUser,
  InvitationRow,
  Role,
  UserDirectory,
} from './directoryPort.ts';
import { canonicalizeDisplayName, DisplayNameTakenError } from './displayNameRules.ts';
import { normalizeEmail, normalizeInvitationInput } from './invitationRules.ts';
import { normalizeUserInput } from './userRules.ts';

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
 * El camino de todo el que ya existe. Un simple SELECT por uid: desde #100 (D4)
 * el login ya NO escribe `display_name` -- ni siquiera para "rellenarlo" desde
 * el token -- y el rol, el estado y la caducidad los sigue decidiendo esta
 * oficina desde el panel, nunca el propio login.
 */
const SELECT_ON_LOGIN_SQL = `
  SELECT ${USER_COLUMNS} FROM users WHERE uid = $1
`;

/**
 * La UNICA alta que puede hacer el login: el superadmin de bootstrap.
 *
 * `lower($2)` aunque el email ya llegue normalizado desde `invitationRules`: la
 * normalizacion en JavaScript es la conveniencia y esta es la garantia. La
 * comparacion con `$3` se repite aqui aunque el llamante ya la haya hecho: si
 * alguien quitase esa guarda, esta sentencia seguiria sin poder crear a nadie
 * que no sea el email de bootstrap. El email de bootstrap va como PARAMETRO y
 * no interpolado: viene del entorno, pero un entorno con una comilla dentro no
 * tiene por que poder reescribir la sentencia.
 *
 * `display_name` nace NULL (#100, D4): el bootstrap NUNCA aporta un nombre
 * elegido, ni siquiera el del token. `ON CONFLICT (uid) DO UPDATE SET uid =
 * EXCLUDED.uid` es un no-op deliberado -- solo esta para que `RETURNING`
 * tenga una fila que devolver cuando la carrera de dos pestanas de la MISMA
 * persona choca contra el `uid` unico; un `DO NOTHING` dejaria ese caso sin
 * fila que releer.
 */
const BOOTSTRAP_SUPERADMIN_SQL = `
  INSERT INTO users (uid, email, display_name, role, status)
  SELECT $1, lower($2), NULL, 'superadmin', 'active'
  WHERE $3::text IS NOT NULL AND lower($2) = lower($3)
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin')
  ON CONFLICT (uid) DO UPDATE SET uid = EXCLUDED.uid
  RETURNING ${USER_COLUMNS}
`;

/** El unico UPDATE que escribe `display_name` en todo el adaptador (#100). */
const SET_DISPLAY_NAME_SQL = `
  UPDATE users SET display_name = $2
  WHERE id = $1
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
      const email = normalizeEmail(identity.email);

      const existing = await pool.query(SELECT_ON_LOGIN_SQL, [identity.uid]);
      if (existing.rows[0]) return toDirectoryUser(existing.rows[0]);

      // Sin fila, y no es el email de bootstrap: no aprovisionado. Ni se toca
      // la base de datos otra vez ni se le inventa una fila (#72).
      if (bootstrapEmail === null || email !== bootstrapEmail) return null;

      try {
        const inserted = await pool.query(BOOTSTRAP_SUPERADMIN_SQL, [
          identity.uid,
          email,
          bootstrapEmail,
        ]);
        if (inserted.rows[0]) return toDirectoryUser(inserted.rows[0]);
      } catch (error) {
        // 23505 aqui es la carrera del bootstrap (otro login se quedo con el
        // indice parcial de superadmin) o el email unico (ese email ya existe
        // con otro uid). Cualquier otro error -- la base caida -- se propaga:
        // no puede disfrazarse de "no esta en el directorio".
        if (!isUniqueViolation(error)) throw error;
      }

      // El INSERT no creo nada: ya hay superadmin, o salto un indice unico. La
      // relectura por uid cubre el unico caso legitimo (otra pestana de la
      // MISMA persona creo su fila entre el UPDATE y el INSERT); en los demas
      // devuelve `null` y `decideAccess` lo trata como no aprovisionado.
      return findOne('uid', identity.uid);
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

    async createUser(input: CreateUserInput) {
      // Validar ANTES de pedir conexion, misma razon que en `createInvitation`:
      // una guarda dentro de la transaccion cobraria una conexion del pool y un
      // BEGIN/ROLLBACK por cada peticion con un rol que no se reparte.
      const { email, role, uid, createdById } = normalizeUserInput(input);

      return inTransaction(async (client) => {
        // `expires_at` y `invited_by` van NULL escritos en la sentencia y no
        // como parametros: no son valores que alguien elija, son la definicion
        // de este alta. El primero es "no caduca" para `decideAccess`; el
        // segundo es lo que mantiene la fila fuera de `listInvitations` y fuera
        // del alcance de `revoke`, que exige `invited_by IS NOT NULL`.
        //
        // El rol SI es un parametro, aunque `assertAssignableRole` ya lo acote:
        // es un valor que entra por HTTP, y una proteccion que desaparece si
        // alguien mueve esa guarda no protege de nada.
        const inserted = await client.query(
          `
            INSERT INTO users (uid, email, display_name, role, status, expires_at, invited_by)
            VALUES ($1, lower($2), NULL, $3, 'active', NULL, NULL)
            RETURNING ${USER_COLUMNS}
          `,
          [uid, email, role],
        );
        const created = toDirectoryUser(inserted.rows[0]);

        // En la MISMA transaccion que el alta, igual que al invitar: una fila
        // sin rastro deja sin respuesta la pregunta de la seccion 10 del PRD,
        // que es quien dio de alta a quien.
        await client.query(
          'INSERT INTO audit_log (actor_id, action, subject_id) VALUES ($1, $2, $3)',
          [createdById, 'create-user', created.id],
        );

        return created;
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

    async listUsers() {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`,
      );
      return result.rows.map(toDirectoryUser);
    },

    async revokeUser(id, actorId) {
      return inTransaction(async (client) => {
        // Both guards live in the WHERE, like `invited_by` in `revoke`: no
        // window between checking and updating, and no way to call this that
        // revokes the superadmin. `status <> 'revoked'` is what keeps a second
        // revocation out of the audit trail.
        const updated = await client.query(
          `
            UPDATE users SET status = 'revoked'
            WHERE id = $1 AND role <> 'superadmin' AND status <> 'revoked'
            RETURNING ${USER_COLUMNS}
          `,
          [id],
        );
        const row = updated.rows[0];
        if (row) {
          await client.query(
            'INSERT INTO audit_log (actor_id, action, subject_id) VALUES ($1, $2, $3)',
            [actorId, 'revoke-user', id],
          );
          return toDirectoryUser(row);
        }

        // Nothing changed: unknown id, the superadmin, or already revoked.
        // Only the last one is a success, and it comes back as it is.
        const existing = await client.query(
          `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND role <> 'superadmin'`,
          [id],
        );
        return existing.rows[0] ? toDirectoryUser(existing.rows[0]) : null;
      });
    },

    async setDisplayName(id, name) {
      // Se vuelve a canonicalizar aunque la ruta HTTP ya lo haya hecho (D10):
      // ningun llamante -- este incluido -- puede dejar un valor no canonico
      // en la columna, o el indice de `schema.sql` dejaria de ser el mismo
      // criterio que esta funcion.
      const canonical = canonicalizeDisplayName(name);
      try {
        const updated = await pool.query(SET_DISPLAY_NAME_SQL, [id, canonical]);
        const row = updated.rows[0];
        return row ? toDirectoryUser(row) : null;
      } catch (error) {
        // El indice parcial `users_display_name_unique` es el arbitro de
        // verdad (D3): actualizar la propia fila a su propio valor nunca
        // colisiona, porque sigue siendo una unica fila con esa clave.
        if (isUniqueViolation(error)) {
          throw new DisplayNameTakenError('ese nombre ya esta en uso');
        }
        throw error;
      }
    },

    close() {
      // Sin esto, `shutdown()` deja conexiones vivas y el proceso de vitest no
      // termina despues de un test que levanta y apaga el servidor.
      return pool.end();
    },
  };
}
