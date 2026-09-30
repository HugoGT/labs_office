/**
 * Turns a CharacterSpec plus a WalkPose into a 3D scene of simple shapes (the "rig") and a list
 * of decals (eyes, badge, lanyard...) that are stamped as crisp pixels after ray casting.
 *
 * Character space: x points to the character's left, y up, z forward. Units are about 1 pixel.
 * Seated poses keep the feet planted at the origin: the legs bend by inverse kinematics and the
 * upper body is built as when standing, then moved back onto the seat and leaned as one piece.
 */
import { CAMERA_PITCH } from './camera.ts';
import type { Accessory, CharacterSpec, HairStyle } from './characters.ts';
import { darkenRamp, makeRamp, type Ramp, type Tone } from './color.ts';
import {
  add,
  applyBasis,
  basisAlong,
  box,
  capsule,
  composeBasis,
  cylinder,
  dot,
  ellipsoid,
  mul,
  normalize,
  pitchDown,
  roll,
  scale,
  solid,
  solveTwoBone,
  sphere,
  sub,
  transformed,
  turn,
  v3,
  type Basis,
  type MaterialFn,
  type Primitive,
  type Vec3,
} from './geometry.ts';
import { SEAT_BACK, SEAT_SURFACE_Y, type SeatedPose, type SitPose } from './sitCycle.ts';
import { LEG_LENGTH, MAX_HIP_SWING, type LegPose, type WalkPose } from './walkCycle.ts';

export type MaterialKey =
  | 'skin'
  | 'hair'
  | 'top'
  | 'inner'
  | 'tie'
  | 'bottom'
  | 'shoes'
  | 'acc'
  | 'accDetail'
  | 'white'
  | 'belt'
  | 'gold'
  | 'ink'
  | 'scrunchie'
  | 'screen'
  | 'lanyard'
  | 'photo'
  | 'lens';

export interface DecalContext {
  /** How directly the decal surface faces the camera, from -1 to 1. */
  readonly facing: number;
  /** Horizontal screen direction the surface normal points to: -1 left, 1 right. */
  readonly screenSide: number;
  plot(dx: number, dy: number, key: MaterialKey, tone?: Tone): void;
}

export interface Decal {
  readonly anchor: Vec3;
  readonly normal: Vec3;
  readonly minFacing: number;
  /** Allows pixels outside the rendered silhouette (earrings hanging below the ear). */
  readonly overflow?: boolean;
  draw(ctx: DecalContext): void;
}

export interface Scene {
  readonly primitives: readonly Primitive[];
  readonly decals: readonly Decal[];
  /** Seated poses only: the point under the pelvis center, on the seat once fully seated. */
  readonly seat?: Vec3;
}

const DEG = Math.PI / 180;
const LEFT = 1;
const RIGHT = -1;
type Side = typeof LEFT | typeof RIGHT;

const ANKLE_Y = 1.7;
const THIGH = 9.2;
const SHIN = LEG_LENGTH - THIGH;
const KNEE_BEND = 55 * DEG;
const UPPER_ARM = 6.8;
const FOREARM = 6.2;
const STANDING_HIP_Y = ANKLE_Y + LEG_LENGTH;

interface Proportions {
  readonly shoulderHalf: number;
  readonly chestHalf: number;
  readonly lowerHalf: number;
  readonly hipHalf: number;
  readonly torsoDepth: number;
  readonly armOffset: number;
  readonly sleeve: number;
  readonly hand: number;
  readonly neck: number;
  readonly head: Vec3;
  readonly legGap: number;
  readonly thigh: number;
  readonly shin: number;
}

const BROAD: Proportions = {
  shoulderHalf: 6.2,
  chestHalf: 5.7,
  lowerHalf: 5.5,
  hipHalf: 4.9,
  torsoDepth: 3.4,
  armOffset: 6.9,
  sleeve: 1.6,
  hand: 1.35,
  neck: 1.45,
  head: v3(4.6, 5.0, 4.6),
  legGap: 2.45,
  thigh: 2.35,
  shin: 2.15,
};

const SLIM: Proportions = {
  shoulderHalf: 5.1,
  chestHalf: 4.5,
  lowerHalf: 4.8,
  hipHalf: 4.6,
  torsoDepth: 3.05,
  armOffset: 5.8,
  sleeve: 1.35,
  hand: 1.2,
  neck: 1.25,
  head: v3(4.45, 4.9, 4.5),
  legGap: 2.2,
  thigh: 2.1,
  shin: 1.8,
};

interface LegJoints {
  readonly hip: Vec3;
  readonly knee: Vec3;
  readonly ankle: Vec3;
  /** Shin angle from straight down, positive when the ankle is forward of the knee. */
  readonly shinAngle: number;
  readonly footPitch: number;
}

/** Extra state of a seated pose. The upper body is built in its own space, see buildSeatedScene. */
interface SeatedRig {
  readonly pose: SitPose;
  readonly legs: Readonly<Record<Side, LegJoints>>;
  /** Parts placed straight in character space, outside the moving upper body (lap, floor). */
  readonly fixed: Primitive[];
  /** Character space to upper-body space. */
  toBody(point: Vec3): Vec3;
}

/** Everything the part builders need to know about the current pose. */
interface Body {
  readonly spec: CharacterSpec;
  readonly p: Proportions;
  readonly pose: WalkPose;
  readonly hipY: number;
  readonly waistY: number;
  readonly chestY: number;
  readonly shoulderY: number;
  readonly headCenter: Vec3;
  readonly headRadii: Vec3;
  readonly prims: Primitive[];
  readonly decals: Decal[];
  readonly sit?: SeatedRig;
}

interface HoldPose {
  readonly gamma: number;
  readonly delta: number;
  readonly swing: number;
  readonly spread: number;
  readonly inward: number;
}

/** How the right arm holds each accessory. Angles in radians, swing is the leftover arm swing. */
const HOLDS: Readonly<Record<Accessory, HoldPose>> = {
  coffee: { gamma: 6 * DEG, delta: 84 * DEG, swing: 0, spread: 0.12, inward: 0.3 },
  tablet: { gamma: 14 * DEG, delta: 66 * DEG, swing: 0, spread: 0.1, inward: 0.4 },
  folder: { gamma: 2 * DEG, delta: 104 * DEG, swing: 0, spread: 0.12, inward: 0.55 },
  laptop: { gamma: 0, delta: 16 * DEG, swing: 6 * DEG, spread: 0.16, inward: 0 },
  briefcase: { gamma: 0, delta: 8 * DEG, swing: 7 * DEG, spread: 0.2, inward: 0 },
  handbag: { gamma: 0, delta: 22 * DEG, swing: 12 * DEG, spread: 0.12, inward: 0 },
  jacketOverShoulder: { gamma: 30 * DEG, delta: 150 * DEG, swing: 0, spread: 0.1, inward: 0.15 },
};

