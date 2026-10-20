import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  BOTTOM_STYLE_OPTIONS,
  CHARACTER_TEMPLATES,
  CLOTHING_COLORS,
  CUSTOM_ACCESSORIES,
  GLASSES_OPTIONS,
  HAIR_COLORS,
  HAIR_STYLE_OPTIONS,
  SHOE_COLORS,
  SHOE_STYLE_OPTIONS,
  SKIN_TONES,
  TOP_STYLE_OPTIONS,
  type CustomCharacterSpec,
  type Option,
  type Swatch,
} from '../art/customCharacter';
import type { CharacterChoice, CharacterOption } from '../auth/characterPort';
import { characterPreviewFrame, type CharacterPose } from '../game/characterPreview';
import { customCharacterPreview } from '../game/customCharacterPreview';
import styles from './CharacterCreator.module.css';
import { PixelFramesCanvas } from './PixelFramesCanvas';

export interface CharacterCreatorProps {
  heading: string;
  description: string;
  /** Every whole character the office offers: the pack ones back the templates, the rest are uploads. */
  options: readonly CharacterOption[];
  /** What the creator opens with: the saved character. */
  initial: CharacterChoice;
  /** A save is in flight. */
  pending: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (choice: CharacterChoice) => void;
  /** Present only where leaving without saving makes sense ("Personalizar"); Escape does the same. */
  onCancel?: () => void;
}

/** Integer scales only: the frames are 1:1 pixel art (see `characterPreviewFrame`). */
const THUMB_SCALE = 2;
/** The one standing pose, as big as the column beside the controls allows. */
export const PREVIEW_SCALE = 5;
const PREVIEW_LABEL = 'Tu personaje';

/** A CSS sprite cut from a whole character's sheet, the same cells the office draws. */
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

