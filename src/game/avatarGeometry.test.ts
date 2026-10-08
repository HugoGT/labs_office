import { describe, expect, it } from 'vitest';
import {
  AVATAR_BODY_OFFSET,
  AVATAR_BODY_SIZE,
  AVATAR_CONTAINER_SIZE,
  AVATAR_FEET_OFFSET_Y,
  characterHitArea,
  feetOf,
  physicalBodyRect,
  positionForFeet,
  seatedSpriteBox,
  walkSpriteBox,
} from './avatarGeometry';
import { CHAIR, CHARACTER_SEATED, CHARACTER_WALK } from './artContract';

const WALK = { frame: CHARACTER_WALK.frame, anchor: CHARACTER_WALK.anchor };
const SEATED = { frame: CHARACTER_SEATED.frame, anchor: CHARACTER_SEATED.anchor };
const SEAT_ABOVE_GROUND = { x: CHAIR.anchor.x - CHAIR.ground.x, y: CHAIR.anchor.y - CHAIR.ground.y };

describe('avatarGeometry: network position, feet and body', () => {
  it('the feet sit a fixed distance below the network position, where the speaking ring always was', () => {
    expect(AVATAR_FEET_OFFSET_Y).toBe(18);
    expect(feetOf({ x: 100, y: 200 })).toEqual({ x: 100, y: 218 });
  });

  it('positionForFeet is the inverse of feetOf', () => {
    const position = { x: 713.5, y: 402.25 };
    expect(positionForFeet(feetOf(position))).toEqual(position);
    expect(feetOf(positionForFeet({ x: 40, y: 60 }))).toEqual({ x: 40, y: 60 });
  });

  it('centers the footprint horizontally on the feet with its bottom on the ground anchor', () => {
    expect(AVATAR_CONTAINER_SIZE).toEqual({ width: 32, height: 44 });
    expect(AVATAR_BODY_SIZE).toEqual({ width: 18, height: 14 });
    expect(AVATAR_BODY_OFFSET).toEqual({ x: 7, y: 26 });
    expect(physicalBodyRect({ x: 100, y: 200 })).toEqual({ x: 91, y: 204, width: 18, height: 14 });
    for (const position of [{ x: 100, y: 200 }, { x: 713.5, y: 402.25 }]) {
      const body = physicalBodyRect(position);
      expect({ x: body.x + body.width / 2, y: body.y + body.height }).toEqual(feetOf(position));
    }
  });
});

describe('avatarGeometry: sprites around the position', () => {
  it('draws the walk frame with its anchor on the feet', () => {
    const box = walkSpriteBox(WALK);
    expect(box).toEqual({ x: -16, y: AVATAR_FEET_OFFSET_Y - 47, width: 32, height: 52 });
    // The anchor pixel of the frame lands on the feet.
    expect({ x: box.x + WALK.anchor.x, y: box.y + WALK.anchor.y }).toEqual({ x: 0, y: AVATAR_FEET_OFFSET_Y });
  });

  it('draws a sitter with its seated anchor on the seat, when the feet stand on the chair ground', () => {
    const box = seatedSpriteBox(SEATED, SEAT_ABOVE_GROUND);
    const seat = { x: 0, y: AVATAR_FEET_OFFSET_Y + SEAT_ABOVE_GROUND.y };
    expect({ x: box.x + SEATED.anchor.x, y: box.y + SEATED.anchor.y }).toEqual(seat);
    expect(box.width).toBe(44);
    expect(box.height).toBe(58);
  });

  it('turns a sprite box into a container hit area, which Phaser offsets by half the container size', () => {
    const box = walkSpriteBox(WALK);
    expect(characterHitArea(box)).toEqual({
      x: box.x + AVATAR_CONTAINER_SIZE.width / 2,
      y: box.y + AVATAR_CONTAINER_SIZE.height / 2,
      width: box.width,
      height: box.height,
    });
  });
});
