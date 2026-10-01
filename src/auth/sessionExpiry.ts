/**
 * The HTTP half of the maximum session age (#128). The server refuses a login
 * older than its maximum with `401 { error: 'unauthorized', reason:
 * 'session-expired' }` on every authenticated route; the join already says it
 * through `OfficeAccessDeniedError`.
 *
 * A `fetch` decorator and not one more outcome per port: the entrance clients
 * (`displayNameClient`, `characterClient`) and every dashboard client already
 * take an injected `fetch`, and each keeps reading the same response it read
 * before (a 401 is still `failed` or `AdminError('unauthorized')`). The only
 * new thing is the side channel to `App`, which signs out and shows the login
 * notice, so the person types email and password instead of staying on an
 * error a reload cannot clear (the same token comes back).
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
