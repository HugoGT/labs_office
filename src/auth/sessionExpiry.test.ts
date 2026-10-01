import { afterEach, describe, expect, it, vi } from 'vitest';
import { withSessionExpiry } from './sessionExpiry';

const EXPIRED_BODY = { error: 'unauthorized', reason: 'session-expired' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withSessionExpiry (#128)', () => {
  it('reports a 401 whose reason is session-expired and still hands the response over', async () => {
    const onExpired = vi.fn();
    const fetchImpl = vi.fn(async () => Response.json(EXPIRED_BODY, { status: 401 }));

    const response = await withSessionExpiry(onExpired, fetchImpl)('http://office/me/avatar');

    expect(onExpired).toHaveBeenCalledTimes(1);
    // The client behind it reads the same response as before: its own 401
    // handling does not change.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(EXPIRED_BODY);
  });

  it('passes the request through untouched', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 200 }));
    const init = { method: 'POST', body: '{}' };

    await withSessionExpiry(() => {}, fetchImpl)('http://office/me/avatar', init);

    expect(fetchImpl).toHaveBeenCalledWith('http://office/me/avatar', init);
  });

  it.each([
    ['a mute 401', Response.json({ error: 'unauthorized' }, { status: 401 })],
    ['a 401 that is not JSON', new Response('<!doctype html>', { status: 401 })],
    ['the reason on another status', Response.json(EXPIRED_BODY, { status: 403 })],
    ['a success', Response.json({ avatarId: 'x', chosen: true }, { status: 200 })],
  ])('ignores %s', async (_name, answer) => {
    const onExpired = vi.fn();

    await withSessionExpiry(onExpired, async () => answer)('http://office/me/avatar');

    expect(onExpired).not.toHaveBeenCalled();
  });

  it('a network failure stays a network failure', async () => {
    const onExpired = vi.fn();
    const down = withSessionExpiry(onExpired, async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(down('http://office/me/avatar')).rejects.toThrow('Failed to fetch');
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('without a fetch of its own uses the global one at request time', async () => {
    const onExpired = vi.fn();
    const wrapped = withSessionExpiry(onExpired);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(EXPIRED_BODY, { status: 401 })));

    await wrapped('http://office/admin/session');

    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
