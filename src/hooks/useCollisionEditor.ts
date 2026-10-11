import { useCallback, useEffect, useRef, useState } from 'react';
import { describeAdminError } from '../dashboard/adminErrors';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import { newRectToward, type CollisionSnap } from '../game/collisionEditor';
import type { OfficeBridge } from '../game/officeBridge';
import { InvalidCollisionRectsError, MAX_COLLISION_RECTS, parseCollisionRects, type CollisionRect } from '../game/pieceCollisions';
import { useEscapeStep } from './useEscapeStep';

/**
 * The collision editor of the office sidebar: pick a placed piece on the map,
 * edit its rectangles there or by hand, see them over every instance of the
 * piece, then save, cancel or restore its default.
 *
 * The map (`CollisionEditLayer`) reports picks and drags; this hook owns the
 * draft and the baseline it cancels back to. A saved edit reaches the
 * colliders of everyone, this admin included, through the room state.
 */

export interface UseCollisionEditorOptions {
  bridge: OfficeBridge;
  collisions: CollisionAdminPort;
}

export type RectField = keyof CollisionRect;

export interface CollisionEditor {
  active: boolean;
  pieceId: string | null;
  rects: readonly CollisionRect[];
  selectedRect: number | null;
  /** Whether the piece has saved rectangles, rather than its default. */
  saved: boolean;
  /** The draft differs from what the piece collides with now. */
  dirty: boolean;
  snap: CollisionSnap;
  showAll: boolean;
  pending: boolean;
  error: string | null;
  notice: string | null;
  enter(): void;
  exit(): void;
  selectRect(index: number | null): void;
  addRect(): void;
  deleteRect(index: number): void;
  /** A hand edit of one number; a value the server would refuse is ignored. */
  updateRect(index: number, field: RectField, value: number): void;
  setSnap(snap: CollisionSnap): void;
  setShowAll(show: boolean): void;
  save(): Promise<void>;
  cancel(): void;
  restoreDefault(): Promise<void>;
}

interface Piece {
  id: string;
  /** What the piece collides with now: the draft cancels back to it. */
  baseline: readonly CollisionRect[];
  defaults: readonly CollisionRect[];
  saved: boolean;
}

function sameRects(a: readonly CollisionRect[], b: readonly CollisionRect[]): boolean {
  return a.length === b.length && a.every((rect, index) => {
    const other = b[index]!;
    return rect.x === other.x && rect.y === other.y && rect.w === other.w && rect.h === other.h;
  });
}

function valid(rects: readonly CollisionRect[]): boolean {
  try {
    parseCollisionRects(rects);
    return true;
  } catch (error) {
    if (error instanceof InvalidCollisionRectsError) return false;
    throw error;
  }
}

export function useCollisionEditor({ bridge, collisions }: UseCollisionEditorOptions): CollisionEditor {
  const [active, setActive] = useState(false);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [rects, setRects] = useState<readonly CollisionRect[]>([]);
  const [selectedRect, setSelectedRect] = useState<number | null>(null);
  const [snap, setSnap] = useState<CollisionSnap>(1);
  const [showAll, setShowAllState] = useState(false);
  const showAllRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const offPick = bridge.on('collisionpick', ({ pieceId, rects: current, saved, defaults }) => {
      setPiece({ id: pieceId, baseline: current, defaults, saved });
      setRects(current);
      setSelectedRect(null);
      clearMessages();
    });
    const offDraft = bridge.on('collisiondraft', ({ rects: next, selectedRect: index }) => {
      setRects(next);
      setSelectedRect(index);
      clearMessages();
    });
    return () => {
      offPick();
      offDraft();
    };
  }, [bridge, active, clearMessages]);

  const pieceId = piece?.id ?? null;
  useEffect(() => {
    if (!active) return;
    bridge.emitCommand('collisionedit', { pieceId, draft: rects, selectedRect, snap });
  }, [bridge, active, pieceId, rects, selectedRect, snap]);

  // The debug outlines belong to this section: unmounted (the panel closed),
  // nobody could turn them off again.
  useEffect(
    () => () => {
      if (showAllRef.current) bridge.emitCommand('collisiondebug', { show: false });
    },
    [bridge],
  );

  // Separate from the effect above so a new draft does not close and reopen
  // the overlay: only leaving (or unmounting) does.
  useEffect(() => {
    if (!active) return undefined;
    return () => bridge.emitCommand('collisionedit', null);
  }, [bridge, active]);

  const reset = (): void => {
    setPiece(null);
    setRects([]);
    setSelectedRect(null);
    clearMessages();
  };

  // A piece with unsaved changes stays: Escape never throws a draft away.
  const dirty = piece !== null && !sameRects(rects, piece.baseline);
  useEscapeStep(active, () => {
    if (selectedRect !== null) setSelectedRect(null);
    else if (piece !== null && !dirty) reset();
    else return false;
    return true;
  });

  const edit = (next: readonly CollisionRect[], index: number | null): void => {
    setRects(next);
    setSelectedRect(index);
    clearMessages();
  };

  async function run(action: () => Promise<void>, done: string, after: () => void): Promise<void> {
    if (pendingRef.current || piece === null) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
      after();
      setError(null);
      setNotice(done);
    } catch (cause) {
      setNotice(null);
      setError(describeAdminError(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return {
    active,
    pieceId,
    rects,
    selectedRect,
    saved: piece?.saved ?? false,
    dirty,
    snap,
    showAll,
    pending,
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
    selectRect(index) {
      setSelectedRect(index);
    },
    addRect() {
      if (piece === null || rects.length >= MAX_COLLISION_RECTS) return;
      edit([...rects, newRectToward(rects)], rects.length);
    },
    deleteRect(index) {
      if (index < 0 || index >= rects.length) return;
      edit(
        rects.filter((_, candidate) => candidate !== index),
        null,
      );
    },
    updateRect(index, field, value) {
      const rect = rects[index];
      if (rect === undefined) return;
      const next = rects.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, [field]: value } : candidate));
      if (valid(next)) edit(next, index);
    },
    setSnap(next) {
      setSnap(next);
    },
    setShowAll(show) {
      setShowAllState(show);
      showAllRef.current = show;
      bridge.emitCommand('collisiondebug', { show });
    },
    async save() {
      if (piece === null) return;
      const draft = rects;
      await run(
        () => collisions.saveRects(piece.id, draft),
        'Colisión guardada.',
        () => setPiece({ ...piece, baseline: draft, saved: true }),
      );
    },
    cancel() {
      if (piece === null) return;
      edit(piece.baseline, null);
    },
    async restoreDefault() {
      if (piece === null) return;
      await run(
        () => collisions.reset(piece.id),
        'Colisión restablecida.',
        () => {
          setPiece({ ...piece, baseline: piece.defaults, saved: false });
          setRects(piece.defaults);
          setSelectedRect(null);
        },
      );
    },
  };
}
