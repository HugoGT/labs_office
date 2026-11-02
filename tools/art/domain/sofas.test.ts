import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SOFA } from '../../../src/game/artContract.ts';
import { chairSprite } from './chairs.ts';
import { SOFA_MATERIALS, SOFA_SEATS, sofaSprite, type SofaSprite } from './sofas.ts';
import { DEFAULT_FABRIC_COLOR, LEATHER, backrestFloor } from './upholstery.ts';
import { sofaBackrestRect } from '../../../src/game/pieceCollisions.ts';
import { makeRamp } from './color.ts';
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
    // Less the one-pixel middle column a two-seat sofa takes for its seam.
    assert.equal(sofaSprite(material, 3, 'down').back.width - sofaSprite(material, 2, 'down').back.width, TILE - 1, `${material}: one tile wider`);
    assert.equal(sofaSprite(material, 3, 'left').back.height - sofaSprite(material, 2, 'left').back.height, TILE - 1, `${material}: one tile longer`);
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

/**
 * The front view of a leather piece: its backrest buttons per cushion, the seams between cushions left out, and the
 * middle of the seat cushion under each one, doubled (its first plus its last pixel across the pelvis row).
 */
function leatherCushions(back: PixelBuffer, front: PixelBuffer, seatY: number): { lo: number; hi: number; buttons: number[][]; middle: number }[] {
  const image = composite({ back, front });
  const deep = LEATHER.deep;
  const isDeep = (x: number, y: number): boolean => {
    const p = image.getPixel(x, y);
    return p.a === 255 && p.r === deep.r && p.g === deep.g && p.b === deep.b;
  };
  let top = 0;
  while (top < image.height && opaqueIn(image, 0, top, image.width, top + 1) === 0) top += 1;
  const rows = seatY - 6 - top;
  // A seam runs down the whole backrest; a button is a lone deep pixel.
  const seams = new Set<number>();
  for (let x = 0; x < image.width; x += 1) {
    let count = 0;
    for (let y = top; y < top + rows; y += 1) if (isDeep(x, y)) count += 1;
    if (count > rows / 2) seams.add(x);
  }
  // The backrest face spans the row under its top edge, between its outline pixels.
  const row = top + 2;
  let left = 0;
  while (image.alphaAt(left, row) < 255) left += 1;
  let right = image.width - 1;
  while (image.alphaAt(right, row) < 255) right -= 1;
  const bounds = [left, ...[...seams].sort((a, b) => a - b), right];
  const cushions: { lo: number; hi: number; buttons: number[][]; middle: number }[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const lo = bounds[i]! + 1;
    const hi = bounds[i + 1]! - 1;
    if (hi < lo) continue;
    const buttons: number[][] = [];
    for (let y = top; y < top + rows; y += 1) for (let x = lo; x <= hi; x += 1) if (isDeep(x, y)) buttons.push([x, y]);
    // Across the pelvis the seat cushion is the longest run between the ink by the arm and the seams.
    let seat = { from: lo, length: 0 };
    for (let x = lo, from = lo; x <= hi + 1; x += 1) {
      if (x <= hi && !isDeep(x, seatY) && luma(image.getPixel(x, seatY)) >= 40) continue;
      if (x - from > seat.length) seat = { from, length: x - from };
      from = x + 1;
    }
    cushions.push({ lo, hi, buttons, middle: 2 * seat.from + seat.length - 1 });
  }
  return cushions;
}

test('the leather buttons sit mirrored on every cushion of the armchair and the sofas, centered over its seat cushion', () => {
  const pieces = [
    { name: 'chair-leather', ...chairSprite('leather', 'down'), seatY: chairSprite('leather', 'down').seat.y, cushions: 1 },
    ...SOFA_SEATS.map((seats) => ({ name: `leather-${seats}`, ...sofaSprite('leather', seats, 'down'), seatY: sofaSprite('leather', seats, 'down').seats[0]!.y, cushions: seats })),
  ];
  const key = (x: number, y: number): string => `${x},${y}`;
  const mirrored = (buttons: number[][], axis: number): number[][] => {
    const set = new Set(buttons.map(([x, y]) => key(x!, y!)));
    return buttons.filter(([x, y]) => !set.has(key(axis - x!, y!)));
  };
  for (const { name, back, front, seatY, cushions: expected } of pieces) {
    const cushions = leatherCushions(back, front, seatY);
    assert.equal(cushions.length, expected, `${name}: one backrest cushion per seat`);
    for (const { lo, hi, buttons, middle } of cushions) {
      assert.ok(buttons.length >= 4, `${name} cushion ${lo}-${hi}: buttoned`);
      assert.deepEqual(mirrored(buttons, middle), [], `${name} cushion ${lo}-${hi}: buttons without a mirror across the seat cushion`);
    }
    const all = cushions.flatMap(({ buttons }) => buttons);
    assert.deepEqual(mirrored(all, cushions[0]!.lo + cushions.at(-1)!.hi), [], `${name}: the backrest reads the same from either end`);
  }
});

