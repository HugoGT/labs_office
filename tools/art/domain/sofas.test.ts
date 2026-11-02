import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SOFA } from '../../../src/game/artContract.ts';
import { chairSprite } from './chairs.ts';
import { SOFA_MATERIALS, SOFA_SEATS, sofaSprite, type SofaSprite } from './sofas.ts';
import { DEFAULT_FABRIC_COLOR } from './upholstery.ts';
import { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { FACINGS, SEAT_HEIGHT } from '../../../src/art/seating.ts';

const TILE = 32;
const luma = (p: { r: number; g: number; b: number }): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;

const ALL = SOFA_MATERIALS.flatMap((material) =>
  SOFA_SEATS.flatMap((seats) => FACINGS.map((facing) => ({ material, seats, facing, sprite: sofaSprite(material, seats, facing) }))),
);

function composite(sprite: Pick<SofaSprite, 'back' | 'front'>): PixelBuffer {
  const out = new PixelBuffer(sprite.back.width, sprite.back.height, sprite.back.data.slice());
  out.blit(sprite.front, 0, 0);
  return out;
}

function opaqueIn(image: PixelBuffer, x0: number, y0: number, x1: number, y1: number): number {
  let count = 0;
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x += 1) if (image.alphaAt(x, y) === 255) count += 1;
  }
  return count;
}

test('every sofa, facing and layer fits a SOFA cell around its anchor, the layers the same size', () => {
  assert.equal(ALL.length, SOFA_MATERIALS.length * SOFA_SEATS.length * 4);
  for (const { material, seats, facing, sprite } of ALL) {
    const name = `${material}-${seats} ${facing}`;
    assert.deepEqual([sprite.front.width, sprite.front.height], [sprite.back.width, sprite.back.height], `${name}: layers share size`);
    const left = SOFA.anchor.x - sprite.ground.x;
    const top = SOFA.anchor.y - sprite.ground.y;
    // A free pixel all around, so the cell corners stay transparent.
    assert.ok(left >= 1 && top >= 1, `${name}: ${left},${top}`);
    assert.ok(left + sprite.back.width <= SOFA.frame.width - 1, `${name}: width ${sprite.back.width}`);
    assert.ok(top + sprite.back.height <= SOFA.frame.height - 1, `${name}: height ${sprite.back.height}`);
    assert.ok(sprite.back.countOpaque() > 200, `${name}: back layer is drawn`);
  }
});

test('one seat per tile: a whole tile apart along the sofa, centered on it, each SEAT_HEIGHT above its own floor', () => {
  for (const { material, seats, facing, sprite } of ALL) {
    const name = `${material}-${seats} ${facing}`;
    assert.equal(sprite.seats.length, seats, name);
    const sideways = facing === 'left' || facing === 'right';
    sprite.seats.forEach((seat, index) => {
      // Seat `index` stands over tile `index` of the footprint, counted from its middle.
      const along = (index - (seats - 1) / 2) * TILE;
      const ground = sideways ? { x: sprite.ground.x, y: sprite.ground.y + along } : { x: sprite.ground.x + along, y: sprite.ground.y };
      assert.deepEqual(seat, { x: ground.x, y: ground.y - SEAT_HEIGHT }, `${name} seat ${index}`);
      assert.equal(composite(sprite).alphaAt(seat.x, seat.y), 255, `${name} seat ${index}: solid under the pelvis`);
    });
  }
});

test('the backrest goes behind sitters facing the viewer and in front of sitters facing away', () => {
  for (const material of SOFA_MATERIALS) {
    for (const seats of SOFA_SEATS) {
      const down = sofaSprite(material, seats, 'down');
      const up = sofaSprite(material, seats, 'up');
      const seatY = down.seats[0]!.y;
      assert.ok(opaqueIn(down.back, 0, 0, down.back.width, seatY - 4) > 40 * seats, `${material}-${seats} down: backrest behind the sitters`);
      assert.equal(opaqueIn(down.front, 0, 0, down.front.width, seatY - 4), 0, `${material}-${seats} down: nothing covers the sitters' torsos`);
      assert.ok(opaqueIn(up.front, 0, 0, up.front.width, up.seats[0]!.y) > 40 * seats, `${material}-${seats} up: backrest covers the sitters' backs`);
    }
  }
});

test('turned sideways only the near arm is in front, low, and the backrest is behind the seats', () => {
  for (const material of SOFA_MATERIALS) {
    for (const seats of SOFA_SEATS) {
      for (const facing of ['left', 'right'] as const) {
        const sprite = sofaSprite(material, seats, facing);
        const name = `${material}-${seats} ${facing}`;
        const last = sprite.seats[seats - 1]!;
        assert.ok(sprite.front.countOpaque() > 10, `${name}: near arm in front`);
        // Nothing in front reaches the upper sitters: only the arm past the last seat.
        assert.equal(opaqueIn(sprite.front, 0, 0, sprite.front.width, last.y - 8), 0, `${name}: the front layer stays by the near end`);
        const behind = facing === 'right' ? opaqueIn(sprite.back, 0, 0, last.x - 3, sprite.back.height) : opaqueIn(sprite.back, last.x + 4, 0, sprite.back.width, sprite.back.height);
        assert.ok(behind > 40 * seats, `${name}: backrest behind the seats`);
      }
    }
  }
});

