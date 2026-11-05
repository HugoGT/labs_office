import { describe, expect, it } from 'vitest';
import { ART_TILE, DOOR, DOOR_FRONT, DOOR_HINGES, DOOR_STEPS, VERTICAL_DOOR, WALL, WALL_TOP_COLOR, WINDOW_FRONT, verticalDoorFeet, type DoorHinge, type DoorVariant } from '../../../src/game/artContract.ts';
import { hexToRgba } from './color.ts';
import { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { DOOR_HANDLE, DOOR_PIECES, doorSprite } from './doors.ts';

const ROTATIONS = [0, 90, 180, 270] as const;
/** The doors seen from above in a vertical run (S9): the window has none. */
const DOOR_VARIANTS = ['single', 'double'] as const;

const CLOSED = 0;
const OPEN = DOOR_STEPS - 1;
const { x: AX, y: AY } = DOOR.anchor;
const STEPS = Array.from({ length: DOOR_STEPS }, (_, i) => i);

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The opaque pixels of a frame (those `keep` accepts), as a bounding box. */
function bounds(image: PixelBuffer, keep: (x: number, y: number) => boolean = () => true): Box {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) === 0 || !keep(x, y)) continue;
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return box;
}

function handle(image: PixelBuffer): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = image.getPixel(x, y);
      if (r === DOOR_HANDLE.r && g === DOOR_HANDLE.g && b === DOOR_HANDLE.b && a === DOOR_HANDLE.a) found.push({ x, y });
    }
  }
  return found;
}

function rgbaOf(image: PixelBuffer): string[] {
  const out: string[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = image.getPixel(x, y);
      out.push(`${r},${g},${b},${a}`);
    }
  }
  return out;
}

/** A door of a vertical run in frame pixels (S14): its span's top and bottom, the column it stands in, the posts' feet. */
function vertical(variant: DoorVariant) {
  // A tile shorter than in a horizontal run (L41): 1 tile for a single door, 2 for a double.
  const span = { single: 1, double: 2, window: 1 }[variant] * ART_TILE;
  const top = AY - span / 2;
  const bottom = AY + span / 2;
  return { top, bottom, left: AX - ART_TILE / 2, right: AX + ART_TILE / 2, ...verticalDoorFeet(variant, top) };
}
const luma = ({ r, g, b }: { r: number; g: number; b: number }): number => 0.299 * r + 0.587 * g + 0.114 * b;

