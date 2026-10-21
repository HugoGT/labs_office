import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import { decorBrushTarget, type DecorBrush } from '../game/decorEditor';
import { MAP_W } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import {
  MAX_DECOR_EDITS,
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
 * The decor editor (#208), shared by "Decoración" (an admin, the whole map,
 * `POST /admin/decor`) and "Mi espacio" (anyone, inside their own desk,
 * `POST /me/decor`): pick a piece in the palette, then a click on the map
 * anchors it on the clicked tile, turned the way R or the wheel last left
 * it, and a colorable piece in the color chosen on its palette tile. One
 * click places one piece and unpicks the brush, so the right rail comes
 * back; with "Múltiple" on (#207) the brush stays picked click after click
 * until Escape. A piece painted over an anchor replaces what stands there.
 * (Removing items comes back as selecting one on the map.)
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

function brushFor(option: DecorPick, rotation: DecorRotation, color: string | undefined): DecorBrush {
  // A room table takes the symmetric half of the turn (0 or 90), a plant none.
  const brush: DecorBrush = { kind: 'piece', piece: option.id, info: option.info, rotation: decorRotationFor(option.info.kind, rotation) };
  return option.info.colorable === true && color !== undefined ? { ...brush, color } : brush;
}

export function useDecorEditor({ bridge, decor, area, onExit }: UseDecorEditorOptions): DecorEditor {
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<readonly DecorItem[]>([]);
  const [brush, setBrush] = useState<DecorBrush | null>(null);
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
    // Every tile the piece would cover must be the desk's.
    if (area !== null && !fitsInsideDesk(decorBrushTarget(index, brush, MAP_W), area)) {
      setError(DECOR_AREA_MESSAGE);
      return;
    }
    const anchored = after.find((item) => item.index === index);
    if (anchored !== undefined && anchored.piece === brush.piece && anchored.rotation === brush.rotation && anchored.color === brush.color) return;
    queue({ index, item: { piece: brush.piece, rotation: brush.rotation, ...(brush.color === undefined ? {} : { color: brush.color }) } });
    // A click that placed nothing keeps the brush; one that did ends it unless "Múltiple" is on.
    // A refusal arriving later only drops that edit: the brush is never touched by it.
    if (!multiple) setBrush(null);
  }

  function turn(step: 1 | -1): void {
    // Only a picked piece that turns: the map asks only then (`holdsWheel`).
    if (brush === null || !isRotatable(brush.info.kind)) return;
    // A chair or desk table turns a quarter, a room table between horizontal and vertical.
    const next = nextDecorRotation(brush.rotation, step, brush.info.kind);
    setRotation(next);
    setBrush({ ...brush, rotation: next });
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
      // An open color picker closes on its own Escape and keeps the editor as it is.
      if (event.key !== 'Escape' || event.defaultPrevented || insidePopover(event)) return;
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

  return {
    active,
    items,
    brush,
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
      setBrush((current) => (current?.piece === option.id ? null : brushFor(option, rotation, colors[option.id])));
      setError(null);
    },
    unpick() {
      setBrush(null);
    },
  };
}
