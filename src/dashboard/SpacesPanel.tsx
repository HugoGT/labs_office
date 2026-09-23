import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeAdminError } from './adminErrors';
import { AdminError } from './adminPort';
import type { AdminSpace, SpacesAdminPort, UpdateSpaceInput } from './spacesAdminPort';
import styles from './DashboardScreen.module.css';

/**
 * Panel de salas y cubiculos (#10, S3b). Mismo contenedor que `DesksPanel`:
 * el unico que llama al puerto y el unico con estado; tabla y formulario son
 * props planas (D3).
 *
 * ## Salas y cubiculos comparten fila, no CRUD
 *
 * `listSpaces` trae las dos clases de fila (`kind: 'room' | 'desk'`). Solo
 * las de `kind: 'room'` tienen `Editar`/`Eliminar`: un cubiculo es un efecto
 * secundario del CRUD de escritorios (`DesksPanel`) y el servidor rechaza con
 * 409 `space-owned-by-desk` cualquier intento de tocarlo por aqui. Ofrecer
 * los botones seria ofrecer algo que solo puede acabar en ese 409.
 */

const MIN_COORD = 0;
const MIN_SIZE = 1;

/** `capacity === null` es un dato ("sin limite"), no un hueco que rellenar. */
const UNLIMITED = 'Sin límite';

/** Como se llama cada `kind` en la tabla; el cubiculo lleva el termino exacto que pide la spec. */
const KIND_LABEL: Record<AdminSpace['kind'], string> = {
  room: 'Sala',
  desk: 'Cubículo de escritorio',
};

export interface SpaceFormValues {
  name: string;
  x: string;
  y: string;
  w: string;
  h: string;
  /** Cadena vacia = sin limite; se manda `null` de todas formas, nunca se omite. */
  capacity: string;
}

const EMPTY_FORM: SpaceFormValues = { name: '', x: '', y: '', w: '', h: '', capacity: '' };

