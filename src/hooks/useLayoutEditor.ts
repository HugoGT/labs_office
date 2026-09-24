/**
 * Cablea el reductor de `layoutEditor.ts` a un `DeskAdminPort` real y al
 * bridge Phaser<->React (#74, PR3c). Es el enganche que la nota de desviacion
 * de PR3b dejo pendiente: `LayoutObstacleItem` es propio de `game/` porque
 * `game/` nunca importa de `dashboard/`, asi que aqui, en `hooks/` -- que SI
 * puede importar de los dos -- es donde `AdminDesk[]` (tiles, `dashboard/`)
 * se proyecta a `LayoutObstacleItem[]` (tiles, `game/`).
 *
 * ## DESK-only en esta PR, y por que
 *
 * El reductor y `LayoutObstacleItem` ya son genericos para `kind: 'room'`,
 * pero las salas llegan en PR4 con su propio `SpacesAdminPort`. `items` sale
 * de `desks.listDesks()` y NO de `spacesAdminClient.listSpaces()` a
 * proposito: el cubiculo de un escritorio en `/spaces` tiene un id DISTINTO
 * al del escritorio en `/desks` (dos tablas -- ver la nota de PR3b), y
 * `layoutpick`/`layoutplace` necesitan el id REAL del escritorio para poder
 * llamar a `updateDesk`/`deleteDesk`. Consecuencia aceptada: el pre-chequeo
 * del ghost en esta PR solo ve OTROS ESCRITORIOS como obstaculo, nunca salas
 * -- una colocacion que pisa una sala se pinta verde en el cliente igual, y
 * el servidor la rechaza con `desk-space-overlap`, mostrado por
 * `describeAdminError`. Ampliar el pre-chequeo a salas es trabajo de cuando
 * exista una lectura compartida de `AdminSpace[]`, no de esta PR.
 *
 * ## `saving` del reductor solo cubre crear/mover, nunca borrar
 *
 * El reductor (PR3b) no tiene una transicion propia para borrar desde
 * `selected` -- solo `deselect` y `startMove`. Borrar no necesita un ghost
 * que suspender, asi que este hook lo trata como un efecto lateral fuera del
 * reductor: `pending` (propio, no del reductor) desactiva el boton mientras
 * la peticion esta en vuelo, y al acabar se dispara `deselect` en exito O en
 * fallo -- el item ya no existe en cualquiera de los dos casos si tuvo exito,
 * y si fallo seguir "seleccionando" un borrado que no ocurrio no aporta nada
 * que `error` no diga ya.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import {
  OFF_STATE,
  reduceEditorState,
  toLayoutEditCommand,
  type EditorState,
  type LayoutObstacleItem,
} from '../game/layoutEditor';
import type { OfficeBridge } from '../game/officeBridge';

/** Mismo tamano que el servidor fija para cada escritorio nuevo (`server/src/desks/deskRules.ts`'s `DESK_SIDE`); no se importa porque `game/`/`hooks/` no leen del servidor -- ver `deskAdminPort.ts`. */
const NEW_DESK_TILES = 3;

export interface UseLayoutEditorOptions {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  /** Se llaman tras cada mutacion con exito, para que la escena y el resto de la oficina converjan (paired-space sync). */
  refreshDesks: () => void;
  refreshSpaces: () => void;
}

export interface UseLayoutEditorResult {
  state: EditorState;
  /** Lo ultimo leido de `desks.listDesks()`, en TILES. */
  desks: readonly AdminDesk[];
  /** Ya traducido con `describeAdminError`, nunca el error crudo. */
  error: string | null;
  /** Escritura en vuelo: crear/mover (mientras `state.tag === 'saving'`) o borrar. */
  pending: boolean;
  enter: () => void;
  exit: () => void;
  /** Pide crear uno nuevo con esta etiqueta; el ghost de colocacion sigue a continuacion. */
  startCreate: (label: string) => void;
  startMove: () => void;
  cancelPlacing: () => void;
  deselect: () => void;
  /** Borra el seleccionado. Ver la nota de cabecera: no pasa por `saving`. */
  remove: () => Promise<void>;
}

function toObstacleItem(desk: AdminDesk): LayoutObstacleItem {
  return { id: desk.id, kind: 'desk', x: desk.x, y: desk.y, w: desk.w, h: desk.h };
}

