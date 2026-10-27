import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import {
  BASE_LAYOUT,
  encodeTerrainBlocks,
  encodeTerrainColors,
  isColorableTerrainMaterial,
  withTerrainColors,
  type LayoutMaterial,
  type TerrainColors,
} from '../game/officeLayout';
import { sameBrush, type TerrainBrush } from '../game/terrainEditor';
import type { TileRect } from '../game/terrainGrid';

/**
 * The terrain editor of the office sidebar (#123 phase 2): pick a floor in
 * the palette, then every click on a 9x9 block of the map paints it, until
 * the floor is unpicked. Painting over terrain replaces it, painting over the
 * void builds new terrain, and the void entry erases. Chairs and the rest of
 * the furniture are the decor editor's (#208, `useDecorEditor`), and so are
 * the walls since #224 (`useWallEditor`).
 *
 * Paints go to the server one request at a time, in click order: the server
 * checks each against the terrain the previous one left, one `setBlock`
 * each. The blocks it shows come from the scene (`terrain` events), which
 * follows the room: a paint reaches this editor the same way it reaches
 * everyone else, so it is drawn as pending only until the room shows it.
 *
 * Carpet takes a color (#222), chosen on its palette tile the way the
 * painted desk's is (`useDecorEditor`): the choice is kept per material and
 * goes with every later pick, and with the picked brush when it is carpet.
 */

/** The admin refused with these may not edit at all any more: no further writes. */
const BLOCKING_ERRORS = ['forbidden', 'unauthorized', 'terrain-not-configured'];

export const SPAWN_BLOCK_MESSAGE = 'El bloque central de la entrada siempre es de madera.';

export type FloorBrush = Extract<TerrainBrush, { kind: 'floor' }>;

export interface UseTerrainEditorOptions {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
  /** The editor closed itself: an Escape with nothing picked, so the admin can walk and try the map. */
  onExit?: () => void;
  /** The outlines of every room and desk the map draws while the editor is open (#216): a guide only. */
  outlines?: readonly TileRect[];
}

export interface TerrainEditor {
  active: boolean;
  blocks: readonly LayoutMaterial[];
  /** The floor picked, or `null`. */
  brush: FloorBrush | null;
  /** The color chosen per colorable floor on its palette tile; one without paints its default art. */
  colors: Readonly<Partial<Record<LayoutMaterial, string>>>;
  /** Chooses the color of a colorable floor: its next pick, and the picked brush if it is that floor. */
  setColor(material: LayoutMaterial, color: string): void;
  /** A paint is on its way to the server. */
  pending: boolean;
  blocked: boolean;
  error: string | null;
  enter(): void;
  exit(): void;
  /** Picks the floor `material`, or unpicks it when it is the picked one. */
  pick(material: LayoutMaterial): void;
  unpick(): void;
}

interface PendingPaint {
  readonly index: number;
  readonly material: LayoutMaterial;
  readonly color?: string;
  readonly sent: boolean;
}

function applyPaints(blocks: readonly LayoutMaterial[], paints: readonly PendingPaint[]): LayoutMaterial[] {
  const next = [...blocks];
  for (const paint of paints) next[paint.index] = paint.material;
  return next;
}

/** The block colors once every pending paint lands: a paint without a color leaves its block the default art. */
function colorsAfter(colors: TerrainColors, paints: readonly PendingPaint[]): Map<number, string> {
  return withTerrainColors(colors, paints);
}

/** The floor brush a pick makes: a colorable one carries the color chosen for it, if any. */
function floorBrush(material: LayoutMaterial, color: string | undefined): FloorBrush {
  return isColorableTerrainMaterial(material) && color !== undefined ? { kind: 'floor', material, color } : { kind: 'floor', material };
}

