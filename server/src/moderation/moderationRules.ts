/**
 * Pure rules of meeting moderation (#282): who moderates, what a request
 * asks for, and which microphones that means.
 *
 * Who moderates reuses the admin roles (`canAdminister`): no role per room
 * and no list of who may publish. A meeting of 6-8 speakers needs someone
 * able to silence a noisy microphone, not a stage.
 */

import { canAdminister } from '../directory/accessDecision.ts';
import type { Role } from '../directory/directoryPort.ts';
import type { PublishedMicrophone } from './moderationPort.ts';

export function canModerate(role: Role): boolean {
  return canAdminister(role);
}

export type MuteTarget = { kind: 'one'; sessionId: string } | { kind: 'all' };

/**
 * Exactly one of `target` (a sessionId) or `all: true`. Anything else is
 * `null` and a 400: a body that lost its field must not mute everyone.
 */
export function parseMuteTarget(body: unknown): MuteTarget | null {
  if (typeof body !== 'object' || body === null) return null;
  const { target, all } = body as { target?: unknown; all?: unknown };
  if (target !== undefined && all !== undefined) return null;
  if (all === true) return { kind: 'all' };
  if (typeof target === 'string' && target.length > 0) return { kind: 'one', sessionId: target };
  return null;
}

/** "Everyone" never includes the moderator's own microphone. */
export function microphonesToMute(
  microphones: readonly PublishedMicrophone[],
  moderatorSessionId: string,
  target: MuteTarget,
): PublishedMicrophone[] {
  return microphones.filter((microphone) =>
    target.kind === 'all' ? microphone.identity !== moderatorSessionId : microphone.identity === target.sessionId,
  );
}
