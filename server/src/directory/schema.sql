-- Esquema del directorio de usuarios (#24). Se aplica entero en cada arranque
-- con el directorio activo, asi que TODO aqui es idempotente: `IF NOT EXISTS`
-- en tablas e indices. No hay versiones ni marcas de migracion a proposito --
-- con dos tablas, un fichero que converge al estado deseado es mas honesto y
-- mas facil de leer que una cadena de migraciones numeradas que nadie recorre.
--
-- Sin extensiones. `citext` habria sido comodo para el email, pero
-- `CREATE EXTENSION` necesita permisos de superusuario sobre la base de datos,
-- que es justo lo que no se tiene en un Postgres gestionado; el fallo aparece
-- ademas en el arranque del despliegue y no en local. `text` con un indice
-- unico sobre `lower(email)` da la misma garantia sin pedir nada.
-- `gen_random_uuid()` viene de serie desde Postgres 13, tampoco necesita
-- `pgcrypto`.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable aunque el flujo de hoy lo rellene siempre: la cuenta de Identity
  -- Platform la crea el adaptador de administracion antes de esta fila, y si
  -- ese orden cambiase, una invitacion sin uid todavia seria una fila valida.
  -- UNIQUE porque es lo que hace idempotente al login: `resolveOnLogin` se
  -- apoya en `ON CONFLICT (uid)`, y sin este indice Postgres rechaza la
  -- sentencia entera.
  uid text UNIQUE,
  -- Guardado ya en minusculas (ver `invitationRules.normalizeEmail`). El indice
  -- de abajo es quien lo garantiza de verdad.
  email text NOT NULL,
  display_name text,
  -- CHECK y no solo el tipo `Role` de TypeScript: los tipos no existen en
  -- tiempo de ejecucion ni protegen de un UPDATE escrito a mano contra la base.
  role text NOT NULL CHECK (role IN ('superadmin', 'admin', 'employee', 'guest')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- NULL = no caduca (empleados y admins). Una fecha = invitado con caducidad.
  expires_at timestamptz,
  -- Quien invito. NULL distingue a quien no vino por invitacion, y es la unica
  -- marca que separa a un invitado de alguien de casa: `revoke` se apoya en
  -- ella para no convertirse en un boton de expulsion del personal.
  invited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dos cuentas con el mismo email serian dos personas para el sistema y una sola
-- para la oficina. Sobre `lower(email)` para que `Ana@` y `ana@` choquen.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

-- La garantia dura de todo este cambio: como mucho UN superadmin, jamas dos.
-- El `CASE ... NOT EXISTS` de `pgDirectory.resolveOnLogin` es la version amable
-- y esta es la que no se puede esquivar: ni con dos logins simultaneos que
-- pasen a la vez por el NOT EXISTS, ni con un UPDATE hecho a mano. Indice
-- parcial porque la unicidad solo aplica a esa fila: puede haber tantos admins,
-- empleados e invitados como haga falta.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_superadmin ON users ((role))
  WHERE role = 'superadmin';

-- Seccion 10 del PRD y punto 7 del issue #24: quien invito a quien, y quien
-- revoco a quien. Se escribe en la MISMA transaccion que el cambio, asi que no
-- puede existir un alta sin su rastro. Tabla aparte y no columnas en `users`
-- porque un rastro es una lista de hechos que pasaron, no un estado actual.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('invite', 'revoke', 'create-user')),
  subject_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe: en un
-- despliegue vivo, la de arriba se salta entera y el CHECK se queda con la
-- lista de acciones del dia que se creo. Sin este refresco, el primer alta de
-- alguien de casa contra ese despliegue moriria con una violacion de
-- restriccion en el peor momento posible -- con la cuenta de Identity Platform
-- ya creada, es decir en el camino de la cuenta huerfana que `adminRoutes.ts`
-- tiene que compensar.
--
-- El DROP ... IF EXISTS delante es lo que lo hace idempotente y converger igual
-- en una base nueva y en una vieja, que es lo unico que este fichero promete.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN ('invite', 'revoke', 'create-user'));

-- El panel consulta el rastro por sujeto ("quien invito a esta persona"), no
-- recorriendo la tabla entera.
CREATE INDEX IF NOT EXISTS audit_log_subject ON audit_log (subject_id);
