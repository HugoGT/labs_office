import { describe, expect, it, vi } from 'vitest';
import {
  RecordingError,
  getRecordingUrl,
  resolveRecordingsUrl,
  startRecording,
  stopRecording,
} from './recordingClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveRecordingsUrl', () => {
  it('derives the HTTP base from the Colyseus endpoint, like the token URL', () => {
    expect(resolveRecordingsUrl('ws://localhost:2567')).toBe('http://localhost:2567/recordings');
    expect(resolveRecordingsUrl('wss://office.example.com')).toBe('https://office.example.com/recordings');
  });

  it('no endpoint means no server to record with', () => {
    expect(resolveRecordingsUrl(null)).toBeNull();
    expect(resolveRecordingsUrl(undefined)).toBeNull();
  });
});

describe('startRecording / stopRecording', () => {
  it('POSTs sessionId, spaceId and the ID token to /start', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { spaceId: 'sala', startedBy: 'ses', startedAt: 1 }),
    );

    const result = await startRecording(
      { url: 'http://h/recordings', sessionId: 'ses', token: 'jwt', spaceId: 'sala' },
      fetchImpl,
    );

    expect(result).toEqual({ spaceId: 'sala', startedBy: 'ses', startedAt: 1 });
    expect(fetchImpl).toHaveBeenCalledWith('http://h/recordings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses', spaceId: 'sala', token: 'jwt' }),
    });
  });

  it('omits a null token: the open mode the server expects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { spaceId: 'sala' }));

    await stopRecording({ url: 'http://h/recordings', sessionId: 'ses', token: null, spaceId: 'sala' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/recordings/stop',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 'ses', spaceId: 'sala' }) }),
    );
  });

  it('rejects with a typed RecordingError carrying status and code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'already-recording' }));

    const error = await startRecording(
      { url: 'http://h/recordings', sessionId: 'ses', spaceId: 'sala' },
      fetchImpl,
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RecordingError);
    expect(error).toMatchObject({ status: 409, code: 'already-recording' });
  });

  it('an unreadable error body still rejects, with code "unknown"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 502 }));

    const error = await stopRecording(
      { url: 'http://h/recordings', sessionId: 'ses', spaceId: 'sala' },
      fetchImpl,
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RecordingError);
    expect(error).toMatchObject({ status: 502, code: 'unknown' });
  });
});

describe('getRecordingUrl (#58)', () => {
  it('POSTs the recording id, and download only when asked, to /url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { url: 'http://m/k?sig', expiresAt: 9 }));

    const result = await getRecordingUrl(
      { url: 'http://h/recordings', sessionId: 'ses', token: 'jwt', recordingId: 'rec-1', download: true },
      fetchImpl,
    );

    expect(result).toEqual({ url: 'http://m/k?sig', expiresAt: 9 });
    expect(fetchImpl).toHaveBeenCalledWith('http://h/recordings/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses', recordingId: 'rec-1', token: 'jwt', download: true }),
    });
  });

  it('rejects with RecordingError on 403/409', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'not-ready' }));

    const error = await getRecordingUrl(
      { url: 'http://h/recordings', sessionId: 'ses', recordingId: 'rec-1' },
      fetchImpl,
    ).catch((err: unknown) => err);

    expect(error).toMatchObject({ status: 409, code: 'not-ready' });
  });
});
