import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ART_IMAGE_SPECS, TABLE, sheetSize, type ArtImageKind } from '../game/artContract';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import {
  CONTRIBUTION_KINDS,
  RIGHTS_STATEMENT,
  type ArtContributionPort,
  type Contribution,
  type ContributionInput,
  type ContributionKind,
  type ContributionUsage,
} from '../dashboard/artContributionPort';
import { ArtPieceViewer } from './ArtPieceViewer';
import styles from './ArtContributionSection.module.css';

/** Same limit as `MAX_NAME_LENGTH` in `server/src/assets/assetUploadRules.ts`. */
const MAX_NAME_LENGTH = 60;

const KIND_LABELS: Readonly<Record<ContributionKind, string>> = {
  character: 'Personaje',
  plant: 'Planta (decoración de escritorio)',
  desk: 'Escritorio',
  floor: 'Suelo',
  chair: 'Silla',
  table: 'Mesa de sala',
  door: 'Puerta',
};

/** Kinds only an admin can place, in the office editor: a contributor cannot put them anywhere. */
const ADMIN_PLACED: ReadonlySet<ContributionKind> = new Set(['table', 'door']);

/** File roles per kind, as `server/src/assets/assetUploadRules.ts` reads them. */
const FILES: Readonly<Record<ContributionKind, readonly { role: string; label: string; imageKind: ArtImageKind }[]>> = {
  character: [
    { role: 'walk', label: 'Caminar', imageKind: 'character-walk' },
    { role: 'seated', label: 'Sentado', imageKind: 'character-seated' },
  ],
  plant: [{ role: 'sheet', label: 'Hoja', imageKind: 'plant' }],
  desk: [{ role: 'sheet', label: 'Hoja', imageKind: 'desk' }],
  floor: [{ role: 'sheet', label: 'Hoja', imageKind: 'floor' }],
  chair: [{ role: 'sheet', label: 'Hoja', imageKind: 'chair' }],
  table: [{ role: 'sheet', label: 'Hoja', imageKind: 'table' }],
  door: [{ role: 'sheet', label: 'Hoja', imageKind: 'door' }],
};

function sizeOf(imageKind: ArtImageKind): string {
  const { width, height } = sheetSize(ART_IMAGE_SPECS[imageKind]);
  return `${width} × ${height} px`;
}

/** The file name without its extension, cut to what the server accepts as a name. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]*$/, '').trim().slice(0, MAX_NAME_LENGTH);
}

/** Whether a field of the footprint holds a whole number of tiles from 1 to `max`. */
function isTiles(value: string, max: number): boolean {
  const tiles = Number(value);
  return value.trim() !== '' && Number.isInteger(tiles) && tiles >= 1 && tiles <= max;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable file'));
    reader.readAsDataURL(file);
  });
}

/** The refusal in Spanish, prefixed by the file it is about when the server names one. */
function describeRefusal(error: unknown, kind: ContributionKind): string {
  const message = describeAdminError(error);
  if (!(error instanceof AdminError) || error.field === null) return message;
  const file = FILES[kind].find((entry) => entry.role === error.field);
  if (file === undefined) return message;
  const size = error.code === 'invalid-dimensions' ? ` Debe medir ${sizeOf(file.imageKind)}.` : '';
  return `Archivo «${file.label}»: ${message}${size}`;
}

function stateOf(contribution: Contribution): string {
  if (contribution.status === 'rejected') return `Rechazada: ${contribution.reviewNote ?? 'sin motivo'}`;
  if (contribution.status === 'pending') return 'Pendiente de revisión';
  return contribution.retiredAt === null ? 'Aprobada' : 'Retirada';
}

function ContributionRow({ contribution, read }: { contribution: Contribution; read: (path: string) => Promise<string> }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <span>{contribution.name}</span>
        <ArtPieceViewer contribution={contribution} read={read} className={styles.button} />
      </div>
      <span className={contribution.status === 'rejected' ? `${styles.state} ${styles.rejected}` : styles.state}>{stateOf(contribution)}</span>
    </li>
  );
}

export interface ArtContributionSectionProps {
  /** Port already built (`OfficeShell`); this section knows nothing of HTTP. */
  contributions: ArtContributionPort;
}

/**
 * "Aportar arte" inside "Personalizar" (#122), for anyone signed in. Container
 * like `ArtUploadSection`: the only one that calls the port. It asks each kind
 * for its sheets, the rights statement, and lists the own contributions with
 * their review state; a pending one shows only here and in the review queue.
 */
