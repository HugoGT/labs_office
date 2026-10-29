import { useEffect, useRef } from 'react';
import { isEditableElementFocused } from '../game/inputFocusGuard';

/**
 * Supr or Backspace deletes what a map editor holds selected, like the decor
 * editor's: `remove` answers whether there was something to delete. Never
 * while someone types in a field or holds a modifier, and a press already
 * handled is left alone; a handled one is default-prevented.
 */
export function useDeleteKey(active: boolean, remove: () => boolean): void {
  const removeRef = useRef(remove);
  removeRef.current = remove;

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.defaultPrevented) return;
      if (isEditableElementFocused() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (removeRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