export function rampsFor(spec: CharacterSpec): Readonly<Record<MaterialKey, Ramp>> {
  const p = spec.palette;
  return {
    skin: makeRamp(p.skin),
    hair: spec.darkerHair ? darkenRamp(makeRamp(p.hair)) : makeRamp(p.hair),
    top: makeRamp(p.top),
    inner: makeRamp(p.inner),
    tie: makeRamp(p.tie ?? p.inner),
    bottom: makeRamp(p.bottom),
    shoes: makeRamp(p.shoes),
    acc: makeRamp(p.accessory),
    accDetail: makeRamp(p.accessoryDetail ?? p.accessory),
    white: makeRamp('#f3efe6'),
    belt: makeRamp('#3b2b25'),
    gold: makeRamp('#e2b23c'),
    ink: makeRamp('#231a2e'),
    scrunchie: makeRamp(p.scrunchie ?? p.hair),
    screen: makeRamp(p.accessoryDetail ?? '#8fd3ea'),
    lanyard: makeRamp('#2a2442'),
    photo: makeRamp('#4a7fd0'),
    lens: makeRamp('#c4e6f5'),
  };
}

/** Keeps the upper body on whole screen pixels so faces do not shimmer between frames. */
function snapHipY(hipY: number): number {
  const k = Math.cos(CAMERA_PITCH);
  return STANDING_HIP_Y + Math.round((hipY - STANDING_HIP_Y) * k) / k;
}

function legDrop(leg: LegPose): number {
  const alpha = leg.swing * MAX_HIP_SWING;
  const beta = leg.lift * KNEE_BEND;
  return THIGH * Math.cos(alpha) + SHIN * Math.cos(alpha - beta);
}

/** `seatBack` is only used by seated poses: how far behind the planted feet the pelvis sits. */
export function buildScene(spec: CharacterSpec, pose: WalkPose | SeatedPose, seatBack = SEAT_BACK): Scene {
  if ('sit' in pose) return buildSeatedScene(spec, pose, seatBack);
  const p = spec.build === 'broad' ? BROAD : SLIM;
  const hipY = snapHipY(ANKLE_Y + Math.max(legDrop(pose.legs.left), legDrop(pose.legs.right)));
  const shoulderY = hipY + 11.2;
  const body: Body = {
    spec,
    p,
    pose,
    hipY,
    waistY: hipY + 2.6,
    chestY: shoulderY - 2.3,
    shoulderY,
    headCenter: v3(0, shoulderY + 7.1, 0.25),
    headRadii: p.head,
    prims: [],
    decals: [],
  };
  addLeg(body.prims, body, LEFT, walkLegJoints(body, LEFT, pose.legs.left));
  addLeg(body.prims, body, RIGHT, walkLegJoints(body, RIGHT, pose.legs.right));
  addUpperBody(body);
  return { primitives: body.prims, decals: body.decals };
}

function addUpperBody(body: Body): void {
  const { pose, spec } = body;
  addHips(body);
  addTorso(body);
  addArm(body, LEFT, pose.arms.left, undefined);
  addArm(body, RIGHT, pose.arms.right, HOLDS[spec.accessory]);
  addHead(body);
  addHair(body);
  addBadge(body);
}

/** Seated hip height: the thighs rest on the seat, snapped like standing so faces draw the same. */
const SEATED_HIP_Y = snapHipY(SEAT_SURFACE_Y + 2.2);
const HIP_ABOVE_SEAT = SEATED_HIP_Y - SEAT_SURFACE_Y;

/**
 * The legs are solved in character space from the planted feet to the hips. The upper body is
 * built exactly as when standing, with its hips at the origin, then leaned forward around the
 * hip axis and moved `seatBack` units backward as one rigid piece.
 */
function buildSeatedScene(spec: CharacterSpec, pose: SeatedPose, seatBack: number): Scene {
  const p = spec.build === 'broad' ? BROAD : SLIM;
  const { sit } = pose;
  const hipY = snapHipY(STANDING_HIP_Y + (SEATED_HIP_Y - STANDING_HIP_Y) * sit.lower);
  const hipZ = -seatBack * sit.lower;
  const shoulderY = hipY + 11.2 + sit.breath / Math.cos(CAMERA_PITCH);
  const lean: Basis = pitchDown(sit.lean);
  const pivot = v3(0, hipY, 0);
  const offset = add(sub(pivot, applyBasis(lean, pivot)), v3(0, 0, hipZ));
  const legs = { [LEFT]: seatedLegJoints(p, LEFT, hipY, hipZ), [RIGHT]: seatedLegJoints(p, RIGHT, hipY, hipZ) };
  const rig: SeatedRig = {
    pose: sit,
    legs,
    fixed: [],
    toBody(point) {
      const q = sub(point, offset);
      return v3(dot(q, lean.ax), dot(q, lean.ay), dot(q, lean.az));
    },
  };
  const body: Body = {
    spec,
    p,
    pose,
    hipY,
    waistY: hipY + 2.6,
    chestY: shoulderY - 2.3,
    shoulderY,
    headCenter: v3(0, shoulderY + 7.1, 0.25),
    headRadii: p.head,
    prims: [],
    decals: [],
    sit: rig,
  };
  addLeg(rig.fixed, body, LEFT, legs[LEFT]);
  addLeg(rig.fixed, body, RIGHT, legs[RIGHT]);
  addUpperBody(body);
  return {
    primitives: [...rig.fixed, ...body.prims.map((primitive) => transformed(primitive, lean, offset))],
    decals: body.decals.map((decal) => ({
      ...decal,
      anchor: add(applyBasis(lean, decal.anchor), offset),
      normal: applyBasis(lean, decal.normal),
    })),
    seat: v3(0, hipY - HIP_ABOVE_SEAT, hipZ),
  };
}

// ---------------------------------------------------------------------------------------------
// Legs and shoes

function walkLegJoints(body: Body, side: Side, leg: LegPose): LegJoints {
  const alpha = leg.swing * MAX_HIP_SWING;
  const shinAngle = alpha - leg.lift * KNEE_BEND;
  const hip = v3(side * body.p.legGap, body.hipY, 0);
  const knee = add(hip, v3(0, -THIGH * Math.cos(alpha), THIGH * Math.sin(alpha)));
  const ankle = add(knee, v3(0, -SHIN * Math.cos(shinAngle), SHIN * Math.sin(shinAngle)));
  return { hip, knee, ankle, shinAngle, footPitch: Math.min(0.45, Math.max(-0.3, -shinAngle * 0.5)) };
}

