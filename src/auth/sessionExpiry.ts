/**
 * The HTTP half of the maximum session age (#128). The server refuses a login
 * older than its maximum with `401 { error: 'unauthorized', reason:
 * 'session-expired' }` on every authenticated route; the join already says it
 * through `OfficeAccessDeniedError`.
 *
 * Dashboard clients keep reading the response as `AdminError('unauthorized')`;
 * this decorator also tells App to sign out and show the login notice. Entrance
 * clients instead preserve denial outcomes for AuthGate, without this decorator,
 * so a response has exactly one sign-out owner.
 */

import type { AccessDeniedReason } from '../game/officeProtocol';

const SESSION_EXPIRED: AccessDeniedReason = 'session-expired';

async function saysSessionExpired(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    // A clone, so the client behind still gets an unread body.
    const body: unknown = await response.clone().json();
    return typeof body === 'object' && body !== null && (body as { reason?: unknown }).reason === SESSION_EXPIRED;
  } catch {
    return false;
  }
}

/**
 * `fetchImpl` absent means the global `fetch`, looked up on each request and
 * not when wrapping, like the clients' own default.
 */
export function withSessionExpiry(onExpired: () => void, fetchImpl?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await (fetchImpl ?? globalThis.fetch)(input, init);
    if (await saysSessionExpired(response)) onExpired();
    return response;
  };
}
