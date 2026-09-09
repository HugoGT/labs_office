/**
 * Resolucion de la configuracion de LiveKit (PRD 6.3), en el mismo espiritu
 * que `officeEndpoint.ts`: puro y sin `import.meta` dentro, para poder
 * probarlo sin montar Vite.
 *
 * D6: la matriz de degradacion ("Colyseus abajo => nunca intentar LiveKit")
 * se codifica aqui como una propiedad pura de la configuracion en vez de un
 * `if` suelto dentro del hook. `officeEndpoint: null` es la unica forma de
 * apagar LiveKit por completo.
 */

export const DEFAULT_LIVEKIT_PORT = 7880;

export interface LivekitConfig {
  /** Derivado del endpoint de Colyseus (mismo `http.Server`, ver diseno). */
  tokenUrl: string;
  /**
   * `null` significa "usa la url que devuelva la respuesta del token": el
   * servidor es la fuente de verdad. `VITE_LIVEKIT_URL` es solo un override
   * de desarrollo para apuntar a otro LiveKit sin tocar el servidor.
   */
  url: string | null;
}

export interface LivekitConfigSources {
  /** `import.meta.env.VITE_LIVEKIT_URL`, si esta definida. */
  configuredUrl?: string;
  /** El endpoint de Colyseus ya resuelto (`resolveOfficeEndpoint`). */
  officeEndpoint?: string | null;
}

function deriveTokenUrl(officeEndpoint: string): string {
  // El mismo `http.Server` sirve WebSocket (Colyseus) y HTTP (la ruta del
  // token, `createOfficeServer.ts`), asi que basta con cambiar de esquema.
  const httpBase = officeEndpoint
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
  return `${httpBase}/livekit/token`;
}

export function resolveLivekitConfig({
  configuredUrl,
  officeEndpoint,
}: LivekitConfigSources): LivekitConfig | null {
  if (officeEndpoint === null || officeEndpoint === undefined) return null;

  const trimmed = configuredUrl?.trim();
  // Una variable puesta a vacio apaga el override a proposito, distinto de
  // no haberla puesto nunca: en ambos casos el resultado es `null` (usa la
  // url del servidor), pero la decision explicita merece su propia prueba.
  const url = trimmed ? trimmed : null;

  return { tokenUrl: deriveTokenUrl(officeEndpoint), url };
}
