import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import { sameDecorBrush, decorBrushTarget, type DecorBrush } from '../game/decorEditor';
import { MAP_W } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import {
  MAX_DECOR_EDITS,
  decorInfoFromPieceId,
  decorItemCovering,
  fitsInsideDesk,
  isRotatable,
  nextDecorRotation,
  withDecor,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
  type DecorRotation,
  type DecorTileRect,
} from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';

/**
 * The decor editor (#208), shared by "Decoración" (an admin, the whole map,
 * `POST /admin/decor`) and "Mi espacio" (anyone, inside their own desk,
 * `POST /me/decor`): pick a piece in the palette, then a click on the map
 * anchors it on the clicked tile, turned the way "Girar", R or the wheel
 * last left it. One click places one piece and unpicks the brush, so the
 * right rail comes back; with "Múltiple" on (#207) the brush stays picked
 * click after click until Escape. A piece painted over an anchor replaces what stands
 * there; the eraser removes the item whose footprint covers the clicked tile.
 *
 * Edits go to the server one request at a time, in click order, each request
 * carrying every click queued meanwhile (the server checks a batch as a
 * whole), modelled on the terrain editor's wall paints. The layer it shows
 * comes from the scene (`decor` events), which follows the room, so an edit
 * is drawn as pending only until the room shows it.
 */

/** Refused with these, this person may not edit at all any more: no further writes. */
const BLOCKING_ERRORS = ['forbidden', 'unauthorized', 'terrain-not-configured', 'no-desk'];

/** `terrain-under-placement`: the item needs free walkable ground. */
export const DECOR_UNDER_PLACEMENT_MESSAGE =
  'Ese mueble necesita suelo libre: no puede ir sobre agua, vacío, una pared, otro mueble ni la entrada. Elige otra casilla.';
/** A click the desk-scoped editor refuses before asking: the server would answer `outside-desk`. */
export const DECOR_AREA_MESSAGE = 'Solo puedes decorar dentro de tu escritorio: elige una casilla dentro de su recuadro.';
/** `invalid-request` here is a piece the catalog no longer offers (retired) or will not turn. */
export const DECOR_INVALID_MESSAGE = 'El servidor no aceptó esa pieza: puede que ya no esté en el catálogo. Elige otra.';


/** A palette entry as the editor needs it: the piece id and its decor info. */
export interface DecorPick {
  readonly id: string;
  readonly info: DecorPieceInfo;
}

export interface UseDecorEditorOptions {
  bridge: OfficeBridge;
  decor: OfficeDecorPort;
  /** Where the editor may act, in tiles: the person's desk, or `null` for the whole map. */
  area: DecorTileRect | null;
  /** How the layer's pieces are sized (the catalog); without it, what each id says. */
  infoOf?: (piece: string) => DecorPieceInfo | null;
  /**
   * The editor may close itself: an Escape with nothing picked does, and says
   * so here. Absent ("Mi espacio") that Escape is left to the sidebar.
   */
  onExit?: () => void;
}

export interface DecorEditor {
  active: boolean;
  /** The live layer the room shows, sorted by anchor. */
  items: readonly DecorItem[];
  /** The palette entry picked, or `null`. */
  brush: DecorBrush | null;
  /** The way the next chair or desk table faces; "Girar" (or the map) turns it. */
  rotation: DecorRotation;
  /** An edit is on its way to the server. */
  pending: boolean;
  /** "Múltiple" (#207): the brush stays picked after a click. Off by default; kept across enter and exit. */
  multiple: boolean;
  setMultiple(next: boolean): void;
  blocked: boolean;
  error: string | null;
  enter(): void;
  exit(): void;
  /** Picks a piece, or unpicks it when it is the picked one. */
  pick(option: DecorPick): void;
  /** Picks the eraser, or unpicks it when it is picked. */
  pickEraser(): void;
  /** Turns `rotation` (and a picked chair or desk table) a quarter turn: `1` down, left, up, right. */
  rotate(step?: 1 | -1): void;
  unpick(): void;
}

interface PendingEdit extends DecorEdit {
  readonly sent: boolean;
}

/** The unsent edits that leave together with the first one: distinct tiles, at most `MAX_DECOR_EDITS`. */
function nextBatch(edits: readonly PendingEdit[]): PendingEdit[] {
  const batch: PendingEdit[] = [];
  const tiles = new Set<number>();
  for (const edit of edits) {
    if (edit.sent) continue;
    // The server refuses one tile twice in a request; the next request carries the rest.
    if (tiles.has(edit.index) || batch.length === MAX_DECOR_EDITS) break;
    tiles.add(edit.index);
    batch.push(edit);
  }
  return batch;
}

function brushFor(option: DecorPick, rotation: DecorRotation): DecorBrush {
  return { kind: 'piece', piece: option.id, info: option.info, rotation: isRotatable(option.info.kind) ? rotation : 0 };
}

