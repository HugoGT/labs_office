import { useCallback, useState } from 'react';

const HEX = /^#[0-9a-f]{6}$/i;

type Colors<K extends string> = Readonly<Partial<Record<K, string>>>;

function read<K extends string>(storageKey: string): Colors<K> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {} as Colors<K>;
    // Anything but a `#rrggbb` string is dropped: the value comes from a browser store the app does not control.
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string' && HEX.test(value))) as Colors<K>;
  } catch {
    return {} as Colors<K>;
  }
}

/**
 * The colors a palette remembers per piece or material, kept in this browser
 * only (`localStorage`): a reload starts the palette where it was left, and
 * nothing goes to the server, since a placed item carries its own color. The
 * store may be unavailable (private window, blocked site data): the colors
 * then last as long as the page.
 */
export function usePersistedColors<K extends string>(
  storageKey: string,
): readonly [Colors<K>, (key: K, color: string) => void] {
  const [colors, setColors] = useState(() => read<K>(storageKey));
  const setColor = useCallback(
    (key: K, color: string) => {
      setColors((current) => {
        const next = { ...current, [key]: color };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Keep the choice in memory.
        }
        return next;
      });
    },
    [storageKey],
  );
  return [colors, setColor] as const;
}
