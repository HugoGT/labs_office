/**
 * Reductor puro del editor de layout en oficina (#74, PR3b). React es dueno
 * de este estado (diseno: "Interaction state owner" -> reductor puro en
 * React), la escena solo sigue el comando derivado de el via
 * `toLayoutEditCommand` -- mismo patron que `setStatus`/`spacesconfig`. Sin
 * Phaser ni red aqui dentro: se prueba en jsdom sin montar ningun juego.
 */

import { boundsOverlap, type SpaceBounds } from './layoutGeometry';
import { MAP_H, MAP_W, TILE } from './mapData';
import type { TileRect } from './terrainGrid';

/** Las dos clases de item editable (#74). `room` cubre tambien las salas incorporadas. */
export type EditorKind = 'desk' | 'room';

/**
 * Union de estados del diseno, literal: off (nada activo), idle (un `kind`
 * elegido, nada seleccionado), selected (un item existente elegible para
 * mover/borrar), placing (ghost tile-encajado pendiente de confirmar, en
 * modo crear o mover), saving (mutacion en vuelo, entrada suspendida).
 */
export type EditorState =
  | { tag: 'off' }
  | { tag: 'idle'; kind: EditorKind }
  | { tag: 'selected'; kind: EditorKind; id: string }
  | { tag: 'placing'; kind: EditorKind; mode: 'create' }
  | { tag: 'placing'; kind: EditorKind; mode: 'move'; id: string }
  | { tag: 'saving'; kind: EditorKind };

export type EditorAction =
  | { type: 'enter'; kind: EditorKind }
  | { type: 'exit' }
  | { type: 'select'; id: string }
  | { type: 'deselect' }
  | { type: 'startCreate' }
  | { type: 'startMove' }
  | { type: 'cancelPlacing' }
  | { type: 'confirmPlacement' }
  | { type: 'saveSucceeded' }
  | { type: 'saveFailed' };

export const OFF_STATE: EditorState = { tag: 'off' };

/**
 * Transiciones puras. `exit` es universal (cualquier estado -> off) y se
 * decide ANTES del switch por estado: un literal nuevo sin campos de sobra
 * es, por construccion, la garantia de "sin ghost ni pick que sobreviva".
 */
export function reduceEditorState(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'exit') return OFF_STATE;

  switch (state.tag) {
    case 'off':
      return action.type === 'enter' ? { tag: 'idle', kind: action.kind } : state;

    case 'idle':
      if (action.type === 'select') return { tag: 'selected', kind: state.kind, id: action.id };
      if (action.type === 'startCreate') return { tag: 'placing', kind: state.kind, mode: 'create' };
      return state;

    case 'selected':
      if (action.type === 'deselect') return { tag: 'idle', kind: state.kind };
      if (action.type === 'startMove') {
        return { tag: 'placing', kind: state.kind, mode: 'move', id: state.id };
      }
      return state;

    case 'placing':
      if (action.type === 'cancelPlacing') return { tag: 'idle', kind: state.kind };
      if (action.type === 'confirmPlacement') return { tag: 'saving', kind: state.kind };
      return state;

    case 'saving':
      // Fin del guardado en cualquier sentido: vuelve a un estado
      // interactivo, no se queda atascado esperando una respuesta que ya
      // llego. Distinguir exito de fallo con mas detalle es trabajo del
      // hook que cablea esto con el cliente admin (PR3c).
      if (action.type === 'saveSucceeded' || action.type === 'saveFailed') {
        return { tag: 'idle', kind: state.kind };
      }
      return state;

    default:
      return state;
  }
}