export function useDecorEditor({ bridge, decor, area, infoOf = decorInfoFromPieceId, onExit }: UseDecorEditorOptions): DecorEditor {
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<readonly DecorItem[]>([]);
  const [brush, setBrush] = useState<DecorBrush | null>(null);
  const [rotation, setRotation] = useState<DecorRotation>(0);
  const [multiple, setMultiple] = useState(false);
  const [edits, setEditsState] = useState<readonly PendingEdit[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const editsRef = useRef<readonly PendingEdit[]>([]);
  const itemsRef = useRef<readonly DecorItem[]>([]);
  const drainingRef = useRef(false);
  const blockedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const setEdits = (next: readonly PendingEdit[]): void => {
    editsRef.current = next;
    setEditsState(next);
  };
  const setBlockedBoth = (next: boolean): void => {
    blockedRef.current = next;
    setBlocked(next);
  };
  const refuse = (cause: unknown): void => {
    const code = cause instanceof AdminError ? cause.code : null;
    if (code === 'terrain-under-placement') setError(DECOR_UNDER_PLACEMENT_MESSAGE);
    else if (code === 'invalid-request') setError(DECOR_INVALID_MESSAGE);
    else setError(describeAdminError(cause));
    if (code !== null && BLOCKING_ERRORS.includes(code)) setBlockedBoth(true);
  };

  async function drain(): Promise<void> {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      for (let batch = nextBatch(editsRef.current); batch.length > 0; batch = nextBatch(editsRef.current)) {
        try {
          await decor.setDecor(batch.map(({ index, item }) => ({ index, item })));
          setEdits(editsRef.current.map((candidate) => (batch.includes(candidate) ? { ...candidate, sent: true } : candidate)));
        } catch (cause) {
          refuse(cause);
          // A refused edit is simply not drawn; once editing is gone, nothing queued is sent.
          setEdits(editsRef.current.filter((candidate) => !batch.includes(candidate) && !(blockedRef.current && !candidate.sent)));
        }
      }
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }

  function queue(edit: DecorEdit): void {
    setError(null);
    setEdits([...editsRef.current, { ...edit, sent: false }]);
    void drain();
  }

  function placeAt(index: number): void {
    if (blockedRef.current || brush === null) return;
    if (!Number.isInteger(index) || index < 0) return;
    // What the layer will hold once every pending edit lands: clicks are judged against it.
    const after = withDecor(itemsRef.current, editsRef.current);
    // The tiles the click acts on (the clicked one when the eraser finds nothing) must be the desk's.
    const target = decorBrushTarget(after, infoOf, MAP_W, index, brush) ?? { x: index % MAP_W, y: Math.floor(index / MAP_W), w: 1, h: 1 };
    if (area !== null && !fitsInsideDesk(target, area)) {
      setError(DECOR_AREA_MESSAGE);
      return;
    }
    if (brush.kind === 'eraser') {
      const covering = decorItemCovering(after, infoOf, MAP_W, index);
      if (covering === null) return;
      queue({ index: covering.index, item: null });
    } else {
      const anchored = after.find((item) => item.index === index);
      if (anchored !== undefined && anchored.piece === brush.piece && anchored.rotation === brush.rotation) return;
      queue({ index, item: { piece: brush.piece, rotation: brush.rotation } });
    }
    // A click that placed nothing keeps the brush; one that did ends it unless "Múltiple" is on.
    // A refusal arriving later only drops that edit: the brush is never touched by it.
    if (!multiple) setBrush(null);
  }

  function turn(step: 1 | -1): void {
    const next = nextDecorRotation(rotation, step);
    setRotation(next);
    // A picked chair or desk table turns at once; a plant or a room table keeps its one drawing.
    setBrush((current) => (current?.kind === 'piece' && isRotatable(current.info.kind) ? { ...current, rotation: next } : current));
  }

  useEffect(
    () =>
      bridge.on('decor', (payload) => {
        itemsRef.current = payload.items;
        setItems(payload.items);
        // The room shows every saved edit from here on, or something newer.
        if (editsRef.current.some((edit) => edit.sent)) setEdits(editsRef.current.filter((edit) => !edit.sent));
      }),
    [bridge],
  );

  // A fresh subscription per render keeps `placeAt` and `turn` reading the current brush.
  useEffect(() => {
    if (!active) return undefined;
    const offPick = bridge.on('decorpick', ({ index }) => placeAt(index));
    const offRotate = bridge.on('decorrotate', ({ step }) => turn(step));
    return () => {
      offPick();
      offRotate();
    };
  });

  // Escape steps out one level at a time: the picked brush first, then the
  // editor itself when it may leave. In the capture phase, so it runs before
  // the sidebar's own Escape (which closes its panel) and that one sees it
  // handled; "Mi espacio" leaves an Escape with nothing picked to the sidebar.
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (brush !== null) {
        event.preventDefault();
        setBrush(null);
        return;
      }
      if (onExitRef.current === undefined) return;
      event.preventDefault();
      reset();
      setActive(false);
      onExitRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, brush]);

  const preview = useMemo<DecorEdit[] | null>(() => (edits.length === 0 ? null : edits.map(({ index, item }) => ({ index, item }))), [edits]);
  const commandKey = JSON.stringify([brush, area, preview]);

  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('decoredit', { brush, area, ...(preview === null ? {} : { preview }) });
    // `commandKey` stands for brush, area and preview: only a different drawing is worth a command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, active, commandKey]);

  // Separate from the effect above so a new pick does not close and reopen
  // the overlay: only leaving (or unmounting) does.
  useEffect(() => {
    if (!active) return undefined;
    return () => bridge.emitCommand('decoredit', null);
  }, [bridge, active]);

  const reset = (): void => {
    setBrush(null);
    setEdits([]);
    setError(null);
    setBlockedBoth(false);
  };

  const toggle = (next: DecorBrush): void => {
    setBrush((current) => (sameDecorBrush(current, next) ? null : next));
    setError(null);
  };

  return {
    active,
    items,
    brush,
    rotation,
    pending: draining,
    multiple,
    setMultiple,
    blocked,
    error,
    enter() {
      reset();
      setActive(true);
    },
    exit() {
      reset();
      setActive(false);
    },
    pick(option) {
      // Another turn of the same piece is the same entry: a second pick unpicks it.
      setBrush((current) => (current?.kind === 'piece' && current.piece === option.id ? null : brushFor(option, rotation)));
      setError(null);
    },
    pickEraser() {
      toggle({ kind: 'eraser' });
    },
    rotate(step = 1) {
      turn(step);
    },
    unpick() {
      setBrush(null);
    },
  };
}
