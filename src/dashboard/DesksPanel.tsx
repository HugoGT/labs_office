import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeAdminError } from './adminErrors';
import { AdminError } from './adminPort';
import type { AdminDesk, DeskAdminPort, UpdateDeskInput } from './deskAdminPort';
import styles from './DashboardScreen.module.css';

/**
 * Panel de escritorios asignables (#7, slice 5). Contenedor: es el unico que
 * llama al puerto y el unico con estado; la tabla y el formulario reciben
 * props planas y no saben que hay un servidor detras (D3), igual que
 * `InvitationsTable` e `InviteForm`.
 *
 * ## Lo que este panel hace, y lo que NO
 *
 * Quien administra decide CUANTOS escritorios hay y DONDE estan: crear, mover,
 * renombrar y borrar. No sienta ni levanta a nadie -- eso lo hace cada persona
 * desde la oficina -- y por eso aqui no hay ningun control de ocupante. No es
 * una pieza que falte: el servidor no tiene ninguna ruta de administracion que
 * escriba `occupant_id`, asi que ofrecerlo seria ofrecer algo que solo puede
 * acabar en un 400.
 *
 * El ocupante SI se ensena, porque es la mitad de la pregunta que se hace
 * antes de mover o quitar un escritorio.
 */

/** Origen en tiles: el servidor rechaza cualquier otra cosa con un 400. */
const MIN_COORD = 0;

/** Ausencia de ocupante, no de dato: un escritorio libre no es de nadie. */
const FREE = 'Libre';

/**
 * Ocupado por alguien sin nombre visible. El directorio no obliga a tenerlo, y
 * las dos alternativas son peores: "Libre" ofreceria un sitio que no lo esta,
 * y el uuid no le dice nada a quien administra.
 */
const OCCUPIED_UNNAMED = 'Ocupado';

export interface DeskFormValues {
  label: string;
  x: string;
  y: string;
}

const EMPTY_FORM: DeskFormValues = { label: '', x: '', y: '' };

export interface DeskFormProps {
  /** El escritorio que se esta editando, o `null` al colocar uno nuevo. */
  editing: AdminDesk | null;
  /** Devuelve `true` si el servidor lo acepto; solo entonces se limpia. */
  onSubmit: (values: DeskFormValues) => Promise<boolean>;
  onCancel: () => void;
  pending: boolean;
  /** Ya traducido a texto (`describeAdminError`), nunca el error crudo. */
  error: string | null;
}

/**
 * Alta y edicion en el MISMO formulario, y no dos: los campos son los mismos
 * tres y el servidor los lee igual. Dos formularios obligarian a mantener en
 * paralelo la misma validacion, y el de edicion estaria vacio casi siempre.
 *
 * Presentacional (D3): no conoce el puerto, solo avisa hacia arriba. Es un
 * `<form>` de verdad, como `InviteForm`, para que Enter envie y el navegador
 * valide los campos obligatorios.
 */
