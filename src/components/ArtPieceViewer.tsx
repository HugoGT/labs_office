import { useRef, useState } from 'react';
import type { Contribution } from '../dashboard/artContributionPort';
import { usePrivateArtImages } from '../hooks/usePrivateArtImages';
import { ArtOfficeMock } from './ArtOfficeMock';
import { ArtPieceDialog } from './ArtPieceDialog';

export interface ArtPieceViewerProps {
  contribution: Contribution;
  /** Reads one private file as a data URL (`ArtContributionPort.fileDataUrl`). */
  read: (path: string) => Promise<string>;
  /** The look of the "Ver" button, which each section styles like its own buttons. */
  className: string;
}

/**
 * The "Ver" button of a piece under review (#122) and the dialog it opens with
 * the office mock. The private files are read only while it is open, so a long
 * queue costs no requests until somebody looks at a piece.
 */
export function ArtPieceViewer({ contribution, read, className }: ArtPieceViewerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const images = usePrivateArtImages(read, open ? contribution.files : null);
  const loading = Object.keys(images).length < contribution.files.length;
  const { name } = contribution;

  return (
    <>
      <button ref={buttonRef} type="button" className={className} aria-haspopup="dialog" aria-label={`Ver ${name}`} onClick={() => setOpen(true)}>
        Ver
      </button>
      {open && (
        <ArtPieceDialog
          title={name}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        >
          {loading && <p>Cargando la vista previa…</p>}
          <ArtOfficeMock kind={contribution.kind} name={name} images={images} />
        </ArtPieceDialog>
      )}
    </>
  );
}
