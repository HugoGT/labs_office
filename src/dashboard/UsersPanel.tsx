import { useCallback, useEffect, useState } from 'react';
import { describeAdminError } from './adminErrors';
import type { Role } from './adminPort';
import { formatUtcDate } from './DashboardScreen';
import type { AdminUser, UsersAdminPort } from './usersAdminPort';
import styles from './DashboardScreen.module.css';

/**
 * Users panel (#93): everyone in the directory, not only invitations, and the
 * "Quitar acceso" action. Same container shape as `AssetsPanel`: the only one
 * that calls the port and holds state; the table gets plain props (D3).
 *
 * The button shows only where the server said `removable`, which is
 * `canRemove` evaluated for the caller. That hides what would end in a 403;
 * it protects nothing, and the revoke route checks the rule again.
 */

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  employee: 'Empleado',
  guest: 'Invitado',
};

const EMPTY_CELL = '-';

export interface UsersTableProps {
  users: AdminUser[];
  confirmingId: string | null;
  busyId: string | null;
  onAskRevoke: (id: string) => void;
  onCancelRevoke: () => void;
  onRevoke: (id: string) => void;
}

/** Users table. Presentational: plain props and callbacks up. */
export function UsersTable({
  users,
  confirmingId,
  busyId,
  onAskRevoke,
  onCancelRevoke,
  onRevoke,
}: UsersTableProps) {
  if (users.length === 0) {
    return <p className={styles.empty}>Todavía no hay usuarios en el directorio.</p>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Correo</th>
            <th scope="col">Nombre</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Vence</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={user.status === 'revoked' ? styles.revoked : undefined}>
              <th scope="row">{user.email}</th>
              <td>{user.displayName ?? EMPTY_CELL}</td>
              <td>{ROLE_LABELS[user.role]}</td>
              <td>{user.status === 'active' ? 'Activo' : 'Sin acceso'}</td>
              <td>{formatUtcDate(user.expiresAt)}</td>
              <td>
                {!user.removable ? null : confirmingId === user.id ? (
                  <>
                    <span className={styles.confirmNote}>
                      Saldrá de la oficina ahora y no podrá volver a entrar.
                    </span>{' '}
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onRevoke(user.id)}
                    >
                      Sí, quitar acceso
                    </button>
                    <button className={styles.ghost} type="button" onClick={onCancelRevoke}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.revoke}
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => onAskRevoke(user.id)}
                  >
                    Quitar acceso
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

export interface UsersPanelProps {
  /** Port already built (`DashboardRoute`); this panel knows nothing of HTTP. */
  users: UsersAdminPort;
}

type Phase = 'loading' | 'failed' | 'ready';

export function UsersPanel({ users }: UsersPanelProps) {
  const [list, setList] = useState<AdminUser[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * The whole list is read again after every change instead of patched: the
   * server owns the state, and the forms above this panel (new user, new
   * invitation) add rows this one cannot see.
   */
  const refresh = useCallback(async () => {
    setList(await users.listUsers());
  }, [users]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refresh();
        if (cancelled) return;
        setPhase('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError(describeAdminError(loadError));
        setPhase('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function handleRefresh(): Promise<void> {
    setError(null);
    try {
      await refresh();
    } catch (loadError) {
      setError(describeAdminError(loadError));
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setError(null);
    setBusyId(id);
    try {
      await users.revokeUser(id);
      setConfirmingId(null);
      await refresh();
    } catch (revokeError) {
      setError(describeAdminError(revokeError));
    } finally {
      setBusyId(null);
    }
  }

  if (phase === 'loading') return null;

  return (
    <section className={styles.card} aria-labelledby="usuarios">
      <h2 className={styles.cardTitle} id="usuarios">
        Usuarios
      </h2>
      <p className={styles.cardSubtitle}>
        Todas las personas del directorio. Quitar el acceso la saca de la oficina en el momento y
        desactiva su cuenta.
      </p>

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div>
            <button className={styles.ghost} type="button" onClick={() => void handleRefresh()}>
              Actualizar
            </button>
          </div>
          <UsersTable
            users={list}
            confirmingId={confirmingId}
            busyId={busyId}
            onAskRevoke={setConfirmingId}
            onCancelRevoke={() => setConfirmingId(null)}
            onRevoke={(id) => void handleRevoke(id)}
          />
        </>
      )}
    </section>
  );
}
