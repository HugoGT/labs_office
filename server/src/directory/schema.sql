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
  -- UNIQUE porque es lo que hace idempotente al login: el alta del superadmin
  -- de bootstrap en `resolveOnLogin` se apoya en `ON CONFLICT (uid)`, y sin
  -- este indice Postgres rechaza la sentencia entera.
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

-- #148: no backfill to spawn. NULL means this uid has never saved a position.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_x double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_y double precision;

-- Dos cuentas con el mismo email serian dos personas para el sistema y una sola
-- para la oficina. Sobre `lower(email)` para que `Ana@` y `ana@` choquen.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

-- La garantia dura de todo este cambio: como mucho UN superadmin, jamas dos.
-- El `WHERE ... NOT EXISTS` de `pgDirectory.resolveOnLogin` es la version amable
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
  action text NOT NULL CHECK (action IN ('invite', 'revoke', 'create-user', 'revoke-user', 'convert-user', 'upload-art', 'submit-art', 'approve-art', 'reject-art', 'retire-art')),
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
-- 'revoke-user' (#93) is its own action and not 'revoke': taking access away
-- from staff is a different decision from withdrawing an invitation, and the
-- trail has to tell them apart. 'convert-user' (#125) records an existing
-- row turned into staff by "Crear usuario" (a guest, or revoked staff). The '*-art' actions (#122) record the art
-- catalog: an Admin upload, a contribution, its review and its withdrawal;
-- their subject is a piece (`piece_id`, added after `art_pieces` below).
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN ('invite', 'revoke', 'create-user', 'revoke-user', 'convert-user', 'upload-art', 'submit-art', 'approve-art', 'reject-art', 'retire-art'));

-- El panel consulta el rastro por sujeto ("quien invito a esta persona"), no
-- recorriendo la tabla entera.
CREATE INDEX IF NOT EXISTS audit_log_subject ON audit_log (subject_id);

-- Space, Asset, SpaceLayout and UserDeskConfig (PRD-7). The int4range GiST
-- exclusions below use built-in range_ops, without extensions.

-- New offices start without rooms. Existing placement rows are never reset.
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

-- #180: rooms and desk cubicles may share an edge or corner, never area.
-- Replace only the legacy inclusive box exclusion; leave an upgraded index
-- intact on subsequent starts. Both steps are transactional with this script,
-- and run before the cubicle backfill, without changing any placement rows.
DO $spaces_overlap$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'spaces'::regclass
    AND conname = 'spaces_no_overlap' AND pg_get_constraintdef(oid) LIKE '%box(%') THEN
    ALTER TABLE spaces DROP CONSTRAINT spaces_no_overlap;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'spaces'::regclass
    AND conname = 'spaces_no_overlap') THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_no_overlap
      EXCLUDE USING gist (int4range(x, x + w, '[)') WITH &&, int4range(y, y + h, '[)') WITH &&);
  END IF;
END $spaces_overlap$;

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
-- Special assets (#71): drawn above every avatar instead of below it. Its own
-- ALTER because `CREATE TABLE IF NOT EXISTS` never touches a live table, and
-- NOT NULL DEFAULT false backfills every existing row as a normal asset.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS above_avatars boolean NOT NULL DEFAULT false;

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
  -- Nueve cajas, no seis: un escritorio ocupa 3x3 tiles (ver `desks`), asi que
  -- los huecos decorables son los nueve de esa cuadricula.
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 8),
  rotation smallint NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_desk_slot_unique ON user_desk_configs (user_id, slot);

-- El rango nacio en 0..5 y el `CREATE TABLE IF NOT EXISTS` de arriba NO toca
-- una tabla que ya existe: en un despliegue vivo el CHECK viejo seguiria
-- rechazando el slot 6, y quien decorase la fila de abajo de su escritorio
-- recibiria un 500 sin nada en el cuerpo que explicase por que. El par
-- DROP/ADD es lo que lo refresca de forma idempotente, mismo precedente que
-- `audit_log_action_check`. El nombre no esta inventado: es el que Postgres le
-- pone al CHECK en linea de una columna, `<tabla>_<columna>_check`.
--
-- El CHECK de arriba se queda y dice lo MISMO, tambien como en `audit_log`:
-- asi el bloque de la tabla se lee solo, sin tener que buscar veinte lineas
-- mas abajo cual es el rango de verdad.
ALTER TABLE user_desk_configs DROP CONSTRAINT IF EXISTS user_desk_configs_slot_check;
ALTER TABLE user_desk_configs ADD CONSTRAINT user_desk_configs_slot_check CHECK (slot BETWEEN 0 AND 8);

