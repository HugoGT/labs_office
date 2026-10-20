/**
 * Tiny analytic ray casting kit used to draw characters: vectors, rotation bases and four
 * primitive shapes (ellipsoid, box, capped cylinder, capsule). All coordinates are in
 * character space: x points to the character's left, y up, z forward (where the face looks).
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, s: number): Vec3 {
  return v3(a.x * s, a.y * s, a.z * s);
}

export function mul(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x * b.x, a.y * b.y, a.z * b.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? a : scale(a, 1 / len);
}

/** Orthonormal basis: the local axes of a shape expressed in character space. */
export interface Basis {
  readonly ax: Vec3;
  readonly ay: Vec3;
  readonly az: Vec3;
}

export const IDENTITY: Basis = { ax: v3(1, 0, 0), ay: v3(0, 1, 0), az: v3(0, 0, 1) };

export function applyBasis(basis: Basis, local: Vec3): Vec3 {
  return add(add(scale(basis.ax, local.x), scale(basis.ay, local.y)), scale(basis.az, local.z));
}

export function composeBasis(outer: Basis, inner: Basis): Basis {
  return { ax: applyBasis(outer, inner.ax), ay: applyBasis(outer, inner.ay), az: applyBasis(outer, inner.az) };
}

/** Rotation about x. Positive angles tip the forward axis downward (toes down, head nods). */
export function pitchDown(angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { ax: v3(1, 0, 0), ay: v3(0, c, s), az: v3(0, -s, c) };
}

/** Rotation about y. Positive angles turn the forward axis toward +x. */
export function turn(angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { ax: v3(c, 0, -s), ay: v3(0, 1, 0), az: v3(s, 0, c) };
}

/** Rotation about z. Positive angles tip the up axis toward -x. */
export function roll(angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { ax: v3(c, s, 0), ay: v3(-s, c, 0), az: v3(0, 0, 1) };
}

/** Basis whose local y axis points along `up`, keeping local z as close to `forward` as possible. */
export function basisAlong(up: Vec3, forward: Vec3 = v3(0, 0, 1)): Basis {
  const ay = normalize(up);
  let ax = cross(ay, forward);
  if (length(ax) < 1e-6) ax = cross(ay, v3(1, 0, 0));
  ax = normalize(ax);
  const az = cross(ax, ay);
  return { ax, ay, az };
}

export interface MaterialSample {
  readonly key: string;
  /** Tone offset: -1 one step darker, +1 one step lighter. */
  readonly shift?: number;
}

export type MaterialFn = (point: Vec3, normal: Vec3, local: Vec3) => MaterialSample;

export function solid(key: string, shift = 0): MaterialFn {
  const sample: MaterialSample = { key, shift };
  return () => sample;
}

export interface Hit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  lx: number;
  ly: number;
  lz: number;
}

export function emptyHit(): Hit {
  return { t: Number.POSITIVE_INFINITY, nx: 0, ny: 0, nz: 0, lx: 0, ly: 0, lz: 0 };
}

export interface Primitive {
  readonly center: Vec3;
  readonly radius: number;
  readonly material: MaterialFn;
  /** Body part name; neighbors from different parts get a contour line. */
  readonly part: string;
  intersect(o: Vec3, d: Vec3, out: Hit): boolean;
}

const EPS = 1e-6;

interface ShapeOptions {
  readonly material: MaterialFn;
  readonly part: string;
  readonly basis?: Basis;
}

function toLocal(basis: Basis, v: Vec3): Vec3 {
  return v3(dot(v, basis.ax), dot(v, basis.ay), dot(v, basis.az));
}

function writeNormal(out: Hit, basis: Basis, local: Vec3, flip: boolean): void {
  const n = normalize(applyBasis(basis, local));
  const s = flip ? -1 : 1;
  out.nx = n.x * s;
  out.ny = n.y * s;
  out.nz = n.z * s;
}

/**
 * Ellipsoid. `clip` receives the hit point in unit-sphere coordinates and can reject parts of
 * the surface; the inner side is then used, which turns an ellipsoid into an open shell (hair).
 */
