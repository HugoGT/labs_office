/**
 * Adaptador HTTP del puerto de administracion de escritorios (#7, slice 5).
 * Unico modulo del panel que conoce `fetch` para estas rutas, igual que
 * `adminClient.ts` lo es del de invitaciones.
 *
 * ## Dos prefijos, y por eso la base es la RAIZ
 *
 * Las escrituras cuelgan de `/admin/desks` y corren la guarda de rol. La
 * lectura NO: es `GET /desks`, que cuelga de la raiz porque la lee cada
 * cliente al arrancar y solo exige credencial. No existe ningun
 * `GET /admin/desks`, asi que esta es la unica lectura posible -- y sirve,
 * porque trae el ocupante ya resuelto, que es justo lo que el panel necesita
 * para decir cuales estan libres y quien esta en los demas.
 *
 * Que un panel de administracion lea por una ruta que no es de administracion
 * no es un descuido del servidor: quien se sienta donde es la misma pregunta
 * para quien administra y para quien entra a la oficina, y una segunda ruta
 * seria una segunda consulta que mantener en paralelo.
 *
 * ## Las cuatro escrituras van por POST
 *
 * Ninguna por PUT/PATCH/DELETE: el middleware de CORS del servidor anuncia
 * `GET,POST,OPTIONS`, asi que cualquier otro verbo moriria en el preflight del
 * navegador antes de llegar a Express.
 */

import type {
  AdminDesk,
  AdminDeskOccupant,
  CreateDeskInput,
  DeskAdminPort,
  UpdateDeskInput,
} from './deskAdminPort';
import { AdminError } from './adminPort';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';

export interface DeskAdminClientOptions {
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
 * El ocupante servido a lo que este panel pinta, o `null` si no cumple la
 * forma. `items` llega en la respuesta y se queda fuera: la decoracion es de
 * la persona y este panel no la toca (ver `deskAdminPort.AdminDeskOccupant`).
 */
function toOccupant(raw: unknown): AdminDeskOccupant | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  if (!isNonEmptyString(row.id)) return null;
  // `null` es un dato, no un hueco: el directorio no obliga a tener nombre
  // visible, y convertirlo en cadena vacia haria pasar por "sin nombre" a
  // quien simplemente llego con uno que no se leyo.
  if (row.displayName !== null && typeof row.displayName !== 'string') return null;

  return { id: row.id, displayName: row.displayName };
}

/**
 * Una fila servida a un `AdminDesk`, o `null` si no cumple la forma. Sin
 * convertir a pixeles: el panel trabaja en TILES, que es lo que se escribe en
 * el formulario y lo que guarda el servidor.
 */
function toAdminDesk(raw: unknown): AdminDesk | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  // Sin `id` no se puede mover ni borrar, y sin `label` no se puede nombrar en
  // la tabla lo que se esta a punto de tocar.
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.label)) return null;
  if (!isFiniteNumber(row.x) || !isFiniteNumber(row.y)) return null;
  if (!isFiniteNumber(row.w) || !isFiniteNumber(row.h)) return null;

  // `undefined` no vale: un escritorio libre llega con `occupant: null`
  // explicito, y una respuesta a la que le falta el campo no es la de este
  // servidor. Darlo por libre pintaria como vacio el sitio de alguien.
  const occupant = row.occupant === null ? null : toOccupant(row.occupant);
  if (row.occupant !== null && occupant === null) return null;

  return { id: row.id, label: row.label, x: row.x, y: row.y, w: row.w, h: row.h, occupant };
}

/**
 * Valida la respuesta ENTERA o la rechaza entera, mismo criterio que
 * `game/desksClient.parseOfficeDesks` y por una razon propia del panel:
 * quedarse con las filas buenas ofreceria mover un escritorio a unas
 * coordenadas que ya ocupa otro que nunca llego a pintarse, y el 409
 * resultante seria inexplicable desde lo que se ve en pantalla.
 */
function parseAdminDesk(raw: unknown): AdminDesk {
  const desk = toAdminDesk(raw);
  if (desk === null) throw new AdminError('unknown');
  return desk;
}

export function createDeskAdminClient(
  { baseUrl, getIdToken }: DeskAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): DeskAdminPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      notConfigured: 'desks-not-configured',
      // Los dos 409 de estas rutas (#10, S2 3.5): `desk-overlap` (otro
      // escritorio) y `desk-space-overlap` (una sala). `desk-taken` no esta
      // en la lista -- lo provoca alguien cogiendo sitio desde la oficina,
      // no el panel, y esta ruta no puede darlo.
      conflicts: ['desk-overlap', 'desk-space-overlap'],
    },
    fetchImpl,
  );

  /** `encodeURIComponent` y no interpolacion cruda: un id con barra inventaria un segmento que el servidor no tiene. */
  function deskPath(id: string, suffix = ''): string {
    return `/admin/desks/${encodeURIComponent(id)}${suffix}`;
  }

  return {
    async listDesks(): Promise<AdminDesk[]> {
      // El servidor envuelve la lista en un objeto (contrato fijo); el puerto
      // promete el array, asi que el desempaquetado vive aqui y no en el panel.
      const { desks } = await request<{ desks: unknown[] }>('/desks');
      if (!Array.isArray(desks)) throw new AdminError('unknown');
      return desks.map(parseAdminDesk);
    },

    async createDesk(input: CreateDeskInput): Promise<AdminDesk> {
      // Se manda solo lo que el servidor lee. Ni `id` ni `occupantId`: el id lo
      // genera la base de datos y quien se sienta lo decide esa persona.
      return parseAdminDesk(
        await request('/admin/desks', jsonBody({ label: input.label, x: input.x, y: input.y })),
      );
    },

    async updateDesk(id: string, input: UpdateDeskInput): Promise<AdminDesk> {
      // Se copian solo las claves PRESENTES, igual que hace el servidor:
      // mandar la posicion al renombrar devolveria el escritorio a la ultima
      // que se leyo si alguien lo movio mientras tanto.
      const patch: UpdateDeskInput = {};
      if (input.label !== undefined) patch.label = input.label;
      if (input.x !== undefined) patch.x = input.x;
      if (input.y !== undefined) patch.y = input.y;

      return parseAdminDesk(await request(deskPath(id), jsonBody(patch)));
    },

    async deleteDesk(id: string): Promise<void> {
      await request<{ deleted: true }>(deskPath(id, '/delete'), { method: 'POST' });
    },
  };
}
