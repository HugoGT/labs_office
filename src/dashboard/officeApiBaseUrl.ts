/**
 * De donde cuelga la API HTTP de la oficina, para todos los adaptadores del
 * panel (#7, slice 5). Puro y sin `import.meta` ni `fetch` dentro, mismo
 * espiritu que `routing/route.ts` y `game/officeEndpoint.ts`: quien llama le
 * pasa el endpoint ya resuelto y se prueba sin montar Vite.
 *
 * El mismo `http.Server` sirve el WebSocket de Colyseus y las rutas HTTP, asi
 * que la derivacion es solo un cambio de esquema.
 *
 * ## Por que la RAIZ y no `/admin`
 *
 * El panel de invitaciones vive entero bajo `/admin`, pero el de escritorios
 * no puede: la unica lectura de escritorios que el servidor ofrece es
 * `GET /desks`, que cuelga de la raiz porque la lee cada cliente al arrancar y
 * no solo el panel (ver la cabecera de `server/src/desks/desksRoutes.ts`). Una
 * base con `/admin` dentro dejaria a ese panel sin forma de leer nada.
 *
 * Por eso esta funcion da la raiz y cada adaptador escribe su camino entero:
 * asi se lee en el sitio de la llamada que `/desks` y `/admin/desks` son dos
 * superficies distintas, con dos guardas distintas, y no un detalle de como se
 * armo una URL.
 *
 * `resolveAdminBaseUrl` delega aqui en vez de repetir el cambio de esquema:
 * dos copias acaban divergiendo, y el dia que el servidor separe HTTP del
 * WebSocket una de las dos se quedaria apuntando al sitio viejo sin que nadie
 * hubiese tocado nada. `game/desksClient.ts` mantiene la suya a proposito --
 * importarla desde aqui meteria el chunk del panel en el bundle de la oficina,
 * que es justo lo que la carga diferida de `App` existe para evitar.
 */

export interface OfficeApiBaseUrlSources {
  /** El endpoint de Colyseus ya resuelto (`resolveOfficeEndpoint`). */
  officeEndpoint?: string | null;
}

/**
 * `null` cuando no hay servidor: sin el no hay nada que administrar, y una URL
 * inventada solo produciria un fallo de red confuso.
 */
export function resolveOfficeApiBaseUrl({
  officeEndpoint,
}: OfficeApiBaseUrlSources): string | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;

  return officeEndpoint.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}
