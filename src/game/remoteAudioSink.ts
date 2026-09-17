/**
 * Ultimo tramo del audio remoto: convertir una pista SUSCRITA en sonido.
 *
 * Suscribirse no reproduce nada. `publication.setSubscribed(true)` le pide la
 * pista al SFU y ahi se acaba: hasta que el `MediaStreamTrack` no cuelga de un
 * elemento multimedia del documento, el navegador no tiene donde reproducirlo
 * y el resultado es silencio con la conexion aparentemente sana (#18).
 *
 * Vive separado de `livekitRoom.ts` a proposito: aqui no se importa
 * `livekit-client`. El contrato que necesita (`kind`, `attach`, `detach`) lo
 * cumple `RemoteTrack` de forma estructural, asi que esta pieza -- la unica con
 * ciclo de vida de DOM -- se prueba entera sin sala, sin servidor y sin red.
 *
 * D-detach: `track.detach()` desvincula la pista de sus elementos pero NO los
 * saca del documento. Retirarlos es responsabilidad de este modulo; sin eso
 * cada salida del radio de proximidad dejaria un `<audio>` huerfano acumulando
 * en la pagina.
 */

import type { AttachableTrack } from './attachableTrack';

export interface RemoteAudioSink {
  /** Adjunta y reproduce. Idempotente: la misma pista nunca suena dos veces. */
  add(track: AttachableTrack): void;
  /** Desvincula y retira del DOM. Una pista desconocida es un no-op. */
  remove(track: AttachableTrack): void;
  /** Retira todas las pistas vivas. Es lo que corre al desconectar la sala. */
  clear(): void;
}

/** Las pistas de video tienen su propia superficie (#17); aqui solo audio. */
const AUDIO_KIND = 'audio';

export function createRemoteAudioSink(container: HTMLElement = document.body): RemoteAudioSink {
  const attached = new Map<AttachableTrack, HTMLMediaElement>();

  function detachTrack(track: AttachableTrack): void {
    const element = attached.get(track);
    if (!element) return;
    attached.delete(track);
    // Se retiran los elementos que devuelve el SDK ademas del propio: si la
    // pista estuviera adjunta a mas de uno, `detach()` los desvincula todos y
    // ninguno debe quedarse en el documento.
    for (const detached of track.detach()) detached.remove();
    element.remove();
  }

  return {
    add(track) {
      if (track.kind !== AUDIO_KIND || attached.has(track)) return;
      const element = track.attach();
      element.autoplay = true;
      // Sin layout: es una superficie de reproduccion, no un control visible.
      element.hidden = true;
      attached.set(track, element);
      container.appendChild(element);
    },
    remove(track) {
      detachTrack(track);
    },
    clear() {
      for (const track of [...attached.keys()]) detachTrack(track);
    },
  };
}
