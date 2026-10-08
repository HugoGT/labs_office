/**
 * Where an avatar's network position, its feet, its physical body and its
 * sprite sit relative to each other (art migration, step 6). Pure numbers:
 * the scene copies them into Phaser objects, and the browser tests compare
 * them with real Arcade and input.
 *
 * The network position (`PlayerState.x/y`, the container position) is the
 * point everything else already reads: proximity, `detectSpace`, the
 * `liveSessions.ts` tracking behind `POST /livekit/token`. Drawing pack art
 * must not move it, so the sprite is placed around it and never the other
 * way round.
 *
 * No imports, like `mapData.ts`, so any side of the wire can load it; the
 * sprite anchors come in as arguments from `artContract.ts`.
 */

export interface GeometryPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeometryBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The feet are this far below the network position: where the speaking ring
 * of the procedural avatar always was. Every avatar shares it, so sorting by
 * the feet orders avatars exactly as sorting by the position did.
 */
export const AVATAR_FEET_OFFSET_Y = 18;

/**
 * Size of the avatar container. It is not the sprite size: Phaser offsets a
 * container's Arcade body and hit area by half of it. Keep this stable so
 * changing the footprint does not change input coordinates or sprite anchors.
 */
export const AVATAR_CONTAINER_SIZE = { width: 32, height: 44 } as const;

/** Arcade body shared by the local player and every peer (#59). */
export const AVATAR_BODY_SIZE = { width: 18, height: 14 } as const;
/** Ground footprint centered horizontally, with its bottom on the drawn feet. */
export const AVATAR_BODY_CENTER_OFFSET = { x: 0, y: AVATAR_FEET_OFFSET_Y - AVATAR_BODY_SIZE.height / 2 } as const;
/** Arcade subtracts the container display origin before adding this offset. */
export const AVATAR_BODY_OFFSET = {
  x: AVATAR_CONTAINER_SIZE.width / 2 + AVATAR_BODY_CENTER_OFFSET.x - AVATAR_BODY_SIZE.width / 2,
  y: AVATAR_CONTAINER_SIZE.height / 2 + AVATAR_BODY_CENTER_OFFSET.y - AVATAR_BODY_SIZE.height / 2,
} as const;

export function feetOf(position: GeometryPoint): GeometryPoint {
  return { x: position.x, y: position.y + AVATAR_FEET_OFFSET_Y };
}

export function positionForFeet(feet: GeometryPoint): GeometryPoint {
  return { x: feet.x, y: feet.y - AVATAR_FEET_OFFSET_Y };
}

/**
 * World rectangle of the Arcade body for an avatar at `position`, as Phaser
 * computes it (`position + offset - container size / 2`). Shared by physics,
 * authoritative movement checks and edit protections, never the visual torso.
 */
export function physicalBodyRect(position: GeometryPoint): GeometryBox {
  return {
    x: position.x + AVATAR_BODY_OFFSET.x - AVATAR_CONTAINER_SIZE.width / 2,
    y: position.y + AVATAR_BODY_OFFSET.y - AVATAR_CONTAINER_SIZE.height / 2,
    width: AVATAR_BODY_SIZE.width,
    height: AVATAR_BODY_SIZE.height,
  };
}

export interface SpriteCell {
  readonly frame: { readonly width: number; readonly height: number };
  readonly anchor: GeometryPoint;
}

/** Walk frame relative to the position: its anchor on the feet. */
export function walkSpriteBox(walk: SpriteCell): GeometryBox {
  return {
    x: -walk.anchor.x,
    y: AVATAR_FEET_OFFSET_Y - walk.anchor.y,
    width: walk.frame.width,
    height: walk.frame.height,
  };
}

/**
 * Seated frame relative to the position of a sitter, whose feet stand on the
 * chair ground: its anchor goes on the seat, `seatAboveGround` (chair seat
 * minus chair ground, negative upward) away from the feet.
 */
export function seatedSpriteBox(seated: SpriteCell, seatAboveGround: GeometryPoint): GeometryBox {
  return {
    x: seatAboveGround.x - seated.anchor.x,
    y: AVATAR_FEET_OFFSET_Y + seatAboveGround.y - seated.anchor.y,
    width: seated.frame.width,
    height: seated.frame.height,
  };
}

/**
 * Hit area of a container covering `box`. Phaser adds half the container
 * size to the local point before testing it (`InputManager.pointWithinHitArea`),
 * so a box centered on the position has to be shifted by that much.
 */
export function characterHitArea(box: GeometryBox): GeometryBox {
  return {
    x: box.x + AVATAR_CONTAINER_SIZE.width / 2,
    y: box.y + AVATAR_CONTAINER_SIZE.height / 2,
    width: box.width,
    height: box.height,
  };
}
