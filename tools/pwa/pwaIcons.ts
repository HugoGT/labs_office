/**
 * The manifest icons (#13), import-free so `vite.config.ts` can read them
 * without the PNG renderer (`icons.ts`, `pnpm pwa:icons`).
 */
export interface PwaIcon {
  /** Path in the repo, under Vite's `public/`. */
  readonly file: string;
  /** URL the manifest and `index.html` reference. */
  readonly src: string;
  readonly sizes: string;
  readonly purpose: 'any' | 'maskable';
}

export const PWA_ICONS: readonly PwaIcon[] = [
  { file: 'public/icons/icon-192.png', src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' },
  { file: 'public/icons/icon-512.png', src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' },
  { file: 'public/icons/icon-maskable-512.png', src: '/icons/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
];
