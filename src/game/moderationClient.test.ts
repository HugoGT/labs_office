import { describe, expect, it, vi } from 'vitest';
import { ModerationError, muteMicrophones, resolveMuteUrl } from './moderationClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn>): unknown {
  return JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
}

describe('resolveMuteUrl (#282)', () => {
  it('derives the HTTP route from the Colyseus endpoint, like the token URL', () => {
    expect(resolveMuteUrl('ws://localhost:2567')).toBe('http://localhost:2567/livekit/mute');
    expect(resolveMuteUrl('wss://office.example.com')).toBe('https://office.example.com/livekit/mute');
  });

  it('no endpoint means no server to moderate with', () => {
    expect(resolveMuteUrl(null)).toBeNull();
    expect(resolveMuteUrl(undefined)).toBeNull();
  });
});

describe('muteMicrophones (#282)', () => {
  const base = { url: 'http://h/livekit/mute', sessionId: 'ses', token: 'jwt', spaceId: 'junta' };

  it('POSTs one person as `target` and answers how many microphones went off', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { muted: 1 }));

    expect(await muteMicrophones({ ...base, target: 'ana' }, fetchImpl)).toBe(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://h/livekit/mute');
    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'ses', token: 'jwt', spaceId: 'junta', target: 'ana' });
  });

  it('POSTs everyone as `all: true`, without a token when there is no session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { muted: 3 }));

    expect(await muteMicrophones({ ...base, token: null, target: 'all' }, fetchImpl)).toBe(3);
    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'ses', spaceId: 'junta', all: true });
  });

  it('rejects with the status and code of a refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));

    const error = await muteMicrophones({ ...base, target: 'all' }, fetchImpl).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ModerationError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden' });
  });
});
