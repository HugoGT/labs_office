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
import { DEPTH_SCALE, type Box, type FurnitureModel, type Layer, type Part, type Span, type SurfacePoint } from './furnitureModel.ts';
import type { Rgba } from '../../../src/art/pixelBuffer.ts';
import { SEAT_HEIGHT, type Facing } from '../../../src/art/seating.ts';

/** Half the seat size; the seat spans -SEAT_HALF..SEAT_HALF on both floor axes. */
export const SEAT_HALF = 7;
/** Model u of the backrest's inner face: where a sitter's back rests. */
export const BACK_FACE = -5;
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
const FABRIC_FEET = makeRamp('#2b2f3a');

/** The beige of the fabric armchair and sofas (the reference sofa), and the color the pack exports them in. */
export const DEFAULT_FABRIC_COLOR = '#c4ab8c';

/** Buttoned upholstery: a dimple on a diamond grid, lit just above it. */
export function tufted(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  // Only the side the sitter leans on is buttoned.
  if (point.face !== 'forward' || point.width < 8) return color;
  const { col, row } = point;
  if (row < 2 || row > point.height - 3 || col < 2 || col > point.width - 3) return color;
  if ((row % 6 === 2 && col % 6 === 3) || (row % 6 === 5 && col % 6 === 0)) return LEATHER.deep;
  return color;
}

export type UpholsteryStyle = 'leather' | 'fabric';

interface Style {
  readonly ramp: Ramp;
  readonly feet: Ramp;
  readonly top: number;
  /** Rolled leather arms stop short of the back; fabric ones are boxes from back to front. */
  readonly armU: Span;
  readonly body: Span;
  readonly back: (point: SurfacePoint, color: Rgba) => Rgba;
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

function lengthen(screen: number, seats: number, facing: Facing): number {
  return seats > 1 && (facing === 'left' || facing === 'right') ? screen / DEPTH_SCALE : screen;
}

/** Seams between cushions, at the seat boundaries on screen, in the ramp's own deep tone: a recolor moves them with the rest. */
function seamed(seats: number, facing: Facing, inner: number, ramp: Ramp, shade?: (point: SurfacePoint, color: Rgba) => Rgba): (point: SurfacePoint, color: Rgba) => Rgba {
  const scale = lengthen(1, seats, facing);
  return (point, color) => {
    const shaded = shade ? shade(point, color) : color;
    if (point.face === 'right' || point.face === 'left') return shaded;
    const screen = point.v / scale;
    for (let k = 1; k < seats; k += 1) {
      const seam = -inner + (2 * inner * k) / seats;
      if (Math.abs(screen - seam) < 0.6) return ramp.deep;
    }
    return shaded;
  };
}

function style(kind: UpholsteryStyle, color: string): Style {
  if (kind === 'leather') {
    return { ramp: LEATHER, feet: LEATHER_FEET, top: SEAT_HEIGHT + 12, armU: [-7, 6], body: [3, SEAT_UNDER], back: tufted, shadowU: [-8, 7], shadowMargin: 0 };
  }
  return { ramp: makeRamp(color), feet: FABRIC_FEET, top: SEAT_HEIGHT + 11, armU: [-8, 7], body: [2, SEAT_UNDER], back: (_point, c) => c, shadowU: [-10, 10], shadowMargin: 2 };
}

/**
 * A padded seat of `seats` places on short dark feet: a body, one cushion per seat, a back and an
 * arm at each end. `color` paints the fabric one; the leather keeps its own.
 */
export function upholsteredModel(kind: UpholsteryStyle, seats: number, facing: Facing, color = DEFAULT_FABRIC_COLOR): FurnitureModel {
  const s = style(kind, color);
  const half = halfWidth(seats);
  const along = ([a, b]: Span): Span => [Math.round(lengthen(a, seats, facing)), Math.round(lengthen(b, seats, facing))];
  const mirror = ([a, b]: Span): Span => [-b, -a];
  const innerHalf = half - 3;
  // The backrest shades the back of the cushion, so the seat reads apart from the back from the front.
  const cushion = (point: SurfacePoint, c: Rgba): Rgba => {
    if (point.face !== 'top') return c;
    if (point.u < BACK_FACE + 2) return s.ramp.shadow;
    return point.row === point.height - 1 ? mixRgba(c, s.ramp.light, 0.3) : c;
  };
  const feetV = along([half - 3, half - 1]);
  const feet: Box[] = [];
  for (const u of [[5, 7], [-7, -5]] as const) for (const v of [feetV, mirror(feetV)]) feet.push({ u, v, y: [0, s.body[0]], ramp: s.feet, side: 'base' });
  const arm = (side: 1 | -1): Part => {
    const v = along([half - 3, half]);
    return { layer: armLayer(side), boxes: [{ u: s.armU, v: side > 0 ? v : mirror(v), y: [s.body[0], ARM_TOP], ramp: s.ramp, top: 'light', side: 'base', rounded: true }] };
  };
  return {
    shadow: { u: s.shadowU, v: along([-(half + s.shadowMargin), half + s.shadowMargin]), shape: seats === 1 ? 'ellipse' : 'rect' },
    parts: [
      { boxes: feet },
      { boxes: [{ u: [-7, 7], v: along([-(half - 1), half - 1]), y: s.body, ramp: s.ramp, side: 'shadow', rounded: true }] },
      {
        boxes: [
          { u: [BACK_FACE + 1, 7], v: along([-innerHalf, innerHalf]), y: [SEAT_UNDER, SEAT_HEIGHT], ramp: s.ramp, top: 'base', side: 'base', rounded: true, shade: seamed(seats, facing, innerHalf, s.ramp, cushion) },
        ],
      },
      {
        layer: backrestLayer,
        boxes: [{ u: [-8, BACK_FACE], v: along([-half, half]), y: [SEAT_UNDER, s.top], ramp: s.ramp, top: 'light', side: 'base', rounded: true, shade: seamed(seats, facing, innerHalf, s.ramp, s.back) }],
      },
      arm(1),
      arm(-1),
    ],
  };
}
