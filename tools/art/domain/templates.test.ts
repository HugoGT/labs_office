import { describe, expect, it } from 'vitest';
import {
  ART_IMAGE_SPECS,
  CHAIR,
  CHAIR_LAYERS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  PACK_FACINGS,
  PLANT,
  WALK_DIRECTIONS,
  sheetSize,
  validateArtImage,
  type Point,
} from '../../../src/game/artContract.ts';
import { UPLOAD_FILE_ROLES } from '../../../server/src/assets/assetUploadRules.ts';
import { LINE_HEIGHT, drawText, textWidth } from './pixelFont.ts';
import { PixelBuffer, type Rgba } from './pixelBuffer.ts';
import {
  TEMPLATE_COLORS,
  TEMPLATE_IMAGE_KINDS,
  TEMPLATE_LABEL_ORIGIN,
  renderTemplate,
  templateFrameLabels,
  type TemplateImageKind,
} from './templates.ts';

interface Frame {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  readonly x0: number;
  readonly y0: number;
}

function framesOf(kind: TemplateImageKind): Frame[] {
  const spec = ART_IMAGE_SPECS[kind];
  const frames: Frame[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.columns; col += 1) {
      frames.push({ index: row * spec.columns + col, col, row, x0: col * spec.frame.width, y0: row * spec.frame.height });
    }
  }
  return frames;
}

/** Anchor points a template marks, with the color of their arms. */
function markersOf(kind: TemplateImageKind): { point: Point; arms: Rgba }[] {
  switch (kind) {
    case 'character-walk':
      return [{ point: CHARACTER_WALK.anchor, arms: TEMPLATE_COLORS.anchor }];
    case 'character-seated':
      return [{ point: CHARACTER_SEATED.anchor, arms: TEMPLATE_COLORS.anchor }];
    case 'chair':
      return [
        { point: CHAIR.anchor, arms: TEMPLATE_COLORS.anchor },
        { point: CHAIR.ground, arms: TEMPLATE_COLORS.ground },
      ];
    case 'desk':
      return [{ point: DESK.anchor, arms: TEMPLATE_COLORS.anchor }];
    case 'plant':
      return [{ point: PLANT.anchor, arms: TEMPLATE_COLORS.anchor }];
    case 'floor':
      return [];
  }
}

const ARM_OFFSETS = [
  [-2, 0],
  [-1, 0],
  [1, 0],
  [2, 0],
  [0, -2],
  [0, -1],
  [0, 1],
  [0, 2],
] as const;

