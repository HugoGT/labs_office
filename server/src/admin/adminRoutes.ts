/**
 * Rutas del panel de administracion (#24), como funciones PURAS: reciben
 * valores planos y devuelven `{ status, body }`, sin `req` ni `res`. Mismo
 * patron y misma razon que `handleLivekitToken` en `createOfficeServer.ts`: el
 * adaptador de Express queda reducido a tres lineas que copian el resultado a
 * la respuesta, y todas las ramas del contrato se prueban sin montar un
 * servidor ni levantar un Postgres.
 *
 * ## Esta es la guarda de verdad (#24, punto 5)
 *
 * El panel esconde su interfaz a quien no administra, y eso no protege NADA.
 * Estas rutas viven en una url publica; cualquiera con un ID token valido -- es
 * decir, cualquier persona de la oficina, incluido un invitado -- puede
 * llamarlas a mano con curl sin pasar por la pantalla. Si la autorizacion
 * viviese solo en el cliente, un empleado podria listar invitaciones, crear
 * cuentas nuevas y revocar la de quien quisiera. Lo unico que decide aqui es
 * este fichero.
 *
 * ## El orden de las guardas es una propiedad de seguridad, no estilo
 *
 * Es el mismo argumento que ya documenta `handleLivekitToken`, aplicado a un
 * sitio donde hay mas que filtrar:
 *
 *   1. Credencial: sin cabecera, mal formada, o firma que no verifica -> 401.
 *   2. Directorio: `decideAccess` distinto de `allow` -> 401, MUDO. Los cuatro
 *      casos (sin fila, caducado, revocado, permitido) colapsan en la misma
 *      respuesta byte por byte. Si "no provisionado" tuviese su propio codigo,
 *      quien sondease con tokens de cuentas ajenas aprenderia que uids existen
 *      en esta oficina y cuales no, que es justo el oraculo que este 401 niega.
 *      Y si el directorio se consultase ANTES de verificar la firma, bastaria
 *      con inventarse un token para hacer esa misma pregunta sin credencial.
 *   3. Rol: `canAdminister` falso -> 403. Aqui SI se distingue, y a proposito:
 *      quien llega hasta aqui ya ha probado quien es, y decirle que no
 *      administra no le revela nada que no supiera. Es la misma separacion que
 *      `handleLivekitToken` hace entre su 401 y su `forbidden-session`.
 *
 * Solo despues de las tres se mira el cuerpo de la peticion. Validarlo antes
 * convertiria el 400 en un canal lateral: un empleado iria probando cuerpos
 * hasta aprender la forma exacta del endpoint que no puede usar.
 *
 * `GET /admin/session` es la excepcion deliberada y corre 1 y 2 pero NO 3. Ver
 * `handleAdminSession`.
 *
 * `POST /admin/users` anade un CUARTO filtro que si vive despues del cuerpo,
 * porque no puede vivir antes: comprobar que quien administra puede repartir el
 * rol que pide exige leer que rol pide. Ver `handleCreateUser`.
 */

import {
  canAdminister,
  canAssignRole,
  decideAccess,
  type AccessDecision,
} from '../directory/accessDecision.ts';
import type {
  AssignableRole,
  DirectoryUser,
  InvitationRow,
  UserDirectory,
} from '../directory/directoryPort.ts';
import {
  assertValidInvitationDays,
  InvalidInvitationError,
  normalizeEmail,
} from '../directory/invitationRules.ts';
import { assertAssignableRole, InvalidUserError } from '../directory/userRules.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { generatePassword } from './generatePassword.ts';
import { IdentityAdminError, type IdentityAdmin } from './identityAdminPort.ts';

export interface AdminResult {
  status: number;
  body: Record<string, unknown>;
}

export interface AdminDeps {
  directory: UserDirectory;
  /**
   * `undefined` cuando el servidor arranco sin `FIREBASE_PROJECT_ID`. NO abre
   * las rutas: sin verificador no hay forma de saber quien llama, asi que todo
   * responde 401. Ver `authenticate`.
   */
  auth?: IdTokenVerifier;
  /** `null` cuando no hay credencial de servicio. El alta responde 503. */
  identityAdmin?: IdentityAdmin | null;
  /** Reloj inyectado: sin el, `daysLeft` dependeria de la hora de la maquina. */
  now?: () => Date;
  /** Inyectable para que los tests afirmen sobre lo que se registra, sin ruido. */
  log?: (message: string) => void;
}

