/**
 * Adaptador HTTP del puerto de administracion de espacios (#10 + #12, S3a).
 * Unico modulo del panel que conoce `fetch` para estas rutas, igual que
 * `deskAdminClient.ts` lo es del de escritorios.
 *
 * ## La lectura es la misma que usa la escena
 *
 * `GET /spaces` no cuelga de `/admin` y va SIN autenticar en el servidor (ver
 * la cabecera de `server/src/spaces/spacesRoutes.ts`): es la config que lee
 * cada cliente al arrancar, no solo el panel. Este adaptador manda igual el
 * token en cada peticion -- lo exige `officeAdminRequest.ts`, y quien abre
 * este panel ya tiene uno -- pero el servidor no lo necesita para esta ruta en
 * particular. Reusarla en vez de abrir una segunda bajo `/admin` evita
 * mantener dos consultas que dirian exactamente lo mismo.
 *
 * ## Las tres escrituras van por POST
 *
 * Ninguna por PUT/PATCH/DELETE, mismo motivo que `deskAdminClient.ts`: el
 * middleware de CORS del servidor anuncia `GET,POST,OPTIONS`.
 */

import type {
  AdminSpace,
  CreateSpaceInput,
  SpacesAdminPort,
  UpdateSpaceInput,
} from './spacesAdminPort';
import { AdminError } from './adminPort';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';

export interface SpacesAdminClientOptions {
  /** La RAIZ del servidor (`resolveOfficeApiBaseUrl`), sin `/admin`. */
  baseUrl: string;
  /** Se llama en CADA peticion y nunca se guarda: ver `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Una fila servida a un `AdminSpace`, o `null` si no cumple la forma. Sin
 * convertir a pixeles, igual que `deskAdminClient.toAdminDesk`: el panel
 * trabaja en TILES.
 */
function toAdminSpace(raw: unknown): AdminSpace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.name)) return null;
  if (!isFiniteNumber(row.x) || !isFiniteNumber(row.y)) return null;
  if (!isFiniteNumber(row.w) || !isFiniteNumber(row.h)) return null;
  // `null` es un dato ("sin limite"), no un hueco: el servidor lo sirve
  // siempre explicito, igual que el `occupant` de un escritorio libre.
  if (row.capacity !== null && !isFiniteNumber(row.capacity)) return null;
  if (row.kind !== 'room' && row.kind !== 'desk') return null;

  return {
    id: row.id,
    name: row.name,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    capacity: row.capacity as number | null,
    kind: row.kind,
  };
}

/**
 * Valida la respuesta de una escritura o la rechaza entera, mismo criterio
 * que `deskAdminClient.parseAdminDesk`.
 */
function parseAdminSpace(raw: unknown): AdminSpace {
  const space = toAdminSpace(raw);
  if (space === null) throw new AdminError('unknown');
  return space;
}

export function createSpacesAdminClient(
  { baseUrl, getIdToken }: SpacesAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): SpacesAdminPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      notConfigured: 'spaces-not-configured',
      // Los tres 409 de estas rutas (#10 + #12, ver `spacesRoutes.ts`):
      // `space-overlap` (otra sala), `space-name-taken` (nombre repetido) y
      // `space-owned-by-desk` (el id es en realidad un cubiculo). No incluye
      // `desk-space-overlap` -- lo provoca el panel de escritorios, no este.
      conflicts: ['space-overlap', 'space-name-taken', 'space-owned-by-desk'],
    },
    fetchImpl,
  );

  /** `encodeURIComponent` y no interpolacion cruda: un id con barra inventaria un segmento que el servidor no tiene. */
  function spacePath(id: string, suffix = ''): string {
    return `/admin/spaces/${encodeURIComponent(id)}${suffix}`;
  }

  return {
    async listSpaces(): Promise<AdminSpace[]> {
      // El cuerpo entero se valida o se rechaza entero, misma propiedad que
      // `game/spacesConfig.parseSpacesConfig`: `version` es un hash de la
      // lista COMPLETA, y no poder confiar en el cuerpo entero dejaria al
      // panel afirmando una lista que no termino de validar.
      const body = await request<{ spaces: unknown[]; version: unknown }>('/spaces');
      if (!isNonEmptyString(body.version)) throw new AdminError('unknown');
      if (!Array.isArray(body.spaces)) throw new AdminError('unknown');
      return body.spaces.map(parseAdminSpace);
    },

    async createSpace(input: CreateSpaceInput): Promise<AdminSpace> {
      // `capacity` viaja siempre, aunque no se haya escrito: ausente en el
      // formulario es "sin limite", y el servidor lo trata igual si falta,
      // pero mandarlo explicito deja un cuerpo predecible en cada peticion.
      return parseAdminSpace(
        await request(
          '/admin/spaces',
          jsonBody({
            name: input.name,
            x: input.x,
            y: input.y,
            w: input.w,
            h: input.h,
            capacity: input.capacity ?? null,
          }),
        ),
      );
    },

    async updateSpace(id: string, input: UpdateSpaceInput): Promise<AdminSpace> {
      // Se copian solo las claves PRESENTES, igual que hace el servidor:
      // `capacity` distingue "no lo toques" (ausente) de "quitale el limite"
      // (`null` presente).
      const patch: UpdateSpaceInput = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.x !== undefined) patch.x = input.x;
      if (input.y !== undefined) patch.y = input.y;
      if (input.w !== undefined) patch.w = input.w;
      if (input.h !== undefined) patch.h = input.h;
      if (input.capacity !== undefined) patch.capacity = input.capacity;

      return parseAdminSpace(await request(spacePath(id), jsonBody(patch)));
    },

    async deleteSpace(id: string): Promise<void> {
      await request<{ deleted: true }>(spacePath(id, '/delete'), { method: 'POST' });
    },
  };
}
