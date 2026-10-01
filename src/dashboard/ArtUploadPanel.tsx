import { useId, useState, type FormEvent } from 'react';
import { ART_IMAGE_SPECS, sheetSize, type ArtImageKind } from '../game/artContract';
import { describeAdminError } from './adminErrors';
import { AdminError } from './adminPort';
import { ART_UPLOAD_KINDS, type ArtUploadInput, type ArtUploadKind, type ArtUploadPort, type UploadedArt } from './artUploadPort';
import styles from './DashboardScreen.module.css';

/**
 * Admin art upload (#121). Container like `UsersPanel`: the only one that
 * calls the port. Each kind asks for the files and fields the server needs,
 * with the exact size of each sheet next to its input, and a refusal names
 * the file and what to change. The checks themselves are the server's: it
 * decodes, validates and re-encodes every file before storing it.
 */

const KIND_LABELS: Readonly<Record<ArtUploadKind, string>> = {
  character: 'Personaje',
  desk: 'Escritorio',
  floor: 'Suelo',
  plant: 'Planta (decoración de escritorio)',
};

/** File roles per kind, as `server/src/assets/assetUploadRules.ts` reads them. */
const FILES: Readonly<Record<ArtUploadKind, readonly { role: string; label: string; imageKind: ArtImageKind }[]>> = {
  character: [
    { role: 'walk', label: 'Caminar', imageKind: 'character-walk' },
    { role: 'seated', label: 'Sentado', imageKind: 'character-seated' },
  ],
  desk: [{ role: 'sheet', label: 'Hoja', imageKind: 'desk' }],
  floor: [{ role: 'sheet', label: 'Hoja', imageKind: 'floor' }],
  plant: [{ role: 'sheet', label: 'Hoja', imageKind: 'plant' }],
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: 'Tipo',
  name: 'Nombre',
  author: 'Autoría',
  license: 'Licencia',
  material: 'Material',
  colorable: 'Admite color',
  defaultColor: 'Color por defecto',
  facings: 'Geometría del escritorio',
  files: 'Archivos',
};

/** The pack's own license: what an upload made in-house carries unless told otherwise. */
const DEFAULT_LICENSE = 'proprietary-internal';
const DEFAULT_COLOR = '#808080';

function hasMaterial(kind: ArtUploadKind): boolean {
  return kind !== 'character';
}

function hasColor(kind: ArtUploadKind): boolean {
  return kind === 'desk' || kind === 'floor';
}

function sizeOf(imageKind: ArtImageKind): string {
  const { width, height } = sheetSize(ART_IMAGE_SPECS[imageKind]);
  return `${width} × ${height} px`;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable file'));
    reader.readAsDataURL(file);
  });
}

/** The refusal in Spanish, prefixed by the file or field it is about, with the size a sheet must have. */
function describeUploadError(error: unknown, kind: ArtUploadKind): string {
  const message = describeAdminError(error);
  if (!(error instanceof AdminError) || error.field === null) return message;
  const file = FILES[kind].find((entry) => entry.role === error.field);
  if (file !== undefined) {
    const size = error.code === 'invalid-dimensions' ? ` Debe medir ${sizeOf(file.imageKind)}.` : '';
    return `Archivo «${file.label}»: ${message}${size}`;
  }
  const label = FIELD_LABELS[error.field];
  return label === undefined ? message : `${label}: ${message}`;
}

function successMessage(uploaded: UploadedArt): string {
  const where = uploaded.decor ? ' y ya se puede poner como decoración de escritorio' : '';
  return `«${uploaded.name}» ya está en el catálogo${where}. La oficina la carga sin desplegar.`;
}

export interface ArtUploadPanelProps {
  /** Port already built (`DashboardRoute`); this panel knows nothing of HTTP. */
  uploads: ArtUploadPort;
}

