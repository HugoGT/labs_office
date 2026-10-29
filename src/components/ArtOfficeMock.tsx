import type { CSSProperties, ReactNode } from 'react';
import { CHARACTER_WALK, PACK_FACINGS, TABLE_FACINGS, WALK_DIRECTIONS, type ArtFacing } from '../game/artContract';
import {
  COMPASS,
  COMPASS_PITCH,
  COMPASS_SIZE,
  DOOR_CAPTIONS,
  FACING_CAPTIONS,
  MOCK_BLOCK_PX,
  MOCK_COLUMNS,
  MOCK_DEFAULTS,
  MOCK_ROWS,
  TABLE_CAPTIONS,
  WALK_CAPTIONS,
  chairSprites,
  deskSprite,
  doorSprite,
  plantSprite,
  seatedAt,
  seatedSprite,
  tableSprite,
  walkingSprite,
  type MockSprite,
} from '../game/artMock';
import styles from './ArtOfficeMock.module.css';

export interface ArtOfficeMockProps {
  kind: string;
  name: string;
  /** Data URL per file role (`walk`, `seated`, `sheet`); a missing one shows nothing yet. */
  images: Readonly<Record<string, string>>;
}

/** Integer only: the sheets are 1:1 pixel art. The blocks, the characters, the plants and the chairs are drawn at this scale. */
const SCALE = 2;
/** Desks, room tables and doors are bigger than a block: drawn at the world's own size so every orientation fits side by side. */
const LARGE_SCALE = 1;
const LARGE_KINDS: ReadonlySet<string> = new Set(['desk', 'table', 'door']);

const DOOR_ROTATIONS = [0, 90, 180, 270] as const;

function tiled(url: string, scale: number): CSSProperties {
  return { backgroundImage: `url("${url}")`, backgroundSize: `${MOCK_BLOCK_PX * scale}px ${MOCK_BLOCK_PX * scale}px` };
}

/** A CSS sprite cut from a sheet, like the character creator's, at a whole `scale`. */
function spriteStyle(sprite: MockSprite, scale: number): CSSProperties {
  const { frame, sheet, url, steps } = sprite;
  return {
    width: frame.width * scale,
    height: frame.height * scale,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
    backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
    ['--sprite-steps' as string]: String(steps),
    ['--sprite-travel' as string]: `${(-frame.x - steps * frame.width) * scale}px`,
  };
}

/** Where the feet stand in a cell of the compass: its middle, a little above the bottom edge. */
function feetIn(col: number, row: number): { x: number; y: number } {
  return { x: col * COMPASS_PITCH.x + COMPASS_PITCH.x / 2, y: row * COMPASS_PITCH.y + COMPASS_PITCH.y - 6 };
}

/** A chair of both layers in one box, so it reads as one image. */
function ChairStack({ url, facing, label }: { url: string; facing: ArtFacing; label: string }) {
  const { back, front } = chairSprites(url, facing);
  return (
    <span className={styles.stack} role="img" aria-label={label} style={{ width: back.frame.width * SCALE, height: back.frame.height * SCALE }}>
      <span className={styles.layer} data-testid="chair-layer" style={spriteStyle(back, SCALE)} />
      <span className={styles.layer} data-testid="chair-layer" style={spriteStyle(front, SCALE)} />
    </span>
  );
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className={styles.figure}>
      {children}
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}

/**
 * The first block: the 8 walking directions on the cells around one sitting
 * on a chair, in the middle one. Whoever the submission is not of is the
 * character of the pack.
 */
function Characters({ who, walkUrl, seatedUrl }: { who: string; walkUrl: string; seatedUrl: string }) {
  const { x: anchorX, y: anchorY } = CHARACTER_WALK.anchor;
  // The sitter's cell is the middle one, and the chair's ground point is in it, like the walkers' feet.
  const { chair, sitter } = seatedAt(feetIn(1, 1));
  const chairLayers = chairSprites(MOCK_DEFAULTS.chair, 'down');
  const seated = seatedSprite(seatedUrl);
  const at = (point: { x: number; y: number }): CSSProperties => ({ left: point.x * SCALE, top: point.y * SCALE });
  return (
    <>
      {WALK_DIRECTIONS.map((direction) => {
        const { col, row } = COMPASS[direction];
        const ground = feetIn(col, row);
        return (
          <span
            key={direction}
            className={`${styles.sprite} ${styles.walking}`}
            role="img"
            aria-label={`${who} caminando ${WALK_CAPTIONS[direction]}`}
            style={{ ...spriteStyle(walkingSprite(walkUrl, direction), SCALE), ...at({ x: ground.x - anchorX, y: ground.y - anchorY }), zIndex: row * 10 }}
          />
        );
      })}
      <span className={styles.sprite} data-testid="chair-layer" style={{ ...spriteStyle(chairLayers.back, SCALE), ...at(chair), zIndex: 10 }} />
      <span className={styles.sprite} role="img" aria-label={`${who} sentado`} style={{ ...spriteStyle(seated, SCALE), ...at(sitter), zIndex: 11 }} />
      <span className={styles.sprite} data-testid="chair-layer" style={{ ...spriteStyle(chairLayers.front, SCALE), ...at(chair), zIndex: 12 }} />
    </>
  );
}

