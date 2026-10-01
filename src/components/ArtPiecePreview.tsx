import type { CSSProperties } from 'react';
import type { ArtFacing } from '../game/artContract';
import { characterPreviewFrame, type CharacterPose } from '../game/characterPreview';
import styles from './ArtPiecePreview.module.css';

export interface ArtPiecePreviewProps {
  kind: string;
  name: string;
  /** Data URL per file role (`walk`, `seated`, `sheet`); a missing one shows nothing yet. */
  images: Readonly<Record<string, string>>;
}

/** Integer only: the sheets are 1:1 pixel art (see `characterPreviewFrame`). */
const SCALE = 2;

const WALKS: readonly { facing: ArtFacing; caption: string }[] = [
  { facing: 'down', caption: 'hacia abajo' },
  { facing: 'left', caption: 'hacia la izquierda' },
  { facing: 'right', caption: 'hacia la derecha' },
  { facing: 'up', caption: 'hacia arriba' },
];

function spriteStyle(sheets: { walkUrl: string; seatedUrl: string }, pose: CharacterPose, facing: ArtFacing): CSSProperties {
  const frame = characterPreviewFrame(sheets, pose, SCALE, facing);
  return {
    width: frame.width,
    height: frame.height,
    backgroundImage: `url("${frame.url}")`,
    backgroundSize: `${frame.sheetWidth}px ${frame.sheetHeight}px`,
    backgroundPosition: `${frame.x}px ${frame.y}px`,
    ['--sprite-steps' as string]: String(frame.steps),
    ['--sprite-travel' as string]: `${frame.x - frame.steps * frame.width}px`,
  };
}

/**
 * Animated preview of a piece under review (#122), for its uploader and its
 * reviewer: a character walks in the four directions and sits, so a wrong row
 * or a broken frame shows before anybody wears it; a plant shows its sheet.
 * Presentational: the images arrive already read (they are private files).
 */
export function ArtPiecePreview({ kind, name, images }: ArtPiecePreviewProps) {
  if (kind === 'character') {
    const { walk, seated } = images;
    if (walk === undefined || seated === undefined) return null;
    const sheets = { walkUrl: walk, seatedUrl: seated };
    return (
      <div className={styles.preview}>
        {WALKS.map(({ facing, caption }) => (
          <figure key={facing} className={styles.pose}>
            <span
              className={`${styles.sprite} ${styles.walking}`}
              style={spriteStyle(sheets, 'walk', facing)}
              role="img"
              aria-label={`${name} caminando ${caption}`}
            />
            <figcaption className={styles.caption}>{caption}</figcaption>
          </figure>
        ))}
        <figure className={styles.pose}>
          <span className={styles.sprite} style={spriteStyle(sheets, 'seated', 'down')} role="img" aria-label={`${name} sentado`} />
          <figcaption className={styles.caption}>sentado</figcaption>
        </figure>
      </div>
    );
  }

  const sheet = images.sheet;
  if (sheet === undefined) return null;
  return (
    <div className={styles.preview}>
      <figure className={styles.pose}>
        <img className={styles.sheet} src={sheet} alt={name} />
      </figure>
    </div>
  );
}
