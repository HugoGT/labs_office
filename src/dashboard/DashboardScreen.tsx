import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeAdminError } from './adminErrors';
import {
  AdminError,
  type AdminPort,
  type AdminSession,
  type AssignableRole,
  type Invitation,
  type Role,
} from './adminPort';
import styles from './DashboardScreen.module.css';

/** Rango de acceso de un invitado (#24): el servidor impone el mismo. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
const DEFAULT_DAYS = '7';

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  employee: 'Empleado',
  guest: 'Invitado',
};

/** Ausencia de dato, no cero: una invitacion sin fecha no vence "el 0". */
const EMPTY_CELL = '—';

function administra(role: Role): boolean {
  return role === 'admin' || role === 'superadmin';
}

/**
 * Fecha en UTC y no en la zona del navegador, a proposito: el servidor manda
 * ISO 8601 en UTC y calcula el los dias restantes en ese mismo marco. Pintar
 * `toLocaleDateString` ensenaria el dia anterior a cualquiera al oeste de
 * Greenwich y la tabla se contradiria a si misma ("vence el 7, quedan 7
 * dias").
 */
export function formatUtcDate(iso: string | null): string {
  if (iso === null) return 'Sin caducidad';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export interface InviteFormProps {
  /** Devuelve `true` si la invitacion se creo; solo entonces se limpia. */
  onSubmit: (email: string, days: number) => Promise<boolean>;
  pending: boolean;
  /** Ya traducido a texto (`describeAdminError`), nunca el error crudo. */
  error: string | null;
}

/**
 * Formulario de invitacion. Presentacional (D3): no conoce el puerto, solo
 * avisa hacia arriba. Es un `<form>` de verdad, como `LoginScreen`, para que
 * Enter envie y el navegador valide los campos obligatorios.
 */
export function InviteForm({ onSubmit, pending, error }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(DEFAULT_DAYS);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // Sin esto el navegador navegaria a la misma URL y se perderia el estado.
    event.preventDefault();
    if (pending) return;

    const created = await onSubmit(email.trim(), Number(days));
    // Solo se limpia si de verdad se creo: tras un fallo, quien invita quiere
    // corregir un caracter, no volver a escribirlo todo.
    if (!created) return;
    setEmail('');
    setDays(DEFAULT_DAYS);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={`${styles.field} ${styles.emailField}`}>
        <label className={styles.label} htmlFor="invite-email">
          Correo
        </label>
        <input
          className={styles.input}
          id="invite-email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="invite-days">
          Días de acceso
        </label>
        {/* `min`/`max` no son la guarda -- se saltan con las herramientas del
            navegador --, pero ponen los limites donde se leen: en el campo. */}
        <input
          className={`${styles.input} ${styles.daysInput}`}
          id="invite-days"
          type="number"
          min={MIN_DAYS}
          max={MAX_DAYS}
          step={1}
          required
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Invitando…' : 'Invitar'}
      </button>

      {/* `role="alert"`, como en `LoginScreen`: el fallo aparece lejos del
          foco y sin anunciarlo no existe para un lector de pantalla. */}
      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

export interface UserFormProps {
  /** Devuelve `true` si el alta se hizo; solo entonces se limpia. */
  onSubmit: (email: string, role: AssignableRole) => Promise<boolean>;
  pending: boolean;
  /** Ya traducido a texto (`describeAdminError`), nunca el error crudo. */
  error: string | null;
  /**
   * Si se ofrece el rol de administrador. Es un booleano plano y no la sesion
   * entera: este componente no tiene por que saber que existe un rol de quien
   * mira, solo si esa opcion se pinta (D3).
   */
  canCreateAdmins: boolean;
}

/**
 * Alta de alguien de casa. Presentacional (D3), igual que `InviteForm`: no
 * conoce el puerto y solo avisa hacia arriba. `<form>` de verdad para que Enter
 * envie y el navegador exija el correo.
 *
 * Esconder la opcion de administrador es COSMETICO, en el mismo sentido que la
 * pantalla de "no autorizado" de mas abajo: `/admin/users` es una url publica y
 * cualquiera con un ID token valido puede pedir `role: 'admin'` a mano con
 * curl. La guarda de verdad es `canAssignRole` en el servidor, que responde 403
 * a un admin que intente crear otro admin. Esto solo evita ofrecer una opcion
 * que a esa persona le va a fallar siempre.
 */
export function UserForm({ onSubmit, pending, error, canCreateAdmins }: UserFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('employee');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // Sin esto el navegador navegaria a la misma URL y se perderia el estado.
    event.preventDefault();
    if (pending) return;

    const done = await onSubmit(email.trim(), role);
    // Solo se limpia si de verdad se creo: tras un fallo, quien da de alta
    // quiere corregir un caracter, no volver a escribirlo todo.
    if (!done) return;
    setEmail('');
    setRole('employee');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={`${styles.field} ${styles.emailField}`}>
        <label className={styles.label} htmlFor="user-email">
          Correo
        </label>
        <input
          className={styles.input}
          id="user-email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="user-role">
          Rol
        </label>
        <select
          className={`${styles.input} ${styles.roleSelect}`}
          id="user-role"
          value={role}
          onChange={(event) => setRole(event.target.value as AssignableRole)}
        >
          <option value="employee">{ROLE_LABELS.employee}</option>
          {canCreateAdmins && <option value="admin">{ROLE_LABELS.admin}</option>}
        </select>
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Creando…' : 'Crear usuario'}
      </button>

      {/* `role="alert"`, como en `InviteForm`: el fallo aparece lejos del foco
          y sin anunciarlo no existe para un lector de pantalla. */}
      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

export interface GeneratedPasswordProps {
  /**
   * Forma estructural y no `CreatedInvitation`: los dos flujos entregan una
   * credencial y solo se diferencian en si hay fecha de vencimiento, asi que
   * pedir lo minimo que hace falta para pintarla evita un segundo panel
   * identico que habria que mantener en paralelo.
   */
  created: { email: string; password: string; expiresAt: string | null };
  onDismiss: () => void;
}

/**
 * La contrasena recien generada (#24, seccion 3). Se entrega UNA vez: no se
 * guarda en `localStorage`, no se escribe en ningun log y no viaja en ninguna
 * consulta posterior -- `Invitation` ni siquiera tiene el campo. Su unica
 * copia es el estado de React de esta pantalla, que muere al descartarla o al
 * recargar. Si se pierde, se revoca y se invita de nuevo.
 */
export function GeneratedPassword({ created, onDismiss }: GeneratedPasswordProps) {
  return (
    <section className={styles.secret} aria-labelledby="credenciales-nuevas" aria-live="polite">
      <h2 className={styles.secretTitle} id="credenciales-nuevas">
        Credenciales de {created.email}
      </h2>
      <p className={styles.secretWarning}>
        Cópiala y entrégala ahora: no se volverá a mostrar en ningún sitio.
      </p>
      <p className={styles.secretValue}>{created.password}</p>
      {/* Decirlo y no callarlo: con las dos altas en la misma pantalla, esta
          linea es lo unico que distingue un acceso temporal de uno que se
          queda, justo cuando quien administra acaba de hacer una de las dos. */}
      <p className={styles.subtitle}>
        {created.expiresAt === null
          ? 'El acceso no caduca.'
          : `El acceso caduca el ${formatUtcDate(created.expiresAt)}.`}
      </p>
      <button className={styles.secretDismiss} type="button" onClick={onDismiss}>
        Entendido, ya la copié
      </button>
    </section>
  );
}

export interface InvitationsTableProps {
  invitations: Invitation[];
  onRevoke: (id: string) => void;
  /** Id de la invitacion con una revocacion en vuelo, o `null`. */
  revokingId: string | null;
}

/** Tabla de invitaciones. Presentacional: props planas y un aviso hacia arriba. */
export function InvitationsTable({ invitations, onRevoke, revokingId }: InvitationsTableProps) {
  if (invitations.length === 0) {
    // Una tabla con encabezados y sin filas se lee como un fallo de carga.
    return <p className={styles.empty}>Todavía no hay invitaciones.</p>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Correo</th>
            <th scope="col">Rol</th>
            <th scope="col">Invitó</th>
            <th scope="col">Vence</th>
            <th scope="col">Días restantes</th>
            <th scope="col">Estado</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr
              key={invitation.id}
              className={invitation.status === 'revoked' ? styles.revoked : undefined}
            >
              <th scope="row">{invitation.email}</th>
              <td>{ROLE_LABELS[invitation.role]}</td>
              {/* Auditoria (#24, punto 7). Las altas anteriores al panel no
                  tienen a quien atribuirse y eso se ensena, no se inventa. */}
              <td>{invitation.invitedByEmail ?? EMPTY_CELL}</td>
              <td>{formatUtcDate(invitation.expiresAt)}</td>
              <td>{invitation.daysLeft ?? EMPTY_CELL}</td>
              <td>{invitation.status === 'active' ? 'Activa' : 'Revocada'}</td>
              <td>
                {invitation.status === 'active' && (
                  <button
                    className={styles.revoke}
                    type="button"
                    disabled={revokingId !== null}
                    onClick={() => onRevoke(invitation.id)}
                  >
                    Revocar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DashboardScreenProps {
  /** Puerto ya construido (`DashboardRoute`); esta pantalla no sabe de HTTP. */
  admin: AdminPort;
}

type Phase = 'loading' | 'denied' | 'failed' | 'ready';

/**
 * Panel de invitaciones (#24). Contenedor: es el unico que llama al puerto y
 * el unico con estado; la tabla, el formulario y el aviso de credenciales
 * reciben props planas y no saben que hay un servidor detras.
 *
 * Lo que se ve al llegar sale de `session()`, es decir del SERVIDOR: el rol no
 * se deduce del ID token en el navegador, que es manipulable.
 */
export function DashboardScreen({ admin }: DashboardScreenProps) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  /**
   * La credencial recien entregada, venga del alta que venga: el panel es el
   * mismo y solo cambia si hay caducidad que anunciar. `expiresAt: null`
   * significa "no caduca", que es exactamente lo que el servidor guarda.
   */
  const [created, setCreated] = useState<GeneratedPasswordProps['created'] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Estado propio para el alta de usuario, separado del de invitar a proposito:
  // con uno solo, un fallo al dar de alta pintaria un error rojo dentro del
  // formulario de invitacion, diciendo que fallo algo que ni se intento.
  const [userError, setUserError] = useState<string | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  /**
   * Tras cada cambio se relee la lista entera en vez de parchearla en local:
   * el servidor es el dueno del estado y una revocacion puede arrastrar mas
   * cosas (un vencimiento que paso mientras tanto, otra persona trabajando en
   * el mismo panel) que este cliente no puede adivinar.
   */
  const refresh = useCallback(async () => {
    setInvitations(await admin.listInvitations());
  }, [admin]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const current = await admin.session();
        if (cancelled) return;
        setSession(current);

        if (!administra(current.role)) {
          setPhase('denied');
          return;
        }
        await refresh();
        if (cancelled) return;
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        // Un 403 es "no eres de los que administran"; cualquier otro fallo es
        // un problema tecnico y merece su propio mensaje. Confundirlos haria
        // que un servidor caido pareciese una falta de permisos.
        if (error instanceof AdminError && error.code === 'forbidden') {
          setPhase('denied');
          return;
        }
        setLoadError(describeAdminError(error));
        setPhase('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [admin, refresh]);

  async function handleCreate(email: string, days: number): Promise<boolean> {
    setActionError(null);

    // Validacion de comodidad, NO la guarda: ahorra un viaje y explica el
    // rango en el acto. El servidor vuelve a comprobarlo en cada peticion,
    // porque cualquiera puede llamar al endpoint a mano (#24, punto 5).
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      setActionError(`El acceso dura entre ${MIN_DAYS} y ${MAX_DAYS} días.`);
      return false;
    }

    setCreating(true);
    try {
      setCreated(await admin.createInvitation(email, days));
      await refresh();
      return true;
    } catch (error) {
      setActionError(describeAdminError(error));
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateUser(email: string, role: AssignableRole): Promise<boolean> {
    setUserError(null);
    setCreatingUser(true);
    try {
      const user = await admin.createUser(email, role);
      // `expiresAt: null` no es un hueco por rellenar: es el dato. Quien entra
      // por aqui es de casa y su acceso no vence.
      setCreated({ email: user.email, password: user.password, expiresAt: null });
      // Y NO se llama a `refresh()`: la fila nace sin `invited_by`, asi que el
      // servidor no la devuelve en `listInvitations` y releer la lista solo
      // gastaria un viaje para pintar exactamente lo mismo.
      return true;
    } catch (error) {
      setUserError(describeAdminError(error));
      return false;
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setActionError(null);
    setRevokingId(id);
    try {
      await admin.revoke(id);
      await refresh();
    } catch (error) {
      setActionError(describeAdminError(error));
    } finally {
      setRevokingId(null);
    }
  }

  // Mismo criterio que `ready` en `AuthGate`: nada mientras no se sabe. Pintar
  // "no autorizado" en este hueco lo haria parpadear en cada recarga a quien
  // si administra.
  if (phase === 'loading') return null;

  if (phase === 'denied') {
    /**
     * Pantalla COSMETICA, y conviene no confundirse (#24, punto 5): esconder
     * el panel no protege nada. Quien tenga un ID token valido puede llamar a
     * `/admin/...` a mano desde una terminal. La autorizacion de verdad la
     * comprueba el SERVIDOR en cada ruta; esto solo evita ensenar una tabla
     * vacia y siete errores a quien no tiene nada que hacer aqui.
     */
    return (
      <div className={styles.screen}>
        <div className={styles.notice}>
          <div>
            <h1 className={styles.title}>No autorizado</h1>
            <p className={styles.subtitle}>
              Este panel es solo para quien administra la oficina.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'failed' || session === null) {
    return (
      <div className={styles.screen}>
        <div className={styles.content}>
          <h1 className={styles.title}>Administración</h1>
          <div className={styles.error} role="alert">
            {loadError ?? describeAdminError(null)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <header>
          {/* El panel ya no hace una sola cosa: titularlo "Invitaciones"
              dejaria fuera el alta de alguien de casa, que no es una. */}
          <h1 className={styles.title}>Administración</h1>
          <p className={styles.subtitle}>
            {session.email} · {ROLE_LABELS[session.role]}
          </p>
        </header>

        {created !== null && (
          <GeneratedPassword created={created} onDismiss={() => setCreated(null)} />
        )}

        {/* Cada tarjeta lleva su encabezado y su `aria-labelledby`: con dos
            altas en la misma pantalla, un campo "Correo" suelto no dice a cual
            de las dos pertenece, ni mirandolo ni oyendolo. */}
        <section className={styles.card} aria-labelledby="nueva-invitacion">
          <h2 className={styles.cardTitle} id="nueva-invitacion">
            Nueva invitación
          </h2>
          <p className={styles.cardSubtitle}>
            Acceso temporal para alguien de fuera: caduca solo y se puede revocar.
          </p>
          <InviteForm onSubmit={handleCreate} pending={creating} error={actionError} />
        </section>

        <section className={styles.card} aria-labelledby="nuevo-usuario">
          <h2 className={styles.cardTitle} id="nuevo-usuario">
            Nuevo usuario
          </h2>
          <p className={styles.cardSubtitle}>
            Alguien de la empresa: su acceso no caduca y no aparece en la lista de
            invitaciones.
          </p>
          <UserForm
            onSubmit={handleCreateUser}
            pending={creatingUser}
            error={userError}
            // El rol de quien mira lo dice el SERVIDOR (`session()`), no el ID
            // token del navegador, que es manipulable.
            canCreateAdmins={session.role === 'superadmin'}
          />
        </section>

        <section className={styles.card} aria-labelledby="lista-invitaciones">
          <h2 className={styles.cardTitle} id="lista-invitaciones">
            Invitaciones
          </h2>
          <InvitationsTable
            invitations={invitations}
            onRevoke={(id) => void handleRevoke(id)}
            revokingId={revokingId}
          />
        </section>
      </div>
    </div>
  );
}
