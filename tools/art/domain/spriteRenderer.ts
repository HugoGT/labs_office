/**
 * Renders a rigged Scene into one pixel-art frame:
 * 1. one orthographic ray per pixel against the analytic shapes,
 * 2. cel shading into a hue-shifted ramp (plus cast shadows from a second ray),
 * 3. contour lines where a nearer part overlaps a farther one,
 * 4. crisp decals (eyes, badge, lanyard...) stamped where their anchor is visible,
 * 5. a dark outline around the silhouette and a soft contact shadow under the feet.
 */
import { CAMERA_PITCH, LIGHT_DIRECTION, WALK_FRAME, type FrameGeometry } from './camera.ts';
import { hexToRgba, mixRgba, TONES, type Ramp, type Tone } from './color.ts';
import { add, dot, emptyHit, scale, sub, v3, type Primitive, type Vec3 } from './geometry.ts';
import { PixelBuffer, rgba } from './pixelBuffer.ts';
import type { MaterialKey, Scene } from './rig.ts';

const FAR = 200;
const CONTOUR_DEPTH = 2.4;
const DECAL_DEPTH = 2.2;
const LIGHT_THRESHOLD = 0.62;
const SHADOW_THRESHOLD = -0.08;
const OUTLINE_INK = hexToRgba('#140c1c');
const SHADOW_COLOR = rgba(46, 26, 20, 78);

const TONE_INDEX: Readonly<Record<Tone, number>> = { outline: 0, deep: 1, shadow: 2, base: 3, light: 4 };

export type Ramps = Readonly<Record<MaterialKey, Ramp>>;

