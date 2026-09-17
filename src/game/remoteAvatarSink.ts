/**
 * Puente entre el registro puro de avatares remotos y Phaser. Aqui vive todo
 * lo que necesita un motor grafico real, y por eso se prueba en la capa
 * navegador; la regla de crear-una-vez-y-actualizar sigue viviendo en
 * `remoteAvatars.ts`, en jsdom.
 */

import type Phaser from 'phaser';
import {
  makeCharacter,
  setCharacterFacing,
  setCharacterStatus,
  type CharacterContainer,
} from './characters';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  FACINGS,
  MOVE_INTERVAL_MS,
  isPresenceStatus,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import { avatarKeyFor, type RemoteAvatarSink, type RemotePlayerSnapshot } from './remoteAvatars';

/** Contenedor de avatar remoto: guarda su interpolacion en curso. */
export interface RemoteAvatarContainer extends CharacterContainer {
  glideTween?: Phaser.Tweens.Tween;
}

/**
 * Mismo limite de confianza que `facingOf`: el servidor ya sanea el estado,
 * pero lo que llega aqui viene por red y un codigo desconocido dejaria el
 * punto de la pildora sin color.
 */
function statusOf(raw: string): PresenceStatus {
  return isPresenceStatus(raw) ? raw : DEFAULT_STATUS;
}

/**
 * El servidor ya valida `facing`, pero esto es un limite de confianza distinto:
 * lo que llega aqui viene por red y una clave desconocida pediria una textura
 * inexistente, que en Phaser es un cuadro verde de "missing texture".
 */
function facingOf(raw: string): Facing {
  return (FACINGS as readonly string[]).includes(raw) ? (raw as Facing) : DEFAULT_FACING;
}

export function createPhaserAvatarSink(
  scene: Phaser.Scene,
): RemoteAvatarSink<RemoteAvatarContainer> {
  return {
    create(snapshot: RemotePlayerSnapshot) {
      // Se construye en (0,0) y se coloca despues porque `makeCharacter` toma
      // coordenadas de tile y aqui ya vienen en pixeles del servidor.
      const container = makeCharacter(
        scene,
        snapshot.name,
        0,
        0,
        avatarKeyFor(snapshot.sessionId),
        statusOf(snapshot.status),
      ) as RemoteAvatarContainer;
      container.setPosition(snapshot.x, snapshot.y);
      container.setDepth(snapshot.y);
      return container;
    },

    update(avatar, snapshot) {
      setCharacterFacing(avatar, facingOf(snapshot.facing));
      // Antes de #1 el estado era inmutable y `update` podia ignorarlo sin
      // consecuencias. Ahora cambia en mitad de la sesion, y no reconciliarlo
      // dejaria a alguien pintado "En linea" mientras esta en "No molestar".
      setCharacterStatus(avatar, statusOf(snapshot.status));
      avatar.glideTween?.stop();
      // Se interpola en vez de saltar: el servidor publica ~10 veces por
      // segundo, asi que un `setPosition` directo haria que los demas se
      // movieran a tirones de 10 Hz en vez de andar.
      avatar.glideTween = scene.tweens.add({
        targets: avatar,
        x: snapshot.x,
        y: snapshot.y,
        duration: MOVE_INTERVAL_MS,
        ease: 'Linear',
        onComplete: () => {
          avatar.glideTween = undefined;
        },
      });
    },

    destroy(avatar) {
      avatar.glideTween?.stop();
      avatar.destroy();
    },
  };
}
