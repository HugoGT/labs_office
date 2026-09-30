import { describe, expect, it, vi } from 'vitest';
import { createMemorySpaces } from '../spaces/memorySpaces.ts';
import type { DeskDirectory } from '../desks/desksPort.ts';
import { createRecordingSpaceSnapshot } from './recordingSpaceSnapshot.ts';

const INPUT = { name: 'Room', x: 10, y: 10, w: 3, h: 3, capacity: null };

describe('recording geometry snapshot', () => {
  it('observes committed room updates/deletions without adding database reads', async () => {
    const source = createMemorySpaces();
    const snapshot = createRecordingSpaceSnapshot(source);
    const room = await snapshot.spaces.createSpace(INPUT);
    const read = vi.spyOn(source, 'listSpaces');
    const changed = vi.fn();
    const off = snapshot.geometry.subscribe(changed);
    await snapshot.spaces.updateSpace(room.id, { x: 20, y: 10, w: 3, h: 3 });
    expect(snapshot.geometry.getSpace(room.id)?.x).toBe(20);
    await snapshot.spaces.deleteSpace(room.id);
    expect(snapshot.geometry.getSpace(room.id)).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    off();
    await snapshot.spaces.createSpace(INPUT);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('never replaces newer committed geometry with a stale in-flight list snapshot', async () => {
    const source = createMemorySpaces();
    const room = await source.createSpace(INPUT);
    const oldRows = await source.listSpaces();
    let resolve!: (value: typeof oldRows) => void;
    vi.spyOn(source, 'listSpaces').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const snapshot = createRecordingSpaceSnapshot(source);
    const pending = snapshot.spaces.listSpaces();
    await snapshot.spaces.updateSpace(room.id, { x: 20, y: 10, w: 3, h: 3 });
    resolve(oldRows);
    expect(await pending).toEqual(oldRows); // HTTP snapshot semantics remain unchanged (F4).
    expect(snapshot.geometry.getSpace(room.id)?.x).toBe(20);
  });

  it('observes paired desk movement/deletion only after successful adapter completion', async () => {
    const source = createMemorySpaces();
    const room = await source.createSpace(INPUT);
    source.listSpaces = async () => [{ ...room, deskId: 'desk' }];
    const snapshot = createRecordingSpaceSnapshot(source);
    await snapshot.spaces.listSpaces();
    const moved = { id: 'desk', label: 'Desk', x: 20, y: 10, occupantId: null, createdAt: new Date(), updatedAt: new Date() };
    let resolve!: (value: typeof moved) => void;
    const update = vi.fn(() => new Promise<typeof moved>((done) => { resolve = done; }));
    const raw = { updateDesk: update, deleteDesk: vi.fn(async () => true) } as unknown as DeskDirectory;
    const desks = snapshot.observeDesks(raw);
    const changed = vi.fn();
    snapshot.geometry.subscribe(changed);
    const pending = desks.updateDesk('desk', { x: 20, y: 10 });
    expect(snapshot.geometry.getSpace(room.id)?.x).toBe(10);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    resolve(moved);
    await pending;
    expect(snapshot.geometry.getSpace(room.id)?.x).toBe(20);
    expect(changed).toHaveBeenCalledTimes(1);
    update.mockRejectedValueOnce(new Error('rollback'));
    await expect(desks.updateDesk('desk', { x: 30, y: 10 })).rejects.toThrow('rollback');
    expect(snapshot.geometry.getSpace(room.id)?.x).toBe(20);
    expect(changed).toHaveBeenCalledTimes(1);
    await desks.deleteDesk('desk');
    expect(snapshot.geometry.getSpace(room.id)).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