export function ArtUploadPanel({ uploads }: ArtUploadPanelProps) {
  const id = useId();
  const [kind, setKind] = useState<ArtUploadKind>('character');
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState(DEFAULT_LICENSE);
  const [material, setMaterial] = useState('');
  const [colorable, setColorable] = useState(false);
  const [defaultColor, setDefaultColor] = useState(DEFAULT_COLOR);
  /** Data URL per file role: the preview and, without its prefix, the upload. */
  const [files, setFiles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const roles = FILES[kind];
  const ready =
    name.trim() !== '' &&
    author.trim() !== '' &&
    license.trim() !== '' &&
    (!hasMaterial(kind) || material.trim() !== '') &&
    roles.every(({ role }) => files[role] !== undefined);

  function changeKind(next: ArtUploadKind): void {
    setKind(next);
    // Another kind wants other sheets: the chosen ones would be the wrong size.
    setFiles({});
    setError(null);
  }

  async function chooseFile(role: string, file: File | undefined): Promise<void> {
    setError(null);
    if (file === undefined) {
      setFiles(({ [role]: _gone, ...rest }) => rest);
      return;
    }
    const dataUrl = await readDataUrl(file);
    setFiles((current) => ({ ...current, [role]: dataUrl }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const input: ArtUploadInput = {
      kind,
      name: name.trim(),
      author: author.trim(),
      license: license.trim(),
      ...(hasMaterial(kind) ? { material: material.trim() } : {}),
      ...(hasColor(kind) && colorable ? { colorable: true, defaultColor } : {}),
      files: Object.fromEntries(roles.map(({ role }) => [role, (files[role] as string).slice((files[role] as string).indexOf(',') + 1)])),
    };
    try {
      const uploaded = await uploads.upload(input);
      setDone(successMessage(uploaded));
      setName('');
      setMaterial('');
      setFiles({});
    } catch (uploadError) {
      setError(describeUploadError(uploadError, kind));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 className={styles.cardTitle} id={`${id}-title`}>
        Subir arte
      </h2>
      <p className={styles.cardSubtitle}>
        PNG de 8 bits con el tamaño exacto de su tipo, hasta 128 colores y 128 KB por archivo. El
        servidor lo revisa y lo vuelve a codificar, y la pieza aparece en la oficina sin desplegar.
      </p>

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {done !== null && (
        <p className={styles.uploadDone} role="status">
          {done}
        </p>
      )}

      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-kind`}>
            Tipo
          </label>
          <select
            id={`${id}-kind`}
            className={`${styles.input} ${styles.roleSelect}`}
            value={kind}
            onChange={(event) => changeKind(event.target.value as ArtUploadKind)}
          >
            {ART_UPLOAD_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-name`}>
            Nombre
          </label>
          <input id={`${id}-name`} className={styles.input} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-author`}>
            Autoría
          </label>
          <input id={`${id}-author`} className={styles.input} value={author} maxLength={80} onChange={(event) => setAuthor(event.target.value)} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-license`}>
            Licencia
          </label>
          <input id={`${id}-license`} className={styles.input} value={license} maxLength={80} onChange={(event) => setLicense(event.target.value)} />
        </div>

        {hasMaterial(kind) && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-material`}>
              Material
            </label>
            <input
              id={`${id}-material`}
              className={styles.input}
              value={material}
              maxLength={40}
              aria-describedby={`${id}-material-hint`}
              onChange={(event) => setMaterial(event.target.value)}
            />
            <span className={styles.label} id={`${id}-material-hint`}>
              Minúsculas, números y guiones, por ejemplo «roble».
            </span>
          </div>
        )}

        {hasColor(kind) && (
          <>
            <div className={styles.checkboxField}>
              <input id={`${id}-colorable`} type="checkbox" checked={colorable} onChange={(event) => setColorable(event.target.checked)} />
              <label className={styles.label} htmlFor={`${id}-colorable`}>
                Admite color
              </label>
            </div>
            {colorable && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${id}-color`}>
                  Color por defecto
                </label>
                <input
                  id={`${id}-color`}
                  type="color"
                  className={styles.colorInput}
                  value={defaultColor}
                  onChange={(event) => setDefaultColor(event.target.value)}
                />
              </div>
            )}
          </>
        )}

        <fieldset className={styles.uploadFiles}>
          <legend className={styles.label}>Archivos PNG</legend>
          {roles.map(({ role, label, imageKind }) => (
            <div className={styles.field} key={`${kind}-${role}`}>
              <label className={styles.label} htmlFor={`${id}-file-${role}`}>
                {label}
              </label>
              <input
                id={`${id}-file-${role}`}
                type="file"
                accept="image/png"
                aria-describedby={`${id}-file-${role}-size`}
                onChange={(event) => void chooseFile(role, event.target.files?.[0])}
              />
              <span className={styles.label} id={`${id}-file-${role}-size`}>
                {sizeOf(imageKind)}
              </span>
              {files[role] !== undefined && <img className={styles.uploadPreview} src={files[role]} alt={`Vista previa de ${label}`} />}
            </div>
          ))}
        </fieldset>

        <button className={styles.submit} type="submit" disabled={!ready || busy}>
          {busy ? 'Subiendo…' : 'Subir'}
        </button>
      </form>
    </section>
  );
}