-- Escritorios asignables (#7, slice 5). Dos personas distintas actuan sobre
-- esta tabla y hacen cosas distintas: el administrador decide cuantos hay y
-- donde estan, y cada quien elige el suyo entre los libres. Por eso el ocupante
-- es una columna de ESTA tabla y no una tabla de asignaciones: una persona
-- ocupa un escritorio o ninguno, nunca un historico.
--
-- La decoracion NO cuelga de aqui. `user_desk_configs` esta indexada por
-- `user_id`, asi que la decoracion de alguien le SIGUE al escritorio que
-- ocupe; una columna `desk_id` alli la anclaria a un sitio y se la borraria en
-- cuanto esa persona se mudase a otro.
CREATE TABLE IF NOT EXISTS desks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  -- TILES, no pixeles, igual que `spaces`. Un escritorio son 3x3 SIEMPRE, asi
  -- que w/h no se guardan: una columna que pudiese decir otra cosa que 3
  -- podria contradecir al CHECK de `slot`, que cuenta nueve cajas, y a la
  -- restriccion de exclusion de aqui abajo, que mide el area con un 3 literal.
  x integer NOT NULL CHECK (x >= 0), y integer NOT NULL CHECK (y >= 0),
  -- ON DELETE SET NULL y no CASCADE: borrar a una PERSONA libera su escritorio
  -- en vez de llevarselo por delante. El escritorio es mobiliario de la
  -- oficina, no propiedad de quien lo usa. Al reves si es cascada natural:
  -- borrar la fila del escritorio se lleva su ocupacion con ella, y esa
  -- persona simplemente se queda sin sitio.
  occupant_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una persona, un escritorio. Parcial porque muchos escritorios pueden estar
-- libres a la vez; mismo precedente que `users_single_superadmin`. Es lo que
-- obliga a que reclamar un sitio nuevo suelte el anterior en la MISMA
-- transaccion (ver `pgDesks.claimDesk`).
CREATE UNIQUE INDEX IF NOT EXISTS desks_single_occupant ON desks (occupant_id)
  WHERE occupant_id IS NOT NULL;

-- Same half-open migration as spaces: desk footprints are always 3x3.
DO $desks_overlap$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'desks'::regclass
    AND conname = 'desks_no_overlap' AND pg_get_constraintdef(oid) LIKE '%box(%') THEN
    ALTER TABLE desks DROP CONSTRAINT desks_no_overlap;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'desks'::regclass
    AND conname = 'desks_no_overlap') THEN
    ALTER TABLE desks ADD CONSTRAINT desks_no_overlap
      EXCLUDE USING gist (int4range(x, x + 3, '[)') WITH &&, int4range(y, y + 3, '[)') WITH &&);
  END IF;
END $desks_overlap$;

