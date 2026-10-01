/**
 * Puente entre el registro puro de avatares remotos y Phaser. Aqui vive todo
 * lo que necesita un motor grafico real, y por eso se prueba en la capa
 * navegador; la regla de crear-una-vez-y-actualizar sigue viviendo en
 * `remoteAvatars.ts`, en jsdom.
 */

import type Phaser from 'phaser';
import { FACING_WALK_DIRECTION } from './artContract';
import { initialAnimation } from './characterAnimation';
import {
  animateCharacter,
  enableCharacterClicks,
  enablePeerBody,
  makeCharacter,
  setCharacterFacing,
  setCharacterSheets,
  setCharacterStatus,
  type CharacterContainer,
  type CharacterSheets,
} from './characters';
import type { OfficeBridge } from './officeBridge';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  FACINGS,
  MOVE_INTERVAL_MS,
  isPresenceStatus,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import { STATUS_LABEL } from './presence';
import { avatarKeyFor, type RemoteAvatarSink, type RemotePlayerSnapshot } from './remoteAvatars';

/** Contenedor de avatar remoto: guarda su interpolacion en curso. */
export interface RemoteAvatarContainer extends CharacterContainer {
  glideTween?: Phaser.Tweens.Tween;
  /**
   * Version de config de espacios con la que ESTE par deriva su sala (#7,
   * D4). Vive en el contenedor por la misma razon que `status`:
   * `proximityTick` la lee para el predicado mutuo de `audiblePeers`.
   */
  spacesVersion: string;
  /** Persisted character of this peer (art migration, step 5), drawn from its sheets. */
  avatarId: string | null;
  /**
   * Seat the server has this peer on (step 6), or `null`. The scene reads it
   * so it never offers someone else's seat.
   */
  seat: string | null;
  /** Position at the last animation frame: a peer's walk comes from how far its tween moved it. */
  lastX: number;
  lastY: number;
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
  bridge: OfficeBridge,
  // #59: opcional para no romper a quien todavia llama con dos argumentos
  // (tests existentes, cualquier otro consumidor futuro sin fisica). Con un
  // grupo, cada peer nace con un cuerpo Arcade inmovible y se une a el; sin
  // el, comportamiento de hoy -- ningun peer bloquea al jugador.
  peerBodies?: Phaser.GameObjects.Group,
  // Art migration, step 6: loaded sheets of a character, or `null` to keep
  // the procedural body. Optional for the same reason as `peerBodies`.
  characterSheets: (avatarId: string | null) => CharacterSheets | null = () => null,
): RemoteAvatarSink<RemoteAvatarContainer> {
  /** Seat facing from the snapshot: while seated, the replicated facing is the seat's. */
  const seatOf = (avatar: RemoteAvatarContainer, snapshot: RemotePlayerSnapshot): void => {
    avatar.seat = snapshot.seat;
    avatar.seatFacing = snapshot.seat === null ? null : facingOf(snapshot.facing);
  };

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
      container.lastX = snapshot.x;
      container.lastY = snapshot.y;
      container.spacesVersion = snapshot.spacesVersion;
      container.avatarId = snapshot.avatarId;
      setCharacterFacing(container, facingOf(snapshot.facing));
      container.animation = initialAnimation(FACING_WALK_DIRECTION[container.facing]);
      seatOf(container, snapshot);
      setCharacterSheets(container, characterSheets(snapshot.avatarId));
      // Sorted (and posed) right away, before any `update()` of the scene.
      animateCharacter(container, { dx: 0, dy: 0, dtMs: 0 });

      // #59: cuerpo de colision, solo si el llamador nos dio donde unirse.
      // `Group.add` registra su propio listener de DESTROY (Group.js:615),
      // asi que `destroy()` mas abajo no necesita retirarlo a mano.
      if (peerBodies) {
        enablePeerBody(scene, container);
        peerBodies.add(container);
      }

      // Issue #2, unit 8 (kill switch): el peer es el unico personaje clicable
      // de la oficina, con `stopPropagation` para no colar el clic al mapa de
      // fondo. Lo que importa (D1, comentario del diseno): nombre y estado se
      // leen del CONTENEDOR en el momento del clic, nunca del `snapshot` de
      // creacion -- un peer muta via `update()` mientras vive, y cerrar sobre
      // el snapshot ofreceria "Llamar" sobre alguien que acaba de pasar a
      // "No molestar".
      // The clickable area follows the drawn body, walking or seated (step 6).
      enableCharacterClicks(container);
      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // #98: por el minimapa el clic es navegacion (`CameraPanLayer`), no
        // un menu sobre un avatar que ahi mide unos pixeles.
        if (pointer.camera && pointer.camera !== scene.cameras.main) return;
        pointer.event.stopPropagation();
        bridge.emit('peermenu', {
          sessionId: snapshot.sessionId,
          name: container.nameText,
          status: STATUS_LABEL[container.status],
          statusCode: container.status,
          x: (pointer.event as MouseEvent).clientX,
          y: (pointer.event as MouseEvent).clientY,
        });
      });

      return container;
    },

    update(avatar, snapshot) {
      setCharacterFacing(avatar, facingOf(snapshot.facing));
      // Antes de #1 el estado era inmutable y `update` podia ignorarlo sin
      // consecuencias. Ahora cambia en mitad de la sesion, y no reconciliarlo
      // dejaria a alguien pintado "En linea" mientras esta en "No molestar".
      setCharacterStatus(avatar, statusOf(snapshot.status));
      avatar.spacesVersion = snapshot.spacesVersion;
      if (avatar.avatarId !== snapshot.avatarId) setCharacterSheets(avatar, characterSheets(snapshot.avatarId));
      avatar.avatarId = snapshot.avatarId;
      seatOf(avatar, snapshot);
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
