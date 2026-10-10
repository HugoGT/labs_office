import { useEffect, useRef } from 'react';

/**
 * Escape steps a map editor out of what it holds (a placement, a selection, a
 * picked piece), one level per press, so the admin can walk and drag the map
 * again without closing the editor. `step` answers whether it handled the
 * press; a handled one is default-prevented, like the terrain editor's, so no
 * other Escape listener acts on it too. An Escape already handled is left alone.
 */
export function useEscapeStep(active: boolean, step: () => boolean): void {
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (stepRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