test('a sofa of two or three seats has wider arms than its armchair', () => {
  // Across the seat, from the outer outline in: the arm runs until the ink that parts it from the cushion.
  const armWidth = (image: PixelBuffer, y: number, from: 'left' | 'right'): number => {
    const step = from === 'left' ? 1 : -1;
    let x = from === 'left' ? 0 : image.width - 1;
    while (image.alphaAt(x, y) < 255) x += step;
    x += step;
    let width = 0;
    while (luma(image.getPixel(x, y)) >= 40) {
      width += 1;
      x += step;
    }
    return width;
  };
  for (const material of SOFA_MATERIALS) {
    const chair = chairSprite(material, 'down');
    const chairImage = composite(chair);
    for (const seats of SOFA_SEATS) {
      const sofa = sofaSprite(material, seats, 'down');
      const image = composite(sofa);
      for (const side of ['left', 'right'] as const) {
        const wide = armWidth(image, sofa.seats[0]!.y, side);
        const narrow = armWidth(chairImage, chair.seat.y, side);
        assert.ok(wide > narrow, `${material}-${seats} ${side}: arm ${wide}px, armchair ${narrow}px`);
      }
    }
  }
});

const UPHOLSTERED = SOFA_MATERIALS.flatMap((material) => [
  { name: `chair-${material}`, material, sprite: (facing: (typeof FACINGS)[number]) => chairSprite(material, facing) },
  ...SOFA_SEATS.map((seats) => ({ name: `${material}-${seats}`, material, sprite: (facing: (typeof FACINGS)[number]) => sofaSprite(material, seats, facing) })),
]);

/** First and last opaque column of a row, or null when the row is empty. */
function rowSpan(image: PixelBuffer, y: number): readonly [number, number] | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < image.width; x += 1) {
    if (image.alphaAt(x, y) !== 255) continue;
    if (first < 0) first = x;
    last = x;
  }
  return first < 0 ? null : [first, last];
}

function topRow(image: PixelBuffer): number {
  let y = 0;
  while (y < image.height && rowSpan(image, y) === null) y += 1;
  return y;
}

test('seen from the side, every upholstered backrest is 5px thick and the near arm runs back to its rear', () => {
  for (const { name, sprite } of UPHOLSTERED) {
    const image = composite(sprite('right'));
    const top = topRow(image);
    // Under its rounded top edge the backrest alone stands above the arms: ink, 5px of upholstery, ink.
    const back = rowSpan(image, top + 2)!;
    assert.equal(back[1] - back[0] + 1, 5 + 2, `${name}: backrest ${back[1] - back[0] - 1}px thick`);
    // Down at the seat, the arm in front starts where the backrest does.
    const seatY = sprite('right').ground.y;
    const arm = rowSpan(image, seatY)!;
    assert.equal(arm[0], back[0], `${name}: the arm starts at x ${arm[0]}, the backrest at ${back[0]}`);
  }
});

test('the fabric armchair and sofas go down to the floor, the leather ones stand on feet', () => {
  for (const { name, material, sprite } of UPHOLSTERED) {
    for (const facing of FACINGS) {
      const image = composite(sprite(facing));
      let bottom = image.height - 1;
      while (rowSpan(image, bottom) === null) bottom -= 1;
      let opaque = 0;
      for (let x = 0; x < image.width; x += 1) if (image.alphaAt(x, bottom) === 255) opaque += 1;
      // Feet leave gaps under the body; a body down to the floor fills the row but for its rounded corners.
      let widest = 0;
      for (let y = 0; y < image.height; y += 1) {
        const span = rowSpan(image, y);
        if (span !== null) widest = Math.max(widest, span[1] - span[0] + 1);
      }
      const full = opaque >= widest * 0.6;
      assert.equal(full, material === 'fabric', `${name} ${facing}: ${opaque}px of ${widest} on the floor`);
    }
  }
});

