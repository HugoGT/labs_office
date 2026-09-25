import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeAdminError } from './adminErrors';
import { AdminError } from './adminPort';
import {
  ASSET_KINDS,
  type AssetAdminPort,
  type AssetKind,
  type CatalogAsset,
} from './assetAdminPort';
import styles from './DashboardScreen.module.css';

/**
 * Panel del catalogo de decoracion (#7, slice 5). Contenedor: es el unico que
 * llama al puerto y el unico con estado; la tabla y el formulario reciben
 * props planas y no saben que hay un servidor detras (D3).
 *
 * ## Aqui no se sube ninguna imagen
 *
 * El catalogo es CURADO: dar de alta una pieza es registrar un `textureKey`
 * que el bundle del cliente YA trae. No hay campo de fichero en ningun sitio y
 * no es un hueco por rellenar -- el servidor no tiene ninguna ruta que reciba
 * una imagen.
 *
 * ## Retirar no es borrar, y el panel no puede decir otra cosa (D1b)
 *
 * La palabra importa porque la regla del servidor tiene tres mitades y las
 * tres son ciertas a la vez: una pieza retirada SIGUE pintandose en los
 * escritorios de quien ya la coloco, su dueno PUEDE quitarla, y nadie puede
 * volver a ANADIRLA. "Borrar" o "eliminar" contarian la primera al reves, y
 * quien administra esperaria que desapareciese de los escritorios ajenos.
 *
 * ## No hay vista de retiradas
 *
 * `handleListAssets` no lee `includeArchived` de ningun sitio: no hay
 * parametro de consulta ni cuerpo que lo active, asi que por HTTP solo se
 * puede pedir el catalogo vivo. Un control que ofreciese el historico no
 * tendria de donde sacarlo.
 */

const KIND_LABELS: Readonly<Record<AssetKind, string>> = {
  furniture: 'Mobiliario',
  decor: 'Decoración',
  plant: 'Planta',
};

/** Tamano minimo en tiles: el servidor exige entero mayor que 0. */
const MIN_SIZE = 1;

const DEFAULT_SIZE = '1';

export interface AssetFormValues {
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: string;
  h: string;
  placeableOnDesk: boolean;
  aboveAvatars: boolean;
}

const EMPTY_FORM: AssetFormValues = {
  name: '',
  kind: 'furniture',
  textureKey: '',
  w: DEFAULT_SIZE,
  h: DEFAULT_SIZE,
  // La mayoria del catalogo existe para ponerse encima de un escritorio, que
  // es la unica superficie que esta issue sabe decorar.
  placeableOnDesk: true,
  // Special assets (#71) cover people walking through them: opt-in only.
  aboveAvatars: false,
};

export interface AssetFormProps {
  /** Devuelve `true` si el servidor la acepto; solo entonces se limpia. */
  onSubmit: (values: AssetFormValues) => Promise<boolean>;
  pending: boolean;
  /** Ya traducido a texto (`describeAdminError`), nunca el error crudo. */
  error: string | null;
}

/**
 * Alta de una pieza. Presentacional (D3): no conoce el puerto y solo avisa
 * hacia arriba. `<form>` de verdad, como `InviteForm`, para que Enter envie y
 * el navegador exija los campos obligatorios.
 */
