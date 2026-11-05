import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { MAP_W } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import { decorFootprint, decorInfoFromPieceId, type DecorItem, type DecorPieceInfo } from '../game/officeDecor';
import { doorOwnRect, isDoorPiece, wallEraseOf } from '../game/officeDoors';
import { BASE_LAYOUT, MAX_WALL_EDITS, isColorableWallPiece, wallPostUnder, type WallColors, type WallEdit, type WallPieceId } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { tileAreaRect, type TileRect } from '../game/terrainGrid';
import { usePersistedColors } from './usePersistedColors';

/**
 * The wall tool of "Decoración" (#224): pick a wall in the palette, or the
 * eraser, then every click or drag on the map paints a wall on the tile under
 * the pointer, which covers that tile and the ones above and below it. Walls
 * are still terrain to the server (`POST /admin/terrain/walls`, the room's
 * `terrainWalls`), so only an admin paints them.
 *
 * The eraser takes what the pointer is over, a piece or a door or window
 * alone, else the wall. A wall a door or window needs goes with it and with the
 * tiles it spans (`wallEraseOf`): the door first, since the room refuses to
 * remove a wall one still needs, then the walls in one request.
 *
 * The map side is the terrain editor's: the tool drives the `terrainedit`
 * overlay (`TerrainEditLayer`), which reports `wallpick`, and the scene draws
 * the pending paints. It holds that overlay only while it has something to
 * show, a picked wall or paints on their way, so the decor editor beside it
 * keeps the map the rest of the time.
 *
 * A colorable wall (plaster) is picked in the color last settled on its
 * palette tile, remembered in this browser like the floors' (#222); each
 * wall it paints carries that color, and a wall the room shows in another
 * color is repainted.
 *
 * Paints go to the server one request at a time, in click order: the ones
 * queued meanwhile leave together in one `setWalls`, so a long dragged wall
 * is one request. The walls it shows come from the scene (`terrain` events),
 * which follows the room, so a paint is drawn as pending only until the
 * room shows it.
 */

/** Refused with these, the admin may not edit at all any more: no further writes. */
const BLOCKING_ERRORS = ['forbidden', 'unauthorized', 'terrain-not-configured'];

/**
 * `terrain-under-placement` for a wall: what a wall may not cover is not what water may not (#223).
 */
export const WALL_UNDER_PLACEMENT_MESSAGE = 'Una pared no puede tapar un escritorio, una silla, una puerta ni la entrada de la oficina. Elige otra casilla.';

export type WallBrush = Extract<TerrainBrush, { kind: 'wall' }>;

export interface UseWallEditorOptions {
  bridge: OfficeBridge;
  /** The admin port the walls are painted through; `null` (no admin, no terrain store), nothing can be picked. */
  terrain: TerrainAdminPort | null;
  /**
   * The eraser on a post, with the tile under the pointer: takes off the
   * chair, table, desk, plant, door or window on that tile (#232, #233), and
   * says whether it found any, in which case the post stays. Without it the
   * eraser only erases posts.
   */
  eraseDecor?: (post: number, tile: number | null) => boolean;
  /**
   * Takes off the doors and windows a wall about to go takes with it, by their
   * anchors, and says when they have left, or `false` when they could not: the
   * walls wait for it. Without it a wall a door needs is only asked for, and refused.
   */
  eraseDoors?: (anchors: readonly number[]) => Promise<boolean>;
  /** What a decor piece is, for the footprints the eraser outlines; the pack's pieces by default. */
  infoOf?: (piece: string) => DecorPieceInfo | null;
  /** The outlines the map draws while a wall is picked (#216), the ones "Decoración" draws: a guide only. */
  outlines?: readonly TileRect[];
}

