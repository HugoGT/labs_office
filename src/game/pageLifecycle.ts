/**
 * Aviso de que la pagina se va (issue #52).
 *
 * Existe para que cerrar la pestana siga siendo una salida INMEDIATA despues
 * de que el servidor aprendiese a esperar. La ventana de reconexion no
 * distingue por si sola "se murio la red" de "esta persona se fue": las dos
 * llegan como un socket que se cierra sin la trama consentida, asi que sin
 * este aviso cerrar la pestana dejaria el avatar plantado media oficina
 * durante 30 s. Avisando, la salida voluntaria vuelve a ser instantanea y la
 * ventana queda para lo que de verdad es transitorio.
 *
 * Se escucha `pagehide` y no `beforeunload` a proposito: `beforeunload` no
 * dispara de forma fiable en moviles ni cuando el navegador descarta una
 * pestana por memoria, que son justo los casos en los que alguien desaparece
 * sin decir nada.
 *
 * Y sigue siendo un aviso de BUENA FE, no una garantia: un corte de luz o un
 * proceso muerto a la fuerza no avisan de nada. Por eso esto no sustituye a la
 * ventana, la complementa -- salida limpia, baja inmediata; muerte violenta,
 * se espera por si vuelve.
 */

/**
 * La unica superficie de `window` que este modulo consume, declarada a mano.
 *
 * No se usa el tipo global del DOM a proposito: `tsconfig.server.json` compila
 * con `lib: ["ES2023"]` y SIN DOM, y alcanza este fichero a traves de
 * `src/**\/*.node.test.ts` -> `officeRoomClient.ts`. Esa ausencia de DOM no es
 * un descuido que haya que remendar anadiendo la libreria: es lo que garantiza
 * que el servidor no puede usar APIs de navegador ni por accidente. Declarar
 * solo lo que se consume la respeta, y es ademas el patron que ya sigue
 * `PlayersCallbacks` en `officeRoomClient.ts` con el schema de Colyseus.
 */
interface PageHideTarget {
  addEventListener(type: 'pagehide', handler: () => void): void;
  removeEventListener(type: 'pagehide', handler: () => void): void;
}

/**
 * El `window` del entorno, o `null` donde no hay pagina -- los tests de la capa
 * node, que corren el envoltorio contra un Colyseus real sin navegador. Se
 * comprueban los dos metodos y no solo la existencia del objeto: un `window`
 * a medias haria fallar el registro en tiempo de ejecucion, y aqui el precio de
 * equivocarse es que nadie avise de una salida.
 */
function pageHideTarget(): PageHideTarget | null {
  const candidate = (globalThis as { window?: Partial<PageHideTarget> }).window;
  if (!candidate) return null;

  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (candidate as PageHideTarget)
    : null;
}

/**
 * Registra `handler` y devuelve como soltarlo. Soltarlo es idempotente porque
 * el propio manejador se suelta a si mismo al dispararse, y despues `leave()`
 * vuelve a soltarlo por su cuenta: ese doble camino es el normal, no un error.
 *
 * Sin pagina devuelve un no-op, que es lo correcto: alli quien cierra la sesion
 * es siempre `leave()`.
 */
export function onPageHide(handler: () => void): () => void {
  const target = pageHideTarget();
  if (target === null) return () => {};

  target.addEventListener('pagehide', handler);
  return () => target.removeEventListener('pagehide', handler);
}