const UNAUTHORIZED: AdminResult = { status: 401, body: { error: 'unauthorized' } };
const FORBIDDEN: AdminResult = { status: 403, body: { error: 'forbidden' } };
/** Compartidos con `spacesRoutes.ts`: dos superficies de administracion no pueden contestar cuerpos distintos al mismo fallo. */
export const INVALID_REQUEST: AdminResult = { status: 400, body: { error: 'invalid-request' } };
export const NOT_FOUND: AdminResult = { status: 404, body: { error: 'not-found' } };
const IDENTITY_UNAVAILABLE: AdminResult = {
  status: 503,
  body: { error: 'identity-admin-not-configured' },
};
const INTERNAL: AdminResult = { status: 500, body: { error: 'internal' } };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function logger(deps: AdminDeps): (message: string) => void {
  return deps.log ?? ((message) => console.warn(`[admin] ${message}`));
}

function clock(deps: AdminDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/**
 * Extrae el token de `Authorization: Bearer <token>`. El esquema se compara sin
 * distinguir mayusculas porque la RFC 7235 lo define asi y hay clientes que
 * mandan `bearer`; rechazarlos seria un fallo que solo aparece con segun que
 * libreria y se diagnostica fatal.
 *
 * Devuelve `null` ante cualquier problema y el llamante responde 401: no hay un
 * "400 por cabecera mal formada" a proposito, porque distinguirlo le diria a
 * quien sondea que el resto de la peticion si iba bien.
 */
function bearerToken(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export type Authenticated =
  | { ok: true; user: DirectoryUser }
  | { ok: false; result: AdminResult };

/**
 * Pasos 1 y 2: quien llama tiene una credencial valida Y una cuenta que esta
 * oficina admite ahora mismo. Todo lo que no sea las dos cosas es el MISMO 401.
 */
async function authenticate(authorization: unknown, deps: AdminDeps): Promise<Authenticated> {
  if (!deps.auth) {
    // Falla cerrado. Un servidor sin verificador no puede identificar a nadie,
    // y "como la auth esta desactivada dejo pasar" convertiria el panel de
    // administracion en una url abierta. Se registra porque el sintoma -- todo
    // el mundo recibe "no autorizado" -- no apunta a esta causa por si solo.
    logger(deps)('peticion a /admin sin verificador de ID token: se rechaza (falla cerrado)');
    return { ok: false, result: UNAUTHORIZED };
  }

  const token = bearerToken(authorization);
  if (token === null) return { ok: false, result: UNAUTHORIZED };

  const identity = await deps.auth.verify(token);
  if (identity === null) return { ok: false, result: UNAUTHORIZED };

  const user = await deps.directory.findByUid(identity.uid);
  const decision: AccessDecision = decideAccess(user, clock(deps));
  if (decision !== 'allow' || user === null) {
    // El motivo va al log y NUNCA al cuerpo, por la misma razon que
    // `verifyIdToken.verify` devuelve `null` en vez de una causa. Pero el
    // operador si lo necesita: "todo el mundo cae en not-provisioned" (las
    // migraciones no corrieron) y "un invitado caduco" son la misma respuesta
    // HTTP y dos incidencias distintas a las tres de la manana.
    logger(deps)(`acceso denegado a /admin: ${decision}`);
    return { ok: false, result: UNAUTHORIZED };
  }

  return { ok: true, user };
}

/**
 * Pasos 1, 2 y 3. Lo que usa todo menos `GET /admin/session`.
 *
 * Se exporta para que las rutas de espacios (#7, slice 3) monten la MISMA
 * guarda en vez de una copia. Duplicar los tres pasos es exactamente como se
 * separan dos superficies de administracion: un dia una aprende a distinguir
 * un invitado caducado y la otra no, y nadie se entera hasta que alguien
 * caducado crea un espacio.
 */
export async function authorize(authorization: unknown, deps: AdminDeps): Promise<Authenticated> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated;

  if (!canAdminister(authenticated.user.role)) {
    return { ok: false, result: FORBIDDEN };
  }
  return authenticated;
}

/** `Date` a ISO 8601, conservando el `null` que significa "no caduca". */
function toIso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/**
 * Dias que le quedan a una invitacion. Lo calcula el SERVIDOR y no el
 * navegador: el reloj del cliente se puede mover, y "te quedan 3 dias" no puede
 * depender de eso.
 *
 * La resta es de instantes absolutos, asi que no hay zona horaria de por medio
 * y el resultado es el mismo en UTC que en cualquier otra: es lo que permite
 * que el cliente pinte las fechas en UTC (`formatUtcDate`) sin que las dos
 * mitades cuenten dias distintos.
 *
 * Se redondea hacia ARRIBA porque `expiresAt` se calcula como `now + dias*24h`:
 * en el instante del alta faltan exactamente N dias, y truncar mostraria N solo
 * durante el primer milisegundo y N-1 el resto del dia -- justo cuando el
 * administrador acaba de crear la invitacion y mira la tabla.
 *
 * Y se limita a 0 por abajo: un numero negativo no significa nada para quien
 * mira la tabla, y el cliente lo pinta tal cual. Cero es "ya no vale", que es
 * la verdad.
 */
function daysLeft(expiresAt: Date | null, now: Date): number | null {
  if (expiresAt === null) return null;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Proyeccion de una fila a lo que ve el panel. Se enumeran los campos uno a uno
 * en vez de esparcir la fila: un `...row` mandaria el `uid` de Identity
 * Platform y el `invitedBy` interno al navegador, que no los necesita para nada
 * y que son exactamente lo que hace falta para hablar con Google en nombre de
 * esa cuenta.
 */
function toInvitationBody(row: InvitationRow, now: Date): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: toIso(row.expiresAt),
    daysLeft: daysLeft(row.expiresAt, now),
    invitedByEmail: row.invitedByEmail,
  };
}

