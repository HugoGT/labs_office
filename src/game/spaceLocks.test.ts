import { describe, expect, it } from 'vitest';
import type { SpaceArea } from './mapData';
import { decodeLockedSpaces, encodeLockedSpaces, heldLocks, lockedSpaceEntered } from './spaceLocks';

const SALA: SpaceArea = { id: 'sala', name: 'Sala 1', x: 0, y: 0, w: 100, h: 100 };
const MESA: SpaceArea = { id: 'mesa', name: 'Mesa 1', x: 200, y: 0, w: 96, h: 96 };
const SPACES = [SALA, MESA];
const inSala = { x: 50, y: 50 };
const inMesa = { x: 250, y: 50 };
const outside = { x: 150, y: 150 };

describe('lockedSpaceEntered', () => {
  it('refuses walking from outside into a locked space', () => {
    expect(lockedSpaceEntered(outside, inSala, SPACES, new Set(['sala']))).toBe(SALA);
  });

  it('refuses walking from another space into a locked one', () => {
    expect(lockedSpaceEntered(inMesa, inSala, SPACES, new Set(['sala']))).toBe(SALA);
  });

  it('lets whoever is inside a locked space move in it and out of it', () => {
    const locked = new Set(['sala']);
    expect(lockedSpaceEntered(inSala, { x: 10, y: 90 }, SPACES, locked)).toBeNull();
    expect(lockedSpaceEntered(inSala, outside, SPACES, locked)).toBeNull();
  });

  it('never refuses an unlocked space', () => {
    expect(lockedSpaceEntered(outside, inSala, SPACES, new Set(['mesa']))).toBeNull();
  });
});

describe('heldLocks', () => {
  it('keeps a lock while someone is inside and drops it once the space is empty', () => {
    const locked = new Set(['sala', 'mesa']);
    expect(heldLocks(locked, SPACES, [inSala, outside])).toEqual(new Set(['sala']));
    expect(heldLocks(locked, SPACES, [outside])).toEqual(new Set());
  });

  it('drops the lock of a space that no longer exists', () => {
    expect(heldLocks(new Set(['borrada']), SPACES, [inSala])).toEqual(new Set());
  });
});

describe('locked spaces wire form', () => {
  it('round-trips sorted and empty for none', () => {
    expect(encodeLockedSpaces(new Set(['sala', 'mesa']))).toBe('mesa,sala');
    expect(encodeLockedSpaces(new Set())).toBe('');
    expect(decodeLockedSpaces('mesa,sala')).toEqual(new Set(['mesa', 'sala']));
    expect(decodeLockedSpaces('')).toEqual(new Set());
  });
});