export interface WallEditor {
  /** The live wall post of every grid vertex (a tile's top-left corner), row major. */
  walls: readonly (string | null)[];
  /** The wall (or eraser, `piece` `null`) picked, or `null`. */
  brush: WallBrush | null;
  /** The color chosen for each colorable wall in this browser; absent, its default art. */
  colors: Readonly<Partial<Record<WallPieceId, string>>>;
  /** Settles `color` for the colorable wall `piece` and picks it in that color. */
  setColor(piece: WallPieceId, color: string): void;
  /** The browser's color picker of a wall's palette tile is open (or closed): the rail stays while it is. */
  setPickingColor(picking: boolean): void;
  /** A paint is on its way to the server. */
  pending: boolean;
  blocked: boolean;
  error: string | null;
  /** Picks the wall `piece` (`null`: the wall eraser), or unpicks it when it is the picked one. */
  pick(piece: WallPieceId | null): void;
  unpick(): void;
  /** The menu around it closed: unpicks and forgets the error. Paints already queued still land. */
  reset(): void;
}

interface WallPaint {
  readonly index: number;
  readonly piece: WallPieceId | null;
  /** The color it paints a colorable wall in; absent, the default art. */
  readonly color?: string;
  readonly sent: boolean;
  /** Left a refused batch: it goes to the server on its own, so it cannot take its neighbors down with it (#223). */
  readonly alone?: boolean;
  /** The doors this erase takes along have left (`true`) or could not (`false`): it waits for that. */
  readonly doorsGone?: Promise<boolean>;
}

/** The wall post a vertex will hold once every pending paint lands. */
function wallAfter(walls: readonly (string | null)[], paints: readonly WallPaint[], index: number): string | null {
  let wall = walls[index] ?? null;
  for (const paint of paints) if (paint.index === index) wall = paint.piece;
  return wall;
}

/** The color of the wall on a vertex once every pending paint lands, `undefined` for its default art. */
function colorAfter(colors: WallColors, paints: readonly WallPaint[], index: number): string | undefined {
  let color = colors.get(index);
  for (const paint of paints) if (paint.index === index) color = paint.color;
  return color;
}

/** The wall brush a pick makes: a colorable wall carries the color chosen for it, if any. */
function wallBrush(piece: WallPieceId | null, color: string | undefined): WallBrush {
  return isColorableWallPiece(piece) && color !== undefined ? { kind: 'wall', piece, color } : { kind: 'wall', piece };
}

/** A paint or preview edit: the color only when there is one, so a wall without one reads as before. */
function editOf({ index, piece, color }: WallPaint): WallEdit {
  return color === undefined ? { index, piece } : { index, piece, color };
}

/** Every wall post once every pending paint lands. */
function wallsAfter(walls: readonly (string | null)[], paints: readonly WallPaint[]): (string | null)[] {
  const after = [...walls];
  for (const paint of paints) after[paint.index] = paint.piece;
  return after;
}

/**
 * The unsent paints that leave together: the first ones of the queue, up to
 * a vertex already in the request (the server refuses one twice) or
 * `MAX_WALL_EDITS`. A paint that is `alone` leaves by itself.
 */
function nextRun(paints: readonly WallPaint[]): WallPaint[] {
  const run: WallPaint[] = [];
  const tiles = new Set<number>();
  for (const paint of paints) {
    if (paint.sent) continue;
    if (paint.alone === true && run.length > 0) break;
    if (tiles.has(paint.index) || run.length === MAX_WALL_EDITS) break;
    tiles.add(paint.index);
    run.push(paint);
    if (paint.alone === true) break;
  }
  return run;
}

