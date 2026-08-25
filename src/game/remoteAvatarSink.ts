/**
 * Puente entre el registro puro de avatares remotos y Phaser. Aqui vive todo
 * lo que necesita un motor grafico real, y por eso se prueba en la capa
 * navegador; la regla de crear-una-vez-y-actualizar sigue viviendo en
 * `remoteAvatars.ts`, en jsdom.
 */

import type Phaser from 'phaser';
import { makeCharacter, setCharacterFacing, type CharacterContainer } from './characters';
import { STATUS_COLOR, type NpcStatus } from './npcData';
import { DEFAULT_FACING, FACINGS, MOVE_INTERVAL_MS, type Facing } from './officeProtocol';
import { avatarKeyFor, type RemoteAvatarSink, type RemotePlayerSnapshot } from './remoteAvatars';

/** Contenedor de avatar remoto: guarda su interpolacion en curso. */
export interface RemoteAvatarContainer extends CharacterContainer {
  glideTween?: Phaser.Tweens.Tween;
}

function statusColorOf(status: string): number {
  return STATUS_COLOR[status as NpcStatus] ?? STATUS_COLOR.g;
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
        statusColorOf(snapshot.status),
      ) as RemoteAvatarContainer;
      container.setPosition(snapshot.x, snapshot.y);
      container.setDepth(snapshot.y);
      return container;
    },

    update(avatar, snapshot) {
      setCharacterFacing(avatar, facingOf(snapshot.facing));
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