/**
 * Feet planted flat at the origin, knees bending forward and a little apart, so a seated front
 * view shows the knees instead of two straight leg columns.
 */
function seatedLegJoints(p: Proportions, side: Side, hipY: number, hipZ: number): LegJoints {
  const hip = v3(side * p.legGap, hipY, hipZ);
  const ankle = v3(side * p.legGap, ANKLE_Y, 0);
  const knee = solveTwoBone(hip, ankle, THIGH, SHIN, v3(side * 0.25, 0, 1));
  return { hip, knee, ankle, shinAngle: Math.atan2(ankle.z - knee.z, knee.y - ankle.y), footPitch: 0 };
}

function addLeg(prims: Primitive[], body: Body, side: Side, joints: LegJoints): void {
  const { p, spec } = body;
  const { hip, knee, ankle, shinAngle, footPitch } = joints;
  const part = side === LEFT ? 'legL' : 'legR';
  // Pull the rounded end of the shin up so it never dips below the floor.
  const shinEnd = (radius: number): Vec3 => {
    const k = Math.max(0, (radius + 0.15 - ankle.y) / Math.cos(shinAngle));
    return add(ankle, v3(0, k * Math.cos(shinAngle), -k * Math.sin(shinAngle)));
  };
  // Seated, a shadow line under the knees tells the lap from the shins in a front view.
  const shin = (key: MaterialKey): MaterialFn =>
    body.sit ? (_point, normal, local) => ({ key, shift: local.x < 0.3 && normal.z > 0.45 ? -1 : 0 }) : solid(key);
  if (spec.bottom === 'skirt') {
    prims.push(capsule(hip, knee, p.thigh * 0.88, { material: solid('skin'), part }));
    prims.push(capsule(knee, shinEnd(p.shin * 0.86), p.shin * 0.86, { material: shin('skin'), part }));
  } else if (spec.bottom === 'widePants') {
    prims.push(capsule(hip, knee, p.thigh + 0.3, { material: solid('bottom'), part }));
    prims.push(capsule(knee, shinEnd(p.shin + 0.95), p.shin + 0.95, { material: shin('bottom'), part }));
  } else {
    prims.push(capsule(hip, knee, p.thigh, { material: solid('bottom'), part }));
    prims.push(capsule(knee, shinEnd(p.shin), p.shin, { material: shin('bottom'), part }));
  }
  const foot = pitchDown(footPitch);
  // Lift the shoe just enough to keep its lowest point on the floor.
  const onFloor = (center: Vec3, radii: Vec3, tilt: number): Vec3 => {
    const reach = Math.hypot(radii.y * Math.cos(tilt), radii.z * Math.sin(tilt));
    return add(center, v3(0, Math.max(0, reach - center.y), 0));
  };
  if (spec.shoes === 'heels') {
    const heelBasis = composeBasis(foot, pitchDown(0.3));
    const radii = v3(1.3, 0.95, 2.2);
    prims.push(
      ellipsoid(onFloor(add(ankle, applyBasis(foot, v3(0, -0.55, 0.85))), radii, footPitch + 0.3), radii, {
        basis: heelBasis,
        material: solid('shoes'),
        part,
      }),
    );
    prims.push(
      capsule(add(ankle, applyBasis(foot, v3(0, -0.3, -0.9))), add(ankle, applyBasis(foot, v3(0, -1.55, -1.05))), 0.5, {
        material: solid('shoes', -1),
        part,
      }),
    );
  } else {
    const radii = spec.build === 'broad' ? v3(1.75, 1.1, 2.75) : v3(1.5, 1.0, 2.4);
    prims.push(
      ellipsoid(onFloor(add(ankle, applyBasis(foot, v3(0, -0.6, 0.95))), radii, footPitch), radii, {
        basis: foot,
        material: (_point, _normal, local) => ({ key: 'shoes', shift: local.y < -0.55 ? -1 : 0 }),
        part,
      }),
    );
  }
}

function addHips(body: Body): void {
  const { p, spec, hipY, waistY } = body;
  body.prims.push(
    ellipsoid(v3(0, hipY + 0.9, -0.1), v3(p.hipHalf, 3.0, p.torsoDepth - 0.2), { material: solid('bottom'), part: 'hips' }),
  );
  if (body.sit) {
    addSeatedSkirtAndCoat(body, body.sit);
    return;
  }
  if (spec.bottom === 'skirt') {
    const bottom = hipY - 7.4;
    const top = waistY + 0.6;
    body.prims.push(
      cylinder(v3(0, (bottom + top) / 2, 0.1), p.hipHalf + 0.35, (top - bottom) / 2, p.torsoDepth + 0.55, {
        material: (_point, _normal, local) => ({ key: 'bottom', shift: local.y < -0.86 ? -1 : 0 }),
        part: 'skirt',
      }),
    );
  }
  if (spec.top === 'longCoat') {
    const bottom = hipY - 9;
    const top = waistY + 1;
    body.prims.push(
      cylinder(v3(0, (bottom + top) / 2, 0), p.hipHalf + 0.95, (top - bottom) / 2, p.torsoDepth + 0.95, {
        material: (point, normal) => {
          if (normal.z > 0.4 && Math.abs(point.x) < 1.3) return { key: 'bottom' };
          if (normal.z > 0.4 && Math.abs(point.x) < 1.9) return { key: 'top', shift: -1 };
          return { key: 'top' };
        },
        part: 'coat',
      }),
    );
  }
}

function thighRadius(body: Body): number {
  const { p, spec } = body;
  if (spec.bottom === 'skirt') return p.thigh * 0.88;
  return spec.bottom === 'widePants' ? p.thigh + 0.3 : p.thigh;
}

function shinRadius(body: Body): number {
  const { p, spec } = body;
  if (spec.bottom === 'skirt') return p.shin * 0.86;
  return spec.bottom === 'widePants' ? p.shin + 0.95 : p.shin;
}

interface Lap {
  /** Midpoint between both thighs, on their top surface, `along` of the way to the knees. */
  readonly point: Vec3;
  /** Direction of the thighs, hip to knee. */
  readonly forward: Vec3;
  /** Outward normal of the thigh tops. */
  readonly up: Vec3;
}

