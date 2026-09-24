/**
 * Cablea el reductor de `layoutEditor.ts` a un `SpacesAdminPort` real y al
 * bridge Phaser<->React (#74, PR4). Mismo patron que `useLayoutEditor.ts`
 * (PR3c), pero para salas (`kind: 'room'`) en vez de escritorios.
 *
 * ## Cruce sala<->escritorio (#74, PR4 addition)
 *
 * `listSpaces()` trae salas Y cubiculos de escritorio en la misma lista
 * (`kind: 'room' | 'desk'`): solo las de `kind: 'room'` son pickable aqui --
 * un cubiculo se administra desde `useLayoutEditor.ts`, y ofrecerlo como
 * pickable en este hook duplicaria esa administracion. Pero el ghost SI tiene
 * que ver los escritorios como obstaculo (misma regla del diseno: "obstaculos
 * = todos los admin spaces salvo el propio"), asi que este hook TAMBIEN lee
 * `desks.listDesks()` y los pasa como `obstacleItems` (ver la nota de
 * `toLayoutEditCommand`, PR4) sin nunca ofrecerlos como pickable. Los
 * cubiculos de la lista de `spaces` se descartan enteros para este proposito
 * -- serian el mismo escritorio contado dos veces si se sumaran a los que ya
 * trae `desks.listDesks()`.
 *
 * ## Tamano variable, a diferencia de un escritorio
 *
 * Un escritorio siempre mide `NEW_DESK_TILES` (3x3, fijo por el servidor).
 * Una sala no: su tamano lo elige quien administra en el formulario, asi que
 * `placingSize` en modo crear sale de lo pedido (`pendingCreateRef`), y en
 * modo mover del propio tamano actual de la sala seleccionada (`roomList`).
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import {
  OFF_STATE,
  reduceEditorState,
  toLayoutEditCommand,
  type EditorState,
  type LayoutObstacleItem,
} from '../game/layoutEditor';
import type { OfficeBridge } from '../game/officeBridge';

export interface UseSpaceEditorOptions {
  bridge: OfficeBridge;
  spaces: SpacesAdminPort;
  /** Solo para el pre-chequeo del ghost: ver la cabecera. */
  desks: DeskAdminPort;
  /** Se llaman tras cada mutacion con exito, para que la escena y el resto de la oficina converjan (paired-space sync). */
  refreshDesks: () => void;
  refreshSpaces: () => void;
}

export interface SpaceCreateInput {
  name: string;
  w: number;
  h: number;
  /** `null` es "sin limite", un dato real -- ver `spacesAdminPort.ts`. */
  capacity: number | null;
}

export interface UseSpaceEditorResult {
  state: EditorState;
  /** Solo salas (`kind: 'room'`) de lo ultimo leido en `spaces.listSpaces()`; nunca cubiculos. */
  spaces: readonly AdminSpace[];
  /** Ya traducido con `describeAdminError`, nunca el error crudo. */
  error: string | null;
  /** Escritura en vuelo: crear/mover (mientras `state.tag === 'saving'`) o borrar. */
  pending: boolean;
  enter: () => void;
  exit: () => void;
  /** Pide crear una nueva con estos datos; el ghost de colocacion sigue a continuacion. */
  startCreate: (input: SpaceCreateInput) => void;
  startMove: () => void;
  cancelPlacing: () => void;
  /** Selecciona una sala existente por id, igual que un `layoutpick` del mapa (misma accion del reductor). */
  select: (id: string) => void;
  deselect: () => void;
  /** Borra la seleccionada. Mismo patron que `useLayoutEditor.remove`: no pasa por `saving`. */
  remove: () => Promise<void>;
}

function isRoom(space: AdminSpace): boolean {
  return space.kind === 'room';
}

function toRoomObstacleItem(space: AdminSpace): LayoutObstacleItem {
  return { id: space.id, kind: 'room', x: space.x, y: space.y, w: space.w, h: space.h };
}

function toDeskObstacleItem(desk: AdminDesk): LayoutObstacleItem {
  return { id: desk.id, kind: 'desk', x: desk.x, y: desk.y, w: desk.w, h: desk.h };
}

