/**
 * Phaser layer of the map zoom (map-zoom). It turns real wheel, key and bridge
 * input into a zoom TARGET (one of `ZOOM_STOPS`, via the pure rules of
 * `mapZoom.ts`) and eases the main camera to it a little each frame. Same
 * pattern as `CameraPanLayer`: the layer listens and moves the camera, the
 * pure module decides.
 *
 * It never touches the camera bounds: `CameraPanLayer` owns them every frame,
 * and must be constructed AFTER this layer so the bounds of a frame already see
 * that frame's zoom (listeners run in UPDATE order). The view center, and so
 * the followed player, stays fixed by itself: Phaser zooms around the middle
 * of the viewport.
 */

import Phaser from 'phaser';
import { isEditableElementFocused } from './inputFocusGuard';
import {
  INITIAL_WHEEL_STATE,
  accumulateWheel,
  applyZoomAction,
  zoomKeyAction,
  zoomStep,
  zoomView,
  type WheelState,
  type ZoomAction,
  type ZoomStore,
} from './mapZoom';
import type { OfficeBridge } from './officeBridge';

export interface CameraZoomLayerOptions {
  scene: Phaser.Scene;
  /** The main camera: the only one that zooms. */
  camera: Phaser.Cameras.Scene2D.Camera;
  /** Its wheel never zooms the map. */
  minimap?: Phaser.Cameras.Scene2D.Camera;
  bridge: OfficeBridge;
  /** Remembers the chosen stop; absent means nothing is persisted. */
  store?: ZoomStore;
  /** Clock for wheel accumulation; injectable so tests do not wait on real time. */
  now?: () => number;
  /** Keys are ignored while a text field has the keystroke. */
  isEditableFocused?: () => boolean;
}

export class CameraZoomLayer {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly minimap?: Phaser.Cameras.Scene2D.Camera;
  private readonly bridge: OfficeBridge;
  private readonly store?: ZoomStore;
  private readonly now: () => number;
  private readonly isEditableFocused: () => boolean;
  // Captured now: after `game.destroy()` the scene no longer reaches its plugins.
  private readonly input: Phaser.Input.InputPlugin;
  private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private readonly sceneEvents: Phaser.Events.EventEmitter;
  private readonly unsubscribeCommand: () => void;
  /** The animated zoom the camera has now; `target` is the stop it is heading to. */
  private current: number;
  private target: number;
  private wheelState: WheelState = INITIAL_WHEEL_STATE;
  private destroyed = false;

  private readonly onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number): void => {
    // Null before the first hit test; tolerated. `hitTestPointer` can also name
    // the main camera over the minimap when a world object is under it, so the
    // minimap rect is checked on its own.
    if (pointer.camera && pointer.camera !== this.camera) return;
    if (this.isOverMinimap(pointer)) return;
    const native = pointer.event as WheelEvent | undefined;
    const { state, step } = accumulateWheel(this.wheelState, {
      deltaY,
      deltaMode: native?.deltaMode ?? 0,
      ctrlKey: native?.ctrlKey ?? false,
      now: this.now(),
    });
    this.wheelState = state;
    if (step !== 0) this.apply(step === 1 ? 'in' : 'out');
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.isEditableFocused()) return;
    const action = zoomKeyAction(event);
    if (action !== null) this.apply(action);
  };

  private readonly onUpdate = (): void => {
    if (this.current === this.target) return;
    const { value } = zoomStep(this.current, this.target);
    this.current = value;
    this.camera.setZoom(value);
  };

  constructor(options: CameraZoomLayerOptions) {
    this.camera = options.camera;
    this.minimap = options.minimap;
    this.bridge = options.bridge;
    this.store = options.store;
    this.now = options.now ?? (() => performance.now());
    this.isEditableFocused = options.isEditableFocused ?? (() => isEditableElementFocused());
    this.input = options.scene.input;
    this.keyboard = options.scene.input.keyboard;
    this.sceneEvents = options.scene.events;
    // The scene (setupCameras) sets the starting zoom before this layer exists.
    this.current = this.target = this.camera.zoom;

    this.input.on('wheel', this.onWheel);
    this.keyboard?.on('keydown', this.onKeyDown);
    this.sceneEvents.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.unsubscribeCommand = this.bridge.onCommand('zoom', ({ action }) => this.apply(action));
    this.bridge.emit('zoomchanged', zoomView(this.target));
  }

  /** Idempotent: SHUTDOWN and DESTROY of the scene both call it. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.off('wheel', this.onWheel);
    this.keyboard?.off('keydown', this.onKeyDown);
    this.sceneEvents.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.unsubscribeCommand();
  }

  private apply(action: ZoomAction): void {
    const next = applyZoomAction(this.target, action);
    if (next === this.target) return;
    this.target = next;
    this.store?.save(next);
    this.bridge.emit('zoomchanged', zoomView(next));
  }

  private isOverMinimap(pointer: Phaser.Input.Pointer): boolean {
    const map = this.minimap;
    if (!map) return false;
    return pointer.x >= map.x && pointer.x < map.x + map.width && pointer.y >= map.y && pointer.y < map.y + map.height;
  }
}