describe('doors of a vertical wall run, standing like the walls (S9, S14)', () => {
  it('draws every variant, rotation, hinge and state in a contract frame, its corners clear', () => {
    for (const { material, variant } of DOOR_PIECES) {
      for (const rotation of ROTATIONS) {
        for (const hinge of DOOR_HINGES) {
          for (const step of STEPS) {
            const sprite = doorSprite(material, variant, rotation, hinge, step);
            expect([sprite.width, sprite.height]).toEqual([DOOR.frame.width, DOOR.frame.height]);
            const corners = [[0, 0], [sprite.width - 1, 0], [0, sprite.height - 1], [sprite.width - 1, sprite.height - 1]] as const;
            expect(corners.map(([x, y]) => sprite.alphaAt(x, y)), `${material} ${variant} ${rotation} ${hinge} ${step}`).toEqual([0, 0, 0, 0]);
          }
        }
      }
    }
  });

  it('lights its posts on the right like the end of a wall, the same as the door line, and runs the post into that line with no cap (L43)', () => {
    for (const variant of DOOR_VARIANTS) {
      const { top, bottom } = vertical(variant);
      const shut = doorSprite('wood', variant, 270, 'start', 0);
      const t = VERTICAL_DOOR.leafThickness;
      const [left, right] = [AX - t / 2, AX + t / 2 - 1];
      // The post under the box, the box on its top, the stub of the lower post and the door line along the span.
      for (const y of [top - 20, top - VERTICAL_DOOR.height + 4, bottom - 1, top + 8]) {
        expect(luma(shut.getPixel(right, y)), `${variant} y ${y - top}`).toBeGreaterThan(luma(shut.getPixel(left, y)));
      }
      // Where the post meets the span: the same wood as just above, no shaded bottom row.
      expect(shut.getPixel(AX, top - 1), variant).toEqual(shut.getPixel(AX, top - 2));
    }
  });

  it('shades the column at 50% in the wall-top color from where the material above ends down to the span bottom, the span and the base rows over it too, nothing outside it (S14c, L43, L45)', () => {
    const band = hexToRgba(WALL_TOP_COLOR);
    for (const variant of DOOR_VARIANTS) {
      const { top, bottom, left, right } = vertical(variant);
      const from = top - 3 * ART_TILE + WALL.topHeight;
      const closed = doorSprite('wood', variant, 90, 'start', CLOSED);
      // Beside the post, where nothing of the door stands: the shadow alone, over the face above and over the floor of the span.
      expect(closed.getPixel(left + 1, from)).toEqual({ ...band, a: 128 });
      // One shade over the whole column, the doorway and the wall's base rows left out over it included (L45).
      for (const y of [top - VERTICAL_DOOR.hidesWallBase - 1, top - VERTICAL_DOOR.hidesWallBase, top, bottom - 1]) {
        expect(closed.getPixel(right - 1, y), `${variant} y ${y - top}`).toEqual({ ...band, a: 128 });
      }
      // The post is the same down to the span: no darker rows where it meets the door line,
      // which is the frame's own wood all along the span (L45).
      expect(closed.getPixel(AX, top - 1), variant).toEqual(closed.getPixel(AX, top - 4));
      expect(closed.getPixel(AX, top + 4), variant).toEqual(closed.getPixel(AX, top - 4));
      // Over the material only: the dark top of the run above it and the wall below it show as they are.
      for (let x = left; x < right; x += 1) {
        expect(closed.alphaAt(x, from - 1), `${variant} above, x ${x}`).toBe(0);
        expect(closed.alphaAt(x, bottom), `${variant} below, x ${x}`).toBe(0);
      }
      // Every pixel of the column between is shaded or drawn, none outside the column, shut.
      for (let y = from; y < bottom; y += 1) for (let x = left; x < right; x += 1) expect(closed.alphaAt(x, y)).toBeGreaterThan(0);
      expect(bounds(closed)).toEqual({ left, top: from, right: right - 1, bottom: bottom - 1 });
    }
  });

  it('stands the frame over the floor: a box 2 tiles over the span top, a post under it down to the floor, and 2px of the lower post over the wall below (S14b)', () => {
    for (const variant of DOOR_VARIANTS) {
      const { top, bottom } = vertical(variant);
      const half = VERTICAL_DOOR.leafThickness / 2;
      const closed = doorSprite('wood', variant, 90, 'start', CLOSED);
      // The box's top is the horizontal door's height over the floor; opaque from there to the floor, post-wide.
      for (let x = AX - half; x < AX + half; x += 1) {
        expect(closed.alphaAt(x, top - VERTICAL_DOOR.height - 1), `${variant} x ${x}`).toBe(128);
        for (let y = top - VERTICAL_DOOR.height; y < top; y += 1) expect(closed.alphaAt(x, y), `${variant} ${x},${y}`).toBe(255);
      }
      // The box ends `jamb` rows down with its outline, over the post.
      const boxEnd = top - VERTICAL_DOOR.height + DOOR.variants[variant].jamb;
      expect(luma(closed.getPixel(AX, boxEnd))).toBeLessThan(luma(closed.getPixel(AX, top - 20)));
      expect(luma(closed.getPixel(AX, boxEnd))).toBeLessThan(luma(closed.getPixel(AX, boxEnd - 2)));
      // The lower post: its top two rows show over the wall below, its outline right over them; nothing of it under the span.
      const stub = [closed.getPixel(AX, bottom - 2), closed.getPixel(AX, bottom - 1)];
      expect(luma(closed.getPixel(AX, bottom - 3))).toBeLessThan(Math.min(...stub.map(luma)));
      for (let x = AX - half; x < AX + half; x += 1) expect(closed.alphaAt(x, bottom)).toBe(0);
    }
  });

  it('keeps the frame and the shut door line the same at every step, over the leaves (S14d)', () => {
    for (const variant of DOOR_VARIANTS) {
      for (const rotation of [90, 270] as const) {
        const { bottom } = vertical(variant);
        const closed = doorSprite('wood', variant, rotation, 'start', CLOSED);
        for (const step of STEPS.slice(1)) {
          const swung = doorSprite('wood', variant, rotation, 'start', step);
          const changed: string[] = [];
          // The post, its box and the door line, with their outline.
          for (let y = 0; y < bottom; y += 1) {
            for (let x = AX - VERTICAL_DOOR.leafThickness / 2 - 1; x < AX + VERTICAL_DOOR.leafThickness / 2 + 1; x += 1) {
              if (JSON.stringify(swung.getPixel(x, y)) !== JSON.stringify(closed.getPixel(x, y))) changed.push(`${x},${y}`);
            }
          }
          expect(changed, `${variant} ${rotation} step ${step}`).toEqual([]);
        }
      }
    }
  });

  it('draws no leaf beside the column shut, and swings the leaves out of it a bit more each step, to the right at 90 and the left at 270 (S14d)', () => {
    for (const variant of DOOR_VARIANTS) {
      const { left, right } = vertical(variant);
      const outside = (x: number): boolean => x < left || x >= right;
      expect(bounds(doorSprite('wood', variant, 90, 'start', CLOSED), outside).left, variant).toBe(Infinity);
      const reach = STEPS.slice(1).map((step) => bounds(doorSprite('wood', variant, 90, 'start', step), outside).right);
      expect(reach[0], variant).toBeGreaterThan(right);
      expect(reach[0], variant).toBeLessThan(reach[1]!);
      expect(reach[1], variant).toBeLessThan(reach[2]!);
      for (const step of STEPS.slice(1)) expect(bounds(doorSprite('wood', variant, 270, 'start', step), outside).right, `${variant} ${step}`).toBeLessThan(left);
    }
  });

  it('hangs the single leaf from the upper post, half the post-to-post length (S14d)', () => {
    const { right, upper, lower } = vertical('single');
    const half = VERTICAL_DOOR.leafThickness / 2;
    const open = bounds(doorSprite('wood', 'single', 90, 'start', OPEN), (x) => x >= right);
    // Turned a quarter, it lies across the run from its hinge: its far end and its foot on the floor, outline included.
    expect(open.right).toBe(AX + Math.floor((lower - upper) / 2));
    expect(open.bottom).toBe(upper + half);
  });

  it('hinges the lower leaf of a double door at the lower post, its foot under the wall below, and the upper one at the upper post (S14d)', () => {
    const { right, upper, lower } = vertical('double');
    const half = VERTICAL_DOOR.leafThickness / 2;
    const open = doorSprite('wood', 'double', 90, 'start', OPEN);
    const middle = Math.floor((upper + lower) / 2);
    const upperLeaf = bounds(open, (x, y) => x >= right && y < middle);
    const lowerLeaf = bounds(open, (x, y) => x >= right && y >= middle);
    expect(upperLeaf.bottom).toBe(upper + half);
    expect(lowerLeaf.bottom).toBe(lower + half);
    // The two share the post-to-post length.
    expect(upperLeaf.right).toBe(AX + Math.floor((lower - upper) / 2));
    expect(lowerLeaf.right).toBe(AX + (lower - upper) - Math.floor((lower - upper) / 2));
  });

  it('mirrors the drawing at 270 of the one at 90, about the column middle, the light staying top-left', () => {
    for (const variant of DOOR_VARIANTS) {
      for (const step of STEPS) {
        const right = doorSprite('wood', variant, 90, 'start', step);
        const left = doorSprite('wood', variant, 270, 'start', step);
        const unmatched: string[] = [];
        for (let y = 0; y < right.height; y += 1) {
          for (let x = 0; x < right.width; x += 1) if (left.alphaAt(x, y) !== right.alphaAt(2 * AX - 1 - x, y)) unmatched.push(`${x},${y}`);
        }
        expect(unmatched, `${variant} ${step}`).toEqual([]);
      }
    }
  });

  it('draws the same door whatever the hinge: the lower post stands under the wall', () => {
    for (const variant of DOOR_VARIANTS) {
      for (const rotation of [90, 270] as const) {
        for (const step of STEPS) expect(rgbaOf(doorSprite('wood', variant, rotation, 'end', step)), `${variant} ${rotation} ${step}`).toEqual(rgbaOf(doorSprite('wood', variant, rotation, 'start', step)));
      }
    }
  });

  it('tops a leaf with a plain plank, no grain line along it, and keeps its handle near its free end (L38)', () => {
    const { right, upper } = vertical('single');
    const open = doorSprite('wood', 'single', 90, 'start', OPEN);
    // Turned a quarter, the top of the leaf runs across the run, its middle row a leaf's height over the hinge's floor line.
    const row = upper - (VERTICAL_DOOR.height - DOOR.variants.single.jamb);
    const tones = new Set<string>();
    // The leaf is 47px long (L41), its last pixels shaded as its end.
    for (let x = right + 1; x < AX + 43; x += 1) tones.add(JSON.stringify(open.getPixel(x, row)));
    expect(tones.size).toBe(1);
    expect(open.alphaAt(right + 1, row)).toBe(255);
    // At 30 degrees the shorter leaf's handle (L41) is still in the column, under the ceiling's shadow.
    for (const step of STEPS.slice(2)) {
      const found = handle(doorSprite('wood', 'single', 90, 'start', step));
      expect(found.length, `step ${step}`).toBeGreaterThan(0);
      expect(found.every(({ x }) => x > AX), `step ${step}`).toBe(true);
    }
  });
});

