/**
 * Guide templates for drawing art (#121): one sheet per kind an artist can contribute, at the
 * exact size the contract (and so the upload check) requires. Each frame shows its border, the
 * contract anchors, a label with its place in the frame order and, under all of it, a
 * translucent checker that is the drawable area. Everything comes from `artContract.ts`, so a
 * template cannot disagree with the rules a drawing is checked against.
 *
 * Guides are meant to sit on their own layer: an upload of the template as is fails the
 * corner or opacity rule on purpose, while its size and color count pass.
 */
import {
  ART_IMAGE_SPECS,
  ART_TILE,
  CHAIR,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  PLANT,
  WALK_DIRECTIONS,
  sheetSize,
  type ArtImageKind,
  type Point,
} from '../../../src/game/artContract.ts';
import { LINE_HEIGHT, drawText } from './pixelFont.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';

/** Kinds with a template: every image an upload takes (characters, desks, floors, plants) plus the chair. */
export const TEMPLATE_IMAGE_KINDS = ['character-walk', 'character-seated', 'chair', 'desk', 'floor', 'plant'] as const satisfies readonly ArtImageKind[];
export type TemplateImageKind = (typeof TEMPLATE_IMAGE_KINDS)[number];

/**
 * Guides are opaque and saturated, far from any art ramp; the drawable checker is translucent
 * so it reads as "empty" in any editor and never as a background to keep.
 */
export const TEMPLATE_COLORS = {
  checkerLight: rgba(96, 128, 192, 24),
  checkerDark: rgba(96, 128, 192, 56),
  border: rgba(236, 0, 140),
  label: rgba(24, 24, 64),
  anchorCenter: rgba(0, 0, 0),
  anchor: rgba(232, 32, 32),
  ground: rgba(0, 176, 240),
  footprint: rgba(0, 168, 80),
} as const satisfies Readonly<Record<string, Rgba>>;

/** Top-left of a frame's label, just inside its border. */
export const TEMPLATE_LABEL_ORIGIN: Point = { x: 2, y: 2 };

const CHECKER_CELL = 4;
const ARM_LENGTH = 2;

interface Marker {
  readonly point: Point;
  readonly arms: Rgba;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TemplateLayout {
  /** Label lines of frame `(col, row)`. */
  readonly label: (col: number, row: number) => readonly string[];
  readonly markers: readonly Marker[];
  /** Footprint tiles the contract places relative to the anchor, in frame pixels. */
  readonly footprint?: Rect;
}

const upper = (text: string): string => text.toUpperCase();

const LAYOUTS: Readonly<Record<TemplateImageKind, TemplateLayout>> = {
  'character-walk': {
    label: (col, row) => [WALK_DIRECTIONS[row]!, col === CHARACTER_WALK.idleColumn ? 'IDLE' : `STEP ${col}`],
    markers: [{ point: CHARACTER_WALK.anchor, arms: TEMPLATE_COLORS.anchor }],
  },
  'character-seated': {
    label: (col, row) => [upper(CHARACTER_SEATED.rowOrder[row]!), CHARACTER_SEATED.idleColumns.includes(col) ? `IDLE ${col}` : `SIT ${col}`],
    markers: [{ point: CHARACTER_SEATED.anchor, arms: TEMPLATE_COLORS.anchor }],
  },
  chair: {
    label: (col, row) => [upper(CHAIR.columnOrder[col]!), upper(CHAIR_LAYERS[row]!)],
    markers: [
      { point: CHAIR.anchor, arms: TEMPLATE_COLORS.anchor },
      { point: CHAIR.ground, arms: TEMPLATE_COLORS.ground },
    ],
  },
  desk: {
    label: (col) => {
      const facing = DESK.columnOrder[col]!;
      const { w, h } = DESK.footprintByFacing[facing];
      return [upper(facing), `${w}X${h}`];
    },
    markers: [{ point: DESK.anchor, arms: TEMPLATE_COLORS.anchor }],
  },
  floor: {
    label: (col, row) => [`${row * ART_IMAGE_SPECS.floor.columns + col}`],
    markers: [],
  },
  plant: {
    label: () => ['PLANT'],
    markers: [{ point: PLANT.anchor, arms: TEMPLATE_COLORS.anchor }],
    // A prop's anchor is the floor pixel at the bottom middle of its footprint (`propPlacement`).
    footprint: {
      x: PLANT.anchor.x - (PLANT.footprint.w * ART_TILE) / 2,
      y: PLANT.anchor.y - PLANT.footprint.h * ART_TILE,
      w: PLANT.footprint.w * ART_TILE,
      h: PLANT.footprint.h * ART_TILE,
    },
  },
};

/** Label lines of every frame, by frame index (`row * columns + col`). */
export function templateFrameLabels(kind: TemplateImageKind): string[][] {
  const spec = ART_IMAGE_SPECS[kind];
  const labels: string[][] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.columns; col += 1) labels.push([...LAYOUTS[kind].label(col, row)]);
  }
  return labels;
}

