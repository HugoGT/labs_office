import { describe, expect, it } from 'vitest';
import { createSessionEvictionHub } from './sessionEviction.ts';

describe('sessionEviction hub (#93)', () => {
  it('forwards an eviction to every registered room', () => {
    const hub = createSessionEvictionHub();
    const seen: string[] = [];
    hub.register((uid) => seen.push(`a:${uid}`));
    hub.register((uid) => seen.push(`b:${uid}`));

    hub.evictAccount('uid-ana');

    expect(seen).toEqual(['a:uid-ana', 'b:uid-ana']);
  });

  it('a room that unregistered (disposed) is no longer called', () => {
    const hub = createSessionEvictionHub();
    const seen: string[] = [];
    const unregister = hub.register((uid) => seen.push(uid));

    unregister();
    hub.evictAccount('uid-ana');

    expect(seen).toEqual([]);
  });

  it('with no room at all, evicting is a harmless no-op', () => {
    expect(() => createSessionEvictionHub().evictAccount('uid-ana')).not.toThrow();
  });

  it('one room failing does not spare the account in the others', () => {
    const hub = createSessionEvictionHub();
    const seen: string[] = [];
    hub.register(() => {
      throw new Error('boom');
    });
    hub.register((uid) => seen.push(uid));

    expect(() => hub.evictAccount('uid-ana')).toThrow('boom');
    expect(seen).toEqual(['uid-ana']);
  });
});