describe('art templates', () => {
  it('cover every image kind an upload takes, plus the chair', () => {
    const uploaded = Object.values(UPLOAD_FILE_ROLES).flatMap((roles) => roles.map((entry) => entry.imageKind));
    expect([...TEMPLATE_IMAGE_KINDS].sort()).toEqual([...new Set([...uploaded, 'chair'])].sort());
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s has the sheet size of its kind in the contract', (kind) => {
    const template = renderTemplate(kind);
    expect({ width: template.width, height: template.height }).toEqual(sheetSize(ART_IMAGE_SPECS[kind]));
    expect(validateArtImage(kind, template).map((violation) => violation.code)).not.toContain('invalid-dimensions');
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s outlines exactly the frame grid of the contract', (kind) => {
    const { frame } = ART_IMAGE_SPECS[kind];
    const template = renderTemplate(kind);
    for (const { index, x0, y0 } of framesOf(kind)) {
      for (let x = x0; x < x0 + frame.width; x += 1) {
        expect(template.getPixel(x, y0), `frame ${index} top (${x})`).toEqual(TEMPLATE_COLORS.border);
        expect(template.getPixel(x, y0 + frame.height - 1), `frame ${index} bottom (${x})`).toEqual(TEMPLATE_COLORS.border);
      }
      for (let y = y0; y < y0 + frame.height; y += 1) {
        expect(template.getPixel(x0, y), `frame ${index} left (${y})`).toEqual(TEMPLATE_COLORS.border);
        expect(template.getPixel(x0 + frame.width - 1, y), `frame ${index} right (${y})`).toEqual(TEMPLATE_COLORS.border);
      }
      // No border inside a frame: one row and one column through the middle cross none.
      const midY = y0 + Math.floor(frame.height / 2);
      const midX = x0 + Math.floor(frame.width / 2);
      for (let x = x0 + 1; x < x0 + frame.width - 1; x += 1) expect(template.getPixel(x, midY), `frame ${index}`).not.toEqual(TEMPLATE_COLORS.border);
      for (let y = y0 + 1; y < y0 + frame.height - 1; y += 1) expect(template.getPixel(midX, y), `frame ${index}`).not.toEqual(TEMPLATE_COLORS.border);
    }
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s marks the contract anchors at the same pixel of every frame', (kind) => {
    const { frame } = ART_IMAGE_SPECS[kind];
    const template = renderTemplate(kind);
    // Arms stop short of the border (the plant anchor sits one pixel above it).
    const inside = (x: number, y: number): boolean => x > 0 && y > 0 && x < frame.width - 1 && y < frame.height - 1;
    for (const { index, x0, y0 } of framesOf(kind)) {
      for (const { point, arms } of markersOf(kind)) {
        expect(template.getPixel(x0 + point.x, y0 + point.y), `frame ${index} at (${point.x}, ${point.y})`).toEqual(TEMPLATE_COLORS.anchorCenter);
        for (const [dx, dy] of ARM_OFFSETS) {
          if (inside(point.x + dx, point.y + dy)) expect(template.getPixel(x0 + point.x + dx, y0 + point.y + dy), `frame ${index}`).toEqual(arms);
        }
      }
    }
  });

  it('labels the frames in the order of the contract', () => {
    const upper = (text: string): string => text.toUpperCase();
    expect(templateFrameLabels('character-walk')).toEqual(
      WALK_DIRECTIONS.flatMap((direction) =>
        Array.from({ length: CHARACTER_WALK.columns }, (_, col) => [direction, col === CHARACTER_WALK.idleColumn ? 'IDLE' : `STEP ${col}`]),
      ),
    );
    expect(templateFrameLabels('character-seated')).toEqual(
      PACK_FACINGS.flatMap((facing) =>
        Array.from({ length: CHARACTER_SEATED.columns }, (_, col) => [
          upper(facing),
          CHARACTER_SEATED.idleColumns.includes(col) ? `IDLE ${col}` : `SIT ${col}`,
        ]),
      ),
    );
    expect(templateFrameLabels('chair')).toEqual(CHAIR_LAYERS.flatMap((layer) => PACK_FACINGS.map((facing) => [upper(facing), upper(layer)])));
    expect(templateFrameLabels('desk')).toEqual(
      PACK_FACINGS.map((facing) => [upper(facing), `${DESK.footprintByFacing[facing].w}X${DESK.footprintByFacing[facing].h}`]),
    );
    expect(templateFrameLabels('floor')).toEqual(Array.from({ length: 9 }, (_, index) => [`${index}`]));
    expect(templateFrameLabels('plant')).toEqual([['PLANT']]);
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s draws each label inside its frame, clear of the anchors', (kind) => {
    const { frame } = ART_IMAGE_SPECS[kind];
    const template = renderTemplate(kind);
    const labels = templateFrameLabels(kind);
    for (const { index, x0, y0 } of framesOf(kind)) {
      const lines = labels[index]!;
      const box = { x: TEMPLATE_LABEL_ORIGIN.x, y: TEMPLATE_LABEL_ORIGIN.y, w: Math.max(...lines.map(textWidth)), h: lines.length * LINE_HEIGHT - 1 };
      expect(box.x + box.w, `frame ${index}`).toBeLessThan(frame.width - 1);
      expect(box.y + box.h, `frame ${index}`).toBeLessThan(frame.height - 1);
      for (const { point } of markersOf(kind)) {
        const touches = point.x + 2 >= box.x && point.x - 2 < box.x + box.w && point.y + 2 >= box.y && point.y - 2 < box.y + box.h;
        expect(touches, `frame ${index} label over the anchor`).toBe(false);
      }
      const expected = new PixelBuffer(frame.width, frame.height);
      lines.forEach((line, i) => drawText(expected, box.x, box.y + i * LINE_HEIGHT, line, TEMPLATE_COLORS.label));
      for (let y = box.y; y < box.y + box.h; y += 1) {
        for (let x = box.x; x < box.x + box.w; x += 1) {
          const inked = expected.alphaAt(x, y) !== 0;
          const actual = template.getPixel(x0 + x, y0 + y);
          if (inked) expect(actual, `frame ${index} (${x}, ${y})`).toEqual(TEMPLATE_COLORS.label);
          else expect(actual, `frame ${index} (${x}, ${y})`).not.toEqual(TEMPLATE_COLORS.label);
        }
      }
    }
  });

  it('outlines the plant footprint tile, which ends where the anchor stands', () => {
    const template = renderTemplate('plant');
    const top = PLANT.anchor.y - PLANT.footprint.h * 32;
    const bottom = PLANT.anchor.y - 1;
    for (const y of [top, bottom]) {
      for (let x = 1; x < PLANT.frame.width - 1; x += 1) {
        if (Math.abs(x - PLANT.anchor.x) <= 0 && y >= PLANT.anchor.y - 2) continue;
        if ((x + y) % 2 === 0) expect(template.getPixel(x, y), `(${x}, ${y})`).toEqual(TEMPLATE_COLORS.footprint);
      }
    }
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s leaves a translucent checker as the drawable area', (kind) => {
    const template = renderTemplate(kind);
    const guides = new Set(
      [TEMPLATE_COLORS.border, TEMPLATE_COLORS.label, TEMPLATE_COLORS.anchor, TEMPLATE_COLORS.anchorCenter, TEMPLATE_COLORS.ground, TEMPLATE_COLORS.footprint].map(
        (color) => JSON.stringify(color),
      ),
    );
    const checker = new Set([TEMPLATE_COLORS.checkerLight, TEMPLATE_COLORS.checkerDark].map((color) => JSON.stringify(color)));
    let drawable = 0;
    for (let y = 0; y < template.height; y += 1) {
      for (let x = 0; x < template.width; x += 1) {
        const pixel = JSON.stringify(template.getPixel(x, y));
        expect(guides.has(pixel) || checker.has(pixel), `(${x}, ${y}) ${pixel}`).toBe(true);
        if (checker.has(pixel)) drawable += 1;
      }
    }
    expect(drawable / (template.width * template.height)).toBeGreaterThan(0.6);
    for (const color of [TEMPLATE_COLORS.checkerLight, TEMPLATE_COLORS.checkerDark]) expect(color.a).toBeGreaterThan(0);
    for (const color of [TEMPLATE_COLORS.checkerLight, TEMPLATE_COLORS.checkerDark]) expect(color.a).toBeLessThan(255);
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s is refused if uploaded as is, but only for its guides', (kind) => {
    // A forgotten guide layer must not land in the catalog; the size and color rules still pass,
    // so whatever the artist draws over the template is held only to the contract.
    const codes = validateArtImage(kind, renderTemplate(kind)).map((violation) => violation.code);
    expect(codes).not.toContain('invalid-dimensions');
    expect(codes).not.toContain('too-many-colors');
    expect(codes.length).toBeGreaterThan(0);
  });

  it.each(TEMPLATE_IMAGE_KINDS)('%s renders the same pixels every time', (kind) => {
    expect(Buffer.from(renderTemplate(kind).data).equals(Buffer.from(renderTemplate(kind).data))).toBe(true);
  });
});
