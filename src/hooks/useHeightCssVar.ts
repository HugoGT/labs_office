import { useCallback } from 'react';

/**
 * Publishes an element's rendered height on the document root as the CSS
 * custom property `name`, and keeps it current (#86). The bottom bar's height
 * depends on the breakpoint, the fonts and whether its controls wrap on a tight
 * window, so the HUD pieces that must stay clear of it read the real value
 * instead of a hardcoded guess.
 *
 * A callback ref and not `useRef` + effect: a component that renders nothing
 * at first (`ExitControls` without actions) still gets measured once its
 * element appears, and the property is removed as soon as the element goes,
 * so nothing keeps reserving room for it.
 */
export function useHeightCssVar(name: string) {
  return useCallback(
    (element: HTMLElement | null) => {
      // jsdom has no layout and no ResizeObserver: there is nothing to publish.
      if (element === null || typeof ResizeObserver === 'undefined') return;
      const root = document.documentElement;
      const publish = () => root.style.setProperty(name, `${element.offsetHeight}px`);
      publish();
      const observer = new ResizeObserver(publish);
      observer.observe(element);
      return () => {
        observer.disconnect();
        root.style.removeProperty(name);
      };
    },
    [name],
  );
}