export function useWallEditor({ bridge, terrain, eraseDecor, eraseDoors, infoOf = decorInfoFromPieceId, outlines }: UseWallEditorOptions): WallEditor {
  const [walls, setWalls] = useState<readonly (string | null)[]>(BASE_LAYOUT.walls);
  /** The live decor layer: the posts its doors span and the tiles its pieces cover, what `eraseDecor` takes them by. */
  const [decor, setDecor] = useState<readonly DecorItem[]>([]);
  const [brush, setBrush] = useState<WallBrush | null>(null);
  // A palette tile's color picker is open: the rail it hangs from must stay while a brush is in hand.
  const [pickingColor, setPickingColor] = useState(false);
  const holdingPicker = brush !== null && pickingColor;
  // Remembered in this browser, never sent: a painted wall carries its own color.
  const [colors, saveColor] = usePersistedColors<WallPieceId>('office:wall-colors');
  const [paints, setPaintsState] = useState<readonly WallPaint[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const paintsRef = useRef<readonly WallPaint[]>([]);
  const wallsRef = useRef<readonly (string | null)[]>(BASE_LAYOUT.walls);
  const wallColorsRef = useRef<WallColors>(new Map());
  const drainingRef = useRef(false);
  const blockedRef = useRef(false);

  const setPaints = (next: readonly WallPaint[]): void => {
    paintsRef.current = next;
    setPaintsState(next);
  };
  const setBlockedBoth = (next: boolean): void => {
    blockedRef.current = next;
    setBlocked(next);
  };

  async function drain(): Promise<void> {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      for (let batch = nextRun(paintsRef.current); batch.length > 0; batch = nextRun(paintsRef.current)) {
        const waiting = batch.filter((paint) => paint.doorsGone !== undefined);
        if (waiting.length > 0) {
          const gone = await Promise.all(waiting.map((paint) => paint.doorsGone));
          // The decor editor already said why: these walls stay, with the door they hold.
          const kept = waiting.filter((_, at) => !gone[at]);
          if (kept.length > 0) {
            setPaints(paintsRef.current.filter((candidate) => !kept.includes(candidate)));
            continue;
          }
        }
        try {
          if (terrain === null) throw new Error('no terrain port: the walls cannot be painted');
          await terrain.setWalls(batch.map(editOf));
          setPaints(paintsRef.current.map((candidate) => (batch.includes(candidate) ? { ...candidate, sent: true } : candidate)));
        } catch (cause) {
          const underPlacement = cause instanceof AdminError && cause.code === 'terrain-under-placement';
          setError(underPlacement ? WALL_UNDER_PLACEMENT_MESSAGE : describeAdminError(cause));
          if (cause instanceof AdminError && BLOCKING_ERRORS.includes(cause.code)) setBlockedBoth(true);
          if (underPlacement && batch.length > 1) {
            // The server takes a batch whole or not at all, and a refusal does not say which post it is about
            // (a door's post is never erased): each one goes again alone, so only the refused ones stay out.
            setPaints(paintsRef.current.map((candidate) => (batch.includes(candidate) ? { ...candidate, alone: true } : candidate)));
            continue;
          }
          // A refused paint is simply not drawn; once editing is gone, nothing queued is sent.
          setPaints(paintsRef.current.filter((candidate) => !batch.includes(candidate) && !(blockedRef.current && !candidate.sent)));
        }
      }
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }

  function paintAt(index: number, tile: number | null): void {
    if (blockedRef.current || brush === null) return;
    if (index < 0 || index >= wallsRef.current.length) return;
    // The piece, door or window under the pointer goes before the post, and alone.
    if (brush.piece === null && eraseDecor?.(index, tile) === true) {
      setError(null);
      return;
    }
    // A wall covers the tiles above and below the one it stands on: the eraser takes it from any of them.
    const map = { width: MAP_W, height: wallsRef.current.length / MAP_W };
    const target = brush.piece === null ? (wallPostUnder(map, index, (candidate) => wallAfter(wallsRef.current, paintsRef.current, candidate) != null) ?? index) : index;
    if (wallAfter(wallsRef.current, paintsRef.current, target) === brush.piece && (brush.piece === null || colorAfter(wallColorsRef.current, paintsRef.current, target) === brush.color)) return;
    setError(null);
    const erased = brush.piece === null && eraseDoors !== undefined ? wallEraseOf(decor, { ...map, walls: wallsAfter(wallsRef.current, paintsRef.current) }, target) : null;
    if (erased !== null && erased.doors.length > 0) {
      const doorsGone = eraseDoors!(erased.doors);
      setPaints([...paintsRef.current, ...erased.posts.map((post): WallPaint => ({ index: post, piece: null, sent: false, doorsGone }))]);
    } else {
      setPaints([...paintsRef.current, { index: target, piece: brush.piece, ...(brush.color === undefined ? {} : { color: brush.color }), sent: false }]);
    }
    void drain();
  }

  useEffect(
    () =>
      bridge.on('terrain', (payload) => {
        wallsRef.current = payload.walls;
        wallColorsRef.current = payload.wallColors ?? new Map();
        setWalls(payload.walls);
        // The room shows every saved paint from here on, or something newer.
        if (paintsRef.current.some((paint) => paint.sent)) setPaints(paintsRef.current.filter((paint) => !paint.sent));
      }),
    [bridge],
  );

  useEffect(() => bridge.on('decor', ({ items }) => setDecor(items)), [bridge]);

  // Only a picked wall listens to the map; a fresh subscription per render keeps `paintAt` reading it.
  useEffect(() => {
    if (brush === null) return undefined;
    return bridge.on('wallpick', ({ index, tile }) => paintAt(index, tile ?? null));
  });

  // Escape puts the picked wall down, and only that: the menu's own Escape
  // steps come after. In the capture phase, so it runs before them.
  useEffect(() => {
    if (brush === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setBrush(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [brush]);

  const previewWalls = useMemo<WallEdit[] | null>(
    () => (paints.length === 0 ? null : paints.map(editOf)),
    [paints],
  );
  // Only the eraser asks (#241): the walls it would take once every pending paint lands.
  const erasable = useMemo<number[] | null>(() => {
    if (brush?.piece !== null) return null;
    return wallsAfter(walls, paints).flatMap((wall, index) => (wall === null ? [] : [index]));
  }, [brush, walls, paints]);
  // And the piece, door or window a tile under the pointer belongs to, outlined whole.
  const takesDecor = eraseDecor !== undefined;
  const erasableDecor = useMemo<TileRect[] | null>(() => {
    if (brush?.piece !== null || !takesDecor) return null;
    return decor.map((item) => tileAreaRect(isDoorPiece(item.piece) ? doorOwnRect(item, MAP_W) : decorFootprint(item, infoOf(item.piece), MAP_W)));
  }, [brush, decor, takesDecor, infoOf]);
  const shows = brush !== null || previewWalls !== null;
  const commandKey = JSON.stringify([brush, previewWalls, outlines, erasable, erasableDecor, holdingPicker]);

  useEffect(() => {
    if (!shows) return;
    bridge.emitCommand('terrainedit', {
      brush,
      ...(previewWalls === null ? {} : { previewWalls }),
      ...(outlines === undefined || outlines.length === 0 ? {} : { outlines }),
      ...(erasable === null ? {} : { erasable }),
      ...(erasableDecor === null ? {} : { erasableDecor }),
      ...(holdingPicker ? { pickingColor: true as const } : {}),
    });
    // `commandKey` stands for the brush and the preview: only a different drawing is worth a command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, shows, commandKey]);

  // Separate from the effect above so a new pick does not close and reopen
  // the overlay: only having nothing left to show (or unmounting) does.
  useEffect(() => {
    if (!shows) return undefined;
    return () => bridge.emitCommand('terrainedit', null);
  }, [bridge, shows]);

  return {
    walls,
    brush,
    colors,
    setColor(piece, color) {
      if (!isColorableWallPiece(piece)) return;
      saveColor(piece, color);
      // A color settled on its tile (its picker was dismissed) picks the wall, so the next click on the map paints it.
      if (terrain === null) return;
      setBrush(wallBrush(piece, color));
      setError(null);
    },
    setPickingColor,
    pending: draining,
    blocked,
    error,
    pick(piece) {
      if (terrain === null) return;
      setBrush((current) => (current !== null && current.piece === piece ? null : wallBrush(piece, piece === null ? undefined : colors[piece])));
      setError(null);
    },
    unpick() {
      setBrush(null);
    },
    reset() {
      setBrush(null);
      setPickingColor(false);
      setError(null);
      setBlockedBoth(false);
    },
  };
}
