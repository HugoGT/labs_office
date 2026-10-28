import { describe, expect, it } from 'vitest';
import type { SpaceArea } from './mapData';
import { physicalBodyRect } from './avatarGeometry';
import { doorLeaves } from './officeDoors';
import { decodeLockedSpaces, encodeLockedSpaces, heldLocks, lockedDoorAhead, lockedSpaceEntered, lockedBehindDoor } from './spaceLocks';

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
  const at = (sessionId: string, point: { x: number; y: number }) => ({ sessionId, ...point });

  it('keeps a lock while whoever locked it is inside', () => {
    expect(heldLocks(locks('sala'), SPACES, [at('locker-sala', inSala), at('otra', outside)])).toEqual(locks('sala'));
  });

  it('drops the lock once whoever locked it leaves, even with others still inside', () => {
    expect(heldLocks(locks('sala'), SPACES, [at('locker-sala', outside), at('otra', inSala)])).toEqual(new Map());
    expect(heldLocks(locks('sala'), SPACES, [at('otra', inSala)])).toEqual(new Map());
  });

  it('drops the lock of a space that no longer exists', () => {
    expect(heldLocks(locks('borrada'), SPACES, [at('locker-borrada', inSala)])).toEqual(new Map());
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

describe('locked doors', () => {
  // A room above the grid line y = 192, its door on tiles 4..5 of that line (x 128..192).
  const ROOM: SpaceArea = { id: 'room', name: 'Sala 2', x: 4 * 32, y: 0, w: 2 * 32, h: 6 * 32 };
  const [DOOR] = doorLeaves([{ index: 6 * 20 + 4, piece: 'door-wood', rotation: 0 }], 20);
  /** A network position whose body center is at (cx, cy). */
  const standingAt = (cx: number, cy: number) => {
    const body = physicalBodyRect({ x: 0, y: 0 });
    return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
  };
  const below = standingAt(185, 6 * 32 + 20);
  const inside = standingAt(150, 6 * 32 - 10);
  const up = { x: 0, y: -1 };

  it('the door leads from outside into a locked room for whoever is outside it', () => {
    expect(lockedBehindDoor(DOOR!, below, [ROOM], locks('room'))).toBe(ROOM);
    expect(lockedBehindDoor(DOOR!, below, [ROOM], locks())).toBeNull();
    expect(lockedBehindDoor(DOOR!, inside, [ROOM], locks('room'))).toBeNull();
    expect(lockedBehindDoor(DOOR!, standingAt(300, 300), [ROOM], locks('room'))).toBeNull();
  });

  it('is ahead of a body lined up with the door, outside the room and heading through it, even beside its post', () => {
    expect(lockedDoorAhead([DOOR!], below, up, [ROOM], locks('room'))).toBe(ROOM);
    expect(lockedDoorAhead([DOOR!], standingAt(191, 6 * 32 + 20), { x: 1, y: -1 }, [ROOM], locks('room'))).toBe(ROOM);
  });

  it('is not ahead of a body walking along the wall or away from the door, nor of whoever is inside', () => {
    expect(lockedDoorAhead([DOOR!], below, { x: 1, y: 0 }, [ROOM], locks('room'))).toBeNull();
    expect(lockedDoorAhead([DOOR!], below, { x: 0, y: 1 }, [ROOM], locks('room'))).toBeNull();
    expect(lockedDoorAhead([DOOR!], inside, { x: 0, y: 1 }, [ROOM], locks('room'))).toBeNull();
    expect(lockedDoorAhead([DOOR!], below, up, [ROOM], locks())).toBeNull();
  });
});
