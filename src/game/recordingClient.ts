/**
 * HTTP client for `POST /recordings/start` and `POST /recordings/stop`
 * (`server/src/recording/recordingRoutes.ts`, #5). Mirrors
 * `livekitTokenClient.ts`: `fetch` is injected, and failures reject with a
 * typed error so the caller decides what to tell the user.
 *
 * Success carries no state the UI should trust: whether a room is recorded is
 * read from the synced Colyseus state, which every occupant sees.
 */

import { officeHttpBase } from './livekitEndpoint';

export interface RecordingRequest {
  /** Base URL, `.../recordings`; see `resolveRecordingsUrl`. */
  url: string;
  /** The Colyseus session acting. */
  sessionId: string;
  /** ID token, absent or null without auth (same open mode as the token route). */
  token?: string | null;
  spaceId: string;
}

export interface RecordingStarted {
  spaceId: string;
  startedBy: string;
  startedAt: number;
}

/** Request for a finished recording (#58); `download` asks for an attachment. */
export interface RecordingUrlRequest {
  url: string;
  sessionId: string;
  token?: string | null;
  recordingId: string;
  download?: boolean;
}

export interface RecordingUrl {
  url: string;
  /** Epoch milliseconds; the URL stops working after it. */
  expiresAt: number;
}

export class RecordingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Recording request failed (status ${status}, ${code})`);
    this.name = 'RecordingError';
    this.status = status;
    this.code = code;
  }
}

/** `null` without a Colyseus endpoint: there is no server to record with. */
export function resolveRecordingsUrl(officeEndpoint: string | null | undefined): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;
  return `${officeHttpBase(officeEndpoint)}/recordings`;
}

async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function post(url: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new RecordingError(response.status, await errorCodeOf(response));
  }
  return response.json();
}

function actionBody({ sessionId, token, spaceId }: RecordingRequest): Record<string, unknown> {
  const body: { sessionId: string; spaceId: string; token?: string } = { sessionId, spaceId };
  if (token) body.token = token;
  return body;
}

export async function startRecording(
  request: RecordingRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<RecordingStarted> {
  return (await post(`${request.url}/start`, actionBody(request), fetchImpl)) as RecordingStarted;
}

export async function stopRecording(request: RecordingRequest, fetchImpl: typeof fetch = fetch): Promise<void> {
  await post(`${request.url}/stop`, actionBody(request), fetchImpl);
}

export async function getRecordingUrl(
  { url, sessionId, token, recordingId, download }: RecordingUrlRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<RecordingUrl> {
  const body: { sessionId: string; recordingId: string; token?: string; download?: boolean } = {
    sessionId,
    recordingId,
  };
  if (token) body.token = token;
  if (download) body.download = true;
  return (await post(`${url}/url`, body, fetchImpl)) as RecordingUrl;
}
