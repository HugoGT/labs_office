import { normalize, v3, type Vec3 } from './geometry.ts';

/**
 * Size of one animation frame in pixels. The extra rows below the feet are needed because the
 * tilted camera projects the front foot of a stride (walking toward the viewer) a few pixels lower.
 */
export const FRAME_WIDTH = 32;
export const FRAME_HEIGHT = 52;

/** Pixel position (inside a frame) of the ground point under the character's feet. */
export const ANCHOR_X = 16;
export const ANCHOR_Y = 47;

/** Size of a rendered frame and the pixel position of the ground point under the feet in it. */
export interface FrameGeometry {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export const WALK_FRAME: FrameGeometry = { width: FRAME_WIDTH, height: FRAME_HEIGHT, anchorX: ANCHOR_X, anchorY: ANCHOR_Y };

/** Height of a standing character, top of the hair to the soles, outline included. */
export const CHARACTER_HEIGHT = 48;

/** Orthographic camera tilted down by this angle, like a classic top-down RPG. */
export const CAMERA_PITCH = (20 * Math.PI) / 180;

/** Key light in world space (x right, y up, z toward the viewer): upper left, slightly in front. */
export const LIGHT_DIRECTION: Vec3 = normalize(v3(-0.55, 0.8, 0.5));