export interface SpaceFormProps {
  /** La sala que se esta editando, o `null` al colocar una nueva. Nunca un cubiculo: el panel no lo ofrece. */
  editing: AdminSpace | null;
  onSubmit: (values: SpaceFormValues) => Promise<boolean>;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

function valuesFrom(space: AdminSpace | null): SpaceFormValues {
  if (space === null) return EMPTY_FORM;
  return {
    name: space.name,
    x: String(space.x),
    y: String(space.y),
    w: String(space.w),
    h: String(space.h),
    capacity: space.capacity === null ? '' : String(space.capacity),
  };
}

/** Alta y edicion en el MISMO formulario, mismo motivo que `DeskForm`. */
export function SpaceForm({ editing, onSubmit, onCancel, pending, error }: SpaceFormProps) {
  const [values, setValues] = useState<SpaceFormValues>(EMPTY_FORM);

  useEffect(() => {
    setValues(valuesFrom(editing));
  }, [editing]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const done = await onSubmit({
      name: values.name.trim(),
      x: values.x.trim(),
      y: values.y.trim(),
      w: values.w.trim(),
      h: values.h.trim(),
      capacity: values.capacity.trim(),
    });
    if (done) setValues(EMPTY_FORM);
  }

  function field(name: keyof SpaceFormValues) {
    return (value: string) => setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      aria-label={editing === null ? 'Nueva sala' : `Editar sala ${editing.name}`}
    >
      <div className={`${styles.field} ${styles.emailField}`}>
        <label className={styles.label} htmlFor="space-name">
          Nombre
        </label>
        <input
          className={styles.input}
          id="space-name"
          type="text"
          autoComplete="off"
          required
          value={values.name}
          onChange={(event) => field('name')(event.target.value)}
        />
      </div>

      {(
        [
          ['space-x', 'X', 'x', MIN_COORD],
          ['space-y', 'Y', 'y', MIN_COORD],
          ['space-w', 'Ancho', 'w', MIN_SIZE],
          ['space-h', 'Alto', 'h', MIN_SIZE],
        ] as const
      ).map(([id, label, name, min]) => (
        <div className={styles.field} key={id}>
          <label className={styles.label} htmlFor={id}>
            {label}
          </label>
          <input
            className={`${styles.input} ${styles.coordInput}`}
            id={id}
            type="number"
            min={min}
            step={1}
            required
            value={values[name]}
            onChange={(event) => field(name)(event.target.value)}
          />
        </div>
      ))}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="space-capacity">
          Aforo
        </label>
        <input
          className={`${styles.input} ${styles.coordInput}`}
          id="space-capacity"
          type="number"
          min={MIN_SIZE}
          step={1}
          value={values.capacity}
          onChange={(event) => field('capacity')(event.target.value)}
        />
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {editing === null ? 'Crear sala' : 'Guardar cambios'}
      </button>

      {editing !== null && (
        <button className={styles.ghost} type="button" onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
      )}

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

export interface SpacesTableProps {
  spaces: AdminSpace[];
  onEdit: (space: AdminSpace) => void;
  onDelete: (id: string) => void;
  confirmingId: string | null;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  busyId: string | null;
}

/** Tabla de salas y cubiculos. Presentacional: props planas y avisos hacia arriba. */
export function SpacesTable({
  spaces,
  onEdit,
  onDelete,
  confirmingId,
  onAskDelete,
  onCancelDelete,
  busyId,
}: SpacesTableProps) {
  if (spaces.length === 0) {
    return <p className={styles.empty}>Todavía no hay salas en la oficina.</p>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Espacio</th>
            <th scope="col">Tipo</th>
            <th scope="col">Posición</th>
            <th scope="col">Tamaño</th>
            <th scope="col">Aforo</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((space) => (
            <tr key={space.id}>
              <th scope="row">{space.name}</th>
              <td>{KIND_LABEL[space.kind]}</td>
              <td>
                {space.x}, {space.y}
              </td>
              <td>
                {space.w}×{space.h}
              </td>
              <td>{space.capacity === null ? UNLIMITED : space.capacity}</td>
              <td>
                {space.kind === 'desk' ? (
                  // Se administra desde `DesksPanel`: ofrecer botones aqui
                  // solo podria acabar en el 409 `space-owned-by-desk`.
                  <span className={styles.confirmNote}>Se administra desde Escritorios.</span>
                ) : confirmingId === space.id ? (
                  <>
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onDelete(space.id)}
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
                      onClick={() => onEdit(space)}
                    >
                      Editar
                    </button>
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onAskDelete(space.id)}
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

export interface SpacesPanelProps {
  /** Puerto ya construido (`DashboardRoute`); este panel no sabe de HTTP. */
  spaces: SpacesAdminPort;
}

type Phase = 'loading' | 'unavailable' | 'failed' | 'ready';

function toCoord(raw: string, min: number): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return null;
  return value;
}

/** `undefined` marca "invalido"; `null` es el valor real de "sin limite". */
function toCapacity(raw: string): number | null | undefined {
  if (raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_SIZE) return undefined;
  return value;
}

export function SpacesPanel({ spaces }: SpacesPanelProps) {
  const [list, setList] = useState<AdminSpace[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminSpace | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setList(await spaces.listSpaces());
  }, [spaces]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refresh();
        if (cancelled) return;
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AdminError && error.code === 'spaces-not-configured') {
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

  async function handleSubmit(values: SpaceFormValues): Promise<boolean> {
    setFormError(null);

    const x = toCoord(values.x, MIN_COORD);
    const y = toCoord(values.y, MIN_COORD);
    if (x === null || y === null) {
      setFormError(`La posición son dos casillas enteras, mayor o igual que ${MIN_COORD}.`);
      return false;
    }
    const w = toCoord(values.w, MIN_SIZE);
    const h = toCoord(values.h, MIN_SIZE);
    if (w === null || h === null) {
      setFormError('El tamaño son dos casillas enteras, mayores que 0.');
      return false;
    }
    const capacity = toCapacity(values.capacity);
    if (capacity === undefined) {
      setFormError('El aforo es un entero mayor que 0, o vacío para sin límite.');
      return false;
    }

    setPending(true);
    try {
      if (editing === null) {
        await spaces.createSpace({ name: values.name, x, y, w, h, capacity });
      } else {
        // Se manda solo lo que CAMBIO. El rectangulo va entero o no va: el
        // servidor rechaza un `x` sin `y`/`w`/`h` (spaceRules.ts).
        const patch: UpdateSpaceInput = {};
        if (values.name !== editing.name) patch.name = values.name;
        if (x !== editing.x || y !== editing.y || w !== editing.w || h !== editing.h) {
          patch.x = x;
          patch.y = y;
          patch.w = w;
          patch.h = h;
        }
        if (capacity !== editing.capacity) patch.capacity = capacity;
        await spaces.updateSpace(editing.id, patch);
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
      await spaces.deleteSpace(id);
      setConfirmingId(null);
      if (editing?.id === id) setEditing(null);
      await refresh();
    } catch (error) {
      setFormError(describeAdminError(error));
    } finally {
      setBusyId(null);
    }
  }

  if (phase === 'loading') return null;

  if (phase === 'unavailable') {
    return (
      <section className={styles.card} aria-labelledby="espacios">
        <h2 className={styles.cardTitle} id="espacios">
          Espacios
        </h2>
        <p className={styles.cardSubtitle}>
          {describeAdminError(new AdminError('spaces-not-configured'))}
        </p>
        <p className={styles.empty}>La oficina funciona igual: simplemente no hay salas que repartir.</p>
      </section>
    );
  }

  if (phase === 'failed') {
    return (
      <section className={styles.card} aria-labelledby="espacios">
        <h2 className={styles.cardTitle} id="espacios">
          Espacios
        </h2>
        <div className={styles.error} role="alert">
          {loadError ?? describeAdminError(null)}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="espacios">
      <h2 className={styles.cardTitle} id="espacios">
        Espacios
      </h2>
      <p className={styles.cardSubtitle}>
        Salas y cubículos de escritorio comparten esta tabla. Los cubículos se administran desde
        Escritorios: aquí solo se ven.
      </p>

      <SpaceForm
        editing={editing}
        onSubmit={handleSubmit}
        onCancel={() => {
          setEditing(null);
          setFormError(null);
        }}
        pending={pending}
        error={formError}
      />

      <SpacesTable
        spaces={list}
        onEdit={(space) => {
          setEditing(space);
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