export function ArtContributionSection({ contributions }: ArtContributionSectionProps) {
  const id = useId();
  const [kind, setKind] = useState<ContributionKind>('character');
  const [name, setName] = useState('');
  const [width, setWidth] = useState('2');
  const [height, setHeight] = useState('1');
  const [rightsAccepted, setRightsAccepted] = useState(true);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [mine, setMine] = useState<{ contributions: Contribution[]; usage: ContributionUsage } | null>(null);

  const refresh = useCallback(() => {
    contributions
      .listMine()
      .then(setMine)
      .catch(() => setMine(null));
  }, [contributions]);

  useEffect(refresh, [refresh]);

  const roles = FILES[kind];
  const ready =
    name.trim() !== '' &&
    (kind !== 'table' || (isTiles(width, TABLE.maxFootprint.w) && isTiles(height, TABLE.maxFootprint.h))) &&
    rightsAccepted &&
    roles.every(({ role }) => files[role] !== undefined);

  function changeKind(next: ContributionKind): void {
    setKind(next);
    setFiles({});
    setError(null);
  }

  async function chooseFile(role: string, file: File | undefined): Promise<void> {
    setError(null);
    if (file === undefined) {
      setFiles(({ [role]: _gone, ...rest }) => rest);
      return;
    }
    // The first file names the piece, as soon as it is chosen; a name already
    // there, typed or taken from a file, is never replaced.
    setName((current) => (current === '' ? nameFromFile(file.name) : current));
    const dataUrl = await readDataUrl(file);
    setFiles((current) => ({ ...current, [role]: dataUrl }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const input: ContributionInput = {
      kind,
      name: name.trim(),
      ...(kind === 'table' ? { footprint: { w: Number(width), h: Number(height) } } : {}),
      rightsAccepted,
      files: Object.fromEntries(roles.map(({ role }) => [role, (files[role] as string).slice((files[role] as string).indexOf(',') + 1)])),
    };
    try {
      const sent = await contributions.submit(input);
      setDone(`«${sent.name}» quedó pendiente de revisión. Te avisamos aquí cuando la revisen.`);
      setName('');
      setFiles({});
      setRightsAccepted(true);
      refresh();
    } catch (submitError) {
      setError(describeRefusal(submitError, kind));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <h3 className={styles.title} id={`${id}-title`}>
        Aportar arte
      </h3>
      <p className={styles.hint}>
        Sube arte para la oficina. Un admin lo revisa antes de que aparezca en ella.
      </p>
      {mine !== null && (
        <p className={styles.hint}>
          Pendientes de revisión: {mine.usage.pending} de {mine.usage.maxPending}
        </p>
      )}

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {done !== null && (
        <p className={styles.done} role="status">
          {done}
        </p>
      )}

      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-kind`}>
            Tipo
          </label>
          <select id={`${id}-kind`} className={styles.input} value={kind} onChange={(event) => changeKind(event.target.value as ContributionKind)}>
            {CONTRIBUTION_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
          {ADMIN_PLACED.has(kind) && (
            <span className={styles.hint}>Solo un admin puede colocarla en la oficina, una vez aprobada.</span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-name`}>
            Nombre
          </label>
          <input id={`${id}-name`} className={styles.input} value={name} maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />
        </div>

        {kind === 'table' && (
          <>
            <div className={styles.footprint} data-row="footprint">
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${id}-width`}>
                  Ancho
                </label>
                <input
                  id={`${id}-width`}
                  className={styles.input}
                  type="number"
                  min={1}
                  max={TABLE.maxFootprint.w}
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${id}-height`}>
                  Alto
                </label>
                <input
                  id={`${id}-height`}
                  className={styles.input}
                  type="number"
                  min={1}
                  max={TABLE.maxFootprint.h}
                  value={height}
                  aria-describedby={`${id}-footprint-hint`}
                  onChange={(event) => setHeight(event.target.value)}
                />
              </div>
            </div>
            <span className={styles.hint} id={`${id}-footprint-hint`}>
              Mesa en horizontal, de hasta {TABLE.maxFootprint.w} × {TABLE.maxFootprint.h} casillas.
            </span>
          </>
        )}

        {roles.map(({ role, label, imageKind }) => (
          <div className={styles.field} key={`${kind}-${role}`}>
            <label className={styles.label} htmlFor={`${id}-file-${role}`}>
              {label}
            </label>
            <input
              id={`${id}-file-${role}`}
              className={styles.file}
              type="file"
              accept="image/png"
              aria-describedby={`${id}-file-${role}-size`}
              onChange={(event) => void chooseFile(role, event.target.files?.[0])}
            />
            <span className={styles.hint} id={`${id}-file-${role}-size`}>
              PNG de {sizeOf(imageKind)}
            </span>
          </div>
        ))}

        <label className={styles.rights}>
          <input type="checkbox" checked={rightsAccepted} onChange={(event) => setRightsAccepted(event.target.checked)} />
          <span>{RIGHTS_STATEMENT}</span>
        </label>

        <button className={styles.button} type="submit" disabled={!ready || busy}>
          {busy ? 'Enviando…' : 'Enviar a revisión'}
        </button>
      </form>

      {mine !== null && mine.contributions.length > 0 && (
        <>
          <h4 className={styles.subtitle} id={`${id}-mine`}>
            Mis aportaciones
          </h4>
          <ul className={styles.list} aria-labelledby={`${id}-mine`}>
            {[...mine.contributions].reverse().map((contribution) => (
              <ContributionRow key={contribution.id} contribution={contribution} read={contributions.fileDataUrl} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