/**
 * Quien consulta, segun el servidor. Es la UNICA fuente del rol para el panel.
 *
 * Corre los pasos 1 y 2 pero NO el 3, y eso no es un descuido: es la ruta con
 * la que el cliente decide si pinta el panel o la pantalla de "no autorizado".
 * Si exigiese rol de administrador, un empleado recibiria 403, el adaptador lo
 * traduciria a un `AdminError('forbidden')` y esa pantalla no se pintaria
 * jamas; el usuario veria un error donde deberia ver una explicacion. El rol va
 * en el cuerpo precisamente para que el cliente lo mire el.
 *
 * Que un empleado sepa su propio rol y su propia caducidad no le da nada: son
 * datos suyos, y las rutas que de verdad administran siguen cerradas.
 */
export async function handleAdminSession(
  authorization: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  const { role, email, displayName, expiresAt } = authenticated.user;
  return { status: 200, body: { role, email, displayName, expiresAt: toIso(expiresAt) } };
}

export async function handleListInvitations(
  authorization: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  const now = clock(deps);
  const rows = await deps.directory.listInvitations();

  // El array va envuelto en un objeto: un JSON de nivel superior que es un
  // array es incomodo de extender sin romper a nadie, y el cliente ya
  // desempaqueta `{ invitations }` en `listInvitations`.
  return { status: 200, body: { invitations: rows.map((row) => toInvitationBody(row, now)) } };
}

/** Forma minima de un email. Ver `handleCreateInvitation` para por que no mas. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = normalizeEmail(raw);
  return EMAIL_SHAPE.test(email) ? email : null;
}

/**
 * Alta de invitacion. El orden de los pasos importa tanto como el de las
 * guardas, y por el mismo motivo: cada uno tiene que fallar antes de que el
 * siguiente deje algo a medias.
 *
 *   validar -> comprobar que hay adaptador -> generar contrasena -> crear la
 *   cuenta en Identity Platform -> guardar la fila en el directorio.
 *
 * La fila va la ULTIMA a proposito. Es la unica de las dos operaciones con
 * efecto que se puede deshacer sola: si se guardase primero y el alta en Google
 * fallase, quedaria una invitacion en la tabla que no corresponde a ninguna
 * cuenta y que alguien tendria que limpiar a mano. Al reves -- que es el orden
 * de aqui -- la unica ventana mala se compensa, y se compensa abajo.
 *
 * ## Sobre la validacion del email
 *
 * `EMAIL_SHAPE` no intenta implementar la RFC 5322: esa gramatica acepta cosas
 * que ningun proveedor emite y rechazarla bien es un problema conocido por no
 * tener solucion corta. La autoridad de verdad es Identity Platform, que valida
 * el formato al crear la cuenta. Esto solo filtra la basura evidente antes de
 * gastar dos viajes a googleapis.com, y sobre todo antes de que el 400 y el 409
 * se confundan en la pantalla.
 */
