/**
 * Reductor puro del editor de layout en oficina (#74, PR3b). React es dueno
 * de este estado (diseno: "Interaction state owner" -> reductor puro en
 * React), la escena solo sigue el comando derivado de el via
 * `toLayoutEditCommand` -- mismo patron que `setStatus`/`spacesconfig`. Sin
 * Phaser ni red aqui dentro: se prueba en jsdom sin montar ningun juego.
 */

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
