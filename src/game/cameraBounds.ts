/**
 * Geometria pura de la camara principal mientras navega sin el jugador (#53,
 * #98), sin Phaser -- mismo motivo que `cameraPan.ts`: probarla con
 * `pnpm test`.
 *
 * Por que existe: `setBounds` al tamano del mundo (2048x1408) clampa el
 * scroll a un rango vacio en cuanto la vista iguala o supera el mundo. En un
 * monitor 1920x1080 el drag solo movia la vista en vertical y en 2560x1440 no
 * la movia nada: el pan "no funcionaba en uso real" aunque los tests, con un
 * canvas pequeno, pasaban.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollRange {
  min: number;
  max: number;
}

/** A menos de esto del destino el planeo aterriza exacto (medio pixel no se ve). */
export const GLIDE_ARRIVE_PX = 0.5;

/**
 * Rango de scroll que deja `Camera.clampX/clampY` de Phaser 3.90 para un eje:
 * `viewSize` es `camera.width` (o `height`) y la vista visible real es
 * `viewSize / zoom`.
 */
export function scrollRange(
  boundsStart: number,
  boundsSize: number,
  viewSize: number,
  zoom: number,
): ScrollRange {
  const displaySize = viewSize / zoom;
  const min = boundsStart + (displaySize - viewSize) / 2;
  return { min, max: Math.max(min, min + boundsSize - displaySize) };
}

/** Scroll que centra `point` en la vista, igual que `Camera.centerOn` (no depende del zoom). */
export function centeredScroll(point: number, viewSize: number): number {
  return point - viewSize / 2;
}

/**
 * Bounds mientras la camara navega: el mundo ampliado media vista visible por
 * cada lado, de modo que cualquier punto del mundo (esquinas incluidas) puede
 * quedar centrado y el pan no se pierde en el vacio mas alla de eso.
 */
export function navigationBounds(
  world: Rect,
  view: { width: number; height: number },
  zoom: number,
): Rect {
  const displayWidth = view.width / zoom;
  const displayHeight = view.height / zoom;
  return {
    x: world.x - displayWidth / 2,
    y: world.y - displayHeight / 2,
    width: world.width + displayWidth,
    height: world.height + displayHeight,
  };
}

/**
 * Un cuadro de planeo: la misma interpolacion por cuadro que `startFollow`
 * con lerp, para que volver al jugador o ir a un punto del minimapa se sienta
 * igual que el seguimiento de siempre.
 */
export function glideStep(
  current: number,
  target: number,
  lerp: number,
): { value: number; arrived: boolean } {
  const next = current + (target - current) * lerp;
  if (Math.abs(target - next) < GLIDE_ARRIVE_PX) return { value: target, arrived: true };
  return { value: next, arrived: false };
}