interface Camera {
  readonly view: Vec3;
  readonly light: Vec3;
  readonly cosYaw: number;
  readonly sinYaw: number;
  readonly cosPitch: number;
  readonly sinPitch: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

function makeCamera(yaw: number, frame: FrameGeometry): Camera {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(CAMERA_PITCH);
  const sinPitch = Math.sin(CAMERA_PITCH);
  const toCharacter = (x: number, y: number, z: number): Vec3 => v3(x * cosYaw - z * sinYaw, y, x * sinYaw + z * cosYaw);
  return {
    view: toCharacter(0, -sinPitch, -cosPitch),
    light: toCharacter(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z),
    cosYaw,
    sinYaw,
    cosPitch,
    sinPitch,
    anchorX: frame.anchorX,
    anchorY: frame.anchorY,
  };
}

function worldX(camera: Camera, p: Vec3): number {
  return p.x * camera.cosYaw + p.z * camera.sinYaw;
}

function projectX(camera: Camera, p: Vec3): number {
  return camera.anchorX + worldX(camera, p);
}

function projectY(camera: Camera, p: Vec3): number {
  const z = -p.x * camera.sinYaw + p.z * camera.cosYaw;
  return camera.anchorY - (p.y * camera.cosPitch - z * camera.sinPitch);
}

function depthOf(camera: Camera, p: Vec3): number {
  return dot(p, camera.view) + FAR;
}

/** Ray origin, in character space, for the center of pixel (px, py). */
function rayOrigin(camera: Camera, px: number, py: number): Vec3 {
  const sx = px + 0.5 - camera.anchorX;
  const su = camera.anchorY - (py + 0.5);
  const x = sx;
  const y = su * camera.cosPitch + FAR * camera.sinPitch;
  const z = -su * camera.sinPitch + FAR * camera.cosPitch;
  return v3(x * camera.cosYaw - z * camera.sinYaw, y, x * camera.sinYaw + z * camera.cosYaw);
}

function occluded(primitives: readonly Primitive[], from: Vec3, direction: Vec3): boolean {
  const hit = emptyHit();
  for (const primitive of primitives) {
    const toCenter = sub(primitive.center, from);
    const along = dot(toCenter, direction);
    if (along < -primitive.radius) continue;
    if (dot(toCenter, toCenter) - along * along > primitive.radius * primitive.radius) continue;
    hit.t = Number.POSITIVE_INFINITY;
    if (primitive.intersect(from, direction, hit)) return true;
  }
  return false;
}

/** Screen position, inside a frame, of a point in character space. */
export function projectPoint(point: Vec3, yaw: number, frame: FrameGeometry = WALK_FRAME): { x: number; y: number } {
  const camera = makeCamera(yaw, frame);
  return { x: projectX(camera, point), y: projectY(camera, point) };
}

export function renderScene(scene: Scene, ramps: Ramps, yaw: number, frame: FrameGeometry = WALK_FRAME): PixelBuffer {
  const camera = makeCamera(yaw, frame);
  const { primitives } = scene;
  const { width, height } = frame;
  const count = width * height;
  const depth = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const owner = new Int32Array(count).fill(-1);
  const keys: (MaterialKey | undefined)[] = new Array(count);
  const tones = new Int8Array(count);

  const bounds = primitives.map((primitive) => {
    const x = projectX(camera, primitive.center);
    const y = projectY(camera, primitive.center);
    const r = primitive.radius + 0.75;
    return [x - r, x + r, y - r, y + r] as const;
  });

  const hit = emptyHit();
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const origin = rayOrigin(camera, px, py);
      hit.t = Number.POSITIVE_INFINITY;
      let best = -1;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let local = v3(0, 0, 0);
      for (let i = 0; i < primitives.length; i += 1) {
        const b = bounds[i];
        if (!b || cx < b[0] || cx > b[1] || cy < b[2] || cy > b[3]) continue;
        if ((primitives[i] as Primitive).intersect(origin, camera.view, hit)) {
          best = i;
          nx = hit.nx;
          ny = hit.ny;
          nz = hit.nz;
          local = v3(hit.lx, hit.ly, hit.lz);
        }
      }
      if (best < 0) continue;
      const index = py * width + px;
      const primitive = primitives[best] as Primitive;
      const normal = v3(nx, ny, nz);
      const point = add(origin, scale(camera.view, hit.t));
      const sample = primitive.material(point, normal, local);
      const lambert = dot(normal, camera.light);
      let tone = lambert > LIGHT_THRESHOLD ? TONE_INDEX.light : lambert > SHADOW_THRESHOLD ? TONE_INDEX.base : TONE_INDEX.shadow;
      const castsOnto = primitive.part !== 'head';
      if (castsOnto && tone > TONE_INDEX.shadow && occluded(primitives, add(point, scale(normal, 0.3)), camera.light)) tone -= 1;
      // Faces read best flat: no highlight band on the forehead.
      if (primitive.part === 'head') tone = Math.min(tone, TONE_INDEX.base);
      tone = Math.min(TONE_INDEX.light, Math.max(TONE_INDEX.deep, tone + (sample.shift ?? 0)));
      depth[index] = hit.t;
      owner[index] = best;
      keys[index] = sample.key as MaterialKey;
      tones[index] = tone;
    }
  }

  // Contour lines: a pixel that sits behind a clearly nearer neighbor gets darker.
  const contour = new Uint8Array(count);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const index = py * width + px;
      const d = depth[index] as number;
      if (!Number.isFinite(d)) continue;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = px + ox;
        const y = py + oy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const other = y * width + x;
        const od = depth[other] as number;
        const differentPart = primitives[owner[other] as number]?.part !== primitives[owner[index] as number]?.part;
        if (od < d - CONTOUR_DEPTH && (differentPart || od < d - CONTOUR_DEPTH * 2)) {
          contour[index] = 1;
          break;
        }
      }
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (!contour[i]) continue;
    const soft = primitives[owner[i] as number]?.part === 'head';
    const tone = tones[i] as number;
    tones[i] = Math.max(TONE_INDEX.deep, soft ? tone - 1 : Math.min(tone, TONE_INDEX.shadow) - 1);
  }

  // Decals.
  const toCamera = scale(camera.view, -1);
  for (const decal of scene.decals) {
    const facing = dot(decal.normal, toCamera);
    if (facing < decal.minFacing) continue;
    const ax = Math.floor(projectX(camera, decal.anchor));
    const ay = Math.floor(projectY(camera, decal.anchor));
    if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
    const anchorDepth = depthOf(camera, decal.anchor);
    const covered = depth[ay * width + ax] as number;
    if (Number.isFinite(covered) ? covered < anchorDepth - 1.1 : !decal.overflow) continue;
    decal.draw({
      facing,
      screenSide: worldX(camera, decal.normal) < 0 ? -1 : 1,
      plot(dx, dy, key, tone = 'base') {
        const x = ax + dx;
        const y = ay + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const index = y * width + x;
        const d = depth[index] as number;
        if (Number.isFinite(d)) {
          if (Math.abs(d - anchorDepth) > DECAL_DEPTH) return;
        } else if (decal.overflow) {
          depth[index] = anchorDepth;
        } else {
          return;
        }
        keys[index] = key;
        tones[index] = TONE_INDEX[tone];
      },
    });
  }

  const figure = new PixelBuffer(width, height);
  for (let i = 0; i < count; i += 1) {
    const key = keys[i];
    if (!key || !Number.isFinite(depth[i] as number)) continue;
    const tone = TONES[tones[i] as number] as Tone;
    figure.setPixel(i % width, Math.floor(i / width), ramps[key][tone]);
  }
  figure.addOutline((neighbor) => mixRgba(neighbor, OUTLINE_INK, 0.78));

  const image = new PixelBuffer(width, height);
  drawContactShadow(image, frame);
  image.blit(figure, 0, 0);
  return image;
}

function drawContactShadow(image: PixelBuffer, frame: FrameGeometry): void {
  const cx = frame.anchorX;
  const cy = frame.anchorY - 0.5;
  const rx = 7.5;
  const ry = 2.4;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const u = (x + 0.5 - cx) / rx;
      const w = (y + 0.5 - cy) / ry;
      if (u * u + w * w <= 1) image.setPixel(x, y, SHADOW_COLOR);
    }
  }
}
