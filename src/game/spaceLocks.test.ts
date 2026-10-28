import { describe, expect, it } from 'vitest';
import type { SpaceArea } from './mapData';
import { decodeLockedSpaces, encodeLockedSpaces, heldLocks, lockedSpaceEntered } from './spaceLocks';

const SALA: SpaceArea = { id: 'sala', name: 'Sala 1', x: 0, y: 0, w: 100, h: 100 };
const MESA: SpaceArea = { id: 'mesa', name: 'Mesa 1', x: 200, y: 0, w: 96, h: 96 };
const SPACES = [SALA, MESA];
const inSala = { x: 50, y: 50 };
const inMesa = { x: 250, y: 50 };
const outside = { x: 150, y: 150 };
/** Locked space ids with who locked each: the session that may unlock it. */
const locks = (...ids: string[]) => new Map(ids.map((id) => [id, `locker-${id}`]));

describe('lockedSpaceEntered', () => {
  it('refuses walking from outside into a locked space', () => {
    expect(lockedSpaceEntered(outside, inSala, SPACES, locks('sala'))).toBe(SALA);
  });

  it('refuses walking from another space into a locked one', () => {
    expect(lockedSpaceEntered(inMesa, inSala, SPACES, locks('sala'))).toBe(SALA);
  });

  it('lets whoever is inside a locked space move in it and out of it', () => {
    const locked = locks('sala');
    expect(lockedSpaceEntered(inSala, { x: 10, y: 90 }, SPACES, locked)).toBeNull();
    expect(lockedSpaceEntered(inSala, outside, SPACES, locked)).toBeNull();
  });

  it('never refuses an unlocked space', () => {
    expect(lockedSpaceEntered(outside, inSala, SPACES, locks('mesa'))).toBeNull();
  });
});

describe('heldLocks', () => {
  it('keeps a lock while someone is inside and drops it once the space is empty', () => {
    const locked = locks('sala', 'mesa');
    expect(heldLocks(locked, SPACES, [inSala, outside])).toEqual(locks('sala'));
    expect(heldLocks(locked, SPACES, [outside])).toEqual(new Map());
  });

  it('drops the lock of a space that no longer exists', () => {
    expect(heldLocks(locks('borrada'), SPACES, [inSala])).toEqual(new Map());
  });
});

describe('locked spaces wire form', () => {
  it('round-trips each space with who locked it, sorted, and empty for none', () => {
    expect(encodeLockedSpaces(locks('sala', 'mesa'))).toBe('mesa:locker-mesa,sala:locker-sala');
    expect(encodeLockedSpaces(new Map())).toBe('');
    expect(decodeLockedSpaces('mesa:locker-mesa,sala:locker-sala')).toEqual(locks('mesa', 'sala'));
    expect(decodeLockedSpaces('')).toEqual(new Map());
  });
});