export async function handleCreateInvitation(
  authorization: unknown,
  body: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) return INVALID_REQUEST;
  const { email: rawEmail, days } = body as { email?: unknown; days?: unknown };

  const email = validEmail(rawEmail);
  if (email === null) return INVALID_REQUEST;

  try {
    // La regla 1..90 NO se reescribe aqui: vive en `invitationRules.ts` y la
    // comparten esta ruta y los dos adaptadores del directorio. Dos copias de
    // "entre 1 y 90" se separan sin que ningun test lo note.
    assertValidInvitationDays(days as number);
  } catch (error) {
    if (error instanceof InvalidInvitationError) return INVALID_REQUEST;
    throw error;
  }

  // Despues de validar: un administrador que escribio mal el correo tiene que
  // leer "peticion invalida", no "el despliegue no tiene credencial", o se
  // pondria a revisar el secreto de GCP por una errata suya.
  const identityAdmin = deps.identityAdmin;
  if (!identityAdmin) return IDENTITY_UNAVAILABLE;

  // Desde aqui hasta el `return`, esta variable es la unica copia del valor en
  // todo el proceso. No se registra, no se guarda y no entra en ningun mensaje
  // de error. Ver la cabecera de `generatePassword.ts`.
  const password = generatePassword();

  let uid: string;
  try {
    uid = await identityAdmin.createAccount(email, password);
  } catch (error) {
    if (error instanceof IdentityAdminError && error.code === 'email-exists') {
      return { status: 409, body: { error: 'conflict' } };
    }
    // Todo lo demas -- Google caido, permisos IAM, cuota, red -- es lo mismo
    // para quien llama: no se pudo, reintentalo. El detalle va al log.
    logger(deps)(`no se pudo crear la cuenta de ${email} en Identity Platform`);
    return IDENTITY_UNAVAILABLE;
  }

  let created: DirectoryUser;
  try {
    created = await deps.directory.createInvitation({
      email,
      days: days as number,
      invitedById: authorized.user.id,
      uid,
    });
  } catch {
    // ## La cuenta huerfana
    //
    // La cuenta YA existe en Identity Platform y su fila no. Esa cuenta puede
    // autenticarse: `OfficeRoom.onAuth` la vera como `not-provisioned` y la
    // echara mientras el directorio siga configurado, pero la credencial existe
    // de verdad, alguien conoce su contrasena, y nadie puede verla ni revocarla
    // desde el panel -- porque el panel lista filas del directorio y esa fila
    // no esta. Es una credencial fuera de inventario, que es el peor sitio
    // donde puede estar una credencial.
    //
    // Por eso se COMPENSA en vez de dejarla: se desactiva la cuenta recien
    // creada, que es la operacion inversa exacta de lo unico que llego a pasar.
    // No se borra: desactivar es reversible por un operador y borrar no, y este
    // camino se recorre justo cuando algo ya ha ido mal y la informacion vale
    // mas que la limpieza.
    //
    // Si la compensacion tambien falla, no queda nada automatico por hacer y la
    // cuenta se queda viva: el log es entonces la UNICA forma de saber cual
    // borrar desde la consola de GCP, asi que lleva el uid.
    logger(deps)(`no se pudo guardar la invitacion de ${email}: cuenta huerfana uid=${uid}`);
    try {
      await identityAdmin.disableAccount(uid);
      logger(deps)(`cuenta huerfana uid=${uid} desactivada por compensacion`);
    } catch {
      logger(deps)(
        `FALLO LA COMPENSACION: la cuenta uid=${uid} (${email}) sigue activa en Identity ` +
          `Platform y no tiene fila en el directorio; hay que desactivarla a mano en GCP`,
      );
    }
    // 500 y no 503: 503 dice "vuelve a intentarlo", y aqui no se sabe si el
    // reintento va a encontrarse la cuenta ya creada. El cliente lo traduce a
    // `unknown`, que es exactamente lo que se sabe.
    return INTERNAL;
  }

  return {
    status: 201,
    body: {
      id: created.id,
      email: created.email,
      // La unica vez que este valor sale de este proceso.
      password,
      expiresAt: toIso(created.expiresAt),
    },
  };
}

