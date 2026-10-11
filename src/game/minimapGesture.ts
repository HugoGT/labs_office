/**
 * Pure click-or-drag rule of the minimap, without Phaser, like `cameraPan.ts`.
 * A region taller than the minimap scrolls by dragging it, so a click can no
 * longer act on press: it acts on release, only when the pointer stayed
 * within `PAN_THRESHOLD_PX` of the press (the main map's click/drag line).
 * Coordinates are screen pixels; `MinimapLayer` turns them into world ones.
 */

import { PAN_THRESHOLD_PX } from './cameraPan';

export type MinimapGestureState =
  | { kind: 'idle' }
  | { kind: 'pressed'; originX: number; originY: number }
  | { kind: 'dragging'; lastX: number; lastY: number };

export type MinimapGestureEvent =
  // Only a primary press over the minimap camera; the layer filters the rest.
  | { kind: 'down'; x: number; y: number }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'up' }
  // Released outside the canvas: never a click.
  | { kind: 'cancel' };

export type MinimapGestureEffect =
  | { kind: 'none' }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'click'; x: number; y: number };

const NONE: MinimapGestureEffect = { kind: 'none' };
const IDLE: MinimapGestureState = { kind: 'idle' };

export function reduceMinimapGesture(
  state: MinimapGestureState,
  event: MinimapGestureEvent,
): { state: MinimapGestureState; effect: MinimapGestureEffect } {
  switch (state.kind) {
    case 'idle':
      if (event.kind === 'down') return { state: { kind: 'pressed', originX: event.x, originY: event.y }, effect: NONE };
      return { state, effect: NONE };

    case 'pressed':
      if (event.kind === 'move') {
        const dx = event.x - state.originX;
        const dy = event.y - state.originY;
        if (Math.hypot(dx, dy) <= PAN_THRESHOLD_PX) return { state, effect: NONE };
        return { state: { kind: 'dragging', lastX: event.x, lastY: event.y }, effect: { kind: 'scroll', dx, dy } };
      }
      if (event.kind === 'up') return { state: IDLE, effect: { kind: 'click', x: state.originX, y: state.originY } };
      if (event.kind === 'cancel') return { state: IDLE, effect: NONE };
      return { state, effect: NONE };

    case 'dragging':
      if (event.kind === 'move') {
        return {
          state: { kind: 'dragging', lastX: event.x, lastY: event.y },
          effect: { kind: 'scroll', dx: event.x - state.lastX, dy: event.y - state.lastY },
        };
      }
      if (event.kind === 'up' || event.kind === 'cancel') return { state: IDLE, effect: NONE };
      return { state, effect: NONE };
  }
}
