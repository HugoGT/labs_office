/**
 * The desk and floor materials the creation forms offer (art migration, step
 * 7), read once per page from the pack manifest the office draws from.
 * `null` until it arrives, and for good when it cannot be read: the forms then
 * create with the pack default, which is what the server stores without a
 * choice.
 */

import { useEffect, useState } from 'react';
import { loadMaterialCatalog, type MaterialCatalog } from '../game/artMaterials';
import { ART_PACK_MANIFEST_URL, artUploadsManifestUrl } from '../game/artPack';
import { resolveOfficeEndpoint } from '../game/officeEndpoint';

/**
 * The office server's uploads manifest (#121), from the same endpoint the
 * office connects to, so materials an Admin uploaded are offered too.
 */
function pageUploadsUrl(): string | null {
  return artUploadsManifestUrl(
    resolveOfficeEndpoint({
      configured: import.meta.env.VITE_COLYSEUS_URL as string | undefined,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    }),
  );
}

export type LoadMaterials = () => Promise<MaterialCatalog | null>;

let pageCatalog: Promise<MaterialCatalog | null> | null = null;

/** Shared by every form of the page; a failed read is forgotten so the next form tries again. */
export const loadPageMaterials: LoadMaterials = () => {
  if (pageCatalog === null) {
    const pending = loadMaterialCatalog({ manifestUrl: ART_PACK_MANIFEST_URL, uploadsUrl: pageUploadsUrl() });
    pageCatalog = pending;
    void pending.then((catalog) => {
      if (catalog === null && pageCatalog === pending) pageCatalog = null;
    });
  }
  return pageCatalog;
};

export function useMaterialCatalog(load: LoadMaterials = loadPageMaterials): MaterialCatalog | null {
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled && loaded !== null) setCatalog(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return catalog;
}