export function DeskForm({ editing, onSubmit, onCancel, pending, error }: DeskFormProps) {
  const [values, setValues] = useState<DeskFormValues>(EMPTY_FORM);

  /**
   * Al elegir otro escritorio (o al salir de la edicion) los campos se
   * rellenan con lo que ese escritorio tiene AHORA. Sin esto, editar uno y
   * luego otro guardaria en el segundo lo que se escribio para el primero.
   */
  useEffect(() => {
    setValues(
      editing === null
        ? EMPTY_FORM
        : { label: editing.label, x: String(editing.x), y: String(editing.y) },
    );
  }, [editing]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // Sin esto el navegador navegaria a la misma URL y se perderia el estado.
    event.preventDefault();
    if (pending) return;

    const done = await onSubmit({
      label: values.label.trim(),
      x: values.x.trim(),
      y: values.y.trim(),
    });
    // Solo se limpia si de verdad se guardo: tras un fallo, quien administra
    // quiere corregir una coordenada, no volver a escribirlo todo.
    if (done) setValues(EMPTY_FORM);
  }

  function field(name: keyof DeskFormValues) {
    return (value: string) => setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      // Nombre accesible que dice en cual de los dos modos esta: con la tabla
      // al lado, un formulario sin nombre no se distingue de ella al navegar
      // por landmarks.
      aria-label={editing === null ? 'Nuevo escritorio' : `Editar escritorio ${editing.label}`}
    >
      <div className={`${styles.field} ${styles.emailField}`}>
        <label className={styles.label} htmlFor="desk-label">
          Etiqueta
        </label>
        <input
          className={styles.input}
          id="desk-label"
          type="text"
          autoComplete="off"
          required
          value={values.label}
          onChange={(event) => field('label')(event.target.value)}
        />
      </div>

      {/* `min`/`step` no son la guarda -- se saltan con las herramientas del
          navegador --, pero ponen el limite donde se lee: en el campo. */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="desk-x">
          X
        </label>
        <input
          className={`${styles.input} ${styles.coordInput}`}
          id="desk-x"
          type="number"
          min={MIN_COORD}
          step={1}
          required
          value={values.x}
          onChange={(event) => field('x')(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="desk-y">
          Y
        </label>
        <input
          className={`${styles.input} ${styles.coordInput}`}
          id="desk-y"
          type="number"
          min={MIN_COORD}
          step={1}
          required
          value={values.y}
          onChange={(event) => field('y')(event.target.value)}
        />
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {editing === null ? 'Crear escritorio' : 'Guardar cambios'}
      </button>

      {editing !== null && (
        <button className={styles.ghost} type="button" onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
      )}

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

export interface DesksTableProps {
  desks: AdminDesk[];
  onEdit: (desk: AdminDesk) => void;
  onDelete: (id: string) => void;
  /** Id del escritorio que espera confirmacion de borrado, o `null`. */
  confirmingId: string | null;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  /** Id con una escritura en vuelo, o `null`. */
  busyId: string | null;
}

/** Tabla de escritorios. Presentacional: props planas y avisos hacia arriba. */
export function DesksTable({
  desks,
  onEdit,
  onDelete,
  confirmingId,
  onAskDelete,
  onCancelDelete,
  busyId,
}: DesksTableProps) {
  if (desks.length === 0) {
    // Una tabla con encabezados y sin filas se lee como un fallo de carga.
    return <p className={styles.empty}>Todavía no hay escritorios en la oficina.</p>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Escritorio</th>
            <th scope="col">Posición</th>
            <th scope="col">Tamaño</th>
            <th scope="col">Estado</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {desks.map((desk) => (
            <tr key={desk.id}>
              <th scope="row">{desk.label}</th>
              {/* En casillas, que es la unidad que se escribe para moverlo. */}
              <td>
                {desk.x}, {desk.y}
              </td>
              <td>
                {desk.w}×{desk.h}
              </td>
              <td>
                {desk.occupant === null ? FREE : (desk.occupant.displayName ?? OCCUPIED_UNNAMED)}
              </td>
              <td>
                {confirmingId === desk.id ? (
                  <>
                    {/* Se dice lo que PASA, no lo que esta prohibido: borrar un
                        escritorio ocupado esta permitido y lo unico que hace es
                        dejar sin sitio a quien estuviese en el. */}
                    <span className={styles.confirmNote}>
                      Se quita de la oficina. Quien esté sentado se queda sin escritorio y podrá
                      coger otro.
                    </span>
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onDelete(desk.id)}
                    >
                      Sí, eliminar
                    </button>
                    <button className={styles.ghost} type="button" onClick={onCancelDelete}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={styles.ghost}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onEdit(desk)}
                    >
                      Editar
                    </button>
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onAskDelete(desk.id)}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DesksPanelProps {
  /** Puerto ya construido (`DashboardRoute`); este panel no sabe de HTTP. */
  desks: DeskAdminPort;
}

type Phase = 'loading' | 'unavailable' | 'failed' | 'ready';

/**
 * Una coordenada escrita a mano a un entero, o `null` si no lo es. Validacion
 * de comodidad, NO la guarda: ahorra un viaje y explica el limite en el acto,
 * pero el servidor la vuelve a comprobar en cada peticion porque cualquiera
 * puede llamar al endpoint a mano.
 */
function toCoord(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_COORD) return null;
  return value;
}

export function DesksPanel({ desks }: DesksPanelProps) {
  const [list, setList] = useState<AdminDesk[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminDesk | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Tras cada cambio se relee la lista entera en vez de parchearla en local:
   * el servidor es el dueno del estado y otra persona puede estar
   * administrando el mismo panel, o alguien puede haberse sentado mientras
   * tanto.
   */
  const refresh = useCallback(async () => {
    setList(await desks.listDesks());
  }, [desks]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refresh();
        if (cancelled) return;
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        /**
         * Un 503 NO es una averia: un despliegue sin `DATABASE_URL` es un
         * estado legitimo en el que la oficina funciona igual, solo que no hay
         * donde sentarse. Por eso tiene fase propia -- se explica, no se grita
         * -- y por eso no pinta el formulario: ofrecerlo seria ofrecer algo
         * que solo puede acabar en otro 503.
         */
        if (error instanceof AdminError && error.code === 'desks-not-configured') {
          setPhase('unavailable');
          return;
        }
        setLoadError(describeAdminError(error));
        setPhase('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function handleSubmit(values: DeskFormValues): Promise<boolean> {
    setFormError(null);

    const x = toCoord(values.x);
    const y = toCoord(values.y);
    if (x === null || y === null) {
      setFormError(`La posición son dos casillas enteras, mayor o igual que ${MIN_COORD}.`);
      return false;
    }

    setPending(true);
    try {
      if (editing === null) {
        await desks.createDesk({ label: values.label, x, y });
      } else {
        // Se manda solo lo que CAMBIO: mandar la posicion al renombrar
        // devolveria el escritorio a la que se leyo si alguien lo movio
        // mientras tanto. Y las dos coordenadas juntas, porque media
        // coordenada no es una posicion y el servidor la rechaza.
        const patch: UpdateDeskInput = {};
        if (values.label !== editing.label) patch.label = values.label;
        if (x !== editing.x || y !== editing.y) {
          patch.x = x;
          patch.y = y;
        }
        await desks.updateDesk(editing.id, patch);
        setEditing(null);
      }
      await refresh();
      return true;
    } catch (error) {
      setFormError(describeAdminError(error));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setFormError(null);
    setBusyId(id);
    try {
      await desks.deleteDesk(id);
      setConfirmingId(null);
      // Si se estaba editando justo ese, el formulario vuelve al alta: seguir
      // ensenando los campos de algo que ya no existe solo puede acabar en un
      // 404 al guardar.
      if (editing?.id === id) setEditing(null);
      await refresh();
    } catch (error) {
      setFormError(describeAdminError(error));
    } finally {
      setBusyId(null);
    }
  }

  // Mismo criterio que `DashboardScreen`: nada mientras no se sabe. Un
  // cargador que parpadea unos milisegundos molesta mas de lo que informa.
  if (phase === 'loading') return null;

  if (phase === 'unavailable') {
    return (
      <section className={styles.card} aria-labelledby="escritorios">
        <h2 className={styles.cardTitle} id="escritorios">
          Escritorios
        </h2>
        <p className={styles.cardSubtitle}>{describeAdminError(new AdminError('desks-not-configured'))}</p>
        <p className={styles.empty}>
          La oficina funciona igual: simplemente no hay escritorios que repartir.
        </p>
      </section>
    );
  }

  if (phase === 'failed') {
    return (
      <section className={styles.card} aria-labelledby="escritorios">
        <h2 className={styles.cardTitle} id="escritorios">
          Escritorios
        </h2>
        <div className={styles.error} role="alert">
          {loadError ?? describeAdminError(null)}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="escritorios">
      <h2 className={styles.cardTitle} id="escritorios">
        Escritorios
      </h2>
      <p className={styles.cardSubtitle}>
        Cada escritorio ocupa 3×3 casillas y no puede tocar a otro. Quien se sienta en cuál lo
        elige cada persona desde la oficina.
      </p>

      <DeskForm
        editing={editing}
        onSubmit={handleSubmit}
        onCancel={() => {
          setEditing(null);
          setFormError(null);
        }}
        pending={pending}
        error={formError}
      />

      <DesksTable
        desks={list}
        onEdit={(desk) => {
          setEditing(desk);
          setFormError(null);
          setConfirmingId(null);
        }}
        onDelete={(id) => void handleDelete(id)}
        confirmingId={confirmingId}
        onAskDelete={setConfirmingId}
        onCancelDelete={() => setConfirmingId(null)}
        busyId={busyId}
      />
    </section>
  );
}