export function useLayoutEditor({
  bridge,
  desks,
  refreshDesks,
  refreshSpaces,
}: UseLayoutEditorOptions): UseLayoutEditorResult {
  const [state, dispatch] = useReducer(reduceEditorState, OFF_STATE);
  const [list, setList] = useState<readonly AdminDesk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** La etiqueta pedida para el proximo `createDesk`, guardada fuera del reductor: no tiene sitio propio en `EditorState`. */
  const pendingLabelRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const active = state.tag !== 'off';

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    void (async () => {
      const resolved = await desks.listDesks();
      // Una respuesta tras salir del modo edicion no toca la lista: mismo
      // motivo que `useDesks`/`useSpacesConfig`.
      if (!cancelled) setList(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, desks]);

  useEffect(() => bridge.on('layoutpick', ({ id }) => dispatch({ type: 'select', id })), [bridge]);

  useEffect(
    () =>
      bridge.on('layoutplace', ({ tx, ty, valid }) => {
        // Invalido: el ghost se queda donde esta, para que se pueda
        // reintentar sin perder ni la etiqueta pedida ni la seleccion.
        if (!valid) return;

        const current = stateRef.current;
        if (current.tag !== 'placing') return;

        const moveId = current.mode === 'move' ? current.id : null;
        const label = pendingLabelRef.current ?? '';

        dispatch({ type: 'confirmPlacement' });
        setError(null);
        setPending(true);

        void (async () => {
          try {
            if (moveId !== null) {
              await desks.updateDesk(moveId, { x: tx, y: ty });
            } else {
              await desks.createDesk({ label, x: tx, y: ty });
            }
            pendingLabelRef.current = null;
            dispatch({ type: 'saveSucceeded' });
            refreshDesks();
            refreshSpaces();
            setList(await desks.listDesks());
          } catch (err) {
            // Fallo del servidor: se cuenta con `describeAdminError` y NO se
            // relee nada -- nada cambio que valga la pena volver a leer, y
            // releer perderia la etiqueta/seleccion sin necesidad.
            setError(describeAdminError(err));
            dispatch({ type: 'saveFailed' });
          } finally {
            setPending(false);
          }
        })();
      }),
    [bridge, desks, refreshDesks, refreshSpaces],
  );

  const enter = useCallback(() => {
    setError(null);
    dispatch({ type: 'enter', kind: 'desk' });
  }, []);

  const exit = useCallback(() => {
    pendingLabelRef.current = null;
    setError(null);
    dispatch({ type: 'exit' });
  }, []);

  const startCreate = useCallback((label: string) => {
    pendingLabelRef.current = label;
    setError(null);
    dispatch({ type: 'startCreate' });
  }, []);

  const startMove = useCallback(() => {
    setError(null);
    dispatch({ type: 'startMove' });
  }, []);

  const cancelPlacing = useCallback(() => {
    pendingLabelRef.current = null;
    dispatch({ type: 'cancelPlacing' });
  }, []);

  const deselect = useCallback(() => dispatch({ type: 'deselect' }), []);

  const remove = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.tag !== 'selected') return;

    setError(null);
    setPending(true);
    try {
      await desks.deleteDesk(current.id);
      dispatch({ type: 'deselect' });
      refreshDesks();
      refreshSpaces();
      setList(await desks.listDesks());
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setPending(false);
    }
  }, [desks, refreshDesks, refreshSpaces]);

  useEffect(() => {
    const moving =
      state.tag === 'placing' && state.mode === 'move'
        ? (() => {
            const own = list.find((desk) => desk.id === state.id);
            return own === undefined ? null : { kind: 'desk' as const, x: own.x, y: own.y };
          })()
        : null;

    const command = toLayoutEditCommand(state, {
      items: list.map(toObstacleItem),
      placingSize: state.tag === 'placing' ? { w: NEW_DESK_TILES, h: NEW_DESK_TILES } : undefined,
      moving,
    });
    bridge.emitCommand('layoutedit', command);
  }, [state, list, bridge]);

  return {
    state,
    desks: list,
    error,
    pending,
    enter,
    exit,
    startCreate,
    startMove,
    cancelPlacing,
    deselect,
    remove,
  };
}
