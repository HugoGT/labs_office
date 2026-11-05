/**
 * HTTP client for `POST /livekit/mute` (`server/src/moderation/moderationRoutes.ts`,
 * #282). Mirrors `recordingClient.ts`: `fetch` is injected, and a refusal
 * rejects with a typed error so the caller decides what to tell the user.
 */

import { officeHttpBase } from './livekitEndpoint';

export interface MuteRequest {
  /** `.../livekit/mute`; see `resolveMuteUrl`. */
  url: string;
  /** The Colyseus session moderating. */
  sessionId: string;
  /** ID token, absent or null without auth. */
  token?: string | null;
  /** The meeting room the server must place the moderator in. */
  spaceId: string;
  /** One person's sessionId, or `'all'` for everyone else in the room. */
  target: string;
}

export class ModerationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Moderation request failed (status ${status}, ${code})`);
    this.name = 'ModerationError';
    this.status = status;
    this.code = code;
  }
}

/** `null` without a Colyseus endpoint: there is no server to moderate with. */
export function resolveMuteUrl(officeEndpoint: string | null | undefined): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;
  return `${officeHttpBase(officeEndpoint)}/livekit/mute`;
}

async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Resolves how many microphones the server muted. */
export async function muteMicrophones(
  { url, sessionId, token, spaceId, target }: MuteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const body: Record<string, unknown> = { sessionId, spaceId };
  if (token) body.token = token;
  if (target === 'all') body.all = true;
  else body.target = target;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ModerationError(response.status, await errorCodeOf(response));
  const { muted } = (await response.json()) as { muted?: unknown };
  return typeof muted === 'number' ? muted : 0;
}
