/**
 * Seat geometry every chair and sofa shares, and the upholstered models built on it: the leather
 * and fabric armchairs and their sofas of two and three seats.
 *
 * A sofa is an armchair widened along `v`, one seat per tile (SEAT_PITCH apart), each seat the
 * same as a chair's: its surface SEAT_HEIGHT above the floor and the backrest's inner face at
 * BACK_FACE. Turned sideways a sofa runs along the floor depth, which DEPTH_SCALE shortens, so its
 * model is built longer by 1 / DEPTH_SCALE there and still covers its tiles on screen.
 */
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { DEPTH_SCALE, floorSpans, type Box, type FurnitureModel, type Layer, type Part, type Span, type SurfacePoint } from './furnitureModel.ts';
import { rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';
import { SEAT_HEIGHT, type Facing } from '../../../src/art/seating.ts';

/** Half the seat size; the seat spans -SEAT_HALF..SEAT_HALF on both floor axes. */
export const SEAT_HALF = 7;
/** Model u of the backrest's inner face: where a sitter's back rests. */
export const BACK_FACE = -5;
/** Model u of the backrest's rear: a backrest 5px thick, behind the face the sitter leans on. */
const BACK_REAR = -10;
export const SEAT_UNDER = SEAT_HEIGHT - 2;
export const ARM_TOP = SEAT_HEIGHT + 4;
export const SEAT_SPAN: Span = [-SEAT_HALF, SEAT_HALF];
/** Screen pixels between two seats of a sofa: one tile. */
export const SEAT_PITCH = 32;

/** Seen from behind, the backrest covers the sitter's back. */
export const backrestLayer = (facing: Facing): Layer => (facing === 'up' ? 'front' : 'back');

/** An armrest on the sitter's right (+1) or left (-1) side covers the sitter when it is the near one. */
export function armLayer(side: 1 | -1): (facing: Facing) => Layer {
  return (facing) => (facing === 'up' || facing === (side > 0 ? 'right' : 'left') ? 'front' : 'back');
}

export const LEATHER = makeRamp('#8c4a31');
export const LEATHER_FEET = makeRamp('#4a2e22');

/** The beige of the fabric armchair and sofas (the reference sofa), and the color the pack exports them in. */
export const DEFAULT_FABRIC_COLOR = '#c4ab8c';

/**
 * Buttoned upholstery: a dimple on a diamond grid, laid out per backrest cushion from its middle out, so the buttons
 * of every cushion mirror each other across it. A cushion runs between the seam pixels `seamed` draws (within 0.5
 * of a seam) and, at the ends, the ink that parts the seat cushion from the arms, which cover the back below their
 * tops: the buttons then line up with the seat cushion under them. The armchair's narrow arms leave its buttons
 * clear, so it spans its whole face.
 */
function tufted(seats: number, facing: Facing, inner: number, half: number): (point: SurfacePoint, color: Rgba) => Rgba {
  const scale = lengthen(1, seats, facing);
  const seams = Array.from({ length: seats - 1 }, (_, k) => -inner + (2 * inner * (k + 1)) / seats);
  // Pixel centers sit on halves: the first one at least 0.5 past a boundary, and the last one before it.
  const end = seats === 1 ? half : inner - 1;
  const lows = [0.5 - end, ...seams.map((b) => Math.ceil(b) + 0.5)];
  const highs = [...seams.map((b) => Math.floor(b - 1) + 0.5), end - 0.5];
  return (point, color) => {
    // Only the side the sitter leans on is buttoned.
    if (point.face !== 'forward' || point.width < 8) return color;
    if (point.row < 2 || point.row > point.height - 3) return color;
    const screen = narrow(point.v / scale, seats);
    const k = lows.findIndex((lo, i) => screen >= lo && screen <= highs[i]!);
    if (k < 0) return color;
    const distance = Math.abs(screen - (lows[k]! + highs[k]!) / 2);
    if (distance > (highs[k]! - lows[k]!) / 2 - 1.5) return color;
    // A cushion an even number of pixels wide has its middle between two of them: count from half a pixel out.
    const step = Math.round(distance % 1 === 0 ? distance : distance + 0.5);
    if ((point.row % 6 === 2 && step % 6 === 3) || (point.row % 6 === 5 && step % 6 === 0)) return LEATHER.deep;
    return color;
  };
}

/** The roll that tops a fabric arm: how tall it is and how far it curls out past the post under it. */
const ROLL_HEIGHT = 6;
const ROLL_OUT = 2;

/**
 * The spiral on the front of a roll, as seen from the front, counted from the arm's outer edge, one per roll width
 * (the armchair's and the sofas'), so it fills the roll; `#` is the deep tone of the ramp, so a recolor moves it with
 * the rest.
 */
const SCROLLS: Readonly<Record<number, readonly string[]>> = {
  5: ['.###.', '#...#', '#.#.#', '#..#.', '.##..'],
  7: ['.#####.', '#.....#', '#.###.#', '#.#..#.', '#..##..', '.###...'],
};

const CUT = rgba(0, 0, 0, 0);

/**
 * The front of a roll curls in from its outer side; on the sitter's right (+1) that is the left of the screen. Seen
 * from the front, its top gives up the pixel at its outer far corner, past the one `rounded` already cuts, so the roll
 * reads round over the spiral (from behind, `rounded` alone already slopes that corner).
 */
function scroll(side: 1 | -1, facing: Facing, ramp: Ramp): (point: SurfacePoint, color: Rgba) => Rgba {
  return (point, color) => {
    const fromOuter = side > 0 ? point.col : point.width - 1 - point.col;
    if (point.face === 'top') return facing === 'down' && point.row === 1 && fromOuter === 0 ? CUT : color;
    if (point.face !== 'forward') return color;
    return SCROLLS[point.width]?.[point.row]?.[fromOuter] === '#' ? ramp.deep : color;
  };
}

export type UpholsteryStyle = 'leather' | 'fabric';

interface Style {
  readonly ramp: Ramp;
  /** Leather stands on short dark feet; the fabric body goes down to the floor. */
  readonly feet: Ramp | null;
  readonly top: number;
  /** Arms run from the backrest's rear; the leather ones stop short of the front. */
  readonly armU: Span;
  readonly body: Span;
  /** Fabric arms end in a roll that curls outward, a spiral on its front. */
  readonly scrolled: boolean;
  /** Leather backs are buttoned; fabric ones plain. */
  readonly buttoned: boolean;
  /** Contact shadow reach: the boxy fabric body covers more of the floor, so its shadow spreads further. */
  readonly shadowU: Span;
  readonly shadowMargin: number;
}

/** Half the width on screen: a lone armchair like the club chair, a sofa its tiles less a margin. */
function halfWidth(seats: number): number {
  return seats === 1 ? 10 : (seats * SEAT_PITCH) / 2 - 5;
}

/** The model `v` of a seat, `index` counted from the sitter's left, for a facing. */
export function seatV(seats: number, index: number, facing: Facing): number {
  return lengthen((index - (seats - 1) / 2) * SEAT_PITCH, seats, facing);
}

/**
 * A sofa of an even number of seats has its middle seam on the middle of the piece, which falls between two pixels;
 * it is drawn one pixel wider, a column inserted at v 0..1, so that seam takes that column alone and both halves stay
 * mirrors. Shapes are laid out without that column and `widen` puts it in; `narrow` turns a drawn screen position
 * back, the column itself to 0.
 */
function middleColumn(seats: number): number {
  return seats % 2 === 0 ? 1 : 0;
}

function widen(screen: number, seats: number): number {
  return screen > 0 ? screen + middleColumn(seats) : screen;
}

function narrow(screen: number, seats: number): number {
  const column = middleColumn(seats);
  if (screen <= 0 || column === 0) return screen;
  return screen < column ? 0 : screen - column;
}

/** A span along the sofa, laid out on screen without the middle column, as the model places it. */
function placed([a, b]: Span, seats: number, facing: Facing): Span {
  const place = (screen: number): number => Math.round(lengthen(widen(screen, seats), seats, facing));
  return [place(a), place(b)];
}

/**
 * Screen x span and floor row span, from the floor under the model origin, of the backrest of a piece of `seats`
 * places turned `facing`: what a sofa's default collision covers (`sofaBackrestRect` of src/game/pieceCollisions.ts).
 */
export function backrestFloor(seats: number, facing: Facing): { readonly x: Span; readonly z: Span } {
  const half = halfWidth(seats);
  return floorSpans(facing, [BACK_REAR, BACK_FACE], placed([-half, half], seats, facing));
}

function lengthen(screen: number, seats: number, facing: Facing): number {
  return seats > 1 && (facing === 'left' || facing === 'right') ? screen / DEPTH_SCALE : screen;
}

/** Seams between cushions, at the seat boundaries on screen, in the ramp's own deep tone: a recolor moves them with the rest. */
function seamed(seats: number, facing: Facing, inner: number, ramp: Ramp, shade?: (point: SurfacePoint, color: Rgba) => Rgba): (point: SurfacePoint, color: Rgba) => Rgba {
  const scale = lengthen(1, seats, facing);
  return (point, color) => {
    const shaded = shade ? shade(point, color) : color;
    if (point.face === 'right' || point.face === 'left') return shaded;
    const screen = narrow(point.v / scale, seats);
    for (let k = 1; k < seats; k += 1) {
      const seam = -inner + (2 * inner * k) / seats;
      if (Math.abs(screen - seam) < 0.5) return ramp.deep;
    }
    return shaded;
  };
}

function style(kind: UpholsteryStyle, color: string): Style {
  if (kind === 'leather') {
    return { ramp: LEATHER, feet: LEATHER_FEET, top: SEAT_HEIGHT + 12, armU: [BACK_REAR, 6], body: [3, SEAT_UNDER], scrolled: false, buttoned: true, shadowU: [BACK_REAR, 7], shadowMargin: 0 };
  }
  return { ramp: makeRamp(color), feet: null, top: SEAT_HEIGHT + 11, armU: [BACK_REAR, 7], body: [0, SEAT_UNDER], scrolled: true, buttoned: false, shadowU: [BACK_REAR - 2, 10], shadowMargin: 2 };
}

/**
 * A padded seat of `seats` places: a body, one cushion per seat, a back and an arm at each end, the leather one on
 * short dark feet, the fabric one down to the floor with rolled arms. `color` paints the fabric one; the leather keeps
 * its own.
 */
export function upholsteredModel(kind: UpholsteryStyle, seats: number, facing: Facing, color = DEFAULT_FABRIC_COLOR): FurnitureModel {
  const s = style(kind, color);
  const half = halfWidth(seats);
  // Spans are laid out on screen without the middle column (mirror them before `along`), then placed.
  const along = (span: Span): Span => placed(span, seats, facing);
  const mirror = ([a, b]: Span): Span => [-b, -a];
  // A sofa's arms are broader than the armchair's, in keeping with its length.
  const armWidth = seats === 1 ? 3 : 5;
  const innerHalf = half - armWidth;
  // The backrest shades the back of the cushion, so the seat reads apart from the back from the front.
  // Down to the floor, the body and arm posts stand square on it from behind; their cut corners read as curves there.
  const softBase = s.feet !== null || facing !== 'up';
  const cushion = (point: SurfacePoint, c: Rgba): Rgba => {
    if (point.face !== 'top') return c;
    if (point.u < BACK_FACE + 2) return s.ramp.shadow;
    return point.row === point.height - 1 ? mixRgba(c, s.ramp.light, 0.3) : c;
  };
  const feetV: Span = [half - 3, half - 1];
  const feet: Box[] = [];
  if (s.feet !== null) {
    for (const u of [[5, 7], [BACK_REAR + 1, BACK_REAR + 3]] as const) for (const v of [along(feetV), along(mirror(feetV))]) feet.push({ u, v, y: [0, s.body[0]], ramp: s.feet, side: 'base' });
  }
  const arm = (side: 1 | -1): Part => {
    const onSide = (span: Span): Span => along(side > 0 ? span : mirror(span));
    const v = onSide([half - armWidth, half]);
    if (!s.scrolled) {
      return { layer: armLayer(side), boxes: [{ u: s.armU, v, y: [s.body[0], ARM_TOP], ramp: s.ramp, top: 'light', side: 'base', rounded: true }] };
    }
    // A post up from the floor, and on it the roll, wider by ROLL_OUT toward the outside.
    return {
      layer: armLayer(side),
      boxes: [
        // From behind the post is the body's own back, in its tone, so it does not read as a leg.
        { u: s.armU, v, y: [s.body[0], ARM_TOP - ROLL_HEIGHT], ramp: s.ramp, side: 'base', rounded: softBase, shade: (point, c) => (point.face === 'backward' ? s.ramp.shadow : c) },
        { u: s.armU, v: onSide([half - armWidth, half + ROLL_OUT]), y: [ARM_TOP - ROLL_HEIGHT, ARM_TOP], ramp: s.ramp, top: 'light', side: 'base', rounded: true, shade: scroll(side, facing, s.ramp) },
      ],
    };
  };
  return {
    // A body down to the floor is a box on it: its shadow is square like the sofas', or it would hide behind it.
    shadow: { u: s.shadowU, v: along([-(half + s.shadowMargin), half + s.shadowMargin]), shape: seats === 1 && s.feet !== null ? 'ellipse' : 'rect' },
    parts: [
      ...(feet.length > 0 ? [{ boxes: feet }] : []),
      // On feet the body sits a pixel in from the back; down to the floor it is flush with it, one block from behind.
      { boxes: [{ u: [s.feet === null ? BACK_REAR : BACK_REAR + 1, 7], v: along([-(half - 1), half - 1]), y: s.body, ramp: s.ramp, side: 'shadow', rounded: softBase }] },
      {
        boxes: [
          { u: [BACK_FACE + 1, 7], v: along([-innerHalf, innerHalf]), y: [SEAT_UNDER, SEAT_HEIGHT], ramp: s.ramp, top: 'base', side: 'base', rounded: true, shade: seamed(seats, facing, innerHalf, s.ramp, cushion) },
        ],
      },
      {
        layer: backrestLayer,
        boxes: [{ u: [BACK_REAR, BACK_FACE], v: along([-half, half]), y: [SEAT_UNDER, s.top], ramp: s.ramp, top: 'light', side: 'base', rounded: true, shade: seamed(seats, facing, innerHalf, s.ramp, s.buttoned ? tufted(seats, facing, innerHalf, half) : undefined) }],
      },
      arm(1),
      arm(-1),
    ],
  };
}
