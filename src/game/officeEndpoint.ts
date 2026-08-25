/**
 * Resolucion del endpoint del servidor de avatares. Puro y sin `import.meta`
 * dentro, para poder probarlo sin montar Vite.
 *
 * El valor por defecto apunta al puerto local del servidor en vez de a `null`:
 * con `null` el multijugador solo funcionaria tras configurar una variable de
 * entorno, y el fallo silencioso mas caro es el que no se nota. Si el servidor
 * no esta levantado, la escena ya cae a modo solitario.
 */

export const DEFAULT_SERVER_PORT = 2567;

export interface EndpointSources {
  /** `import.meta.env.VITE_COLYSEUS_URL`, si esta definida. */
  configured?: string;
  /** `window.location`, para deducir el host cuando no hay configuracion. */
  protocol?: string;
  hostname?: string;
}

export function resolveOfficeEndpoint({
  configured,
  protocol,
  hostname,
}: EndpointSources): string | null {
  const trimmed = configured?.trim();
  // Una variable puesta a vacio es una forma explicita de apagar el
  // multijugador, distinta de no haberla puesto nunca.
  if (trimmed === '') return null;
  if (trimmed) return trimmed;
  if (!hostname) return null;

  // Sobre HTTPS hay que hablar WSS o el navegador bloquea la conexion por
  // contenido mixto.
  const scheme = protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${hostname}:${DEFAULT_SERVER_PORT}`;
}
