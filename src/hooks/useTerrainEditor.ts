import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import { BASE_LAYOUT, MAX_WALL_EDITS, encodeTerrainBlocks, type LayoutMaterial, type WallEdit, type WallPieceId } from '../game/officeLayout';
import { sameBrush, type TerrainBrush } from '../game/terrainEditor';

/**
 * The terrain editor of the office sidebar (#123 phase 2): pick a floor in
 * the palette, then every click on a 9x9 block of the map paints it, until
 * the floor is unpicked. Painting over terrain replaces it, painting over the
 * void builds new terrain, and the void entry erases. Picking a wall (or the
 * wall eraser) instead paints single tiles: a wall blocks the way.
 *
 * Paints go to the server one request at a time, in click order: the server
 * checks each against the terrain the previous one left. A block paint is
 * one `setBlock`; wall paints queued one after another leave together in one
 * `setWalls`, so a long dragged wall is one request. The blocks and walls it
 * shows come from the scene (`terrain` events), which follows the room: a
 * paint reaches this editor the same way it reaches everyone else, so it is
 * drawn as pending only until the room shows it.
 */

/** The admin refused with these may not edit at all any more: no further writes. */
const BLOCKING_ERRORS = ['forbidden', 'unauthorized', 'terrain-not-configured'];

export const SPAWN_BLOCK_MESSAGE = 'El bloque central de la entrada siempre es de madera.';
/** `terrain-under-placement` for a wall: what a wall may not cover is not what water may not. */
export const WALL_UNDER_PLACEMENT_MESSAGE = 'Una pared no puede tapar un escritorio, una silla ni la entrada de la oficina. Elige otra casilla.';

export interface UseTerrainEditorOptions {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
}

export interface TerrainEditor {
  active: boolean;
  blocks: readonly LayoutMaterial[];
  /** The live wall of every tile, row major. */
  walls: readonly (string | null)[];
  /** The palette entry picked, floor or wall, or `null`. */
  brush: TerrainBrush | null;
  /** A paint is on its way to the server. */
  pending: boolean;
  blocked: boolean;
  error: string | null;
  enter(): void;
  exit(): void;
  /** Picks the floor `material`, or unpicks it when it is the picked one. */
  pick(material: LayoutMaterial): void;
  /** Picks the wall `piece` (`null`: the wall eraser), or unpicks it when it is the picked one. */
  pickWall(piece: WallPieceId | null): void;
  unpick(): void;
}

type PendingPaint =
  | { readonly kind: 'block'; readonly index: number; readonly material: LayoutMaterial; readonly sent: boolean }
  | { readonly kind: 'wall'; readonly index: number; readonly piece: WallPieceId | null; readonly sent: boolean };
type BlockPaint = Extract<PendingPaint, { kind: 'block' }>;
type WallPaint = Extract<PendingPaint, { kind: 'wall' }>;

const isBlockPaint = (paint: PendingPaint): paint is BlockPaint => paint.kind === 'block';
const isWallPaint = (paint: PendingPaint): paint is WallPaint => paint.kind === 'wall';

function applyPaints(blocks: readonly LayoutMaterial[], paints: readonly PendingPaint[]): LayoutMaterial[] {
  const next = [...blocks];
  for (const paint of paints) if (isBlockPaint(paint)) next[paint.index] = paint.material;
  return next;
}

/** The wall a tile will hold once every pending paint lands. */
function wallAfter(walls: readonly (string | null)[], paints: readonly PendingPaint[], index: number): string | null {
  let wall = walls[index] ?? null;
  for (const paint of paints) if (isWallPaint(paint) && paint.index === index) wall = paint.piece;
  return wall;
}

/**
 * The unsent wall paints that leave together with `first`: the ones right
 * after it in the queue, up to the first block paint, a tile already in the
 * request (the server refuses a tile twice) or `MAX_WALL_EDITS`.
 */
function wallRun(paints: readonly PendingPaint[], first: WallPaint): WallPaint[] {
  const run: WallPaint[] = [];
  const tiles = new Set<number>();
  for (const paint of paints.slice(paints.indexOf(first))) {
    if (paint.sent) continue;
    if (!isWallPaint(paint) || tiles.has(paint.index) || run.length === MAX_WALL_EDITS) break;
    tiles.add(paint.index);
    run.push(paint);
  }
  return run;
}