export interface TilePosition {
  tx: number;
  ty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Encaja el ghost de w x h tiles sobre el puntero: lo centra y lo recorta a
 * `[0, MAP_W-w] x [0, MAP_H-h]` para que nunca se pueda soltar mitad fuera
 * del mapa. `worldX`/`worldY` llegan en PIXELES (mismo espacio que
 * `Pointer.worldX/worldY`); `w`/`h` en TILES.
 */
export function snapToTile(worldX: number, worldY: number, w: number, h: number): TilePosition {
  const rawTx = Math.round(worldX / TILE - w / 2);
  const rawTy = Math.round(worldY / TILE - h / 2);

  return {
    tx: clamp(rawTx, 0, MAP_W - w),
    ty: clamp(rawTy, 0, MAP_H - h),
  };
}

/**
 * Proyeccion, en TILES, de un admin space (sala o cubiculo de escritorio)
 * relevante para el pre-chequeo de solape del editor. Deliberadamente propio
 * de `game/` y no `AdminSpace` de `dashboard/spacesAdminPort.ts`: el juego
 * nunca importa del dashboard (ni al reves), asi que quien cablee el hook en
 * PR3c proyecta `AdminSpace[]` a esta forma en la frontera.
 */
export interface LayoutObstacleItem {
  id: string;
  kind: EditorKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A que item propio excluir de los obstaculos mientras se mueve algo que ya
 * existe. Una sala se identifica por `id`, como cualquier otra clave de
 * pertenencia estable de este repo. Un cubiculo de escritorio NO: su fila en
 * `/spaces` tiene un id distinto al del escritorio en `/desks` (son dos
 * tablas), asi que la unica correlacion posible es kind `desk` + la misma
 * x/y que ese escritorio tiene ahora mismo.
 */
export interface MovingExclusion {
  kind: EditorKind;
  id?: string;
  x?: number;
  y?: number;
}

function toSpaceBounds(item: LayoutObstacleItem): SpaceBounds {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/**
 * Obstaculos = todos los admin spaces salvo el propio del item en
 * movimiento. `moving: null` cubre tanto "no hay nada que excluir" (crear)
 * como "esto no es una colocacion" -- ninguno de los dos tiene un propio que
 * descartar.
 */
export function computeObstacles(
  items: readonly LayoutObstacleItem[],
  moving: MovingExclusion | null,
): readonly SpaceBounds[] {
  if (moving === null) return items.map(toSpaceBounds);

  return items
    .filter((item) => {
      if (item.kind !== moving.kind) return true;
      if (moving.kind === 'room') return item.id !== moving.id;
      return !(item.x === moving.x && item.y === moving.y);
    })
    .map(toSpaceBounds);
}

function tileRectToBounds(rect: TileRect): SpaceBounds {
  return { x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0 + 1, h: rect.y1 - rect.y0 + 1 };
}

/** Mismo pre-chequeo que `boundsOverlap`, pero contra la lista entera de obstaculos servida al ghost. */
export function isPlacementValid(placement: SpaceBounds, obstacles: readonly TileRect[]): boolean {
  return !obstacles.some((obstacle) => boundsOverlap(placement, tileRectToBounds(obstacle)));
}

/** Un rectangulo pickable identificado -- lo que la capa de Phaser necesita para saber QUE se clico. */
export interface PickableRect extends TileRect {
  id: string;
}

function toPickableRect(item: LayoutObstacleItem): PickableRect {
  return { id: item.id, x0: item.x, y0: item.y, x1: item.x + item.w - 1, y1: item.y + item.h - 1 };
}

function toObstacleTileRect(bounds: SpaceBounds): TileRect {
  return { x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.w - 1, y1: bounds.y + bounds.h - 1 };
}

/**
 * Comando `layoutedit` que la escena sigue (D: bridge command, `null` = salir
 * del modo edicion). `pickable` lleva id -- a diferencia del `TileRect[]`
 * suelto del diseno original -- porque sin id `layoutpick` no podria decir
 * QUE se clico; ver la nota de desviacion en el apply-progress de esta PR.
 */
export interface LayoutEditCommand {
  pickable: readonly PickableRect[];
  selectedId: string | null;
  placing: { w: number; h: number; obstacles: readonly TileRect[] } | null;
}

export interface ToLayoutEditCommandOptions {
  items: readonly LayoutObstacleItem[];
  /** Tamano del item en colocacion. Requerido solo mientras `state.tag === 'placing'`. */
  placingSize?: { w: number; h: number };
  /** Que excluir de los obstaculos mientras se mueve un item existente. Ausente al crear uno nuevo. */
  moving?: MovingExclusion | null;
}

/**
 * Proyeccion pura de `EditorState` + contexto (la geometria que el reductor
 * no guarda) al comando que la escena consume. `off` es el unico estado que
 * produce `null`. `saving` no expone pickable ni ghost: la entrada esta
 * suspendida (mutacion en vuelo), asi que no hay nada que ofrecer clicar.
 */
export function toLayoutEditCommand(
  state: EditorState,
  options: ToLayoutEditCommandOptions,
): LayoutEditCommand | null {
  if (state.tag === 'off') return null;
  if (state.tag === 'saving') return { pickable: [], selectedId: null, placing: null };

  const pickable = options.items.map(toPickableRect);

  if (state.tag !== 'placing') {
    return { pickable, selectedId: state.tag === 'selected' ? state.id : null, placing: null };
  }

  const { w, h } = options.placingSize ?? { w: 0, h: 0 };
  const obstacles = computeObstacles(options.items, options.moving ?? null).map(toObstacleTileRect);

  return { pickable, selectedId: null, placing: { w, h, obstacles } };
}
