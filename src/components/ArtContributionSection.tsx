import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ART_IMAGE_SPECS, sheetSize, type ArtImageKind } from '../game/artContract';
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
import { usePrivateArtImages } from '../hooks/usePrivateArtImages';
import { ArtPiecePreview } from './ArtPiecePreview';
import styles from './ArtContributionSection.module.css';

const KIND_LABELS: Readonly<Record<ContributionKind, string>> = {
  character: 'Personaje',
  plant: 'Planta (decoración de escritorio)',
};

/** File roles per kind, as `server/src/assets/assetUploadRules.ts` reads them. */
const FILES: Readonly<Record<ContributionKind, readonly { role: string; label: string; imageKind: ArtImageKind }[]>> = {
  character: [
    { role: 'walk', label: 'Caminar', imageKind: 'character-walk' },
    { role: 'seated', label: 'Sentado', imageKind: 'character-seated' },
  ],
  plant: [{ role: 'sheet', label: 'Hoja', imageKind: 'plant' }],
};

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
  const [open, setOpen] = useState(false);
  const images = usePrivateArtImages(read, open ? contribution.files : null);
  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <span>{contribution.name}</span>
        <button
          type="button"
          className={styles.button}
          aria-expanded={open}
          aria-label={`${open ? 'Ocultar' : 'Ver'} ${contribution.name}`}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Ocultar' : 'Ver'}
        </button>
      </div>
      <span className={contribution.status === 'rejected' ? `${styles.state} ${styles.rejected}` : styles.state}>{stateOf(contribution)}</span>
      {open && <ArtPiecePreview kind={contribution.kind} name={contribution.name} images={images} />}
    </li>
  );
}

export interface ArtContributionSectionProps {
  /** Port already built (`OfficeShell`); this section knows nothing of HTTP. */
  contributions: ArtContributionPort;
}

/**
 * "Aportar arte" inside "Personalizar" (#122), for anyone signed in. Container
 * like `ArtUploadPanel`: the only one that calls the port. It asks each kind
 * for its sheets, the rights statement, and lists the own contributions with
 * their review state; a pending one shows only here and in the review queue.
 */
export function ArtContributionSection({ contributions }: ArtContributionSectionProps) {
  const id = useId();
  const [kind, setKind] = useState<ContributionKind>('character');
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [material, setMaterial] = useState('');
  const [rightsAccepted, setRightsAccepted] = useState(false);
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
    author.trim() !== '' &&
    (kind !== 'plant' || material.trim() !== '') &&
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
      author: author.trim(),
      ...(kind === 'plant' ? { material: material.trim() } : {}),
      rightsAccepted,
      files: Object.fromEntries(roles.map(({ role }) => [role, (files[role] as string).slice((files[role] as string).indexOf(',') + 1)])),
    };
    try {
      const sent = await contributions.submit(input);
      setDone(`«${sent.name}» quedó pendiente de revisión. Te avisamos aquí cuando la revisen.`);
      setName('');
      setMaterial('');
      setFiles({});
      setRightsAccepted(false);
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
        Sube un personaje o una planta para los escritorios. Un admin la revisa antes de que aparezca en la oficina.
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

        {kind === 'plant' && (
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
            <span className={styles.hint} id={`${id}-material-hint`}>
              Minúsculas, números y guiones, por ejemplo «helecho».
            </span>
          </div>
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