export function useTerrainEditor({ bridge, terrain, onExit, outlines }: UseTerrainEditorOptions): TerrainEditor {
  const [active, setActive] = useState(false);
  const [blocks, setBlocks] = useState<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const [liveColors, setLiveColors] = useState<TerrainColors>(() => new Map());
  const [brush, setBrush] = useState<FloorBrush | null>(null);
  const [colors, setColors] = useState<Readonly<Partial<Record<LayoutMaterial, string>>>>({});
  const [paints, setPaintsState] = useState<readonly PendingPaint[]>([]);
  const [draining, setDraining] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const paintsRef = useRef<readonly PendingPaint[]>([]);
  const blocksRef = useRef<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const colorsRef = useRef<TerrainColors>(new Map());
  const drainingRef = useRef(false);
  const blockedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const setPaints = (next: readonly PendingPaint[]): void => {
    paintsRef.current = next;
    setPaintsState(next);
  };
  const setBlockedBoth = (next: boolean): void => {
    blockedRef.current = next;
    setBlocked(next);
  };
  const refuse = (cause: unknown): void => {
    setError(describeAdminError(cause));
    if (cause instanceof AdminError && BLOCKING_ERRORS.includes(cause.code)) setBlockedBoth(true);
  };

  async function drain(): Promise<void> {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      for (let next = paintsRef.current.find((paint) => !paint.sent); next !== undefined; next = paintsRef.current.find((paint) => !paint.sent)) {
        const paint = next;
        try {
          if (paint.color === undefined) await terrain.setBlock(paint.index, paint.material);
          else await terrain.setBlock(paint.index, paint.material, paint.color);
          setPaints(paintsRef.current.map((candidate) => (candidate === paint ? { ...candidate, sent: true } : candidate)));
        } catch (cause) {
          refuse(cause);
          // A refused paint is simply not drawn; once editing is gone, nothing queued is sent.
          setPaints(paintsRef.current.filter((candidate) => candidate !== paint && !(blockedRef.current && !candidate.sent)));
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
    if (blockedRef.current || brush === null) return;
    if (index < 0 || index >= blocksRef.current.length) return;
    if (index === SPAWN_BLOCK_INDEX && brush.material !== 'wood') {
      setError(SPAWN_BLOCK_MESSAGE);
      return;
    }
    // Carpet in another color (or the default art) is a different paint, so it is sent.
    const sameMaterial = applyPaints(blocksRef.current, paintsRef.current)[index] === brush.material;
    if (sameMaterial && colorsAfter(colorsRef.current, paintsRef.current).get(index) === brush.color) return;
    queue({ index, material: brush.material, ...(brush.color === undefined ? {} : { color: brush.color }), sent: false });
  }

  useEffect(
    () =>
      bridge.on('terrain', (payload) => {
        blocksRef.current = payload.blocks;
        colorsRef.current = payload.colors;
        setBlocks(payload.blocks);
        setLiveColors(payload.colors);
        // The room shows every saved paint from here on, or something newer.
        if (paintsRef.current.some((paint) => paint.sent)) setPaints(paintsRef.current.filter((paint) => !paint.sent));
      }),
    [bridge],
  );

  // A fresh subscription per render keeps `paintAt` reading the current brush.
  useEffect(() => {
    if (!active) return undefined;
    return bridge.on('terrainpick', ({ index }) => paintAt(index));
  });

  // Escape steps out one level at a time: the picked brush first, then the
  // editor itself. Each press is the editor's, so the sidebar (which closes
  // its panel on an unhandled Escape) waits for the next one.
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (brush !== null) {
        setBrush(null);
        return;
      }
      reset();
      setActive(false);
      onExitRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, brush]);

  const previewBlocks = useMemo(() => (paints.length > 0 ? applyPaints(blocks, paints) : null), [blocks, paints]);
  // Only sent when the paints change a color: absent, the map keeps drawing the live ones.
  const previewColors = useMemo(() => {
    if (previewBlocks === null) return null;
    const next = colorsAfter(liveColors, paints);
    return encodeTerrainColors(next) === encodeTerrainColors(liveColors) ? null : next;
  }, [previewBlocks, liveColors, paints]);
  const previewKey = [
    previewBlocks === null ? '' : encodeTerrainBlocks(previewBlocks),
    previewColors === null ? '' : encodeTerrainColors(previewColors),
    JSON.stringify(outlines ?? []),
  ].join('|');

  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('terrainedit', {
      brush,
      ...(previewBlocks === null ? {} : { previewBlocks }),
      ...(previewColors === null ? {} : { previewColors }),
      ...(outlines === undefined || outlines.length === 0 ? {} : { outlines }),
    });
    // `previewKey` stands for both previews and the outlines: only a different drawing is worth a command.
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

  const toggle = (next: FloorBrush): void => {
    setBrush((current) => (sameBrush(current, next) ? null : next));
    setError(null);
  };

  return {
    active,
    blocks,
    brush,
    colors,
    setColor(material, color) {
      setColors((current) => ({ ...current, [material]: color }));
      setBrush((current) => (current?.material === material ? floorBrush(material, color) : current));
    },
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
      toggle(floorBrush(material, colors[material]));
    },
    unpick() {
      setBrush(null);
    },
  };
}
