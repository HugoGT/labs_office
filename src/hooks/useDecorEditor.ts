import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import { decorBrushTarget, type DecorBrush } from '../game/decorEditor';
import { deskOverChairLimit, displacedDeskTables } from '../game/deskDecorRules';
import { isEditableElementFocused } from '../game/inputFocusGuard';
import { MAP_W } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import {
  MAX_DECOR_EDITS,
  decorFootprint,
  decorInfoFromPieceId,
  decorRotationFor,
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
 * The decor editor (#208) of "Decoración", in both its scopes (an admin, the
 * whole map, `POST /admin/decor`; anyone else, inside their own desk,
 * `POST /me/decor`): pick a piece in the palette, then a click on the map
 * anchors it on the clicked tile, turned the way R or the wheel last left
 * it, and a colorable piece in the color chosen on its palette tile. One
 * click places one piece and unpicks the brush, so the right rail comes
 * back; with "Múltiple" on (#207) the brush stays picked click after click
 * until Escape. A piece painted over an anchor replaces what stands there.
 *
 * With nothing picked, a click on a placed item selects it (in desk scope
 * only items wholly inside the desk): the map outlines it and draws a move
 * and a trash button. Move makes it a brush of the same piece, turn and
 * color; the next click moves it in one request (off its old anchor, onto
 * the new one, so its own place never blocks it). Trash, Supr or Backspace
 * deletes it. Escape cancels a move (back to the item selected), then
 * deselects, then leaves.
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
/** A click the editor refuses before asking, and `desk-chair-limit` from the server: a desk takes three chairs at most. */
export const DECOR_CHAIR_LIMIT_MESSAGE = 'Un escritorio admite como máximo 3 sillas.';
/** `invalid-request` here is a piece the catalog no longer offers (retired) or will not turn. */
export const DECOR_INVALID_MESSAGE = 'El servidor no aceptó esa pieza: puede que ya no esté en el catálogo. Elige otra.';


/** A palette entry as the editor needs it: the piece id and its decor info. */
export interface DecorPick {
  readonly id: string;
  readonly info: DecorPieceInfo;
}

/** Whether an event comes from inside a popover (the color picker's dialog), whose own Escape closes it. */
function insidePopover(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest('[role="dialog"]') !== null;
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
   * so here. Absent, that Escape is left to the sidebar.
   */
  onExit?: () => void;
  /**
   * Every desk area in tiles, for the desk rules (`deskDecorRules.ts`): a
   * desk table placed on a desk takes the other desk tables off it in the
   * same click, and a fourth chair on a desk is refused before asking. The
   * server enforces both on its own. Absent, no desk rule applies here.
   */
  desks?: readonly DecorTileRect[];
  /**
   * Another tool of the same menu holds the map (the wall tool, #224): the
   * editor puts its brush and selection down, closes its overlay and leaves
   * Escape alone until it is resumed. It stays open meanwhile.
   */
  paused?: boolean;
}

export interface DecorEditor {
  active: boolean;
  /** The live layer the room shows, sorted by anchor. */
  items: readonly DecorItem[];
  /** The palette entry picked (or the item being moved, `brush.from`), or `null`. */
  brush: DecorBrush | null;
  /** The anchor of the placed item selected with nothing picked, or `null`. */
  selected: number | null;
  /** The way the next rotatable piece turns; R or the wheel on the map turns it. */
  rotation: DecorRotation;
  /** The color chosen per colorable piece on its palette tile; a piece without one draws in its manifest default. */
  colors: Readonly<Record<string, string>>;
  /** Chooses the color of a colorable piece: the next pick of it, and the picked brush if it is that piece. */
  setColor(piece: string, color: string): void;
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
  unpick(): void;
}

interface PendingEdit extends DecorEdit {
  readonly sent: boolean;
  /** The edits of one click share it: a move's removal and placement always leave together. */
  readonly group: number;
}

/**
 * The unsent edits that leave together with the first one: whole clicks,
 * distinct tiles, at most `MAX_DECOR_EDITS`.
 */
function nextBatch(edits: readonly PendingEdit[]): PendingEdit[] {
  const batch: PendingEdit[] = [];
  const tiles = new Set<number>();
  const unsent = edits.filter((edit) => !edit.sent);
  for (let start = 0; start < unsent.length; ) {
    let end = start;
    while (end < unsent.length && unsent[end]!.group === unsent[start]!.group) end += 1;
    const click = unsent.slice(start, end);
    // The server refuses one tile twice in a request; the next request carries the rest.
    if (click.some((edit) => tiles.has(edit.index)) || batch.length + click.length > MAX_DECOR_EDITS) break;
    for (const edit of click) {
      tiles.add(edit.index);
      batch.push(edit);
    }
    start = end;
  }
  return batch;
}

/** An item's placement as an edit carries it: piece, turn and its color if it has one. */
function placementOf(item: Pick<DecorBrush, 'piece' | 'rotation' | 'color'>): NonNullable<DecorEdit['item']> {
  return { piece: item.piece, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }) };
}