test('a fabric arm ends in a roll that curls outward, a spiral on its front, the same on both sides', () => {
  const deep = makeRamp(DEFAULT_FABRIC_COLOR).deep;
  for (const { name, material, sprite } of UPHOLSTERED) {
    if (material !== 'fabric') continue;
    const { back, front, ground } = sprite('down');
    const image = composite({ back, front });
    // Across the roll the silhouette is wider than at the floor.
    const roll = rowSpan(image, ground.y - 9)!;
    const floor = rowSpan(image, ground.y - 1)!;
    assert.ok(roll[0] < floor[0] && roll[1] > floor[1], `${name}: roll ${roll}, floor ${floor}`);
    const spiral = (x: number, y: number): boolean => {
      const p = image.getPixel(x, y);
      return p.a === 255 && p.r === deep.r && p.g === deep.g && p.b === deep.b;
    };
    const left: string[] = [];
    const right: string[] = [];
    for (let y = 0; y < image.height; y += 1) {
      for (let dx = 0; dx < 10; dx += 1) {
        if (spiral(roll[0] + dx, y)) left.push(`${dx},${y}`);
        if (spiral(roll[1] - dx, y)) right.push(`${dx},${y}`);
      }
    }
    assert.ok(left.length >= 8, `${name}: ${left.length} spiral pixels`);
    assert.deepEqual(right, left, `${name}: the arms mirror each other`);
    // The spiral spans the roll, from its outer outline in to the ink that parts it from the seat.
    const ramp = makeRamp(DEFAULT_FABRIC_COLOR);
    // Two rows into the spiral, clear of the roll's lit top edge.
    const top = Math.min(...left.map((pixel) => Number(pixel.split(',')[1]))) + 2;
    const face = (x: number): boolean => [ramp.base, ramp.deep].some((tone) => {
      const p = image.getPixel(x, top);
      return p.r === tone.r && p.g === tone.g && p.b === tone.b;
    });
    let rollWidth = 0;
    while (face(roll[0] + 1 + rollWidth)) rollWidth += 1;
    const columns = new Set(left.map((pixel) => Number(pixel.split(',')[0])));
    assert.equal(Math.max(...columns) - Math.min(...columns) + 1, rollWidth, `${name}: spiral over ${[...columns].sort()} of a ${rollWidth}px roll`);
  }
});

test('seen from behind, the fabric armchair and sofas stand square on the floor, no corner cut off', () => {
  for (const { name, material, sprite } of UPHOLSTERED) {
    if (material !== 'fabric') continue;
    const image = composite(sprite('up'));
    let bottom = image.height - 1;
    while (rowSpan(image, bottom) === null) bottom -= 1;
    // The base's last row is as wide as it is higher up; the ink under it only leaves out the outline's own corners.
    const base = rowSpan(image, bottom - 3)!;
    assert.deepEqual(rowSpan(image, bottom - 1), base, `${name}: the base's last row`);
    assert.deepEqual(rowSpan(image, bottom), [base[0] + 1, base[1] - 1], `${name}: the ink under it`);
  }
});

test('a two-seat sofa parts its cushions with a seam one pixel wide', () => {
  for (const material of SOFA_MATERIALS) {
    const sofa = sofaSprite(material, 2, 'down');
    const image = composite(sofa);
    const [left, right] = sofa.seats;
    let seam = 0;
    for (let x = left!.x; x <= right!.x; x += 1) if (luma(image.getPixel(x, left!.y)) < luma(image.getPixel(left!.x, left!.y)) * 0.75) seam += 1;
    assert.equal(seam, 1, `${material}: ${seam}px seam between the seats`);
  }
});

test('a sofa keeps walkers out of the floor under its backrest, as the shared collision states it', () => {
  for (const seats of SOFA_SEATS) {
    for (const facing of FACINGS) {
      const { x, z } = backrestFloor(seats, facing);
      assert.deepEqual(sofaBackrestRect(seats, facing), { x: x[0], y: z[0], w: x[1] - x[0], h: z[1] - z[0] }, `${seats} seats ${facing}`);
    }
  }
});
