import { useId, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import type { CharacterOption } from '../auth/characterPort';
import { characterPreviewFrame, type CharacterPose } from '../game/characterPreview';
import styles from './CharacterSelect.module.css';

export interface CharacterSelectProps {
  options: readonly CharacterOption[];
  /** Preselected: the saved character, or the pack default for someone who never chose. */
  initialId: string;
  /** A save is in flight. */
  pending: boolean;
  error: string | null;
  onSubmit: (avatarId: string) => void;
}

/** Integer scales only: the sheets are 1:1 pixel art (see `characterPreviewFrame`). */
const CARD_SCALE = 2;
const PREVIEW_SCALE = 3;

const POSES: readonly { pose: CharacterPose; caption: string; label: (name: string) => string }[] = [
  { pose: 'idle', caption: 'Reposo', label: (name) => `${name} en reposo` },
  { pose: 'walk', caption: 'Caminando', label: (name) => `${name} caminando` },
  { pose: 'seated', caption: 'En su silla', label: (name) => `${name} en su silla` },
];

/**
 * A CSS sprite cut from the pack sheet: no canvas and no Phaser, so the
 * selector costs one small PNG per sheet. A walking pose animates its step
 * columns with `steps()`; the module CSS turns that off under reduced motion.
 */
function spriteStyle(option: CharacterOption, pose: CharacterPose, scale: number): CSSProperties {
  const frame = characterPreviewFrame(option, pose, scale);
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
 * Character step of the office entrance (art migration, step 5).
 * Presentational: `AuthGate` owns the flow (`useCharacterChoice`) and passes
 * flat props, the same split as `LoginScreen`.
 *
 * Native radios inside one group give keyboard support for free (arrows move
 * the choice, Tab leaves the group), and Enter on a radio submits, which a
 * browser does not do on its own for radios.
 */
export function CharacterSelect({ options, initialId, pending, error, onSubmit }: CharacterSelectProps) {
  const [selectedId, setSelectedId] = useState(initialId);
  const titleId = useId();
  const groupName = useId();
  const selected = options.find((option) => option.id === selectedId) ?? options[0];

  const submit = () => {
    if (pending || selected === undefined) return;
    onSubmit(selected.id);
  };

  const handleSubmit = (event: FormEvent) => {
    // Without this the browser would navigate and React state would be lost.
    event.preventDefault();
    submit();
  };

  const handleRadioKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title} id={titleId}>
          Elige tu personaje
        </h1>
        <p className={styles.subtitle}>Así te verán tus compañeros en la oficina.</p>

        <div className={styles.layout}>
          <div className={styles.grid} role="radiogroup" aria-labelledby={titleId}>
            {options.map((option) => (
              <label key={option.id} className={styles.option}>
                <input
                  className={styles.radio}
                  type="radio"
                  name={groupName}
                  value={option.id}
                  checked={option.id === selected?.id}
                  onChange={() => setSelectedId(option.id)}
                  onKeyDown={handleRadioKey}
                />
                <span className={styles.sprite} style={spriteStyle(option, 'idle', CARD_SCALE)} aria-hidden="true" />
                <span className={styles.name}>{option.name}</span>
              </label>
            ))}
          </div>

          {selected !== undefined && (
            <section className={styles.preview} aria-label={`Vista previa de ${selected.name}`}>
              <h2 className={styles.previewName}>{selected.name}</h2>
              <div className={styles.poses}>
                {POSES.map(({ pose, caption, label }) => (
                  <figure key={pose} className={styles.pose}>
                    <span
                      className={pose === 'walk' ? `${styles.sprite} ${styles.walking}` : styles.sprite}
                      style={spriteStyle(selected, pose, PREVIEW_SCALE)}
                      role="img"
                      aria-label={label(selected.name)}
                    />
                    <figcaption className={styles.caption}>{caption}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>

        {error !== null && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <button className={styles.submit} type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Entrar a la oficina'}
        </button>
      </form>
    </div>
  );
}
