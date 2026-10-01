import { useEffect, useState } from 'react';

/**
 * The files of a contribution under review (#122), read as data URLs through
 * the authenticated preview route: an `<img src>` cannot carry the ID token.
 * `files === null` reads nothing (a preview that is closed). A file that
 * cannot be read is left out, and the preview shows what it has.
 */
export function usePrivateArtImages(
  read: (path: string) => Promise<string>,
  files: readonly { role: string; path: string }[] | null,
): Readonly<Record<string, string>> {
  const [images, setImages] = useState<Record<string, string>>({});
  // The same files arrive as a new array on every render; their paths are the identity.
  const key = files === null ? '' : files.map((file) => `${file.role}:${file.path}`).join('|');

  useEffect(() => {
    setImages({});
    if (files === null) return;
    let alive = true;
    for (const file of files) {
      read(file.path)
        .then((url) => {
          if (alive) setImages((current) => ({ ...current, [file.role]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // `files` is read through `key` on purpose, see above.
  }, [read, key]);

  return images;
}
