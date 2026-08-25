/**
 * Reconciliacion entre el estado remoto de Colyseus y los avatares dibujados.
 *
 * Deliberadamente ignorante de Phaser: recibe un `sink` con create/update/
 * destroy y no sabe si detras hay un contenedor, un div o un doble de test.
 * Asi la regla que de verdad importa -- crear una vez y actualizar despues, no
 * recrear en cada mensaje -- se prueba en jsdom sin arrancar un motor grafico.
 */

export interface RemotePlayerSnapshot {
  sessionId: string;
  name: string;
  x: number;
  y: number;
  status: string;
  facing: string;
}

export interface RemoteAvatarSink<TAvatar> {
  create(snapshot: RemotePlayerSnapshot): TAvatar;
  update(avatar: TAvatar, snapshot: RemotePlayerSnapshot): void;
  destroy(avatar: TAvatar): void;
}

export interface RemoteAvatarRegistryOptions {
  /**
   * Sesion propia. Su snapshot se descarta entero: el jugador local ya se
   * dibuja con `spawnPlayer` y responde al teclado al instante. Dibujarlo otra
   * vez desde el estado del servidor pondria un clon encima, moviendose con el
   * retardo de la red.
   */
  ignoreSessionId?: string;
}

export interface RemoteAvatarRegistry<TAvatar> {
  upsert(snapshot: RemotePlayerSnapshot): void;
  remove(sessionId: string): void;
  clear(): void;
  get(sessionId: string): TAvatar | undefined;
  sessionIds(): string[];
}

export function createRemoteAvatarRegistry<TAvatar>(
  sink: RemoteAvatarSink<TAvatar>,
  options: RemoteAvatarRegistryOptions = {},
): RemoteAvatarRegistry<TAvatar> {
  const avatars = new Map<string, TAvatar>();

  return {
    upsert(snapshot) {
      if (snapshot.sessionId === options.ignoreSessionId) return;

      const existing = avatars.get(snapshot.sessionId);
      if (existing === undefined) {
        avatars.set(snapshot.sessionId, sink.create(snapshot));
        return;
      }
      sink.update(existing, snapshot);
    },
    remove(sessionId) {
      const avatar = avatars.get(sessionId);
      if (avatar === undefined) return;
      avatars.delete(sessionId);
      sink.destroy(avatar);
    },
    clear() {
      for (const avatar of avatars.values()) sink.destroy(avatar);
      avatars.clear();
    },
    get(sessionId) {
      return avatars.get(sessionId);
    },
    sessionIds() {
      return [...avatars.keys()];
    },
  };
}

/** Numero de texturas de avatar disponibles (`av0`..`av9`, ver `textures.ts`). */
const AVATAR_VARIANTS = 10;

/**
 * Elige la textura de un avatar remoto a partir de su sesion. Determinista a
 * proposito: la clave no puede depender del orden de llegada ni del azar, o el
 * mismo compañero cambiaria de aspecto entre mensajes.
 */
export function avatarKeyFor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) % 1_000_003;
  }
  return `av${hash % AVATAR_VARIANTS}`;
}
