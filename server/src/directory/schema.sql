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

-- Cuatro tablas nuevas para PRD-7 (#7): Space, Asset, SpaceLayout,
-- UserDeskConfig. Mismo patron que arriba: `IF NOT EXISTS` en tablas e
-- indices, sin extensiones. `box`/GiST (box_ops) es de nucleo desde siempre
-- en Postgres; `EXCLUDE USING gist` de abajo no necesita `postgis` ni ninguna
-- `CREATE EXTENSION` -- verificado empiricamente en la fase de apply de este
-- cambio contra Postgres real (WASM, sin extensiones instaladas antes ni
-- despues de crear la restriccion).

CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL, name text NOT NULL,
  -- TILES, no pixeles. `ROOMS` en mapData.ts guarda pixeles (50*TILE); el
  -- terrainGrid divide por TILE y el E2E teletransporta por tile. Con
  -- enteros los CHECK de abajo son de verdad.
  x integer NOT NULL CHECK (x >= 0), y integer NOT NULL CHECK (y >= 0),
  w integer NOT NULL CHECK (w > 0), h integer NOT NULL CHECK (h > 0),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  -- Sin `archived_at`: borrar un espacio es un DELETE de verdad (D1b). La
  -- proteccion contra un segundo espacio en el mismo sitio es la restriccion
  -- de exclusion de abajo, no un estado de fila.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_slug_unique ON spaces (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS spaces_name_unique ON spaces (lower(name));

-- Dos espacios solapados harian que `detectSpace` dependiese del orden de
-- comparacion en el cliente, y ese orden puede diferir entre clientes:
-- asimetria de audibilidad. Un UPDATE escrito a mano contra la base tampoco
-- puede crear el solape -- misma razon que `users_single_superadmin` mas
-- arriba. No existe forma `IF NOT EXISTS` para una restriccion de exclusion,
-- de ahi el DROP/ADD -- mismo precedente que `audit_log_action_check`.
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_no_overlap;
ALTER TABLE spaces ADD CONSTRAINT spaces_no_overlap
  EXCLUDE USING gist (box(point(x, y), point(x + w, y + h)) WITH &&);

CREATE TABLE IF NOT EXISTS assets (          -- antes que space_layouts: orden de FK
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('furniture', 'decor', 'plant')),
  texture_key text NOT NULL,
  w integer NOT NULL CHECK (w > 0), h integer NOT NULL CHECK (h > 0),
  placeable_on_desk boolean NOT NULL DEFAULT false,
  -- Retirar del catalogo NO es borrar: las colocaciones ajenas siguen vivas
  -- (D1b). `archived_at IS NULL` es el filtro de lectura del catalogo; una
  -- colocacion ya existente sigue resolviendo su `texture_key` sin filtro.
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assets_slug_unique ON assets (lower(slug));

CREATE TABLE IF NOT EXISTS space_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  x integer NOT NULL CHECK (x >= 0), y integer NOT NULL CHECK (y >= 0),  -- relativo al origen del espacio
  rotation smallint NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  z_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS space_layouts_space ON space_layouts (space_id);

CREATE TABLE IF NOT EXISTS user_desk_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 5),
  rotation smallint NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_desk_slot_unique ON user_desk_configs (user_id, slot);

-- Semilla: los dos espacios de siempre, con los MISMOS uuids literales que
-- usara `BUILT_IN_SPACES` en mapData.ts cuando aterrice la identidad de
-- espacio (#7), para que un cliente en modo fallback y uno servido coincidan
-- en id y en version (D4). `ON CONFLICT (id) DO NOTHING`: el cambio de un
-- admin no tiene por que deshacerse en cada arranque.
INSERT INTO spaces (id, slug, name, x, y, w, h) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sala-de-juntas', 'Sala de Juntas', 50, 2, 13, 14),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cafeteria', 'Cafetería', 50, 18, 13, 14)
ON CONFLICT (id) DO NOTHING;