export function useTerrainEditor({ bridge, terrain }: UseTerrainEditorOptions): TerrainEditor {
  const [active, setActive] = useState(false);
  const [blocks, setBlocks] = useState<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const [walls, setWalls] = useState<readonly (string | null)[]>(BASE_LAYOUT.walls);
  const [brush, setBrush] = useState<TerrainBrush | null>(null);
  const [paints, setPaintsState] = useState<readonly PendingPaint[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const paintsRef = useRef<readonly PendingPaint[]>([]);
  const blocksRef = useRef<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const wallsRef = useRef<readonly (string | null)[]>(BASE_LAYOUT.walls);
  const drainingRef = useRef(false);
  const blockedRef = useRef(false);

  const setPaints = (next: readonly PendingPaint[]): void => {
    paintsRef.current = next;
    setPaintsState(next);
  };
  const setBlockedBoth = (next: boolean): void => {
    blockedRef.current = next;
    setBlocked(next);
  };
  const refuse = (cause: unknown, wall: boolean): void => {
    setError(wall && cause instanceof AdminError && cause.code === 'terrain-under-placement' ? WALL_UNDER_PLACEMENT_MESSAGE : describeAdminError(cause));
    if (cause instanceof AdminError && BLOCKING_ERRORS.includes(cause.code)) setBlockedBoth(true);
  };

  async function drain(): Promise<void> {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      for (let next = paintsRef.current.find((paint) => !paint.sent); next !== undefined; next = paintsRef.current.find((paint) => !paint.sent)) {
        const batch: readonly PendingPaint[] = isWallPaint(next) ? wallRun(paintsRef.current, next) : [next];
        try {
          if (isWallPaint(next)) await terrain.setWalls((batch as readonly WallPaint[]).map(({ index, piece }) => ({ index, piece })));
          else await terrain.setBlock(next.index, (next as BlockPaint).material);
          setPaints(paintsRef.current.map((candidate) => (batch.includes(candidate) ? { ...candidate, sent: true } : candidate)));
        } catch (cause) {
          refuse(cause, isWallPaint(next));
          // A refused paint is simply not drawn; once editing is gone, nothing queued is sent.
          setPaints(paintsRef.current.filter((candidate) => !batch.includes(candidate) && !(blockedRef.current && !candidate.sent)));
        }
      }
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }

  function queue(paint: PendingPaint): void {
    setError(null);
    setPaints([...paintsRef.current, paint]);
    void drain();
  }

  function paintAt(index: number): void {
    if (blockedRef.current || brush?.kind !== 'floor') return;
    if (index < 0 || index >= blocksRef.current.length) return;
    if (index === SPAWN_BLOCK_INDEX && brush.material !== 'wood') {
      setError(SPAWN_BLOCK_MESSAGE);
      return;
    }
    if (applyPaints(blocksRef.current, paintsRef.current)[index] === brush.material) return;
    queue({ kind: 'block', index, material: brush.material, sent: false });
  }

  function paintWallAt(index: number): void {
    if (blockedRef.current || brush?.kind !== 'wall') return;
    if (index < 0 || index >= wallsRef.current.length) return;
    if (wallAfter(wallsRef.current, paintsRef.current, index) === brush.piece) return;
    queue({ kind: 'wall', index, piece: brush.piece, sent: false });
  }

  useEffect(
    () =>
      bridge.on('terrain', (payload) => {
        blocksRef.current = payload.blocks;
        wallsRef.current = payload.walls;
        setBlocks(payload.blocks);
        setWalls(payload.walls);
        // The room shows every saved paint from here on, or something newer.
        if (paintsRef.current.some((paint) => paint.sent)) setPaints(paintsRef.current.filter((paint) => !paint.sent));
      }),
    [bridge],
  );

  // A fresh subscription per render keeps `paintAt` reading the current brush.
  useEffect(() => {
    if (!active) return undefined;
    const offBlocks = bridge.on('terrainpick', ({ index }) => paintAt(index));
    const offWalls = bridge.on('wallpick', ({ index }) => paintWallAt(index));
    return () => {
      offBlocks();
      offWalls();
    };
  });

  useEffect(() => {
    if (!active || brush === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setBrush(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, brush]);

  const previewBlocks = useMemo(() => (paints.some(isBlockPaint) ? applyPaints(blocks, paints) : null), [blocks, paints]);
  const previewWalls = useMemo<WallEdit[] | null>(() => {
    const pending = paints.filter(isWallPaint).map(({ index, piece }) => ({ index, piece }));
    return pending.length === 0 ? null : pending;
  }, [paints]);
  const previewKey = `${previewBlocks === null ? '' : encodeTerrainBlocks(previewBlocks)}|${previewWalls === null ? '' : JSON.stringify(previewWalls)}`;

  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('terrainedit', {
      brush,
      ...(previewBlocks === null ? {} : { previewBlocks }),
      ...(previewWalls === null ? {} : { previewWalls }),
    });
    // `previewKey` stands for both previews: only a different drawing is worth a command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, active, brush, previewKey]);

  // Separate from the effect above so a new pick does not close and reopen
  // the overlay: only leaving (or unmounting) does.
  useEffect(() => {
    if (!active) return undefined;
    return () => bridge.emitCommand('terrainedit', null);
  }, [bridge, active]);

  const reset = (): void => {
    setBrush(null);
    setPaints([]);
    setError(null);
    setBlockedBoth(false);
  };

  const toggle = (next: TerrainBrush): void => {
    setBrush((current) => (sameBrush(current, next) ? null : next));
    setError(null);
  };

  return {
    active,
    blocks,
    walls,
    brush,
    pending: draining,
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
    pick(material) {
      toggle({ kind: 'floor', material });
    },
    pickWall(piece) {
      toggle({ kind: 'wall', piece });
    },
    unpick() {
      setBrush(null);
    },
  };
}
