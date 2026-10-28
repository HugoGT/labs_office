import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { MAP_W } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import { decorFootprint, decorInfoFromPieceId, type DecorItem, type DecorPieceInfo } from '../game/officeDecor';
import { doorPosts, isDoorPiece } from '../game/officeDoors';
import { BASE_LAYOUT, MAX_WALL_EDITS, type WallEdit, type WallPieceId } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { tileAreaRect, type TileRect } from '../game/terrainGrid';

/**
 * The wall tool of "Decoración" (#224; it was part of the terrain editor
 * until then): pick a wall in the palette, or the wall eraser, then every
 * click or drag on the map paints single posts on the grid vertex nearest
 * the pointer. A wall runs along the line between tiles and blocks the way.
 * Walls are still terrain to the server (`POST /admin/terrain/walls`, the
 * room's `terrainWalls`), so only an admin paints them.
 *
 * The map side is the terrain editor's: the tool drives the `terrainedit`
 * overlay (`TerrainEditLayer`), which reports `wallpick`, and the scene draws
 * the pending paints. It holds that overlay only while it has something to
 * show, a picked wall or paints on their way, so the decor editor beside it
 * keeps the map the rest of the time.
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
 * `terrain-under-placement` for a wall: what a wall may not cover is not what
 * water may not, and the post a door stands on is repainted but never removed (#223).
 */
export const WALL_UNDER_PLACEMENT_MESSAGE =
  'Una pared no puede tapar un escritorio, una silla ni la entrada de la oficina, y el poste de una puerta no se quita. Elige otra esquina.';

export type WallBrush = Extract<TerrainBrush, { kind: 'wall' }>;

export interface UseWallEditorOptions {
  bridge: OfficeBridge;
  /** The admin port the walls are painted through; `null` (no admin, no terrain store), nothing can be picked. */
  terrain: TerrainAdminPort | null;
  /**
   * The eraser on a post, with the tile under the pointer: takes off the
   * chair, table, desk or plant on that tile, else the doors whose span holds
   * the post (#232, #233), and says whether it found any, in which case the
   * post stays. Without it the eraser only erases posts.
   */
  eraseDecor?: (post: number, tile: number | null) => boolean;
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
  readonly sent: boolean;
  /** Left a refused batch: it goes to the server on its own, so it cannot take its neighbors down with it (#223). */
  readonly alone?: boolean;
}

/** The wall post a vertex will hold once every pending paint lands. */
function wallAfter(walls: readonly (string | null)[], paints: readonly WallPaint[], index: number): string | null {
  let wall = walls[index] ?? null;
  for (const paint of paints) if (paint.index === index) wall = paint.piece;
  return wall;
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

export function useWallEditor({ bridge, terrain, eraseDecor, infoOf = decorInfoFromPieceId, outlines }: UseWallEditorOptions): WallEditor {
  const [walls, setWalls] = useState<readonly (string | null)[]>(BASE_LAYOUT.walls);
  /** The live decor layer: the posts its doors span and the tiles its pieces cover, what `eraseDecor` takes them by. */
  const [decor, setDecor] = useState<readonly DecorItem[]>([]);
  const [brush, setBrush] = useState<WallBrush | null>(null);
  const [paints, setPaintsState] = useState<readonly WallPaint[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const paintsRef = useRef<readonly WallPaint[]>([]);
  const wallsRef = useRef<readonly (string | null)[]>(BASE_LAYOUT.walls);
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
        try {
          if (terrain === null) throw new Error('no terrain port: the walls cannot be painted');
          await terrain.setWalls(batch.map(({ index, piece }) => ({ index, piece })));
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
    // The piece under the pointer goes before the post. A door's post is never
    // erased under it either: the eraser takes the door instead, and the wall stays closed.
    if (brush.piece === null && eraseDecor?.(index, tile) === true) {
      setError(null);
      return;
    }
    if (wallAfter(wallsRef.current, paintsRef.current, index) === brush.piece) return;
    setError(null);
    setPaints([...paintsRef.current, { index, piece: brush.piece, sent: false }]);
    void drain();
  }

  useEffect(
    () =>
      bridge.on('terrain', (payload) => {
        wallsRef.current = payload.walls;
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
    () => (paints.length === 0 ? null : paints.map(({ index, piece }) => ({ index, piece }))),
    [paints],
  );
  // Only the eraser asks (#241): the posts it would take a wall from once every pending paint lands, and those of a door.
  const takesDecor = eraseDecor !== undefined;
  const erasable = useMemo<number[] | null>(() => {
    if (brush?.piece !== null) return null;
    const posts = new Set(takesDecor ? decor.flatMap((item) => (isDoorPiece(item.piece) ? doorPosts(item, MAP_W) : [])) : []);
    const after = [...walls];
    for (const paint of paints) after[paint.index] = paint.piece;
    after.forEach((wall, index) => {
      if (wall !== null) posts.add(index);
    });
    return [...posts].sort((a, b) => a - b);
  }, [brush, walls, paints, decor, takesDecor]);
  // And the piece a tile under the pointer belongs to, outlined whole.
  const erasableDecor = useMemo<TileRect[] | null>(() => {
    if (brush?.piece !== null || !takesDecor) return null;
    return decor.filter((item) => !isDoorPiece(item.piece)).map((item) => tileAreaRect(decorFootprint(item, infoOf(item.piece), MAP_W)));
  }, [brush, decor, takesDecor, infoOf]);
  const shows = brush !== null || previewWalls !== null;
  const commandKey = JSON.stringify([brush, previewWalls, outlines, erasable, erasableDecor]);

  useEffect(() => {
    if (!shows) return;
    bridge.emitCommand('terrainedit', {
      brush,
      ...(previewWalls === null ? {} : { previewWalls }),
      ...(outlines === undefined || outlines.length === 0 ? {} : { outlines }),
      ...(erasable === null ? {} : { erasable }),
      ...(erasableDecor === null ? {} : { erasableDecor }),
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
    pending: draining,
    blocked,
    error,
    pick(piece) {
      if (terrain === null) return;
      setBrush((current) => (current !== null && current.piece === piece ? null : { kind: 'wall', piece }));
      setError(null);
    },
    unpick() {
      setBrush(null);
    },
    reset() {
      setBrush(null);
      setError(null);
      setBlockedBoth(false);
    },
  };
}
