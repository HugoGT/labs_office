/**
 * Conmutador de ruta del SPA (#24, punto 1). Puro y sin React ni
 * `window` dentro, en el mismo espiritu que `officeEndpoint.ts`: quien llama
 * le pasa el `location.pathname` y se prueba sin montar nada.
 *
 * No se agrego ninguna dependencia de router a proposito. Hay exactamente dos
 * pantallas, ninguna ruta anidada y ningun parametro: un router traeria
 * historial, `<Link>`, coincidencia de patrones y su propio peso al bundle
 * (#24, punto 8: el panel existe justamente para no descargar de mas) a
 * cambio de resolver un `switch` de dos casos. El dia que haya subrutas
 * reales, este archivo es el unico sitio que hay que cambiar.
 *
 * El destino se decide una sola vez, en el arranque: no hay navegacion en
 * cliente entre la oficina y el panel -- al panel se llega escribiendo la URL
 * -- asi que tampoco hace falta escuchar `popstate`.
 */

export type Route = 'office' | 'dashboard';

/** Formas de la misma ruta que un enlace copiado a mano puede tomar. */
const DASHBOARD_PATHS = new Set(['/dashboard', '/dashboard/']);

export function resolveRoute(pathname: string): Route {
  // Las rutas de una URL distinguen mayusculas, pero quien las escribe a mano
  // no: `/Dashboard` es la misma intencion y mandarlo a la oficina seria un
  // fallo mudo. La comparacion se hace en minusculas y nada mas: cualquier
  // otra normalizacion (barras repetidas, subrutas) cae a la oficina, que es
  // el destino seguro.
  return DASHBOARD_PATHS.has(pathname.toLowerCase()) ? 'dashboard' : 'office';
}