/**
 * Alta de alguien de casa: un empleado o un administrador, sin caducidad y sin
 * `invited_by`. Es la otra mitad del panel; la de arriba da acceso temporal a
 * gente de fuera y esta incorpora a alguien que se queda.
 *
 * El orden es el mismo que el del alta de invitacion, y por el mismo motivo:
 * cada paso tiene que fallar antes de que el siguiente deje algo a medias.
 *
 *   1. autorizar (401 mudo / 403 a quien no administra),
 *   2. el cuerpo tiene que ser un objeto,
 *   3. email con forma de email,
 *   4. rol de los que se reparten (`assertAssignableRole`),
 *   5. quien llama puede repartir ESE rol (`canAssignRole`),
 *   6. hay adaptador de Identity Platform,
 *   7. generar contrasena y crear la cuenta,
 *   8. guardar la fila, y compensar la cuenta si eso falla.
 *
 * ## Por que el 403 del paso 5 va DESPUES de validar el cuerpo
 *
 * En las demas rutas el rol se comprueba antes de mirar el cuerpo, para que el
 * 400 no sea un canal lateral con el que ir aprendiendo la forma del endpoint.
 * Aqui no se puede: la pregunta no es "puede administrar" -- eso ya se resolvio
 * en el paso 1 -- sino "puede repartir ESTE rol", y ese rol viene en el cuerpo.
 * No abre nada: quien llega al paso 5 ya ha probado que administra, y lo unico
 * que aprende es que los administradores no se crean solos.
 *
 * ## Por que `invited_by` se queda en NULL
 *
 * No es un descuido ni un campo que falte rellenar: es la marca que separa a un
 * invitado de alguien de casa. Sin ella, la fila no aparece en
 * `listInvitations` y `revoke` no la alcanza -- su guarda es
 * `invited_by IS NOT NULL` --, asi que dar de alta a un empleado no anade un
 * boton para expulsarlo desde el panel de invitaciones, que es otra decision y
 * no esta tomada.
 */
export async function handleCreateUser(
  authorization: unknown,
  body: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) return INVALID_REQUEST;
  const { email: rawEmail, role: rawRole } = body as { email?: unknown; role?: unknown };

  const email = validEmail(rawEmail);
  if (email === null) return INVALID_REQUEST;

  // La lista de roles asignables NO se reescribe aqui: vive en `userRules.ts` y
  // la comparten esta ruta y los dos adaptadores del directorio.
  let role: AssignableRole;
  try {
    assertAssignableRole(rawRole);
    role = rawRole;
  } catch (error) {
    if (error instanceof InvalidUserError) return INVALID_REQUEST;
    throw error;
  }

  if (!canAssignRole(authorized.user.role, role)) return FORBIDDEN;

  // Despues de validar, igual que en el alta de invitacion: quien escribio mal
  // el correo tiene que leer "peticion invalida" y no "el despliegue no tiene
  // credencial", o se pondria a revisar el secreto de GCP por una errata suya.
  const identityAdmin = deps.identityAdmin;
  if (!identityAdmin) return IDENTITY_UNAVAILABLE;

  // Unica copia del valor en todo el proceso: no se registra, no se guarda y no
  // entra en ningun mensaje de error. Ver la cabecera de `generatePassword.ts`.
  const password = generatePassword();

  let uid: string;
  try {
    uid = await identityAdmin.createAccount(email, password);
  } catch (error) {
    if (error instanceof IdentityAdminError && error.code === 'email-exists') {
      return { status: 409, body: { error: 'conflict' } };
    }
    logger(deps)(`no se pudo crear la cuenta de ${email} en Identity Platform`);
    return IDENTITY_UNAVAILABLE;
  }

  let created: DirectoryUser;
  try {
    created = await deps.directory.createUser({
      email,
      role,
      uid,
      createdById: authorized.user.id,
    });
  } catch {
    // Mismo hueco y misma compensacion que en el alta de invitacion: la cuenta
    // ya existe en Identity Platform y su fila no, asi que es una credencial
    // que nadie puede ver ni revocar desde el panel. Se desactiva, que es la
    // operacion inversa exacta de lo unico que llego a pasar, y no se borra:
    // desactivar es reversible por un operador y borrar no.
    logger(deps)(`no se pudo guardar el alta de ${email}: cuenta huerfana uid=${uid}`);
    try {
      await identityAdmin.disableAccount(uid);
      logger(deps)(`cuenta huerfana uid=${uid} desactivada por compensacion`);
    } catch {
      logger(deps)(
        `FALLO LA COMPENSACION: la cuenta uid=${uid} (${email}) sigue activa en Identity ` +
          `Platform y no tiene fila en el directorio; hay que desactivarla a mano en GCP`,
      );
    }
    return INTERNAL;
  }

  return {
    status: 201,
    body: {
      id: created.id,
      email: created.email,
      role: created.role,
      // La unica vez que este valor sale de este proceso.
      password,
    },
  };
}