describe('doors and windows seen from the front, in a horizontal wall run (tile walls, S10, S11)', () => {
  const opaque = (image: PixelBuffer, x: number, y: number): boolean => image.alphaAt(x, y) > 0;

  it('fills the bottom two tiles of the wall with a door, centered on its span and `frontWidth` wide, nothing above or beside it (S10)', () => {
    for (const variant of DOOR_VARIANTS) {
      const half = DOOR.variants[variant].frontWidth / 2;
      for (const rotation of [0, 180] as const) {
        const closed = doorSprite('wood', variant, rotation, 'start', CLOSED);
        expect(bounds(closed), `${variant} ${rotation}`).toEqual({ left: AX - half, top: DOOR_FRONT.top, right: AX + half - 1, bottom: DOOR_FRONT.bottom - 1 });
        // Shut, the doorway is filled: every pixel of the span over its two tiles is drawn.
        const holes: string[] = [];
        for (let y = DOOR_FRONT.top; y < DOOR_FRONT.bottom; y += 1) for (let x = AX - half; x < AX + half; x += 1) if (!opaque(closed, x, y)) holes.push(`${x},${y}`);
        expect(holes, `${variant} ${rotation}`).toEqual([]);
      }
    }
  });

  it('frames every door alike in dark wood, whatever its variant: the same jambs and lintel colors, darker than the leaf (S10)', () => {
    const frameColors = (variant: DoorVariant) => {
      const image = doorSprite('wood', variant, 0, 'start', CLOSED);
      const half = DOOR.variants[variant].frontWidth / 2;
      return [image.getPixel(AX - half + 1, DOOR_FRONT.top + 10), image.getPixel(AX, DOOR_FRONT.top + 1)];
    };
    expect(frameColors('double')).toEqual(frameColors('single'));
    const single = doorSprite('wood', 'single', 0, 'start', CLOSED);
    const luma = ({ r, g, b }: { r: number; g: number; b: number }) => 0.299 * r + 0.587 * g + 0.114 * b;
    const jamb = single.getPixel(AX - DOOR.variants.single.frontWidth / 2 + 1, DOOR_FRONT.top + 10);
    const leaf = single.getPixel(AX, DOOR_FRONT.top + 20);
    // The frame's outer edge is one light line all round, the corners of the lintel included.
    const { frontWidth } = DOOR.variants.single;
    const edge = [
      ...Array.from({ length: DOOR_FRONT.bottom - DOOR_FRONT.top }, (_, i) => single.getPixel(AX - frontWidth / 2, DOOR_FRONT.top + i)),
      ...Array.from({ length: DOOR_FRONT.bottom - DOOR_FRONT.top }, (_, i) => single.getPixel(AX + frontWidth / 2 - 1, DOOR_FRONT.top + i)),
      ...Array.from({ length: frontWidth }, (_, i) => single.getPixel(AX - frontWidth / 2 + i, DOOR_FRONT.top)),
    ];
    expect(new Set(edge.map((color) => JSON.stringify(color))).size).toBe(1);
    // Wood: more red than blue; dark: under the leaf's own wood.
    expect(jamb.r).toBeGreaterThan(jamb.b);
    expect(luma(jamb)).toBeLessThan(luma(leaf));
  });

  it('opens the doorway as it swings: the leaf narrows toward its hinge and leaves the middle clear', () => {
    const middleRow = DOOR_FRONT.top + 32;
    const drawn = (step: number, hinge: DoorHinge) => {
      const image = doorSprite('wood', 'single', 0, hinge, step);
      let count = 0;
      for (let x = AX - 22; x < AX + 22; x += 1) if (opaque(image, x, middleRow)) count += 1;
      return count;
    };
    expect(drawn(0, 'start')).toBeGreaterThan(drawn(1, 'start'));
    expect(drawn(1, 'start')).toBeGreaterThan(drawn(2, 'start'));
    expect(drawn(2, 'start')).toBeGreaterThan(drawn(OPEN, 'start'));
    const open = doorSprite('wood', 'single', 0, 'start', OPEN);
    expect(opaque(open, AX, middleRow)).toBe(false);
    // Hinged at the start (west) the leaf stays on the west side, at the end on the east one.
    expect(opaque(open, AX - 22 + 5, middleRow)).toBe(true);
    expect(opaque(doorSprite('wood', 'single', 0, 'end', OPEN), AX + 22 - 6, middleRow)).toBe(true);
    // The same frame whichever side it swings to.
    expect(rgbaOf(doorSprite('wood', 'single', 180, 'start', 2))).toEqual(rgbaOf(doorSprite('wood', 'single', 0, 'start', 2)));
  });

  it('borders a window alike on both sides: its right edge shows the same light line as its left (S11)', () => {
    const width = DOOR.variants.window.frontWidth;
    const image = doorSprite('glass', 'window', 0, 'start', CLOSED);
    const middle = WINDOW_FRONT.top + 12;
    expect(image.getPixel(AX + width / 2 - 1, middle)).toEqual(image.getPixel(AX - width / 2, middle));
    // The top edge is one light line from end to end, the corners over the jambs included.
    const top = Array.from({ length: width }, (_, i) => JSON.stringify(image.getPixel(AX - width / 2 + i, WINDOW_FRONT.top)));
    expect(new Set(top).size).toBe(1);
  });

  it('draws a window 1.4 tiles wide in the middle of its two, 0.4 tiles under the band down to the bottom tile of the wall, in solid glass (S11, L22-L24)', () => {
    const half = DOOR.variants.window.frontWidth / 2;
    expect(half * 2).toBeLessThan(DOOR.variants.window.span * ART_TILE);
    for (const rotation of [0, 180] as const) {
      const image = doorSprite('glass', 'window', rotation, 'start', CLOSED);
      expect(bounds(image)).toEqual({ left: AX - half, top: WINDOW_FRONT.top, right: AX + half - 1, bottom: WINDOW_FRONT.bottom - 1 });
      // Its top is its own frame, not the band's color: the wall shows between them.
      expect(image.getPixel(AX, WINDOW_FRONT.top)).not.toEqual(hexToRgba(WALL_TOP_COLOR));
      // Every pixel inside the frame is opaque: the wall never shows through the glass.
      for (let y = WINDOW_FRONT.top; y < WINDOW_FRONT.bottom; y += 1) for (let x = AX - half; x < AX + half; x += 1) expect(image.alphaAt(x, y)).toBe(255);
      // The same at every step and hinge: a window never opens.
      expect(rgbaOf(doorSprite('glass', 'window', rotation, 'end', OPEN))).toEqual(rgbaOf(image));
    }
  });

  it('draws no window in a vertical run (S8)', () => {
    for (const rotation of [90, 270] as const) expect(bounds(doorSprite('glass', 'window', rotation, 'start', CLOSED)).left).toBe(Infinity);
  });
});
