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
} from '../art/customCharacter';
import type { CharacterChoice, CharacterOption } from '../auth/characterPort';
import { artPackFileUrl } from '../game/artPack';
import { characterPreviewFrame, type CharacterPose } from '../game/characterPreview';
import { customCharacterPart, customCharacterPreview, type CharacterPart } from '../game/customCharacterPreview';
import styles from './CharacterCreator.module.css';
import { ColorPicker } from './ColorPicker';
import { PixelFramesCanvas } from './PixelFramesCanvas';
import { StylePicker } from './StylePicker';

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
/** The pack's wood floor, tiled under the preview like the office's: its 96 px motif at the preview scale. */
const FLOOR_URL = artPackFileUrl('floor/wood.png');
const FLOOR_MOTIF_PX = 96;
/** The glasses crop is small: drawn bigger so the lenses read. */
const PART_SCALE: Partial<Record<CharacterPart, number>> = { glasses: 3, shoes: 3 };

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

type PartArea = 'pelo' | 'piel' | 'superior' | 'inferior' | 'zapatos';

function Part({ legend, area, children }: { legend: string; area: PartArea; children: ReactNode }) {
  return (
    <fieldset className={`${styles.part} ${styles[area]}`}>
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
 * stay as they are when other parts change. Styles are picked by looking:
 * `StylePicker` shows each option drawn on the person's own character,
 * cropped to the part it changes; colors come from `ColorPicker`, curated
 * presets plus any RGB. Everything fits one screen with no vertical scroll
 * (narrow phones may still scroll).
 *
 * The preview is the character standing still, big, over the pack's wood
 * floor. A built one is drawn on canvas by the same renderer the server
 * draws it with (`customCharacterPreview`), deferred so clicking stays
 * responsive; whole characters cut their own sheet.
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

  /** An option drawn on the person's current character, cropped to the part it changes. */
  const thumbnail = (region: CharacterPart, change: Partial<CustomCharacterSpec>) => customCharacterPart({ ...spec, ...change }, region);

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

        <div className={styles.band}>
        <section className={`${styles.row} ${styles.templates}`} aria-label="Plantillas">
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
          <section className={`${styles.row} ${styles.whole}`} aria-label="Personajes completos">
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
        </div>

        <div className={styles.layout}>
          <div className={styles.parts}>
            <Part legend="Pelo" area="pelo">
              <StylePicker
                label="Estilo de pelo"
                caption="Estilo"
                options={HAIR_STYLE_OPTIONS}
                value={spec.hair.style}
                thumbnail={(style) => thumbnail('hair', { hair: { ...spec.hair, style } })}
                onChange={(style) => edit({ hair: { ...spec.hair, style } })}
              />
              <ColorPicker label="Color de pelo" caption="Color" presets={HAIR_COLORS} value={spec.hair.color} onChange={(color) => edit({ hair: { ...spec.hair, color } })} />
            </Part>
            <Part legend="Piel" area="piel">
              <ColorPicker label="Tono de piel" caption="Tono" presets={SKIN_TONES} value={spec.skin} onChange={(skin) => edit({ skin })} />
            </Part>
            <Part legend="Superior" area="superior">
              <StylePicker
                label="Estilo de la parte superior"
                caption="Estilo"
                options={TOP_STYLE_OPTIONS}
                value={spec.top.style}
                thumbnail={(style) => thumbnail('top', { top: { ...spec.top, style } })}
                onChange={(style) => edit({ top: { ...spec.top, style } })}
              />
              <ColorPicker
                label="Color de la parte superior"
                caption="Color"
                presets={CLOTHING_COLORS}
                value={spec.top.color}
                onChange={(color) => edit({ top: { ...spec.top, color } })}
              />
              <StylePicker
                label="Extras"
                caption="Extras"
                options={CUSTOM_ACCESSORIES}
                value={spec.accessory}
                thumbnail={(accessory) => thumbnail('accessory', { accessory })}
                onChange={(accessory) => edit({ accessory })}
              />
              <StylePicker
                label="Lentes"
                caption="Lentes"
                options={GLASSES_OPTIONS}
                value={spec.glasses}
                thumbnail={(glasses) => thumbnail('glasses', { glasses })}
                scale={PART_SCALE.glasses}
                onChange={(glasses) => edit({ glasses })}
              />
            </Part>
            <Part legend="Inferior" area="inferior">
              <StylePicker
                label="Estilo de la parte inferior"
                caption="Estilo"
                options={BOTTOM_STYLE_OPTIONS}
                value={spec.bottom.style}
                thumbnail={(style) => thumbnail('bottom', { bottom: { ...spec.bottom, style } })}
                onChange={(style) => edit({ bottom: { ...spec.bottom, style } })}
              />
              <ColorPicker
                label="Color de la parte inferior"
                caption="Color"
                presets={CLOTHING_COLORS}
                value={spec.bottom.color}
                onChange={(color) => edit({ bottom: { ...spec.bottom, color } })}
              />
            </Part>
            <Part legend="Zapatos" area="zapatos">
              <StylePicker
                label="Estilo de zapatos"
                caption="Estilo"
                options={SHOE_STYLE_OPTIONS}
                value={spec.shoes.style}
                thumbnail={(style) => thumbnail('shoes', { shoes: { ...spec.shoes, style } })}
                scale={PART_SCALE.shoes}
                onChange={(style) => edit({ shoes: { ...spec.shoes, style } })}
              />
              <ColorPicker label="Color de zapatos" caption="Color" presets={SHOE_COLORS} value={spec.shoes.color} onChange={(color) => edit({ shoes: { ...spec.shoes, color } })} />
            </Part>
          </div>

          <section className={styles.preview} aria-label="Vista previa">
            {piece?.author != null && <p className={styles.credit}>Autoría: {piece.author}</p>}
            <div
              data-floor
              className={styles.floor}
              style={{ backgroundImage: `url("${FLOOR_URL}")`, backgroundSize: `${FLOOR_MOTIF_PX * PREVIEW_SCALE}px ${FLOOR_MOTIF_PX * PREVIEW_SCALE}px` }}
            >
              {piece !== undefined ? (
                <span className={styles.sprite} style={spriteStyle(piece, 'idle', PREVIEW_SCALE)} role="img" aria-label={PREVIEW_LABEL} />
              ) : (
                <PixelFramesCanvas frames={idle === null ? [] : [idle]} scale={PREVIEW_SCALE} label={PREVIEW_LABEL} />
              )}
            </div>
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