/** A dashed outline: every other pixel, by the parity of its sheet position. */
function drawDashedRect(image: PixelBuffer, rect: Rect, color: Rgba): void {
  const dash = (x: number, y: number): void => {
    if ((x + y) % 2 === 0) image.setPixel(x, y, color);
  };
  for (let x = rect.x; x < rect.x + rect.w; x += 1) {
    dash(x, rect.y);
    dash(x, rect.y + rect.h - 1);
  }
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    dash(rect.x, y);
    dash(rect.x + rect.w - 1, y);
  }
}

function drawFrame(image: PixelBuffer, kind: TemplateImageKind, col: number, row: number): void {
  const { frame } = ART_IMAGE_SPECS[kind];
  const layout = LAYOUTS[kind];
  const x0 = col * frame.width;
  const y0 = row * frame.height;

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const light = (Math.floor(x / CHECKER_CELL) + Math.floor(y / CHECKER_CELL)) % 2 === 0;
      image.setPixel(x0 + x, y0 + y, light ? TEMPLATE_COLORS.checkerLight : TEMPLATE_COLORS.checkerDark);
    }
  }
  if (layout.footprint) {
    const { x, y, w, h } = layout.footprint;
    drawDashedRect(image, { x: x0 + x, y: y0 + y, w, h }, TEMPLATE_COLORS.footprint);
  }
  drawBorder(image, x0, y0, frame.width, frame.height);
  layout.label(col, row).forEach((line, i) => {
    drawText(image, x0 + TEMPLATE_LABEL_ORIGIN.x, y0 + TEMPLATE_LABEL_ORIGIN.y + i * LINE_HEIGHT, line, TEMPLATE_COLORS.label);
  });
  // Arms stop inside the border, so the frame grid stays a clean line in every frame.
  const inside = (x: number, y: number): boolean => x > 0 && y > 0 && x < frame.width - 1 && y < frame.height - 1;
  for (const { point, arms } of layout.markers) {
    for (let d = 1; d <= ARM_LENGTH; d += 1) {
      for (const [x, y] of [
        [point.x - d, point.y],
        [point.x + d, point.y],
        [point.x, point.y - d],
        [point.x, point.y + d],
      ] as const) {
        if (inside(x, y)) image.setPixel(x0 + x, y0 + y, arms);
      }
    }
    image.setPixel(x0 + point.x, y0 + point.y, TEMPLATE_COLORS.anchorCenter);
  }
}

function drawBorder(image: PixelBuffer, x0: number, y0: number, width: number, height: number): void {
  for (let x = x0; x < x0 + width; x += 1) {
    image.setPixel(x, y0, TEMPLATE_COLORS.border);
    image.setPixel(x, y0 + height - 1, TEMPLATE_COLORS.border);
  }
  for (let y = y0; y < y0 + height; y += 1) {
    image.setPixel(x0, y, TEMPLATE_COLORS.border);
    image.setPixel(x0 + width - 1, y, TEMPLATE_COLORS.border);
  }
}

/** The template of one image kind, at the contract's sheet size. */
export function renderTemplate(kind: TemplateImageKind): PixelBuffer {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const image = new PixelBuffer(width, height);
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.columns; col += 1) drawFrame(image, kind, col, row);
  }
  return image;
}