export function AssetForm({ onSubmit, pending, error }: AssetFormProps) {
  const [values, setValues] = useState<AssetFormValues>(EMPTY_FORM);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // Sin esto el navegador navegaria a la misma URL y se perderia el estado.
    event.preventDefault();
    if (pending) return;

    const done = await onSubmit({
      ...values,
      name: values.name.trim(),
      textureKey: values.textureKey.trim(),
    });
    // Solo se limpia si de verdad se dio de alta: tras un fallo, quien
    // administra quiere corregir un caracter, no volver a escribirlo todo.
    if (done) setValues(EMPTY_FORM);
  }

  function set<K extends keyof AssetFormValues>(name: K, value: AssetFormValues[K]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} aria-label="Nueva pieza del catálogo">
      <div className={`${styles.field} ${styles.emailField}`}>
        <label className={styles.label} htmlFor="asset-name">
          Nombre
        </label>
        <input
          className={styles.input}
          id="asset-name"
          type="text"
          autoComplete="off"
          required
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="asset-kind">
          Tipo
        </label>
        <select
          className={`${styles.input} ${styles.roleSelect}`}
          id="asset-kind"
          value={values.kind}
          onChange={(event) => set('kind', event.target.value as AssetKind)}
        >
          {ASSET_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="asset-texture">
          Clave de textura
        </label>
        {/* Texto y no un fichero: el catalogo es curado y esta clave apunta a
            un sprite que el bundle del cliente ya trae. */}
        <input
          className={styles.input}
          id="asset-texture"
          type="text"
          autoComplete="off"
          required
          value={values.textureKey}
          onChange={(event) => set('textureKey', event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="asset-w">
          Ancho
        </label>
        <input
          className={`${styles.input} ${styles.coordInput}`}
          id="asset-w"
          type="number"
          min={MIN_SIZE}
          step={1}
          required
          value={values.w}
          onChange={(event) => set('w', event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="asset-h">
          Alto
        </label>
        <input
          className={`${styles.input} ${styles.coordInput}`}
          id="asset-h"
          type="number"
          min={MIN_SIZE}
          step={1}
          required
          value={values.h}
          onChange={(event) => set('h', event.target.value)}
        />
      </div>

      <div className={styles.checkboxField}>
        <input
          id="asset-placeable"
          type="checkbox"
          checked={values.placeableOnDesk}
          onChange={(event) => set('placeableOnDesk', event.target.checked)}
        />
        <label className={styles.label} htmlFor="asset-placeable">
          Se puede colocar en un escritorio
        </label>
      </div>

      <div className={styles.checkboxField}>
        <input
          id="asset-above-avatars"
          type="checkbox"
          checked={values.aboveAvatars}
          onChange={(event) => set('aboveAvatars', event.target.checked)}
        />
        <label className={styles.label} htmlFor="asset-above-avatars">
          Se dibuja por encima de los avatares
        </label>
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Añadiendo…' : 'Añadir al catálogo'}
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

export interface AssetsTableProps {
  assets: CatalogAsset[];
  /** Id de la pieza que espera confirmacion, o `null`. */
  confirmingId: string | null;
  onAskRetire: (id: string) => void;
  onCancelRetire: () => void;
  onRetire: (id: string) => void;
  /** Marks or unmarks an asset as drawn above avatars (#71). */
  onToggleAboveAvatars: (id: string, aboveAvatars: boolean) => void;
  /** Id con una escritura en vuelo, o `null`. */
  busyId: string | null;
}

/** Tabla del catalogo. Presentacional: props planas y avisos hacia arriba. */
export function AssetsTable({
  assets,
  confirmingId,
  onAskRetire,
  onCancelRetire,
  onRetire,
  onToggleAboveAvatars,
  busyId,
}: AssetsTableProps) {
  if (assets.length === 0) {
    // Una tabla con encabezados y sin filas se lee como un fallo de carga.
    return <p className={styles.empty}>Todavía no hay piezas en el catálogo.</p>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Pieza</th>
            <th scope="col">Tipo</th>
            <th scope="col">Textura</th>
            <th scope="col">Tamaño</th>
            <th scope="col">En escritorio</th>
            <th scope="col">Sobre avatares</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id}>
              <th scope="row">{asset.name}</th>
              <td>{KIND_LABELS[asset.kind]}</td>
              {/* Tal cual: es lo unico que ata la fila con un sprite que el
                  bundle del cliente puede dibujar. */}
              <td>{asset.textureKey}</td>
              <td>
                {asset.w}×{asset.h}
              </td>
              <td>{asset.placeableOnDesk ? 'Sí' : 'No'}</td>
              <td>
                {/* Controlled by the served row: the box only flips once the
                    server confirmed and the list was reread (#71). */}
                <input
                  type="checkbox"
                  aria-label={`Dibujar ${asset.name} por encima de los avatares`}
                  checked={asset.aboveAvatars}
                  disabled={busyId !== null}
                  onChange={(event) => onToggleAboveAvatars(asset.id, event.target.checked)}
                />
              </td>
              <td>
                {confirmingId === asset.id ? (
                  <>
                    {/* Las TRES mitades de D1b, porque las tres son ciertas a
                        la vez y callar una convierte a las otras dos en otra
                        cosa. */}
                    <span className={styles.confirmNote}>
                      Deja de poder añadirse. Quien ya la tenga puesta la sigue viendo y puede
                      quitarla cuando quiera.
                    </span>
                    <button
                      className={styles.revoke}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => onRetire(asset.id)}
                    >
                      Sí, retirar
                    </button>
                    <button className={styles.ghost} type="button" onClick={onCancelRetire}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.revoke}
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => onAskRetire(asset.id)}
                  >
                    Retirar
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

export interface AssetsPanelProps {
  /** Puerto ya construido (`DashboardRoute`); este panel no sabe de HTTP. */
  assets: AssetAdminPort;
}

type Phase = 'loading' | 'unavailable' | 'failed' | 'ready';

export function AssetsPanel({ assets }: AssetsPanelProps) {
  const [list, setList] = useState<CatalogAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Tras cada cambio se relee la lista entera. Al retirar es ademas lo que
   * hace que la pieza desaparezca: el servidor filtra las retiradas, y este
   * cliente no puede quitarla en local sin duplicar ese filtro.
   */
  const refresh = useCallback(async () => {
    setList(await assets.listAssets());
  }, [assets]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refresh();
        if (cancelled) return;
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        // Un 503 NO es una averia: un despliegue sin `DATABASE_URL` es un
        // estado legitimo. Se explica, no se grita, y no se pinta el
        // formulario, que solo podria acabar en otro 503.
        if (error instanceof AdminError && error.code === 'decor-not-configured') {
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

  async function handleCreate(values: AssetFormValues): Promise<boolean> {
    setFormError(null);
    setPending(true);
    try {
      await assets.createAsset({
        name: values.name,
        kind: values.kind,
        textureKey: values.textureKey,
        w: Number(values.w),
        h: Number(values.h),
        placeableOnDesk: values.placeableOnDesk,
        aboveAvatars: values.aboveAvatars,
      });
      await refresh();
      return true;
    } catch (error) {
      setFormError(describeAdminError(error));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function handleRetire(id: string): Promise<void> {
    setFormError(null);
    setBusyId(id);
    try {
      await assets.archiveAsset(id);
      setConfirmingId(null);
      await refresh();
    } catch (error) {
      setFormError(describeAdminError(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleAboveAvatars(id: string, aboveAvatars: boolean): Promise<void> {
    setFormError(null);
    setBusyId(id);
    try {
      await assets.updateAsset(id, { aboveAvatars });
      await refresh();
    } catch (error) {
      setFormError(describeAdminError(error));
    } finally {
      setBusyId(null);
    }
  }

  // Mismo criterio que `DashboardScreen`: nada mientras no se sabe.
  if (phase === 'loading') return null;

  if (phase === 'unavailable') {
    return (
      <section className={styles.card} aria-labelledby="catalogo">
        <h2 className={styles.cardTitle} id="catalogo">
          Catálogo de decoración
        </h2>
        <p className={styles.cardSubtitle}>
          {describeAdminError(new AdminError('decor-not-configured'))}
        </p>
        <p className={styles.empty}>
          La oficina funciona igual: simplemente no hay piezas que colocar.
        </p>
      </section>
    );
  }

  if (phase === 'failed') {
    return (
      <section className={styles.card} aria-labelledby="catalogo">
        <h2 className={styles.cardTitle} id="catalogo">
          Catálogo de decoración
        </h2>
        <div className={styles.error} role="alert">
          {loadError ?? describeAdminError(null)}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="catalogo">
      <h2 className={styles.cardTitle} id="catalogo">
        Catálogo de decoración
      </h2>
      <p className={styles.cardSubtitle}>
        Piezas que cada persona puede poner en su escritorio. La clave de textura apunta a un
        sprite que la aplicación ya trae: aquí no se sube ninguna imagen.
      </p>

      <AssetForm onSubmit={handleCreate} pending={pending} error={formError} />

      <AssetsTable
        assets={list}
        confirmingId={confirmingId}
        onAskRetire={(id) => {
          setConfirmingId(id);
          setFormError(null);
        }}
        onCancelRetire={() => setConfirmingId(null)}
        onRetire={(id) => void handleRetire(id)}
        onToggleAboveAvatars={(id, aboveAvatars) => void handleToggleAboveAvatars(id, aboveAvatars)}
        busyId={busyId}
      />
    </section>
  );
}
