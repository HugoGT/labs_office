import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';

const GAP_PX = 6;
const MARGIN_PX = 8;

export interface AnchoredPopover {
  open: boolean;
  toggle: () => void;
  /** Closes and gives the focus back to the trigger. */
  close: () => void;
  /** Fixed position next to the trigger: below when it fits, else above, always inside the viewport. */
  style: CSSProperties;
  /** For the popover's `onKeyDown`: Escape closes it and never reaches what contains it (the creator dialog). */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Open state and placement of a small popover anchored to a button (the
 * creator's style menus and color pickers). It is `position: fixed`, so a
 * popover near the bottom of the creator opens upward instead of making the
 * card scroll, and no overflow box clips it. Closes on Escape (focus back to
 * the trigger) and on a pointer down outside both (focus stays where it went),
 * like `CameraFilterMenu`.
 */
export function useAnchoredPopover(
  triggerRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
): AnchoredPopover {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const popover = popoverRef.current?.getBoundingClientRect();
    if (!trigger || !popover) return;
    const below = trigger.bottom + GAP_PX;
    const fitsBelow = below + popover.height <= window.innerHeight - MARGIN_PX;
    const top = fitsBelow ? below : Math.max(MARGIN_PX, trigger.top - GAP_PX - popover.height);
    const left = Math.min(Math.max(MARGIN_PX, trigger.left), Math.max(MARGIN_PX, window.innerWidth - MARGIN_PX - popover.width));
    setStyle({ position: 'fixed', top, left });
  }, [open, triggerRef, popoverRef]);

  useEffect(() => {
    if (!open) {
      setStyle({ position: 'fixed', visibility: 'hidden' });
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, popoverRef, triggerRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    [close],
  );

  return { open, toggle: () => setOpen((current) => !current), close, style, onKeyDown };
}
