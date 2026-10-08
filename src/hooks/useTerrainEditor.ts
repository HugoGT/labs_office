import { useCallback, useEffect, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { BASE_LAYOUT, BLOCK_TILES, blockCount, encodeTerrainBlocks, type LayoutMaterial } from '../game/officeLayout';
import { generateMapBlocks, SPAWN_BLOCK_INDEX, type MapGeneration } from '../game/mapGeneration';

/**
 * The terrain editor of the office sidebar (#123 phase 2): pick a block on
 * the map or by column and row, choose a material, see it on the map, apply.
 *
 * The blocks it shows come from the scene (`terrain` events), which follows
 * the room: an applied edit reaches this editor the same way it reaches
 * everyone else, so the preview simply stops once the block shows it.
 */

export const BLOCK_COLUMNS = BASE_LAYOUT.width / BLOCK_TILES;
export const BLOCK_ROWS = BASE_LAYOUT.height / BLOCK_TILES;

export interface UseTerrainEditorOptions {
  bridge: OfficeBridge;
  terrain: TerrainAdminPort;
}

export interface TerrainEditor {
  active: boolean;
  blocks: readonly LayoutMaterial[];
  selected: number | null;
  /** The material chosen for the selected block, or `null` before choosing. */
  material: LayoutMaterial | null;
  pending: boolean;
  blocked: boolean;
  error: string | null;
  notice: string | null;
  enter(): void;
  exit(): void;
  /** 1-based, as the form shows them; out of range is ignored. */
  selectAt(column: number, row: number): void;
  choose(material: LayoutMaterial): void;
  discard(): void;
  apply(): Promise<void>;
  draft: readonly LayoutMaterial[] | null;
  generate(params: MapGeneration): void;
  applyGenerated(): Promise<void>;
}

export function useTerrainEditor({ bridge, terrain }: UseTerrainEditorOptions): TerrainEditor {
  const [active, setActive] = useState(false);
  const [blocks, setBlocks] = useState<readonly LayoutMaterial[]>(BASE_LAYOUT.blocks);
  const [selected, setSelected] = useState<number | null>(null);
  const [material, setMaterial] = useState<LayoutMaterial | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<readonly LayoutMaterial[] | null>(null);
  const expectedRef = useRef('');
  const refuse = (cause: unknown): void => {
    setNotice(null);
    setError(describeAdminError(cause));
    if (cause instanceof AdminError && ['forbidden', 'unauthorized', 'terrain-not-configured'].includes(cause.code)) setBlocked(true);
  };

  useEffect(() => bridge.on('terrain', (payload) => setBlocks(payload.blocks)), [bridge]);

  const select = useCallback((index: number) => {
    if (pendingRef.current || blocked) return;
    setDraft(null);
    setSelected(index);
    setError(null);
    setNotice(null);
  }, [blocked]);

  useEffect(() => {
    if (!active) return undefined;
    return bridge.on('terrainpick', ({ index }) => select(index));
  }, [bridge, active, select]);

  const previewMaterial = selected !== null && selected !== SPAWN_BLOCK_INDEX && material !== null && blocks[selected] !== material ? material : null;

  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('terrainedit', {
      selected,
      preview: selected !== null && previewMaterial !== null ? { index: selected, material: previewMaterial } : null,
      ...(draft === null ? {} : { previewBlocks: draft }),
    });
  }, [bridge, active, selected, previewMaterial, draft]);

  // Separate from the effect above so a new selection does not close and
  // reopen the overlay: only leaving (or unmounting) does.
  useEffect(() => {
    if (!active) return undefined;
    return () => bridge.emitCommand('terrainedit', null);
  }, [bridge, active]);

  const reset = (): void => {
    setSelected(null);
    setMaterial(null);
    setError(null);
    setNotice(null);
    setDraft(null);
    setBlocked(false);
  };

  return {
    active,
    blocks,
    selected,
    material,
    pending,
    blocked,
    error,
    notice,
    draft,
    generate(params) {
      if (pendingRef.current || blocked || !active) return;
      try {
        setDraft(generateMapBlocks(params));
        expectedRef.current = encodeTerrainBlocks(blocks);
        setSelected(null);
        setMaterial(null);
        setError(null);
        setNotice(null);
      } catch {
        setError('Revisa la semilla (0–4294967295), los bloques (1–140) y el material.');
      }
    },
    async applyGenerated() {
      if (pendingRef.current || blocked || draft === null || !active) return;
      pendingRef.current = true;
      setPending(true);
      try {
        await terrain.setBlocks(draft.map((material, index) => ({ index, material })), expectedRef.current);
        setDraft(null);
        setError(null);
        setNotice('Mapa actualizado. Las salas y los escritorios se conservan.');
      } catch (cause) {
        refuse(cause);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    enter() {
      reset();
      setActive(true);
    },
    exit() {
      reset();
      setActive(false);
    },
    selectAt(column, row) {
      if (!Number.isInteger(column) || !Number.isInteger(row)) return;
      if (column < 1 || row < 1 || column > BLOCK_COLUMNS || row > BLOCK_ROWS) return;
      const index = (row - 1) * BLOCK_COLUMNS + (column - 1);
      if (index < blockCount(BASE_LAYOUT)) select(index);
    },
    choose(next) {
      if (pendingRef.current || blocked || selected === SPAWN_BLOCK_INDEX) return;
      setDraft(null);
      setMaterial(next);
      setError(null);
      setNotice(null);
    },
    discard() {
      if (pendingRef.current) return;
      setMaterial(null);
      setDraft(null);
    },
    async apply() {
      if (pendingRef.current || blocked || selected === null || selected === SPAWN_BLOCK_INDEX || material === null) return;
      pendingRef.current = true;
      setPending(true);
      try {
        await terrain.setBlock(selected, material);
        setError(null);
        setNotice('Bloque actualizado.');
      } catch (cause) {
        refuse(cause);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
  };
}