test('every sofa has a 1px dark outline and a contact shadow', () => {
  for (const { material, seats, facing, sprite } of ALL) {
    const image = composite(sprite);
    let edge = 0;
    let dark = 0;
    let shadow = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const a = image.alphaAt(x, y);
        if (a > 0 && a < 255) shadow += 1;
        if (a !== 255) continue;
        const open = [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ].some(([ox, oy]) => image.alphaAt(x + (ox as number), y + (oy as number)) < 255);
        if (!open) continue;
        edge += 1;
        if (luma(image.getPixel(x, y)) < 60) dark += 1;
      }
    }
    assert.equal(dark, edge, `${material}-${seats} ${facing}: ${edge - dark} light edge pixels`);
    assert.ok(shadow > 6, `${material}-${seats} ${facing}: contact shadow`);
  }
});

test('every sofa is its own drawing, a three-seat one wider (or longer) than a two-seat one', () => {
  const keys = new Set(ALL.map(({ sprite }) => [sprite.back.data.join(), sprite.front.data.join()].join('|')));
  assert.equal(keys.size, ALL.length);
  for (const material of SOFA_MATERIALS) {
    assert.equal(sofaSprite(material, 3, 'down').back.width - sofaSprite(material, 2, 'down').back.width, TILE, `${material}: one tile wider`);
    assert.equal(sofaSprite(material, 3, 'left').back.height - sofaSprite(material, 2, 'left').back.height, TILE, `${material}: one tile longer`);
  }
});

test('a sofa seat is the armchair seat of the same material, upholstery and height', () => {
  for (const material of SOFA_MATERIALS) {
    const chair = chairSprite(material, 'down');
    const sofa = sofaSprite(material, 2, 'down');
    const chairSeat = composite(chair).getPixel(chair.seat.x, chair.seat.y);
    const sofaSeat = composite(sofa).getPixel(sofa.seats[0]!.x, sofa.seats[0]!.y);
    assert.ok(Math.abs(luma(chairSeat) - luma(sofaSeat)) < 40, `${material}: same upholstery under the pelvis`);
  }
});

test('sofas are cached and deterministic', () => {
  assert.equal(sofaSprite('leather', 2, 'up'), sofaSprite('leather', 2, 'up'));
});

test('only the fabric sofa takes a color, and the silhouette does not change with it', () => {
  const teal = '#2a9d8f';
  for (const seats of SOFA_SEATS) {
    for (const facing of FACINGS) {
      const plain = sofaSprite('fabric', seats, facing);
      assert.equal(sofaSprite('fabric', seats, facing, DEFAULT_FABRIC_COLOR), plain, `fabric-${seats} ${facing}: the default color is the exported sofa`);
      const painted = sofaSprite('fabric', seats, facing, teal);
      assert.notDeepEqual(painted.back.data, plain.back.data, `fabric-${seats} ${facing}: the color shows`);
      assert.deepEqual(painted.seats, plain.seats);
      for (let i = 3; i < plain.back.data.length; i += 4) assert.equal(painted.back.data[i], plain.back.data[i], `fabric-${seats} ${facing}: same alpha`);
      assert.equal(sofaSprite('leather', seats, facing, teal), sofaSprite('leather', seats, facing), `leather-${seats} ${facing}: ignores the color`);
    }
  }
});

test('seen from the front, a dark contour parts every upholstered backrest from its seat', () => {
  const sprites = [
    ...SOFA_MATERIALS.map((material) => ({ name: `chair-${material}`, back: chairSprite(material, 'down').back, front: chairSprite(material, 'down').front, seats: [chairSprite(material, 'down').seat] })),
    ...SOFA_MATERIALS.flatMap((material) => SOFA_SEATS.map((seats) => ({ name: `${material}-${seats}`, ...sofaSprite(material, seats, 'down') }))),
  ];
  for (const { name, back, front, seats } of sprites) {
    const image = composite({ back, front });
    for (const seat of seats) {
      const cushion = luma(image.getPixel(seat.x, seat.y));
      // Up from the pelvis, the seat ends in an ink line before the backrest starts.
      let contour = -1;
      for (let y = seat.y - 1; y > seat.y - 8 && contour < 0; y -= 1) if (luma(image.getPixel(seat.x, y)) < cushion * 0.6) contour = y;
      assert.ok(contour > 0, `${name} seat at ${seat.x}: no contour above the seat`);
      assert.equal(image.alphaAt(seat.x, contour - 2), 255, `${name}: the backrest goes on above the contour`);
      assert.ok(luma(image.getPixel(seat.x, contour - 2)) > cushion * 0.6, `${name}: above the contour is upholstery, not ink`);
    }
  }
});