/** Top of the lap in character space. Both thighs are parallel, so one direction serves both. */
function lapAt(body: Body, rig: SeatedRig, along: number): Lap {
  const { hip, knee } = rig.legs[LEFT];
  const forward = normalize(sub(knee, hip));
  const up = v3(0, forward.z, -forward.y);
  const middle = add(v3(0, hip.y, hip.z), scale(sub(knee, hip), along));
  return { point: add(middle, scale(up, thighRadius(body))), forward, up };
}

/** A tube lying over both thighs from the hips to `reach` of the way to the knees. */
function lapCover(
  body: Body,
  rig: SeatedRig,
  halfWidth: number,
  thickness: number,
  reach: number,
  options: { material: MaterialFn; part: string },
): Primitive {
  const { forward, up } = lapAt(body, rig, 0);
  const start = -0.12;
  const center = sub(lapAt(body, rig, (start + reach) / 2).point, scale(up, thighRadius(body)));
  return cylinder(center, halfWidth, ((reach - start) * THIGH) / 2, thickness, { basis: basisAlong(forward, up), ...options });
}

/**
 * Seated skirt and coat: the upper part stays around the hips (and leans with them), the rest
 * lies over the thighs instead of hanging down through the seat.
 */
function addSeatedSkirtAndCoat(body: Body, rig: SeatedRig): void {
  const { p, spec, hipY, waistY } = body;
  if (spec.bottom === 'skirt') {
    const bottom = hipY - 1.6;
    const top = waistY + 0.6;
    body.prims.push(
      cylinder(v3(0, (bottom + top) / 2, 0.1), p.hipHalf + 0.35, (top - bottom) / 2, p.torsoDepth + 0.55, {
        material: solid('bottom'),
        part: 'skirt',
      }),
    );
    rig.fixed.push(
      lapCover(body, rig, p.hipHalf + 0.35, thighRadius(body) + 0.55, 0.8, {
        material: (_point, _normal, local) => ({ key: 'bottom', shift: local.y > 0.86 ? -1 : 0 }),
        part: 'skirt',
      }),
    );
  }
  if (spec.top === 'longCoat') {
    const bottom = hipY - 1.8;
    const top = waistY + 1;
    const opening = (point: Vec3, normal: Vec3): { key: string; shift?: number } => {
      if (normal.z > 0.4 && Math.abs(point.x) < 1.3) return { key: 'bottom' };
      if (normal.z > 0.4 && Math.abs(point.x) < 1.9) return { key: 'top', shift: -1 };
      return { key: 'top' };
    };
    body.prims.push(
      cylinder(v3(0, (bottom + top) / 2, 0), p.hipHalf + 0.95, (top - bottom) / 2, p.torsoDepth + 0.95, {
        material: opening,
        part: 'coat',
      }),
    );
    rig.fixed.push(
      lapCover(body, rig, p.hipHalf + 0.95, thighRadius(body) + 0.85, 0.92, {
        material: (point, normal, local) => {
          const x = Math.abs(point.x);
          if (normal.y > 0.4 && x < 1.3) return { key: 'bottom' };
          if (normal.y > 0.4 && x < 1.9) return { key: 'top', shift: -1 };
          return { key: 'top', shift: local.y > 0.9 ? -1 : 0 };
        },
        part: 'coat',
      }),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Torso

function hasJacket(spec: CharacterSpec): boolean {
  return spec.top === 'suit' || spec.top === 'blazer' || spec.top === 'longCoat';
}

function torsoMaterial(body: Body): MaterialFn {
  const { spec, hipY, waistY, shoulderY } = body;
  const jacket = hasJacket(spec);
  const vTop = shoulderY + 0.4;
  const vBottom = shoulderY - 5.2;
  const minGap = spec.top === 'suit' ? 1.25 : 1.6;
  const openHalf = (y: number): number =>
    y >= vBottom ? minGap + ((y - vBottom) / (vTop - vBottom)) * (2.7 - minGap) : minGap;
  const beltLow = waistY - 0.75;
  const beltHigh = waistY + 0.25;
  const tieHalf = (y: number): number => (y < hipY + 4.2 ? 0.95 : 0.7);
  const tieBottom = hipY + 2.2;
  return (point, normal) => {
    const x = Math.abs(point.x);
    const front = normal.z > 0.3 && point.z > 0;
    const nearNeck = point.y > shoulderY - 1.0 && x < 2.3 && point.z > -1.2;
    if (jacket) {
      if (nearNeck && normal.y > 0.35) return { key: 'inner' };
      if (front) {
        const gap = openHalf(point.y);
        if (x < gap) {
          if (spec.top === 'suit' && x < tieHalf(point.y) && point.y > tieBottom) return { key: 'tie' };
          if (point.y > beltLow && point.y < beltHigh) return { key: x < 0.6 ? 'gold' : 'belt' };
          if (point.y < beltLow) return { key: 'bottom' };
          return { key: 'inner' };
        }
        if (x < gap + 0.75 && point.y > vBottom - 3) return { key: 'top', shift: -1 };
      }
      return { key: 'top' };
    }
    if (spec.top === 'shirt') {
      if (front && x < tieHalf(point.y) && point.y > waistY + 0.4) return { key: 'tie' };
      if (nearNeck && normal.y > 0.35) return { key: 'top', shift: 1 };
      if (front && x < 1.2 && point.y > shoulderY - 1.4) return { key: 'top', shift: -1 };
      return { key: 'top' };
    }
    const neckline = shoulderY - 2.6;
    if (front && point.y > neckline && x < (point.y - neckline) * 0.8) return { key: 'skin' };
    return { key: 'top' };
  };
}

function addTorso(body: Body): void {
  const { p, spec, hipY, waistY, chestY, shoulderY } = body;
  const material = torsoMaterial(body);
  const part = 'torso';
  const midBottom = waistY - 0.2;
  body.prims.push(
    ellipsoid(v3(0, chestY, 0), v3(p.shoulderHalf, 2.5, p.torsoDepth + 0.05), { material, part }),
    cylinder(v3(0, (midBottom + chestY) / 2, 0), p.chestHalf, (chestY - midBottom) / 2, p.torsoDepth, { material, part }),
  );
  if (hasJacket(spec)) {
    const hem = hipY - 1.3;
    body.prims.push(
      cylinder(v3(0, (hem + waistY) / 2, 0), p.lowerHalf, (waistY - hem) / 2, p.torsoDepth + 0.1, { material, part }),
    );
  } else {
    body.prims.push(
      cylinder(v3(0, waistY - 0.25, 0), p.chestHalf + 0.12, 0.5, p.torsoDepth + 0.12, {
        material: (point, normal) => ({ key: normal.z > 0.5 && Math.abs(point.x) < 0.7 ? 'gold' : 'belt' }),
        part,
      }),
    );
  }
  body.prims.push(
    capsule(v3(0, shoulderY - 1.5, -0.3), v3(0, shoulderY + 2.4, -0.1), p.neck, { material: solid('skin'), part: 'neck' }),
  );
}

// ---------------------------------------------------------------------------------------------
// Arms and accessories

interface ArmJoints {
  readonly shoulder: Vec3;
  readonly elbow: Vec3;
  readonly wrist: Vec3;
  readonly hand: Vec3;
  readonly upperDir: Vec3;
  readonly foreDir: Vec3;
}

function armJoints(body: Body, side: Side, swing: number, hold: HoldPose | undefined): ArmJoints {
  const { p } = body;
  const gamma = hold ? hold.gamma + swing * hold.swing : swing * 20 * DEG;
  const delta = hold ? hold.delta : 12 * DEG + Math.max(0, swing) * 16 * DEG;
  const spread = hold?.spread ?? 0.1;
  const inward = hold?.inward ?? 0;
  const shoulder = v3(side * p.armOffset, body.shoulderY - 1.4, -0.15);
  const upperDir = normalize(v3(side * spread, -Math.cos(gamma), Math.sin(gamma)));
  const elbow = add(shoulder, scale(upperDir, UPPER_ARM));
  const foreDir = normalize(v3(side * (spread * 0.5 - inward), -Math.cos(gamma + delta), Math.sin(gamma + delta)));
  const wrist = add(elbow, scale(foreDir, FOREARM));
  const hand = add(wrist, scale(foreDir, p.hand * 0.6));
  return { shoulder, elbow, wrist, hand, upperDir, foreDir };
}

/** Accessories whose standing hold also works seated, so that arm never moves to the lap. */
const SEATED_HOLDS: ReadonlySet<Accessory> = new Set(['folder', 'jacketOverShoulder']);

/** Seated items that leave the hand once the hands are mostly down: on the lap or the floor. */
function setDown(body: Body): boolean {
  return (body.sit?.pose.hands ?? 0) >= 0.5 && (body.spec.accessory === 'laptop' || body.spec.accessory === 'briefcase');
}

/** Closed laptop lying across the lap. */
function lapLaptop(body: Body, rig: SeatedRig): { center: Vec3; basis: Basis } {
  const lap = lapAt(body, rig, 0.55);
  return { center: add(lap.point, scale(lap.up, 0.5)), basis: basisAlong(lap.up, lap.forward) };
}

/** Where a seated hand rests, in character space: on its thigh, or on the laptop. */
function handRest(body: Body, rig: SeatedRig, side: Side): Vec3 {
  const { p } = body;
  if (side === RIGHT && setDown(body) && body.spec.accessory === 'laptop') {
    const { center, basis } = lapLaptop(body, rig);
    return add(center, add(scale(basis.ay, 0.45 + p.hand * 0.7), v3(RIGHT * 1.5, 0, 0)));
  }
  const lap = lapAt(body, rig, 0.62);
  return add(lap.point, add(scale(lap.up, p.hand * 0.75), v3(side * (p.legGap + 0.7), 0, 0)));
}

/** Blends the standing arm toward a hand resting on the lap; the elbow bends back and out. */
function seatedArmJoints(body: Body, rig: SeatedRig, side: Side, hold: HoldPose | undefined): ArmJoints {
  const standing = armJoints(body, side, 0, hold);
  const blend = rig.pose.hands;
  if (blend === 0 || (hold && SEATED_HOLDS.has(body.spec.accessory))) return standing;
  const { shoulder } = standing;
  const rest = rig.toBody(handRest(body, rig, side));
  const target = add(standing.wrist, scale(sub(rest, standing.wrist), blend));
  const elbow = solveTwoBone(shoulder, target, UPPER_ARM, FOREARM, v3(side * 0.8, -0.2, -1));
  const upperDir = normalize(sub(elbow, shoulder));
  const foreDir = normalize(sub(target, elbow));
  const wrist = add(elbow, scale(foreDir, FOREARM));
  return { shoulder, elbow, wrist, hand: add(wrist, scale(foreDir, body.p.hand * 0.6)), upperDir, foreDir };
}

function addArm(body: Body, side: Side, swing: number, hold: HoldPose | undefined): void {
  const { p, spec } = body;
  const j = body.sit ? seatedArmJoints(body, body.sit, side, hold) : armJoints(body, side, swing, hold);
  const part = side === LEFT ? 'armL' : 'armR';
  const sleeve = solid('top');
  body.prims.push(capsule(j.shoulder, j.elbow, p.sleeve, { material: sleeve, part }));
  const cuffStart = sub(j.wrist, scale(j.foreDir, 0.9));
  switch (spec.top) {
    case 'suit':
    case 'longCoat':
      body.prims.push(capsule(j.elbow, cuffStart, p.sleeve * 0.95, { material: sleeve, part }));
      body.prims.push(
        capsule(cuffStart, j.wrist, p.sleeve * 0.8, { material: solid(spec.top === 'suit' ? 'inner' : 'top', spec.top === 'suit' ? 0 : -1), part }),
      );
      break;
    case 'blazer':
      body.prims.push(capsule(j.elbow, cuffStart, p.sleeve * 0.95, { material: sleeve, part }));
      body.prims.push(capsule(cuffStart, j.wrist, p.sleeve * 0.7, { material: solid('skin'), part }));
      break;
    case 'shirt':
      body.prims.push(capsule(j.elbow, j.wrist, p.sleeve * 0.78, { material: solid('skin'), part }));
      body.prims.push(
        capsule(sub(j.elbow, scale(j.upperDir, 0.7)), add(j.elbow, scale(j.foreDir, 0.6)), p.sleeve * 1.1, {
          material: solid('top', -1),
          part,
        }),
      );
      break;
    case 'blouse':
      body.prims.push(capsule(j.elbow, cuffStart, p.sleeve * 0.92, { material: sleeve, part }));
      body.prims.push(capsule(cuffStart, j.wrist, p.sleeve * 0.95, { material: solid('top', 1), part }));
      break;
  }
  body.prims.push(sphere(j.hand, p.hand, { material: solid('skin'), part }));
  if (hold) addAccessory(body, j);
}

function addAccessory(body: Body, j: ArmJoints): void {
  const { p, spec, hipY, shoulderY } = body;
  const part = 'acc';
  const prims = body.prims;
  switch (spec.accessory) {
    case 'coffee': {
      const cup = add(j.hand, v3(0, 1.5, 0.2));
      prims.push(
        cylinder(cup, 1.2, 1.8, 1.2, {
          material: (_point, _normal, local) => ({ key: local.y > -0.35 && local.y < 0.35 ? 'accDetail' : 'acc' }),
          part,
        }),
        cylinder(add(cup, v3(0, 1.95, 0)), 1.35, 0.35, 1.35, { material: solid('white'), part }),
      );
      break;
    }
    case 'tablet': {
      const basis = composeBasis(turn(0.2), pitchDown(-2.35));
      prims.push(
        box(add(j.hand, v3(0.5, 1.4, 0.6)), v3(2.2, 2.9, 0.3), {
          basis,
          material: (_point, _normal, local) => {
            const screen = local.z > 0.95 && Math.abs(local.x) < 0.8 && Math.abs(local.y) < 0.84;
            return { key: screen ? 'screen' : 'acc' };
          },
          part,
        }),
      );
      break;
    }
    case 'folder': {
      const basis = composeBasis(turn(0.35), pitchDown(0.12));
      prims.push(
        box(v3(RIGHT * 1.9, shoulderY - 6.1, p.torsoDepth + 0.9), v3(2.1, 2.9, 0.38), {
          basis,
          material: (_point, _normal, local) => ({ key: local.y > 0.8 && Math.abs(local.z) < 0.9 ? 'accDetail' : 'acc' }),
          part,
        }),
      );
      break;
    }
    case 'laptop': {
      if (body.sit && setDown(body)) {
        const { center, basis } = lapLaptop(body, body.sit);
        body.sit.fixed.push(
          box(center, v3(2.9, 0.45, 2.3), {
            basis,
            material: (_point, _normal, local) => ({ key: local.z > 0.9 && Math.abs(local.y) < 0.4 ? 'accDetail' : 'acc' }),
            part,
          }),
        );
        break;
      }
      prims.push(
        box(add(j.hand, v3(RIGHT * 1.0, -1.4, 0.6)), v3(0.5, 2.9, 3.9), {
          material: (_point, _normal, local) => ({
            key: Math.abs(local.y) < 0.22 && Math.abs(local.z) < 0.14 ? 'accDetail' : 'acc',
          }),
          part,
        }),
      );
      break;
    }
    case 'briefcase': {
      // Seated, the case stands on the floor beside the right foot, handle up.
      const grip = body.sit && setDown(body) ? v3(RIGHT * (p.legGap + shinRadius(body) + 1.4), 5.7, 1.2) : j.hand;
      const target = body.sit && setDown(body) ? body.sit.fixed : prims;
      target.push(
        box(add(grip, v3(RIGHT * 0.3, -3.2, 0)), v3(1.0, 2.5, 3.5), {
          material: (_point, _normal, local) => {
            if (Math.abs(local.x) > 0.9 && Math.abs(local.z) < 0.16 && local.y > 0.2 && local.y < 0.7) return { key: 'accDetail' };
            if (Math.abs(local.y - 0.55) < 0.09) return { key: 'acc', shift: -1 };
            return { key: 'acc' };
          },
          part,
        }),
        capsule(add(grip, v3(0, -0.5, -1.1)), add(grip, v3(0, -0.5, 1.1)), 0.45, { material: solid('acc', -1), part }),
      );
      break;
    }
    case 'handbag': {
      const bag = v3(RIGHT * (p.hipHalf + 1.6), hipY + 1.0, -1.3);
      prims.push(
        box(bag, v3(1.1, 2.0, 2.5), {
          basis: turn(0.1),
          material: (_point, _normal, local) => {
            if (Math.abs(local.z) < 0.16 && local.y > 0.25 && local.y < 0.5 && Math.abs(local.x) > 0.9) return { key: 'accDetail' };
            return { key: 'acc', shift: local.y > 0.45 ? -1 : 0 };
          },
          part,
        }),
        capsule(v3(RIGHT * (p.shoulderHalf - 1.7), shoulderY + 0.3, -0.2), add(bag, v3(0, 2.0, 0)), 0.5, {
          material: solid('acc', -1),
          part,
        }),
      );
      break;
    }
    case 'jacketOverShoulder': {
      const fold = v3(RIGHT * (p.shoulderHalf - 2.0), shoulderY + 0.35, -0.9);
      prims.push(
        ellipsoid(v3(RIGHT * 2.6, shoulderY - 4.9, -(p.torsoDepth + 1.05)), v3(3.0, 6.0, 1.15), {
          basis: roll(RIGHT * 0.12),
          material: (_point, _normal, local) => ({ key: 'acc', shift: Math.abs(local.x) < 0.08 ? -1 : 0 }),
          part,
        }),
        ellipsoid(fold, v3(1.9, 1.05, 2.8), { material: solid('acc'), part }),
        capsule(j.hand, fold, 0.75, { material: solid('acc', -1), part }),
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Head, face and hair

/** Point on the front of an ellipsoid at local (x, y), with its outward normal. */
function frontPoint(center: Vec3, radii: Vec3, x: number, y: number): { point: Vec3; normal: Vec3 } {
  const u = x / radii.x;
  const w = y / radii.y;
  const z = Math.sqrt(Math.max(0, 1 - u * u - w * w));
  return {
    point: add(center, v3(x, y, radii.z * z)),
    normal: normalize(v3(u / radii.x, w / radii.y, z / radii.z)),
  };
}

function addHead(body: Body): void {
  const { spec, headCenter: h, headRadii: r } = body;
  const part = 'head';
  const skin = solid('skin');
  const jawCenter = add(h, v3(0, -2.6, 0.9));
  const jawRadii = v3(3.1, 2.4, 3.3);
  body.prims.push(
    ellipsoid(h, r, { material: skin, part }),
    ellipsoid(jawCenter, jawRadii, { material: skin, part }),
    ellipsoid(add(h, v3(0, -1.0, r.z - 0.35)), v3(0.55, 0.85, 0.9), { material: skin, part }),
    ellipsoid(add(h, v3(r.x - 0.15, -0.7, -0.4)), v3(0.75, 1.25, 0.95), { material: skin, part }),
    ellipsoid(add(h, v3(-(r.x - 0.15), -0.7, -0.4)), v3(0.75, 1.25, 0.95), { material: skin, part }),
  );

  const lashes = spec.build === 'slim';
  for (const side of [LEFT, RIGHT] as const) {
    const eye = frontPoint(h, r, side * 1.75, -0.8);
    body.decals.push({
      anchor: eye.point,
      normal: eye.normal,
      minFacing: 0.15,
      draw(ctx) {
        ctx.plot(0, 0, 'ink', 'base');
        ctx.plot(0, 1, 'ink', 'base');
        if (lashes && ctx.facing > 0.35) ctx.plot(ctx.screenSide, 0, 'ink', 'base');
        if (spec.glasses) {
          for (const dx of [-1, 0, 1]) ctx.plot(dx, -1, 'ink', 'base');
          ctx.plot(-ctx.screenSide, 0, 'ink', 'base');
          if (ctx.facing > 0.45) ctx.plot(ctx.screenSide, 0, 'lens', 'base');
        }
      },
    });
    if (spec.earrings) {
      body.decals.push({
        anchor: add(h, v3(side * (r.x - 0.1), -2.1, -0.4)),
        normal: normalize(v3(side, -0.2, 0.25)),
        minFacing: -0.05,
        overflow: true,
        draw(ctx) {
          ctx.plot(0, 0, 'gold', 'light');
          ctx.plot(0, 1, 'gold', 'base');
        },
      });
    }
  }
  if (spec.glasses) {
    // Both frame tops meet between the eyes and read as a unibrow; keep one skin pixel there.
    const bridge = frontPoint(h, r, 0, -0.8);
    body.decals.push({
      anchor: bridge.point,
      normal: bridge.normal,
      minFacing: 0.5,
      draw(ctx) {
        ctx.plot(0, -1, 'skin', 'base');
      },
    });
  }
  const mouth = frontPoint(jawCenter, jawRadii, 0, -0.4);
  body.decals.push({
    anchor: mouth.point,
    normal: mouth.normal,
    minFacing: 0.3,
    draw(ctx) {
      ctx.plot(0, 0, 'skin', 'deep');
    },
  });
}

interface HairKit {
  readonly body: Body;
  readonly capCenter: Vec3;
  readonly capRadii: Vec3;
  shell(clip: (q: Vec3) => boolean, grow?: Vec3, center?: Vec3): void;
  tuft(position: Vec3, axis: Vec3, len: number, thick: number): void;
  bump(center: Vec3, radius: number): void;
}

/** Fibonacci sphere: evenly spread unit vectors. */
function spherePoints(count: number): Vec3[] {
  const points: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    points.push(v3(Math.cos(golden * i) * radius, y, Math.sin(golden * i) * radius));
  }
  return points;
}

const shortClip = (q: Vec3): boolean =>
  !(q.z > 0.05 && q.y < 0.3) && q.y > -0.5 && !(q.y < 0.05 && q.z > -0.45 && Math.abs(q.x) > 0.5);

const longClip = (q: Vec3): boolean => !(q.z > 0 && q.y < 0.3 && Math.abs(q.x) < 0.64);

const bobClip = (q: Vec3): boolean => !(q.z > 0.05 && q.y < 0.25 && Math.abs(q.x) < 0.66) && q.y > -0.8;

function hairKit(body: Body): HairKit {
  const capCenter = add(body.headCenter, v3(0, 0.35, -0.15));
  const capRadii = add(body.headRadii, v3(0.5, 0.5, 0.5));
  const material = solid('hair');
  const part = 'hair';
  return {
    body,
    capCenter,
    capRadii,
    shell(clip, grow = v3(0, 0, 0), center = capCenter) {
      body.prims.push(ellipsoid(center, add(capRadii, grow), { material, part, clip }));
    },
    tuft(position, axis, len, thick) {
      const base = add(capCenter, mul(normalize(position), capRadii));
      const direction = normalize(axis);
      body.prims.push(
        ellipsoid(add(base, scale(direction, len * 0.35)), v3(thick, len, thick * 0.9), {
          basis: basisAlong(direction, normalize(position)),
          material,
          part,
        }),
      );
    },
    bump(center, radius) {
      body.prims.push(sphere(center, radius, { material, part }));
    },
  };
}

function addFringe(kit: HairKit): void {
  kit.tuft(v3(-0.45, 0.62, 0.72), v3(-0.45, -0.75, 0.45), 1.3, 1.05);
  kit.tuft(v3(0.08, 0.6, 0.8), v3(0.05, -0.85, 0.5), 1.6, 1.1);
  kit.tuft(v3(0.55, 0.58, 0.68), v3(0.5, -0.75, 0.4), 1.25, 1.0);
}

/** Strands hanging in front of the ears, framing the face. */
function addSideLocks(kit: HairKit, length: number): void {
  for (const side of [LEFT, RIGHT] as const) {
    kit.tuft(v3(side * 0.88, 0.25, 0.42), v3(side * 0.12, -1, 0.15), length, 0.85);
  }
}

function addMessy(kit: HairKit): void {
  kit.shell(shortClip);
  addFringe(kit);
  kit.tuft(v3(-0.3, 0.9, 0.2), v3(-0.4, 0.8, -0.3), 1.8, 1.3);
  kit.tuft(v3(0.35, 0.92, -0.2), v3(0.45, 0.8, -0.4), 1.7, 1.25);
  kit.tuft(v3(0, 0.7, -0.7), v3(0, 0.4, -0.9), 1.8, 1.3);
  kit.tuft(v3(-0.8, 0.35, -0.4), v3(-0.9, 0.1, -0.3), 1.5, 1.1);
  kit.tuft(v3(0.8, 0.35, -0.4), v3(0.9, 0.1, -0.3), 1.5, 1.1);
}

function addSpiky(kit: HairKit): void {
  kit.shell(shortClip);
  kit.tuft(v3(-0.4, 0.5, 0.8), v3(-0.3, 0.1, 1), 2.0, 1.1);
  kit.tuft(v3(0.15, 0.55, 0.82), v3(0.1, 0.25, 1), 2.1, 1.1);
  kit.tuft(v3(0.6, 0.45, 0.72), v3(0.5, 0.05, 0.9), 1.9, 1.0);
  const spikes: readonly [Vec3, Vec3][] = [
    [v3(0, 1, 0.3), v3(0.05, 1, 0.35)],
    [v3(0.55, 0.8, 0.1), v3(0.6, 0.8, 0)],
    [v3(-0.55, 0.8, 0.1), v3(-0.6, 0.8, 0)],
    [v3(0.35, 0.7, -0.6), v3(0.35, 0.6, -0.75)],
    [v3(-0.35, 0.7, -0.6), v3(-0.35, 0.6, -0.75)],
    [v3(0.85, 0.4, -0.25), v3(0.95, 0.3, -0.2)],
    [v3(-0.85, 0.4, -0.25), v3(-0.95, 0.3, -0.2)],
    [v3(0, 0.3, -0.95), v3(0, 0.1, -1)],
  ];
  for (const [position, axis] of spikes) kit.tuft(position, axis, 2.5, 1.1);
}

function addShortCurly(kit: HairKit): void {
  kit.shell(shortClip, v3(-0.2, -0.15, -0.2));
  for (const q of spherePoints(46)) {
    if (!shortClip(q) || q.y < -0.35) continue;
    kit.bump(add(kit.capCenter, mul(q, sub(kit.capRadii, v3(0.25, 0.2, 0.25)))), 1.1);
  }
}

function addBigCurly(kit: HairKit): void {
  const center = add(kit.capCenter, v3(0, 0.2, -0.9));
  const grow = v3(1.6, 0.9, 1.9);
  const radii = add(kit.capRadii, grow);
  const clip = (q: Vec3): boolean => !(q.z > -0.15 && q.y < 0.42 && Math.abs(q.x) < 0.74) && q.y > -0.75;
  kit.shell(clip, grow, center);
  for (const q of spherePoints(60)) {
    if (!clip(q)) continue;
    kit.bump(add(center, mul(q, radii)), 1.7);
  }
}

function addLongStraight(kit: HairKit): void {
  const { headCenter: h, headRadii: r } = kit.body;
  kit.shell(longClip);
  addFringe(kit);
  addSideLocks(kit, 2.8);
  kit.body.prims.push(
    ellipsoid(add(h, v3(0, -5.6, -1.9)), v3(r.x + 0.9, 7.8, 2.3), { material: solid('hair'), part: 'hair' }),
  );
}

function addBob(kit: HairKit): void {
  kit.shell(bobClip, v3(0.45, 0.1, 0.35));
  addFringe(kit);
  addSideLocks(kit, 2.2);
  kit.tuft(v3(-0.6, 0.35, 0.72), v3(-0.5, -0.8, 0.3), 2.2, 1.3);
  for (const q of [v3(0.85, -0.55, -0.2), v3(-0.85, -0.55, -0.2), v3(0.45, -0.6, -0.75), v3(-0.45, -0.6, -0.75), v3(0, -0.6, -0.95)]) {
    kit.tuft(q, v3(q.x * 1.4, -0.5, q.z * 1.4), 1.6, 1.25);
  }
}

function addPonytail(kit: HairKit, wavy: boolean): void {
  const { body } = kit;
  const { headCenter: h, headRadii: r, pose } = body;
  kit.shell(shortClip);
  addFringe(kit);
  addSideLocks(kit, 2.3);
  const anchor = add(h, v3(0, r.y * 0.4, -(r.z + 0.45)));
  body.prims.push(sphere(add(anchor, v3(0, 0, 0.1)), 1.25, { material: solid('scrunchie'), part: 'hair' }));
  const sway = pose.arms.left * 0.7;
  const lift = pose.bob * 0.4;
  const thick = wavy ? 1.25 : 1;
  const segments: readonly [Vec3, Vec3][] = [
    [v3(0, 0.1, -1.1), v3(1.55, 1.55, 1.6)],
    [v3(sway * 0.3, -1.8 + lift, -2.5), v3(1.7, 2.6, 1.7)],
    [v3(sway * 0.6, -5.2 + lift, -2.4), v3(1.55, 2.8, 1.45)],
    [v3(sway * 0.9, -8.4 + lift, -1.8), v3(1.15, 2.4, 1.05)],
  ];
  const material = solid('hair');
  for (const [offset, radii] of segments) {
    const center = add(anchor, offset);
    body.prims.push(ellipsoid(center, v3(radii.x * thick, radii.y, radii.z * thick), { material, part: 'hair' }));
    if (wavy) {
      for (const side of [LEFT, RIGHT] as const) {
        body.prims.push(sphere(add(center, v3(side * radii.x * 0.9, -0.6, 0)), 1.1, { material, part: 'hair' }));
      }
    }
  }
  if (wavy) {
    body.prims.push(
      ellipsoid(add(anchor, v3(sway * 1.1, -11.2 + lift, -1.3)), v3(1.0, 1.8, 0.95), { material, part: 'hair' }),
    );
  }
}

const HAIR_BUILDERS: Readonly<Record<HairStyle, (kit: HairKit) => void>> = {
  messy: addMessy,
  spiky: addSpiky,
  shortCurly: addShortCurly,
  bigCurly: addBigCurly,
  longStraight: addLongStraight,
  ponytail: (kit) => addPonytail(kit, false),
  wavyPonytail: (kit) => addPonytail(kit, true),
  bob: addBob,
};

function addHair(body: Body): void {
  HAIR_BUILDERS[body.spec.hair](hairKit(body));
}

// ---------------------------------------------------------------------------------------------
// Lanyard and badge

function torsoFrontZ(body: Body, x: number, y: number): number {
  const { p, chestY } = body;
  if (y > chestY) {
    const w = (y - chestY) / 2.5;
    const u = x / p.shoulderHalf;
    return (p.torsoDepth + 0.05) * Math.sqrt(Math.max(0, 1 - w * w - u * u));
  }
  const u = x / p.chestHalf;
  return p.torsoDepth * Math.sqrt(Math.max(0, 1 - u * u));
}

function addBadge(body: Body): void {
  const { shoulderY } = body;
  const badgeX = 1.5;
  const badgeY = shoulderY - 6.2;
  const forward = v3(0, 0.1, 1);
  body.decals.push({
    anchor: v3(badgeX, badgeY, torsoFrontZ(body, badgeX, badgeY) + 0.1),
    normal: normalize(forward),
    minFacing: 0.25,
    draw(ctx) {
      const width = ctx.facing > 0.72 ? 2 : 1;
      for (let dy = 0; dy < 3; dy += 1) {
        for (let dx = 0; dx < width; dx += 1) ctx.plot(dx, dy, dy === 1 && dx === 0 ? 'photo' : 'white', 'base');
      }
    },
  });
  const strands: readonly [Vec3, Vec3][] = [
    [v3(1.7, shoulderY - 0.4, 0), v3(badgeX + 0.6, badgeY + 0.6, 0)],
    [v3(-1.7, shoulderY - 0.4, 0), v3(badgeX - 0.3, badgeY + 0.6, 0)],
  ];
  for (const [from, to] of strands) {
    const steps = 9;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      body.decals.push({
        anchor: v3(x, y, torsoFrontZ(body, x, y) + 0.1),
        normal: normalize(v3(0, 0.25, 1)),
        minFacing: 0.2,
        draw(ctx) {
          ctx.plot(0, 0, 'lanyard', 'base');
        },
      });
    }
  }
}
