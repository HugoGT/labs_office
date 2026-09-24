/**
 * Authorization chain shared by every HTTP route that acts on behalf of a live
 * Colyseus session: `/livekit/token` and `/recordings/*` (#5). Extracted from
 * `handleLivekitToken` so the order of the guards, which is part of the
 * contract, lives in one place.
 */

import type { LiveSessionRegistry } from './liveSessions.ts';
import { spaceIdAt } from './spaces/spaceMembership.ts';
import type { SpacesDirectory } from './spaces/spacesPort.ts';
import type { IdTokenVerifier } from './verifyIdToken.ts';

export type SessionGuardResult =
  | { ok: true; sessionId: string; spaceId: string | null }
  | { ok: false; status: 400 | 401 | 403; body: { error: string } };

/**
 * Body validation, ID token and session ownership, in that order. The space,
 * if any, is only parsed here: whether the session is inside it is
 * `sessionIsInSpace`, because each route decides differently what a missing
 * spaces store means.
 */
export async function guardSessionRequest(
  body: unknown,
  sessions: LiveSessionRegistry,
  auth?: IdTokenVerifier,
): Promise<SessionGuardResult> {
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { ok: false, status: 400, body: { error: 'invalid-request' } };
  }

  // Mismo 400 que el de arriba y por la misma razon: un `spaceId` con un tipo
  // que no es ni texto ni ausencia deliberada (`null`) es un cuerpo mal
  // formado, no una pregunta de autorizacion.
  const rawSpaceId = (body as { spaceId?: unknown } | null)?.spaceId;
  if (rawSpaceId !== undefined && rawSpaceId !== null && typeof rawSpaceId !== 'string') {
    return { ok: false, status: 400, body: { error: 'invalid-request' } };
  }
  const spaceId: string | null = typeof rawSpaceId === 'string' ? rawSpaceId : null;

  // Con auth activa, la credencial se comprueba ANTES que nada que hable de la
  // sesion. El orden no es cosmetico: si `unknown-session` fuese primero, quien
  // sondea sin token distinguiria un `sessionId` vivo (401) de uno inventado
  // (403), que es justo el oraculo que este 401 mudo quiere negarle. Un token
  // ausente o con el tipo cambiado tambien cae aqui, y responde 401 y no 400,
  // por lo mismo: el llamante solo aprende "no autorizado".
  const identity = auth ? await auth.verify((body as { token?: unknown }).token) : null;
  if (auth && identity === null) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }

  if (!sessions.has(sessionId)) {
    return { ok: false, status: 403, body: { error: 'unknown-session' } };
  }

  // La guarda de verdad: estar autenticado no basta, hay que ser el dueno de
  // ESTA sesion. Sin esto cualquier participante podia leer el `sessionId` de
  // otro en el estado de la sala y mintar un token en su nombre -- con su
  // propio token valido, asi que la verificacion de firma no lo habria
  // frenado. Se separa del 401 a proposito: aqui el llamante ya ha probado
  // quien es, y decirle que esa sesion no es suya no le revela nada que no
  // supiese.
  if (identity !== null && sessions.uidOf(sessionId) !== identity.uid) {
    return { ok: false, status: 403, body: { error: 'forbidden-session' } };
  }

  return { ok: true, sessionId, spaceId };
}

/**
 * Whether the LAST tracked position of the session (`sessions.positionOf`)
 * falls inside `spaceId`. An unknown space and a session that never moved are
 * both `false`, so callers answer the same 403 and leak no oracle of which
 * spaces exist or who is where.
 */
export async function sessionIsInSpace(
  sessionId: string,
  spaceId: string,
  sessions: LiveSessionRegistry,
  spaces: SpacesDirectory,
): Promise<boolean> {
  const known = await spaces.listSpaces();
  const pos = sessions.positionOf(sessionId);
  return (pos ? spaceIdAt(pos, known) : null) === spaceId;
}
