/**
 * Contrato estructural minimo que necesita cualquier consumidor de una pista
 * de LiveKit para adjuntarla/desvincularla de un elemento del DOM. Antes vivia
 * solo en `remoteAudioSink.ts` (unico consumidor hasta el slice 1); issue #17
 * agrega un segundo consumidor -- el video, que `livekitRoom.ts` reporta hacia
 * afuera en vez de adjuntarlo el mismo (ver D3: dos duenos de un mismo
 * `<video>` es un bug de orden de desmontaje) -- asi que el tipo se mueve
 * aqui, fuera de ambos, para que ninguno dependa del otro solo por esta forma.
 *
 * `RemoteTrack` y `LocalTrack` de `livekit-client` lo cumplen de forma
 * estructural sin que este archivo importe `livekit-client`: es lo que
 * mantiene el motor de LiveKit fuera de jsdom en las pruebas que solo
 * necesitan esta forma.
 */
export interface AttachableTrack {
  readonly kind: string;
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
}
