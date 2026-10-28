import { describe, expect, it } from 'vitest';
import type { OfficeDesk } from '../game/desksPort';
import type { SpaceArea } from '../game/mapData';
import { placeLabel, placeOf } from './roomPlace';

const SALA: SpaceArea = { id: 'sala', name: 'Sala 1', x: 0, y: 0, w: 320, h: 320 };
/** A desk's cubicle: same origin and size as the desk, named after its label. */
const CUBICULO: SpaceArea = { id: 'cubiculo', name: 'Mesa 4', x: 640, y: 0, w: 96, h: 96 };
const MESA: OfficeDesk = { id: 'mesa', label: 'Mesa 4', x: 640, y: 0, w: 96, h: 96, occupant: null, mine: false };
const SPACES = [SALA, CUBICULO];

describe('placeOf', () => {
  it('is a room by its name', () => {
    expect(placeOf('sala', 'Sala 1', SPACES, [MESA])).toEqual({ kind: 'room', name: 'Sala 1' });
  });

  it('is an unclaimed desk when its cubicle matches a desk nobody claimed', () => {
    expect(placeOf('cubiculo', 'Mesa 4', SPACES, [MESA])).toEqual({ kind: 'desk', owner: null });
  });

  it('is the desk of whoever claimed it', () => {
    const claimed = { ...MESA, occupant: { id: 'u-hugo', displayName: 'Hugo' } };
    expect(placeOf('cubiculo', 'Mesa 4', SPACES, [claimed])).toEqual({ kind: 'desk', owner: 'Hugo' });
  });

  it('is nowhere on the open floor', () => {
    expect(placeOf(null, null, SPACES, [MESA])).toBeNull();
  });

  it('is a room by its name when the space is not served yet', () => {
    expect(placeOf('otra', 'Cafetería', SPACES, [MESA])).toEqual({ kind: 'room', name: 'Cafetería' });
  });
});

describe('placeLabel', () => {
  it('names a room, a claimed desk and an unclaimed one', () => {
    expect(placeLabel({ kind: 'room', name: 'Sala 1' })).toBe('Sala 1');
    expect(placeLabel({ kind: 'desk', owner: 'Hugo' })).toBe('Escritorio de Hugo');
    expect(placeLabel({ kind: 'desk', owner: null })).toBe('Escritorio');
  });
});
