/**
 * HTTP adapter of `GET|POST /me/avatar` and of the pack catalog the selector
 * offers (art migration, step 5). `fetch` is injected, as in
 * `displayNameClient.ts`, to test the whole contract without Vite or a server.
 *
 * Nothing here throws: the entrance is waiting for a concrete answer, and the
 * closed outcomes of `characterPort.ts` say every case. A 401 preserves the
 * access denial; a network failure or anything unexpected is `failed`.
 *
 * ## The catalog is the manifest the office loads
 *
 * The selector reads `assets/pack/manifest.json`, the same file
 * `ArtPackLoader` reads once inside the office, through the same pure parser
 * (`parseArtPackManifest`). That keeps "what you pick" and "what the office
 * draws" one list. The server still checks every choice against its own
 * registered catalog, so a stale manifest can only offer a piece the server
 * then refuses with a readable reason.
 *
 * Characters an Admin uploaded (#121) come from the office server's uploads
 * manifest, the second catalog the office loader reads, joined after the pack
 * the same way (`combineArtManifests`). Without it the selector is the pack's.
 */

import { combineArtManifests, findPiece, parseArtPackManifest, type ArtCatalog } from '../game/artPack';
import { readAccessDenied } from './authErrors';
import type {
  CharacterCatalog,
  CharacterOption,
  CharacterPort,
  InvalidCharacterReason,
  ReadCharacterResult,
  SaveCharacterResult,
} from './characterPort';

/** Same default as `displayNameClient.ts`: a hung server cannot leave the entrance unresolved. */
const DEFAULT_TIMEOUT_MS = 3000;

export interface CharacterClientOptions {
  /** Already derived with `deriveDisplayNameBaseUrl`, without a trailing slash. */
  baseUrl: string;
  /** Called on EVERY request and never stored: the ID token expires every hour. */
  getIdToken: () => Promise<string | null>;
  /** Manifest of the pack, relative to the page like the office's. */
  manifestUrl: string;
  /** Manifest of the Admin uploads (`artUploadsManifestUrl`); absent: the pack only. */
  uploadsManifestUrl?: string | null;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function manifestFolder(manifestUrl: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
}

/**
 * The characters that carry both sheets the previews need, pack first, each
 * with its own folder. A piece from the uploads manifest carries its author,
 * which the selector credits (#122).
 */
function characterOptions(catalog: ArtCatalog, uploadsUrl: string | null): CharacterCatalog | null {
  const { manifest } = catalog;
  const options = manifest.pieces.flatMap((piece): CharacterOption[] => {
    if (piece.kind !== 'character') return [];
    const walk = piece.files.find((file) => file.role === 'walk' && file.imageKind === 'character-walk');
    const seated = piece.files.find((file) => file.role === 'seated' && file.imageKind === 'character-seated');
    const source = catalog.sourceOf(piece.id);
    if (walk === undefined || seated === undefined || source === undefined) return [];
    const folder = manifestFolder(source);
    const author = uploadsUrl !== null && source === uploadsUrl ? piece.author : null;
    return [{ id: piece.id, name: piece.name, walkUrl: `${folder}${walk.path}`, seatedUrl: `${folder}${seated.path}`, author }];
  });
  if (options.length === 0) return null;
  const fallback = findPiece(manifest, manifest.defaults.character)?.id;
  const defaultId = options.some((option) => option.id === fallback) ? (fallback as string) : options[0].id;
  return { options, defaultId };
}

function invalidReason(body: unknown): InvalidCharacterReason {
  return isRecord(body) && body.reason === 'retired-piece' ? 'retired-piece' : 'unknown-piece';
}

export function createCharacterClient(
  { baseUrl, getIdToken, manifestUrl, uploadsManifestUrl = null, timeoutMs = DEFAULT_TIMEOUT_MS }: CharacterClientOptions,
  fetchImpl: typeof fetch = fetch,
): CharacterPort {
  /** `null` when it never happened: no token, network down or timeout. */
  async function request(url: string, init: RequestInit, withToken: boolean): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (withToken) {
        const token = await getIdToken();
        if (token === null) return null;
        headers.Authorization = `Bearer ${token}`;
      }
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      return await fetchImpl(url, {
        ...init,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  return {
    async read(): Promise<ReadCharacterResult> {
      const response = await request(`${baseUrl}/me/avatar`, { method: 'GET' }, true);
      if (response === null) return { outcome: 'failed' };
      if (response.status === 401) return readAccessDenied(response);
      if (response.status === 503) return { outcome: 'unavailable' };
      if (!response.ok) return { outcome: 'failed' };
      const body = await json(response);
      if (!isRecord(body) || typeof body.avatarId !== 'string' || typeof body.chosen !== 'boolean') {
        return { outcome: 'failed' };
      }
      return { outcome: 'ok', avatarId: body.avatarId, chosen: body.chosen };
    },

    async save(avatarId): Promise<SaveCharacterResult> {
      const response = await request(
        `${baseUrl}/me/avatar`,
        { method: 'POST', body: JSON.stringify({ avatarId }) },
        true,
      );
      if (response === null) return { outcome: 'failed' };
      if (response.status === 401) return readAccessDenied(response);
      if (response.status === 400) return { outcome: 'invalid', reason: invalidReason(await json(response)) };
      if (response.status === 503) return { outcome: 'unavailable' };
      if (!response.ok) return { outcome: 'failed' };
      const body = await json(response);
      if (!isRecord(body) || typeof body.avatarId !== 'string') return { outcome: 'failed' };
      return { outcome: 'ok', avatarId: body.avatarId };
    },

    async catalog(): Promise<CharacterCatalog | null> {
      /** A catalog that cannot be read counts as empty, never as a failure of the other. */
      const read = async (url: string | null) => {
        if (url === null) return { manifest: null, url: '' };
        const response = await request(url, { method: 'GET' }, false);
        const manifest = response === null || !response.ok ? null : parseArtPackManifest(await json(response));
        return { manifest, url };
      };
      const [pack, uploads] = await Promise.all([read(manifestUrl), read(uploadsManifestUrl)]);
      // Without the pack there is no default to fall back on: no selector at all.
      if (pack.manifest === null) return null;
      const catalog = combineArtManifests([pack, uploads]);
      return catalog === null ? null : characterOptions(catalog, uploadsManifestUrl);
    },
  };
}