/**
 * Revocacion. Son DOS operaciones porque cortan dos cosas distintas y las dos
 * hacen falta:
 *
 *   - `directory.revoke` corta la ENTRADA a la oficina. `OfficeRoom.onAuth`
 *     consulta el directorio en cada join, asi que el siguiente intento de
 *     entrar se rechaza de inmediato aunque el ID token siga siendo valido.
 *   - `identityAdmin.disableAccount` corta la CREDENCIAL. Mientras no se haga,
 *     la persona conserva un ID token valido hasta una hora mas y, peor,
 *     Identity Platform se lo renueva indefinidamente con su refresh token: la
 *     cuenta sigue existiendo y sirviendo para cualquier cosa de ese proyecto.
 *
 * Sin la segunda, "revocar" significa "no puede volver a entrar a la sala", no
 * "ya no es nadie aqui". Es la diferencia entre cerrar la puerta y retirar la
 * llave.
 *
 * ## Si la segunda falla, la primera NO se deshace
 *
 * Una fila revocada que sobrevive a un fallo al desactivar deja a la persona
 * fuera de la oficina, que es lo que el administrador pidio. Devolverle el
 * acceso porque una llamada a Google no respondio seria fallar en abierto, y
 * ademas sin que nadie se entere: el panel diria "revocada" o "no se pudo", y
 * en un caso la fila volveria atras en silencio. Se responde 200, porque la
 * revocacion que importa SI ocurrio, y se registra la mitad que falta con el
 * uid, porque desactivar esa cuenta pasa a ser trabajo manual.
 */
export async function handleRevokeInvitation(
  authorization: unknown,
  id: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  // Un id que no es texto se trata igual que uno que no existe: distinguirlos
  // con un 400 solo le diria a quien sondea que su id tenia buena forma.
  if (typeof id !== 'string' || id.length === 0) return NOT_FOUND;

  // El directorio es quien decide si ese id es revocable: su `revoke` devuelve
  // `null` tambien para un empleado, porque revocar por aqui a alguien de casa
  // convertiria el panel de invitaciones en un boton de expulsion del personal.
  const revoked = await deps.directory.revoke(id, authorized.user.id);
  if (revoked === null) return NOT_FOUND;

  if (revoked.uid === null) {
    // Alta anterior al panel: la fila existe pero nunca hubo cuenta creada por
    // nosotros. No hay nada que desactivar y mandar un `localId` vacio solo
    // produciria un error en el log que no significa nada.
  } else if (!deps.identityAdmin) {
    logger(deps)(
      `invitacion ${id} revocada en el directorio, pero no hay credencial de Identity ` +
        `Platform: la cuenta uid=${revoked.uid} sigue activa y hay que desactivarla a mano`,
    );
  } else {
    try {
      await deps.identityAdmin.disableAccount(revoked.uid);
    } catch {
      logger(deps)(
        `invitacion ${id} revocada en el directorio, pero no se pudo desactivar la cuenta ` +
          `uid=${revoked.uid} en Identity Platform: hay que desactivarla a mano en GCP`,
      );
    }
  }

  return { status: 200, body: { id: revoked.id, status: 'revoked' } };
}