/** A long option list in one row: a native select, labelled, keyboard and screen reader ready. */
function Select<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.choiceLegend} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(event) => {
          const picked = options.find((option) => option.value === event.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Swatches({ legend, swatches, value, onChange }: {
  legend: string;
  swatches: readonly Swatch[];
  value: string;
  onChange: (hex: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className={styles.choiceGroup}>
      <legend className={styles.choiceLegend}>{legend}</legend>
      <div className={styles.swatches}>
        {swatches.map((swatch) => (
          <label key={swatch.hex} className={styles.swatch} title={swatch.label}>
            <input
              className={styles.radio}
              type="radio"
              name={name}
              value={swatch.hex}
              checked={swatch.hex === value}
              aria-label={swatch.label}
              onChange={() => onChange(swatch.hex)}
            />
            <span className={styles.swatchColor} style={{ backgroundColor: swatch.hex }} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Part({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.part}>
      <legend className={styles.partLegend}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/** The spec the controls show for a choice: its own parts, a template's, or the first template's. */
function specFor(choice: CharacterChoice): CustomCharacterSpec {
  if (choice.kind === 'custom') return choice.spec;
  return (CHARACTER_TEMPLATES.find((template) => template.baseId === choice.avatarId) ?? CHARACTER_TEMPLATES[0]!).spec;
}

/**
 * The character creator of the entrance and of "Personalizar". Presentational:
 * `AuthGate` (or the "Mi personaje" section) owns the flow and the port and
 * passes flat props, the same split as `LoginScreen`.
 *
 * The person either keeps a whole character (a template used as is, which
 * stays that exact pack character, or an uploaded one) or builds one from
 * parts; touching any part turns the current look into a character of its
 * own. Build and earrings are not offered: they come with the template and
 * stay as they are when other parts change. Every control is native (a
 * select per long list, swatch radios inside a labelled fieldset), so the
 * keyboard works without any code here.
 *
 * The preview is the character standing still, big. A built one is drawn on
 * canvas by the same renderer the server draws it with
 * (`customCharacterPreview`), deferred so clicking stays responsive; whole
 * characters cut their own sheet.
 */
export function CharacterCreator({
  heading,
  description,
  options,
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: CharacterCreatorProps) {
  const titleId = useId();
  const [spec, setSpec] = useState<CustomCharacterSpec>(() => specFor(initial));
  const [pieceId, setPieceId] = useState<string | null>(initial.kind === 'piece' ? initial.avatarId : null);

  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const templateIds = useMemo(() => new Set(CHARACTER_TEMPLATES.map((template) => template.baseId)), []);
  const wholeCharacters = useMemo(() => options.filter((option) => !templateIds.has(option.id)), [options, templateIds]);
  const piece = pieceId === null ? undefined : byId.get(pieceId);

  const deferredSpec = useDeferredValue(spec);
  const idle = useMemo(() => (piece === undefined ? customCharacterPreview(deferredSpec) : null), [piece, deferredSpec]);

  const dialog = onCancel !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A dialog over the office takes the focus, so the keyboard starts inside it.
    if (dialog) rootRef.current?.focus();
  }, [dialog]);

  /**
   * Over the office, nothing typed in the dialog reaches `window`, where the
   * office listens (the arrow keys walk the avatar, the sidebar closes on
   * Escape): Escape here only cancels the dialog.
   */
  const handleDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  };

  const edit = (next: Partial<CustomCharacterSpec>) => {
    setSpec((current) => ({ ...current, ...next }));
    setPieceId(null);
  };

  const handleSubmit = (event: FormEvent) => {
    // Without this the browser would navigate and React state would be lost.
    event.preventDefault();
    if (pending) return;
    onSubmit(piece !== undefined ? { kind: 'piece', avatarId: piece.id } : { kind: 'custom', spec });
  };

  return (
    <div
      ref={rootRef}
      className={styles.screen}
      role={dialog ? 'dialog' : undefined}
      aria-modal={dialog ? true : undefined}
      aria-labelledby={dialog ? titleId : undefined}
      tabIndex={dialog ? -1 : undefined}
      onKeyDown={dialog ? handleDialogKey : undefined}
    >
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title} id={titleId}>
          {heading}
        </h1>
        <p className={styles.subtitle}>{description}</p>

        <section className={styles.row} aria-label="Plantillas">
          <h2 className={styles.rowTitle}>Empieza desde una plantilla</h2>
          <div className={styles.thumbs}>
            {CHARACTER_TEMPLATES.map((template, index) => {
              const option = byId.get(template.baseId);
              return (
                <button
                  key={template.baseId}
                  type="button"
                  className={styles.thumb}
                  aria-label={`Plantilla ${index + 1}`}
                  aria-pressed={pieceId === template.baseId}
                  onClick={() => {
                    setSpec(template.spec);
                    setPieceId(option ? template.baseId : null);
                  }}
                >
                  {option ? (
                    <span className={styles.sprite} style={spriteStyle(option, 'idle', THUMB_SCALE)} aria-hidden="true" />
                  ) : (
                    <PixelFramesCanvas frames={[customCharacterPreview(template.spec)]} scale={THUMB_SCALE} label="" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {wholeCharacters.length > 0 && (
          <section className={styles.row} aria-label="Personajes completos">
            <h2 className={styles.rowTitle}>Personajes completos</h2>
            <div className={styles.thumbs}>
              {wholeCharacters.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.thumb}
                  aria-label={`Personaje completo ${index + 1}`}
                  aria-pressed={pieceId === option.id}
                  onClick={() => setPieceId(option.id)}
                >
                  <span className={styles.sprite} style={spriteStyle(option, 'idle', THUMB_SCALE)} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        <div className={styles.layout}>
          <div className={styles.parts}>
            <Part legend="Pelo">
              <Select label="Estilo" options={HAIR_STYLE_OPTIONS} value={spec.hair.style} onChange={(style) => edit({ hair: { ...spec.hair, style } })} />
              <Swatches legend="Color" swatches={HAIR_COLORS} value={spec.hair.color} onChange={(color) => edit({ hair: { ...spec.hair, color } })} />
            </Part>
            <Part legend="Piel">
              <Swatches legend="Tono" swatches={SKIN_TONES} value={spec.skin} onChange={(skin) => edit({ skin })} />
            </Part>
            <Part legend="Superior">
              <Select label="Estilo" options={TOP_STYLE_OPTIONS} value={spec.top.style} onChange={(style) => edit({ top: { ...spec.top, style } })} />
              <Swatches legend="Color" swatches={CLOTHING_COLORS} value={spec.top.color} onChange={(color) => edit({ top: { ...spec.top, color } })} />
              <div className={styles.pair}>
                <Select label="Extras" options={CUSTOM_ACCESSORIES} value={spec.accessory} onChange={(accessory) => edit({ accessory })} />
                <Select label="Lentes" options={GLASSES_OPTIONS} value={spec.glasses} onChange={(glasses) => edit({ glasses })} />
              </div>
            </Part>
            <Part legend="Inferior">
              <Select label="Estilo" options={BOTTOM_STYLE_OPTIONS} value={spec.bottom.style} onChange={(style) => edit({ bottom: { ...spec.bottom, style } })} />
              <Swatches legend="Color" swatches={CLOTHING_COLORS} value={spec.bottom.color} onChange={(color) => edit({ bottom: { ...spec.bottom, color } })} />
            </Part>
            <Part legend="Zapatos">
              <Select label="Estilo" options={SHOE_STYLE_OPTIONS} value={spec.shoes.style} onChange={(style) => edit({ shoes: { ...spec.shoes, style } })} />
              <Swatches legend="Color" swatches={SHOE_COLORS} value={spec.shoes.color} onChange={(color) => edit({ shoes: { ...spec.shoes, color } })} />
            </Part>
          </div>

          <section className={styles.preview} aria-label="Vista previa">
            {piece?.author != null && <p className={styles.credit}>Autoría: {piece.author}</p>}
            {piece !== undefined ? (
              <span className={styles.sprite} style={spriteStyle(piece, 'idle', PREVIEW_SCALE)} role="img" aria-label={PREVIEW_LABEL} />
            ) : (
              <PixelFramesCanvas frames={idle === null ? [] : [idle]} scale={PREVIEW_SCALE} label={PREVIEW_LABEL} />
            )}
          </section>
        </div>

        {error !== null && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          {onCancel !== undefined && (
            <button className={styles.secondary} type="button" onClick={onCancel} disabled={pending}>
              Cancelar
            </button>
          )}
          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? 'Guardando…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