export function ellipsoid(
  center: Vec3,
  radii: Vec3,
  options: ShapeOptions & { readonly clip?: (q: Vec3) => boolean },
): Primitive {
  const basis = options.basis ?? IDENTITY;
  const clip = options.clip;
  return {
    center,
    radius: Math.max(radii.x, radii.y, radii.z),
    material: options.material,
    part: options.part,
    intersect(o, d, out) {
      const lo = toLocal(basis, sub(o, center));
      const ld = toLocal(basis, d);
      const ox = lo.x / radii.x;
      const oy = lo.y / radii.y;
      const oz = lo.z / radii.z;
      const dx = ld.x / radii.x;
      const dy = ld.y / radii.y;
      const dz = ld.z / radii.z;
      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (ox * dx + oy * dy + oz * dz);
      const c = ox * ox + oy * oy + oz * oz - 1;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return false;
      const root = Math.sqrt(disc);
      for (const [t, inner] of [
        [(-b - root) / (2 * a), false],
        [(-b + root) / (2 * a), true],
      ] as const) {
        if (t <= EPS || t >= out.t) continue;
        const q = v3(ox + t * dx, oy + t * dy, oz + t * dz);
        if (clip && !clip(q)) continue;
        out.t = t;
        writeNormal(out, basis, v3(q.x / radii.x, q.y / radii.y, q.z / radii.z), inner);
        out.lx = q.x;
        out.ly = q.y;
        out.lz = q.z;
        return true;
      }
      return false;
    },
  };
}

export function sphere(center: Vec3, radius: number, options: ShapeOptions): Primitive {
  return ellipsoid(center, v3(radius, radius, radius), options);
}

/** Oriented box with half extents `half`. Local hit coordinates are normalized to [-1, 1]. */
export function box(center: Vec3, half: Vec3, options: ShapeOptions): Primitive {
  const basis = options.basis ?? IDENTITY;
  const halves = [half.x, half.y, half.z];
  return {
    center,
    radius: length(half),
    material: options.material,
    part: options.part,
    intersect(o, d, out) {
      const lo = toLocal(basis, sub(o, center));
      const ld = toLocal(basis, d);
      const os = [lo.x, lo.y, lo.z];
      const ds = [ld.x, ld.y, ld.z];
      let tMin = Number.NEGATIVE_INFINITY;
      let tMax = Number.POSITIVE_INFINITY;
      let axis = 0;
      let sign = 1;
      for (let i = 0; i < 3; i += 1) {
        const oi = os[i] as number;
        const di = ds[i] as number;
        const hi = halves[i] as number;
        if (Math.abs(di) < 1e-12) {
          if (Math.abs(oi) > hi) return false;
          continue;
        }
        let t1 = (-hi - oi) / di;
        let t2 = (hi - oi) / di;
        let s = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          s = 1;
        }
        if (t1 > tMin) {
          tMin = t1;
          axis = i;
          sign = s;
        }
        tMax = Math.min(tMax, t2);
      }
      if (tMax < tMin || tMin <= EPS || tMin >= out.t) return false;
      out.t = tMin;
      const n = [0, 0, 0];
      n[axis] = sign;
      writeNormal(out, basis, v3(n[0] as number, n[1] as number, n[2] as number), false);
      out.lx = (lo.x + tMin * ld.x) / half.x;
      out.ly = (lo.y + tMin * ld.y) / half.y;
      out.lz = (lo.z + tMin * ld.z) / half.z;
      return true;
    },
  };
}

/** Capped elliptic cylinder along local y. Local hit coordinates are normalized to [-1, 1]. */
export function cylinder(center: Vec3, radiusX: number, halfHeight: number, radiusZ: number, options: ShapeOptions): Primitive {
  const basis = options.basis ?? IDENTITY;
  return {
    center,
    radius: Math.hypot(Math.max(radiusX, radiusZ), halfHeight),
    material: options.material,
    part: options.part,
    intersect(o, d, out) {
      const lo = toLocal(basis, sub(o, center));
      const ld = toLocal(basis, d);
      const ox = lo.x / radiusX;
      const oy = lo.y / halfHeight;
      const oz = lo.z / radiusZ;
      const dx = ld.x / radiusX;
      const dy = ld.y / halfHeight;
      const dz = ld.z / radiusZ;
      let best = out.t;
      let normal: Vec3 | undefined;
      let local: Vec3 | undefined;
      const a = dx * dx + dz * dz;
      if (a > 1e-12) {
        const b = 2 * (ox * dx + oz * dz);
        const c = ox * ox + oz * oz - 1;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const root = Math.sqrt(disc);
          for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
            if (t <= EPS || t >= best) continue;
            const y = oy + t * dy;
            if (Math.abs(y) > 1) continue;
            const qx = ox + t * dx;
            const qz = oz + t * dz;
            best = t;
            normal = v3(qx / radiusX, 0, qz / radiusZ);
            local = v3(qx, y, qz);
            break;
          }
        }
      }
      if (Math.abs(dy) > 1e-12) {
        for (const cap of [-1, 1]) {
          const t = (cap - oy) / dy;
          if (t <= EPS || t >= best) continue;
          const qx = ox + t * dx;
          const qz = oz + t * dz;
          if (qx * qx + qz * qz > 1) continue;
          best = t;
          normal = v3(0, cap, 0);
          local = v3(qx, cap, qz);
        }
      }
      if (!normal || !local) return false;
      out.t = best;
      writeNormal(out, basis, normal, false);
      out.lx = local.x;
      out.ly = local.y;
      out.lz = local.z;
      return true;
    },
  };
}