export function useSpaceEditor({
  bridge,
  spaces,
  desks,
  refreshDesks,
  refreshSpaces,
}: UseSpaceEditorOptions): UseSpaceEditorResult {
  const [state, dispatch] = useReducer(reduceEditorState, OFF_STATE);
  const [roomList, setRoomList] = useState<readonly AdminSpace[]>([]);
  const [deskList, setDeskList] = useState<readonly AdminDesk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Lo pedido para el proximo `createSpace`, fuera del reductor: no tiene sitio propio en `EditorState`, mismo motivo que `pendingLabelRef` en `useLayoutEditor.ts`. */
  const pendingCreateRef = useRef<SpaceCreateInput | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const active = state.tag !== 'off';

  const reload = useCallback(async (): Promise<void> => {
    const [resolvedSpaces, resolvedDesks] = await Promise.all([spaces.listSpaces(), desks.listDesks()]);
    setRoomList(resolvedSpaces.filter(isRoom));
    setDeskList(resolvedDesks);
  }, [spaces, desks]);

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    void (async () => {
      const [resolvedSpaces, resolvedDesks] = await Promise.all([spaces.listSpaces(), desks.listDesks()]);
      // Misma regla que `useLayoutEditor`/`useDesks`: una respuesta tras salir del modo edicion no toca la lista.
      if (cancelled) return;
      setRoomList(resolvedSpaces.filter(isRoom));
      setDeskList(resolvedDesks);
    })();

    return () => {
      cancelled = true;
    };
    // `reload` no entra en las dependencias a proposito: solo se usa DESPUES
    // de una mutacion con exito, donde "salir de edicion mientras tanto"
    // vuelve a valer la pena descartar por la misma regla de arriba; nada
    // distinto ocurre por omitirlo aqui.
  }, [active, spaces, desks]);

  useEffect(() => bridge.on('layoutpick', ({ id }) => dispatch({ type: 'select', id })), [bridge]);

  useEffect(
    () =>
      bridge.on('layoutplace', ({ tx, ty, valid }) => {
        // Invalido: el ghost se queda donde esta, para reintentar sin perder lo pedido ni la seleccion.
        if (!valid) return;

        const current = stateRef.current;
        if (current.tag !== 'placing') return;

        const moveId = current.mode === 'move' ? current.id : null;
        const create = pendingCreateRef.current;

        dispatch({ type: 'confirmPlacement' });
        setError(null);
        setPending(true);

        void (async () => {
          try {
            if (moveId !== null) {
              await spaces.updateSpace(moveId, { x: tx, y: ty });
            } else if (create !== null) {
              await spaces.createSpace({ name: create.name, x: tx, y: ty, w: create.w, h: create.h, capacity: create.capacity });
            }
            pendingCreateRef.current = null;
            dispatch({ type: 'saveSucceeded' });
            refreshDesks();
            refreshSpaces();
            await reload();
          } catch (err) {
            // Fallo del servidor: se cuenta con `describeAdminError` y NO se relee nada, mismo criterio que `useLayoutEditor.ts`.
            setError(describeAdminError(err));
            dispatch({ type: 'saveFailed' });
          } finally {
            setPending(false);
          }
        })();
      }),
    [bridge, spaces, refreshDesks, refreshSpaces, reload],
  );

  const enter = useCallback(() => {
    setError(null);
    dispatch({ type: 'enter', kind: 'room' });
  }, []);

  const exit = useCallback(() => {
    pendingCreateRef.current = null;
    setError(null);
    dispatch({ type: 'exit' });
  }, []);

  const startCreate = useCallback((input: SpaceCreateInput) => {
    pendingCreateRef.current = input;
    setError(null);
    dispatch({ type: 'startCreate' });
  }, []);

  const startMove = useCallback(() => {
    setError(null);
    dispatch({ type: 'startMove' });
  }, []);

  const cancelPlacing = useCallback(() => {
    pendingCreateRef.current = null;
    dispatch({ type: 'cancelPlacing' });
  }, []);

  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);

  const deselect = useCallback(() => dispatch({ type: 'deselect' }), []);

  const remove = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.tag !== 'selected') return;

    setError(null);
    setPending(true);
    try {
      await spaces.deleteSpace(current.id);
      dispatch({ type: 'deselect' });
      refreshDesks();
      refreshSpaces();
      await reload();
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setPending(false);
    }
  }, [spaces, refreshDesks, refreshSpaces, reload]);

  useEffect(() => {
    const placingSize =
      state.tag === 'placing'
        ? state.mode === 'create'
          ? (pendingCreateRef.current ?? { w: 0, h: 0 })
          : (() => {
              const own = roomList.find((room) => room.id === state.id);
              return own === undefined ? { w: 0, h: 0 } : { w: own.w, h: own.h };
            })()
        : undefined;

    const moving: { kind: 'room'; id: string } | null =
      state.tag === 'placing' && state.mode === 'move' ? { kind: 'room', id: state.id } : null;

    const command = toLayoutEditCommand(state, {
      items: roomList.map(toRoomObstacleItem),
      obstacleItems: [...roomList.map(toRoomObstacleItem), ...deskList.map(toDeskObstacleItem)],
      placingSize,
      moving,
    });
    bridge.emitCommand('layoutedit', command);
  }, [state, roomList, deskList, bridge]);

  return {
    state,
    spaces: roomList,
    error,
    pending,
    enter,
    exit,
    startCreate,
    startMove,
    cancelPlacing,
    select,
    deselect,
    remove,
  };
}