/** The second block's contents: a plant, or the piece in every orientation it has. Null for a kind with nothing to show on grass. */
function GrassPieces({ kind, name, sheet }: { kind: string; name: string; sheet: string }) {
  const scale = LARGE_KINDS.has(kind) ? LARGE_SCALE : SCALE;
  switch (kind) {
    case 'plant':
      return <span className={styles.sprite} role="img" aria-label={name} style={spriteStyle(plantSprite(sheet), SCALE)} />;
    case 'chair':
      return PACK_FACINGS.map((facing) => (
        <Figure key={facing} caption={FACING_CAPTIONS[facing]}>
          <ChairStack url={sheet} facing={facing} label={`${name}, ${FACING_CAPTIONS[facing]}`} />
        </Figure>
      ));
    case 'desk':
      return PACK_FACINGS.map((facing) => (
        <Figure key={facing} caption={FACING_CAPTIONS[facing]}>
          <span className={styles.sprite} role="img" aria-label={`${name}, ${FACING_CAPTIONS[facing]}`} style={spriteStyle(deskSprite(sheet, facing), scale)} />
        </Figure>
      ));
    case 'table':
      return TABLE_FACINGS.map((orientation) => (
        <Figure key={orientation} caption={TABLE_CAPTIONS[orientation]}>
          <span className={styles.sprite} role="img" aria-label={`${name}, ${TABLE_CAPTIONS[orientation]}`} style={spriteStyle(tableSprite(sheet, orientation), scale)} />
        </Figure>
      ));
    case 'door':
      return DOOR_ROTATIONS.map((rotation) => (
        <Figure key={rotation} caption={DOOR_CAPTIONS[rotation]}>
          <span className={styles.sprite} role="img" aria-label={`${name}, ${DOOR_CAPTIONS[rotation]}`} style={spriteStyle(doorSprite(sheet, rotation), scale)} />
        </Figure>
      ));
    case 'character':
    case 'floor':
      return null;
    default:
      // A kind the mock has no scene for: its sheet as it is, so a reviewer still sees the pixels.
      return <img className={styles.raw} src={sheet} alt={name} />;
  }
}

/**
 * The preview of a submission in an art review (#121, #122): an office of
 * `MOCK_COLUMNS` x `MOCK_ROWS` blocks, and in its three middle blocks a
 * character that walks in 8 directions and sits, grass with a plant or the
 * piece in every orientation it has, and the floor the person drew (water
 * when it is not a floor), so a wrong row, a broken frame or a leftover
 * background shows before anybody uses the piece. Presentational: the images
 * arrive already read (they are private files).
 */
export function ArtOfficeMock({ kind, name, images }: ArtOfficeMockProps) {
  const isCharacter = kind === 'character';
  const sheet = images.sheet;
  if (isCharacter ? images.walk === undefined || images.seated === undefined : sheet === undefined) return null;

  const who = isCharacter ? name : 'Personaje del pack';
  const walkUrl = isCharacter ? (images.walk as string) : MOCK_DEFAULTS.characterWalk;
  const seatedUrl = isCharacter ? (images.seated as string) : MOCK_DEFAULTS.characterSeated;
  const terrain = kind === 'floor' ? (sheet as string) : MOCK_DEFAULTS.water;

  return (
    <div
      className={styles.mock}
      role="group"
      aria-label={`${name} en la oficina`}
      data-blocks={`${MOCK_COLUMNS}x${MOCK_ROWS}`}
      style={{ ...tiled(MOCK_DEFAULTS.office, SCALE), ['--block' as string]: `${MOCK_BLOCK_PX * SCALE}px` }}
    >
      <div
        className={`${styles.block} ${styles.characters}`}
        role="region"
        aria-label="Personaje"
        style={{ width: COMPASS_SIZE.width * SCALE, height: COMPASS_SIZE.height * SCALE }}
      >
        <Characters who={who} walkUrl={walkUrl} seatedUrl={seatedUrl} />
      </div>
      <div className={`${styles.block} ${styles.grass}`} role="region" aria-label="Césped" style={tiled(MOCK_DEFAULTS.grass, SCALE)}>
        <GrassPieces kind={kind} name={name} sheet={sheet ?? ''} />
      </div>
      <div className={`${styles.block} ${styles.terrain}`} role="region" aria-label="Terreno" style={tiled(terrain, SCALE)} />
    </div>
  );
}