/** Capsule between `a` and `b`. Local x of the hit is the position along the segment in [0, 1]. */
export function capsule(a: Vec3, b: Vec3, radius: number, options: ShapeOptions): Primitive {
  const ba = sub(b, a);
  const baba = dot(ba, ba);
  return {
    center: scale(add(a, b), 0.5),
    radius: Math.sqrt(baba) / 2 + radius,
    material: options.material,
    part: options.part,
    intersect(o, d, out) {
      const oa = sub(o, a);
      const bard = dot(ba, d);
      const baoa = dot(ba, oa);
      const rdoa = dot(d, oa);
      const oaoa = dot(oa, oa);
      let t = -1;
      const qa = baba - bard * bard;
      if (qa > 1e-9) {
        const qb = baba * rdoa - baoa * bard;
        const qc = baba * oaoa - baoa * baoa - radius * radius * baba;
        const h = qb * qb - qa * qc;
        if (h < 0) return false;
        const tBody = (-qb - Math.sqrt(h)) / qa;
        const y = baoa + tBody * bard;
        if (y > 0 && y < baba) t = tBody;
      }
      if (t < 0) {
        for (const end of [a, b]) {
          const oc = sub(o, end);
          const cb = dot(d, oc);
          const cc = dot(oc, oc) - radius * radius;
          const h = cb * cb - cc;
          if (h <= 0) continue;
          const tc = -cb - Math.sqrt(h);
          if (tc > EPS && (t < 0 || tc < t)) t = tc;
        }
      }
      if (t <= EPS || t >= out.t) return false;
      const p = add(o, scale(d, t));
      const along = Math.min(1, Math.max(0, dot(sub(p, a), ba) / baba));
      const n = normalize(sub(p, add(a, scale(ba, along))));
      out.t = t;
      out.nx = n.x;
      out.ny = n.y;
      out.nz = n.z;
      out.lx = along;
      out.ly = 0;
      out.lz = 0;
      return true;
    },
  };
}

/**
 * The same shape moved rigidly: `world = basis * local + offset`. Rays are taken into the
 * shape's own space and normals back out, and the material still sees the untransformed point
 * and normal, so part builders can keep working in their own frame (a torso leaning forward).
 */
export function transformed(inner: Primitive, basis: Basis, offset: Vec3): Primitive {
  const toInner = (p: Vec3): Vec3 => toLocal(basis, sub(p, offset));
  return {
    center: add(applyBasis(basis, inner.center), offset),
    radius: inner.radius,
    part: inner.part,
    material: (point, normal, local) => inner.material(toInner(point), toLocal(basis, normal), local),
    intersect(o, d, out) {
      if (!inner.intersect(toInner(o), toLocal(basis, d), out)) return false;
      const n = applyBasis(basis, v3(out.nx, out.ny, out.nz));
      out.nx = n.x;
      out.ny = n.y;
      out.nz = n.z;
      return true;
    },
  };
}

/**
 * Two-bone inverse kinematics: the middle joint (knee, elbow) of a chain from `root` toward
 * `target`, bending toward `pole`. A target out of reach straightens the chain toward it.
 */
export function solveTwoBone(root: Vec3, target: Vec3, first: number, second: number, pole: Vec3): Vec3 {
  const toTarget = sub(target, root);
  const distance = Math.min(first + second, Math.max(Math.abs(first - second) + EPS, length(toTarget)));
  const along = normalize(toTarget);
  const a = (first * first - second * second + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0, first * first - a * a));
  const bend = normalize(sub(pole, scale(along, dot(pole, along))));
  return add(root, add(scale(along, a), scale(bend, h)));
}
