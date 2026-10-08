import { useEffect, useMemo, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import type { OfficeBridge } from '../game/officeBridge';
import { BASE_LAYOUT, encodeTerrainBlocks, type LayoutMaterial } from '../game/officeLayout';

/**
 * The terrain editor of the office sidebar (#123 phase 2): pick a floor in
 * the palette, then every click on a 9x9 block of the map paints it, until
 * the floor is unpicked. Painting over terrain replaces it, painting over the
 * void builds new terrain, and the void entry erases.
 *
 * Each paint is one `setBlock`, sent one at a time in click order: the server
 * checks it against the terrain the previous one left. The blocks it shows
 * come from the scene (`terrain` events), which follows the room: a paint
 * reaches this editor the same way it reaches everyone else, so it is drawn
 * as pending only until the room shows it.
 */

/** The admin refused with these may not edit at all any more: no further writes. */
const BLOCKING_ERRORS = ['forbidden', 'unauthorized', 'terrain-not-configured'];

export const SPAWN_BLOCK_MESSAGE = 'El bloque central de la entrada siempre es de madera.';

export interface UseTerrainEditorOptions {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
}

export interface TerrainEditor {
  active: boolean;
  blocks: readonly LayoutMaterial[];
  /** The floor picked in the palette, or `null`. */
  brush: LayoutMaterial | null;
  /** A paint or the emptying is on its way to the server. */
  pending: boolean;
  blocked: boolean;
  error: string | null;
  notice: string | null;
  enter(): void;
  exit(): void;
  /** Picks `material`, or unpicks it when it is the picked one. */
  pick(material: LayoutMaterial): void;
  unpick(): void;
  /** Every block back to void but the central entrance, in one atomic batch. */
  clear(): Promise<void>;
}

interface PendingPaint {
  readonly index: number;
  readonly material: LayoutMaterial;
  /** Saved by the server; drawn until the next terrain update from the room. */
  readonly sent: boolean;
}

function applyPaints(blocks: readonly LayoutMaterial[], paints: readonly PendingPaint[]): LayoutMaterial[] {
  const next = [...blocks];
  for (const { index, material } of paints) next[index] = material;
  return next;
}

export function useTerrainEditor({ bridge, terrain }: UseTerrainEditorOptions): TerrainEditor {
  const [active, setActive] = useState(false);
  const [blocks, setBlocks] = useState<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const [brush, setBrush] = useState<LayoutMaterial | null>(null);
  const [paints, setPaintsState] = useState<readonly PendingPaint[]>([]);
  const [draining, setDraining] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The queue is read and written across awaits: refs are its source of truth, state only renders it.
  const paintsRef = useRef<readonly PendingPaint[]>([]);
  const blocksRef = useRef<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const drainingRef = useRef(false);
  const blockedRef = useRef(false);
  const busyRef = useRef(false);

  const setPaints = (next: readonly PendingPaint[]): void => {
    paintsRef.current = next;
    setPaintsState(next);
  };
  const setBlockedBoth = (next: boolean): void => {
    blockedRef.current = next;
    setBlocked(next);
  };
  const refuse = (cause: unknown): void => {
    setNotice(null);
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
          await terrain.setBlock(paint.index, paint.material);
          setPaints(paintsRef.current.map((candidate) => (candidate === paint ? { ...paint, sent: true } : candidate)));
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

  function paintAt(index: number): void {
    if (blockedRef.current || busyRef.current || brush === null) return;
    if (index < 0 || index >= blocksRef.current.length) return;
    if (index === SPAWN_BLOCK_INDEX && brush !== 'wood') {
      setNotice(null);
      setError(SPAWN_BLOCK_MESSAGE);
      return;
    }
    if (applyPaints(blocksRef.current, paintsRef.current)[index] === brush) return;
    setError(null);
    setNotice(null);
    setPaints([...paintsRef.current, { index, material: brush, sent: false }]);
    void drain();
  }

  useEffect(
    () =>
      bridge.on('terrain', (payload) => {
        blocksRef.current = payload.blocks;
        setBlocks(payload.blocks);
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

  useEffect(() => {
    if (!active || brush === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setBrush(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, brush]);

  const previewBlocks = useMemo(() => (paints.length === 0 ? null : applyPaints(blocks, paints)), [blocks, paints]);
  const previewKey = previewBlocks === null ? '' : encodeTerrainBlocks(previewBlocks);

  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('terrainedit', previewBlocks === null ? { brush } : { brush, previewBlocks });
    // `previewKey` stands for `previewBlocks`: only a different drawing is worth a command.
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
    setNotice(null);
    setBlockedBoth(false);
  };

  return {
    active,
    blocks,
    brush,
    pending: draining || clearing,
    blocked,
    error,
    notice,
    enter() {
      reset();
      setActive(true);
    },
    exit() {
      reset();
      setActive(false);
    },
    pick(material) {
      setBrush((current) => (current === material ? null : material));
      setError(null);
      setNotice(null);
    },
    unpick() {
      setBrush(null);
    },
    async clear() {
      if (!active || blockedRef.current || busyRef.current || drainingRef.current) return;
      const current = blocksRef.current;
      const edits = current.flatMap((material, index) => {
        const target: LayoutMaterial = index === SPAWN_BLOCK_INDEX ? 'wood' : 'void';
        return material === target ? [] : [{ index, material: target }];
      });
      setError(null);
      if (edits.length === 0) {
        setNotice('El terreno ya está vacío.');
        return;
      }
      busyRef.current = true;
      setClearing(true);
      try {
        await terrain.setBlocks(edits, encodeTerrainBlocks(current));
        setNotice('Terreno vaciado. Las salas y los escritorios se conservan.');
      } catch (cause) {
        refuse(cause);
      } finally {
        busyRef.current = false;
        setClearing(false);
      }
    },
  };
}