-- Cada escritorio es tambien un espacio (#10 + #12): su cubiculo propio, con
-- el mismo mecanismo generico de pertenencia (`detectSpace`, `audiblePeers`,
-- el evento `room` del bridge) que ya tienen las salas. `desk_id` va DESPUES
-- de `desks`, porque la FK necesita esa tabla ya creada.
--
-- UNIQUE en `desk_id`: un escritorio tiene, como mucho, UN cubiculo
-- emparejado. El upsert de `pgDesks` (slice S1b) se apoya en este indice con
-- `ON CONFLICT (desk_id) DO UPDATE`. CASCADE porque borrar el escritorio se
-- lleva su cubiculo con el -- no tiene sentido un cubiculo sin dueno.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS desk_id uuid UNIQUE REFERENCES desks(id) ON DELETE CASCADE;

-- El indice de nombre unico de arriba protegia la tabla ENTERA. Con
-- cubiculos en la misma tabla eso rechazaria dos escritorios que compartan
-- nombre (dos personas llamadas "Ana" no pueden tener las dos una "Mesa de
-- Ana"), asi que se sustituye por uno acotado a las salas. El nombre nuevo
-- y no `IF NOT EXISTS` sobre el viejo: `IF NOT EXISTS` solo mira el nombre
-- del indice, no su definicion, y dejaria vivo al que protegia la tabla
-- entera.
DROP INDEX IF EXISTS spaces_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS spaces_room_name_unique ON spaces (lower(name)) WHERE desk_id IS NULL;

-- Backfill: un cubiculo 3x3 para cada escritorio que todavia no tiene uno,
-- en las MISMAS coordenadas del escritorio (igual que `syncDeskSpace` en
-- adelante). `ON CONFLICT DO NOTHING` sin target absorbe tambien el choque
-- contra `spaces_no_overlap`: un escritorio sentado encima de una sala
-- existente se salta en vez de tumbar el arranque entero. `WHERE NOT EXISTS`
-- es lo que hace idempotente volver a correr esto en cada arranque, y
-- `reportDesksWithoutSpace` (migrate.ts) es quien avisa de los que quedan sin
-- cubiculo.
INSERT INTO spaces (desk_id, slug, name, x, y, w, h, capacity)
SELECT d.id, 'desk-' || d.id::text, d.label, d.x, d.y, 3, 3, NULL FROM desks d
WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.desk_id = d.id)
ON CONFLICT DO NOTHING;

-- Nombre visible auto-elegido en login (#100). El indice de abajo exige
-- unicidad, y una unicidad no puede convivir con datos que ya la violan: por
-- eso primero se limpia (D3) y luego se crea el indice, en el MISMO fichero
-- que corre en cada arranque. En la practica no se espera que esto toque
-- ninguna fila: nada escribe `display_name` todavia.
--
-- La expresion de clave se repite IDENTICA en las dos UPDATE de abajo y en el
-- indice: es la MISMA garantia que `displayNameRules.canonicalizeDisplayName`
-- + `displayNameKey` dan en JavaScript para cualquier fila NUEVA (ver la
-- cabecera de ese fichero). `[[:space:]]` y no `\s` -- eso es sintaxis Perl
-- que Postgres no entiende en un patron POSIX -- y sin escapar la barra
-- invertida, para no depender de `standard_conforming_strings`. El colapso va
-- ANTES de `btrim` porque `btrim(text)` solo quita U+0020: un tabulador al
-- principio se quedaria sin recortar si `btrim` corriese primero.

-- Un display_name en blanco o solo espacio no es un nombre elegido: se limpia
-- a NULL para que no compita por el indice de unicidad contra si mismo ni
-- contra nadie.
UPDATE users
SET display_name = NULL
WHERE display_name IS NOT NULL
  AND btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g')) = '';

-- Duplicados por la MISMA clave: se queda con el mas antiguo (created_at,
-- y el id como desempate) y el resto vuelve a NULL, cayendo a su nombre
-- derivado hasta que elija uno nuevo en un proximo login.
UPDATE users u
SET display_name = NULL
WHERE display_name IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users older
    WHERE lower(btrim(regexp_replace(older.display_name, '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(u.display_name, '[[:space:]]+', ' ', 'g')))
      AND older.display_name IS NOT NULL
      AND (older.created_at, older.id) < (u.created_at, u.id)
  );

-- El indice de verdad: como mucho una fila por clave canonica, y solo entre
-- quien ya eligio un nombre (`display_name IS NOT NULL`). "Invitado" y
-- cualquier nombre derivado del email nunca llegan a escribirse aqui, asi que
-- no cuentan como ocupados.
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique ON users (
  lower(btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g')))
) WHERE display_name IS NOT NULL;

-- Art pack catalog (art migration, step 3). One row per manifest piece, keyed
-- by its stable id (`<kind>-<name>`), filled by `registerArtPack` after this
-- script runs (see `directory/fromEnv.ts`). `spec` is the whole manifest entry
-- so kind-specific data (anchors, facings) needs no column of its own; the
-- columns next to it are the ones the choice rules read.
--
-- A piece missing from a newer pack gets `retired_at` and is never deleted:
-- users, desks and spaces that chose it keep resolving it. No foreign key from
-- those choices for the same reason `avatar_id` below cannot have one: the
-- backfill writes ids that only exist here once the pack is registered.
CREATE TABLE IF NOT EXISTS art_pieces (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table')),
  name text NOT NULL,
  -- NULL for characters and the terrain tileset; every other kind has one.
  material text,
  colorable boolean NOT NULL DEFAULT false,
  default_color text CHECK (default_color IS NULL OR default_color ~ '^#[0-9a-f]{6}$'),
  author text NOT NULL,
  license text NOT NULL,
  files jsonb NOT NULL,
  spec jsonb NOT NULL,
  contract_version integer NOT NULL,
  retired_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Art contract 2 added the terrain tileset and the map props. CREATE TABLE IF
-- NOT EXISTS keeps the CHECK of a table created before, so it is replaced.
ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_kind_check;
ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_kind_check CHECK (kind IN ('character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table'));

-- Admin uploads (#121) live in the same catalog, so every choice resolves
-- them the same way. `source` is what keeps a pack registration from
-- retiring them: it only retires `pack` rows. Their ids are reserved
-- (`<kind>-upload-<hash>`, refused in a pack), so the upsert can never touch
-- one either. Existing rows are pack pieces, hence the DEFAULT.
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pack';
ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_source_check;
ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_source_check CHECK (source IN ('pack', 'upload'));
-- Who uploaded it; NULL for pack pieces. Users are revoked, never deleted.
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES users(id);

-- Contributions and their review (#122). Any signed-in user can contribute a
-- character or a decor plant; it waits as 'pending' until an admin approves
-- or rejects it, and only approved rows are the catalog. The DEFAULT is
-- 'approved' because every row that existed before (pack pieces and Admin
-- uploads) was already in the catalog. `uploaded_by` above is who submitted.
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_status_check;
ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id);
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- The reason of a rejection, which the uploader reads; only a rejection has one.
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_review_note_check;
ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_review_note_check CHECK ((status = 'rejected') = (review_note IS NOT NULL));
-- When the contributor accepted the rights statement of the upload form.
-- Without it there is no contribution, so a pending row always has one.
ALTER TABLE art_pieces ADD COLUMN IF NOT EXISTS license_accepted_at timestamptz;
ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_pending_license_check;
ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_pending_license_check CHECK (status <> 'pending' OR license_accepted_at IS NOT NULL);

-- The subject of an art audit entry is a piece, not a user. Pieces are
-- retired, never deleted, so the reference never dangles.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS piece_id text REFERENCES art_pieces(id);
-- The hourly contribution quota counts a user's 'submit-art' entries of the
-- last hour under a lock; this keeps that count off a full scan.
CREATE INDEX IF NOT EXISTS audit_log_actor_action ON audit_log (actor_id, action, created_at);

-- Persisted choices. Each DEFAULT is the pack default (`ART_PACK_DEFAULTS`,
-- checked against the manifest by artCatalogRules.test.ts) and is what
-- backfills the rows that already exist. The color of a non-colorable
-- material is NULL, and both defaults are non-colorable, so the color columns
-- need no default. Which colors a material admits depends on the catalog, so
-- the CHECK only bounds the format; the rules own the rest.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id text NOT NULL DEFAULT 'character-p01-burgundy-suit';
-- When the user chose that character (step 5). No DEFAULT on purpose: every
-- row that existed before this column stays NULL, which is what sends existing
-- accounts through the character selector on their first access after it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_chosen_at timestamptz;

ALTER TABLE desks ADD COLUMN IF NOT EXISTS material_id text NOT NULL DEFAULT 'desk-wood';
ALTER TABLE desks ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE desks DROP CONSTRAINT IF EXISTS desks_color_check;
ALTER TABLE desks ADD CONSTRAINT desks_color_check CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$');

-- On `spaces` and not on `desks`: a desk's cubicle is a space, so its floor
-- lives with every other floor.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS floor_material_id text NOT NULL DEFAULT 'floor-wood';
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS floor_color text;
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_floor_color_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_floor_color_check CHECK (floor_color IS NULL OR floor_color ~ '^#[0-9a-f]{6}$');

-- Terrain blocks (#123 phase 2). One row per 9x9 block an admin edited; a
-- block without a row keeps the material of the committed Tiled layout
-- (`src/game/maps/office.json`), so a new layout file still reaches every
-- block nobody touched. No upper bound on the index: the map size lives in
-- the layout, and the server ignores rows past its last block. The materials
-- are `LAYOUT_MATERIALS` (`src/game/officeLayout.ts`, pinned by
-- migrate.test.ts), refreshed below like `art_pieces_kind_check`.
CREATE TABLE IF NOT EXISTS terrain_blocks (
  block_index integer PRIMARY KEY CHECK (block_index >= 0),
  material text NOT NULL CHECK (material IN ('void', 'water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE terrain_blocks DROP CONSTRAINT IF EXISTS terrain_blocks_material_check;
ALTER TABLE terrain_blocks ADD CONSTRAINT terrain_blocks_material_check CHECK (material IN ('void', 'water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet'));

-- Painted walls (terrain editor). One row per TILE holding a wall an admin
-- painted, the wall piece of the art pack on it (`WALL_PIECES` in
-- `src/game/officeLayout.ts`, pinned by migrate.test.ts and refreshed below
-- like `terrain_blocks_material_check`). Removing a wall deletes its row. A
-- stored wall wins over the committed layout's wall on that tile (the shipped
-- layout has none). The tile index is row major over the current map; the
-- server ignores rows past its last tile. Created after the 14x10 grid was
-- retired, so the one-time grid move below never touches it.
CREATE TABLE IF NOT EXISTS terrain_walls (
  tile_index integer PRIMARY KEY CHECK (tile_index >= 0),
  piece_id text NOT NULL CHECK (piece_id IN ('wall-brick', 'wall-stone', 'wall-plaster', 'wall-glass')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE terrain_walls DROP CONSTRAINT IF EXISTS terrain_walls_piece_id_check;
ALTER TABLE terrain_walls ADD CONSTRAINT terrain_walls_piece_id_check CHECK (piece_id IN ('wall-brick', 'wall-stone', 'wall-plaster', 'wall-glass'));

-- Placed chairs (terrain editor). One row per TILE holding a chair an admin
-- placed: the chair piece of the art pack (`CHAIR_PIECES` in
-- `src/game/seating.ts`, pinned by migrate.test.ts and refreshed below like
-- the wall pieces) and the way it faces. Removing a chair deletes its row.
-- Same row-major tile index as `terrain_walls`; the server ignores rows past
-- its last tile. Created after the 14x10 grid was retired, so the one-time
-- grid move below never touches it.
CREATE TABLE IF NOT EXISTS terrain_chairs (
  tile_index integer PRIMARY KEY CHECK (tile_index >= 0),
  piece_id text NOT NULL CHECK (piece_id IN ('chair-wood', 'chair-metal', 'chair-leather', 'chair-gamer')),
  facing text NOT NULL CHECK (facing IN ('up', 'down', 'left', 'right')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE terrain_chairs DROP CONSTRAINT IF EXISTS terrain_chairs_piece_id_check;
ALTER TABLE terrain_chairs ADD CONSTRAINT terrain_chairs_piece_id_check CHECK (piece_id IN ('chair-wood', 'chair-metal', 'chair-leather', 'chair-gamer'));

-- Collision areas per art piece (collision editor). One row per piece an
-- admin edited: a JSON list of rectangles in art pixels from the piece's
-- anchor (`src/game/pieceCollisions.ts` validates them on every write and
-- every load). A piece without a row keeps its default: its footprint for a
-- Tiled prop, nothing for desks, decor and chairs. No reference to
-- `art_pieces`: layout pieces load before the pack registers, and a retired
-- piece may still stand in the layout.
CREATE TABLE IF NOT EXISTS piece_collisions (
  piece_id text PRIMARY KEY,
  rects jsonb NOT NULL CHECK (jsonb_typeof(rects) = 'array'),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The 21x15 block grid (map editor palette). Stored rows were written against
-- the first editor's 14x10 grid, which now sits at block offset (+3, +2) so
-- the spawn block stays in the middle (`LEGACY_BLOCK_GRID` in
-- `src/game/mapData.ts`). They move exactly once: the first start that finds
-- no `map_layout_version` row moves them and writes the row, inside the one
-- implicit transaction of this script, so a crash moves nothing and a restart
-- never moves anything twice. The only marker in this file on purpose: a
-- shift is not convergent, so it cannot be written as one more idempotent
-- statement. A brand new database runs it over empty tables and just gets
-- the marker. `MAP_LAYOUT_VERSION` (migrate.ts) is the version written here.
CREATE TABLE IF NOT EXISTS map_layout_version (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM map_layout_version) THEN
    -- Rows past the old grid were never read (the runtime ignores them):
    -- remapped, they would suddenly show up inside the new grid.
    DELETE FROM terrain_blocks WHERE block_index >= 140;
    -- Old index r * 14 + c becomes (r + 2) * 21 + (c + 3). Through a free
    -- range first, so no row ever lands on the old index of one not moved yet.
    -- Explicit water rows stay water; untouched blocks have no row and are void now.
    UPDATE terrain_blocks SET block_index = 1000000 + (block_index / 14 + 2) * 21 + (block_index % 14 + 3);
    UPDATE terrain_blocks SET block_index = block_index - 1000000;
    -- Spaces (rooms and desk cubicles) and desks store TILES: +27, +18. The
    -- free range again, so `spaces_no_overlap` and `desks_no_overlap` never
    -- see a moved row on top of one still waiting. Decor in `space_layouts`
    -- is relative to its space and moves with it.
    UPDATE spaces SET x = x + 1000000, y = y + 1000000;
    UPDATE spaces SET x = x - 1000000 + 27, y = y - 1000000 + 18;
    UPDATE desks SET x = x + 1000000, y = y + 1000000;
    UPDATE desks SET x = x - 1000000 + 27, y = y - 1000000 + 18;
    -- Last positions (#148) are PIXELS: +864, +576. NULL means never saved.
    UPDATE users SET last_x = last_x + 864, last_y = last_y + 576 WHERE last_x IS NOT NULL AND last_y IS NOT NULL;
    INSERT INTO map_layout_version (version) VALUES (2);
  END IF;
END $$;