function brushFor(option: DecorPick, rotation: DecorRotation, color: string | undefined): DecorBrush {
  // A room table takes the symmetric half of the turn (0 or 90), a plant none.
  const brush: DecorBrush = { kind: 'piece', piece: option.id, info: option.info, rotation: decorRotationFor(option.info.kind, rotation) };
  return option.info.colorable === true && color !== undefined ? { ...brush, color } : brush;
}

const NO_DESKS: readonly DecorTileRect[] = [];

export function useDecorEditor({
  bridge,
  decor,
  area,
  infoOf = decorInfoFromPieceId,
  onExit,
  desks = NO_DESKS,
  paused = false,
}: UseDecorEditorOptions): DecorEditor {
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<readonly DecorItem[]>([]);
  const [brush, setBrush] = useState<DecorBrush | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [rotation, setRotation] = useState<DecorRotation>(0);
  const [colors, setColors] = useState<Readonly<Record<string, string>>>({});
  const [multiple, setMultiple] = useState(false);
  const [edits, setEditsState] = useState<readonly PendingEdit[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const editsRef = useRef<readonly PendingEdit[]>([]);
  const itemsRef = useRef<readonly DecorItem[]>([]);
  const drainingRef = useRef(false);
  const groupRef = useRef(0);
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
    else if (code === 'desk-chair-limit') setError(DECOR_CHAIR_LIMIT_MESSAGE);
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

  /** Queues the edits of one click: they leave in the same request. */
  function queue(...click: DecorEdit[]): void {
    setError(null);
    groupRef.current += 1;
    const group = groupRef.current;
    setEdits([...editsRef.current, ...click.map((edit) => ({ ...edit, sent: false, group }))]);
    void drain();
  }

  /** What the layer will hold once every pending edit lands: clicks are judged against it. */
  const layerAfter = (): DecorItem[] => withDecor(itemsRef.current, editsRef.current);

  /**
   * Queues one click placing on `placed` after the desk rules: the desk
   * tables it displaces leave in the same click (so the preview shows the
   * table gone), and a click that would put a fourth chair on a desk is
   * refused here. Returns whether it queued.
   */
  function queuePlacement(after: readonly DecorItem[], click: DecorEdit[], placed: number): boolean {
    if (desks.length > 0) {
      const placedLayer = withDecor(after, click);
      const removals = displacedDeskTables(placedLayer, [placed], infoOf, desks, MAP_W).map((index): DecorEdit => ({ index, item: null }));
      if (deskOverChairLimit(after, withDecor(placedLayer, removals), [placed], infoOf, desks, MAP_W) !== null) {
        setError(DECOR_CHAIR_LIMIT_MESSAGE);
        return false;
      }
      click.push(...removals);
    }
    queue(...click);
    return true;
  }

  function placeAt(index: number): void {
    if (blockedRef.current || brush === null) return;
    if (!Number.isInteger(index) || index < 0) return;
    const after = layerAfter();
    // Every tile the piece would cover must be the desk's.
    if (area !== null && !fitsInsideDesk(decorBrushTarget(index, brush, MAP_W), area)) {
      setError(DECOR_AREA_MESSAGE);
      return;
    }
    if (brush.from !== undefined) {
      moveTo(brush.from, index, after);
      return;
    }
    const anchored = after.find((item) => item.index === index);
    if (anchored !== undefined && anchored.piece === brush.piece && anchored.rotation === brush.rotation && anchored.color === brush.color) return;
    // A refused click keeps the brush, like one that placed nothing.
    if (!queuePlacement(after, [{ index, item: placementOf(brush) }], index)) return;
    // A click that placed nothing keeps the brush; one that did ends it unless "Múltiple" is on.
    // A refusal arriving later only drops that edit: the brush is never touched by it.
    if (!multiple) setBrush(null);
  }

  /**
   * The click of a move: one move, whatever "Múltiple" says. Onto its own
   * anchor it only turns (or does nothing); elsewhere it leaves its old
   * anchor and takes the new one in one request, so the room judges the
   * move as a whole and refuses it whole. It never replaces another item.
   */
  function moveTo(from: number, index: number, after: readonly DecorItem[]): void {
    if (brush === null) return;
    setBrush(null);
    const moved = after.find((item) => item.index === from);
    if (moved === undefined) return;
    if (index === from) {
      if (moved.rotation !== brush.rotation || moved.color !== brush.color) queuePlacement(after, [{ index, item: placementOf(brush) }], index);
      return;
    }
    if (after.some((item) => item.index === index)) {
      setError(DECOR_UNDER_PLACEMENT_MESSAGE);
      return;
    }
    queuePlacement(after, [{ index: from, item: null }, { index, item: placementOf(brush) }], index);
  }

  /** Selects the item anchored on `index` if this editor may act on it (inside its area), else nothing. */
  function select(index: number | null): void {
    if (brush !== null) return;
    if (index === null) {
      setSelected(null);
      return;
    }
    const item = layerAfter().find((candidate) => candidate.index === index);
    const reachable = item !== undefined && (area === null || fitsInsideDesk(decorFootprint(item, infoOf(item.piece), MAP_W), area));
    setSelected(reachable ? index : null);
  }

  function startMove(index: number): void {
    if (blockedRef.current) return;
    const item = layerAfter().find((candidate) => candidate.index === index);
    const info = item === undefined ? null : infoOf(item.piece);
    if (item === undefined || info === null) return;
    setSelected(null);
    setError(null);
    setBrush({ kind: 'piece', piece: item.piece, info, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }), from: index });
  }

  function remove(index: number): void {
    if (blockedRef.current) return;
    setSelected(null);
    if (!layerAfter().some((item) => item.index === index)) return;
    queue({ index, item: null });
  }

  /** Puts the brush down; a cancelled move goes back to its item selected, where it still is. */
  function putDown(): void {
    setBrush(null);
    const from = brush?.from;
    if (from !== undefined && layerAfter().some((item) => item.index === from)) setSelected(from);
  }

  function turn(step: 1 | -1): void {
    // Only a picked piece that turns: the map asks only then (`holdsWheel`).
    if (brush === null || !isRotatable(brush.info.kind)) return;
    // A chair or desk table turns a quarter, a room table between horizontal and vertical.
    const next = nextDecorRotation(brush.rotation, step, brush.info.kind);
    // A moved item turns alone; the palette keeps its own turn for the next pick.
    if (brush.from === undefined) setRotation(next);
    setBrush({ ...brush, rotation: next });
  }

  useEffect(
    () =>
      bridge.on('decor', (payload) => {
        itemsRef.current = payload.items;
        setItems(payload.items);
        // The room shows every saved edit from here on, or something newer.
        if (editsRef.current.some((edit) => edit.sent)) setEdits(editsRef.current.filter((edit) => !edit.sent));
        // A selected item someone else removed or moved is gone from the selection too.
        const after = withDecor(payload.items, editsRef.current);
        setSelected((current) => (current !== null && after.some((item) => item.index === current) ? current : null));
      }),
    [bridge],
  );

  // A fresh subscription per render keeps `placeAt` and `turn` reading the current brush.
  useEffect(() => {
    if (!active || paused) return undefined;
    const offs = [
      bridge.on('decorpick', ({ index }) => placeAt(index)),
      bridge.on('decorrotate', ({ step }) => turn(step)),
      bridge.on('decorselect', ({ index }) => select(index)),
      bridge.on('decormove', ({ index }) => startMove(index)),
      bridge.on('decordelete', ({ index }) => remove(index)),
    ];
    return () => {
      for (const off of offs) off();
    };
  });

  // Escape steps out one level at a time: the picked brush (or the move,
  // which leaves the item where it was) first, then the selection, then the
  // editor itself when it may leave. In the capture phase, so it runs before
  // the sidebar's own Escape (which closes its panel) and that one sees it
  // handled; without `onExit` an Escape with nothing picked is left to the sidebar.
  // Supr and Backspace delete the selected item, unless someone is typing.
  useEffect(() => {
    if (!active || paused) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && brush === null && selected !== null) {
        if (isEditableElementFocused() || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        remove(selected);
        return;
      }
      // An open color picker closes on its own Escape and keeps the editor as it is.
      if (event.key !== 'Escape' || insidePopover(event)) return;
      if (brush !== null) {
        event.preventDefault();
        putDown();
        return;
      }
      if (selected !== null) {
        event.preventDefault();
        setSelected(null);
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
  });

  const preview = useMemo<DecorEdit[] | null>(() => (edits.length === 0 ? null : edits.map(({ index, item }) => ({ index, item }))), [edits]);
  const commandKey = JSON.stringify([brush, area, selected, preview, desks]);

  // A pause puts down what the next map click would act on; a move leaves the item where it was.
  useEffect(() => {
    if (!paused) return;
    setBrush(null);
    setSelected(null);
  }, [paused]);

  useEffect(() => {
    if (!active || paused) return;
    bridge.emitCommand('decoredit', {
      brush,
      area,
      ...(desks.length === 0 ? {} : { desks }),
      ...(selected === null ? {} : { selected }),
      ...(preview === null ? {} : { preview }),
    });
    // `commandKey` stands for brush, area, desks, selection and preview: only a different drawing is worth a command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, active, paused, commandKey]);

  // Separate from the effect above so a new pick does not close and reopen
  // the overlay: only leaving, a pause (or unmounting) does.
  useEffect(() => {
    if (!active || paused) return undefined;
    return () => bridge.emitCommand('decoredit', null);
  }, [bridge, active, paused]);

  const reset = (): void => {
    setBrush(null);
    setSelected(null);
    setEdits([]);
    setError(null);
    setBlockedBoth(false);
  };

  return {
    active,
    items,
    brush,
    selected,
    rotation,
    colors,
    setColor(piece, color) {
      setColors((current) => ({ ...current, [piece]: color }));
      setBrush((current) => (current !== null && current.piece === piece && current.info.colorable === true ? { ...current, color } : current));
    },
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
      // A move in progress is put down too: the palette starts a new piece.
      setBrush((current) => (current?.piece === option.id && current.from === undefined ? null : brushFor(option, rotation, colors[option.id])));
      setSelected(null);
      setError(null);
    },
    unpick() {
      putDown();
    },
  };
}
