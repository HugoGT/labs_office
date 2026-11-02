/**
 * Admin port of the art upload (#121), as the dashboard sees it. Types only,
 * like `terrainAdminPort.ts`; the only adapter is `artUploadClient.ts`.
 *
 * The rules (sizes, colors, alpha, 128 KB) live on the server, which checks
 * and re-encodes every file; the panel only says what each kind needs.
 */

/**
 * The kinds the server accepts from an upload (`server/src/assets/assetUploadRules.ts`),
 * the same list and order a contributor sees (`CONTRIBUTION_KINDS`).
 */
export const ART_UPLOAD_KINDS = ['character', 'plant', 'desk', 'floor', 'chair', 'table', 'door'] as const;
export type ArtUploadKind = (typeof ART_UPLOAD_KINDS)[number];

export interface ArtUploadInput {
  kind: ArtUploadKind;
  /** The credit is the uploader's and the material is the name's: the server sets both. */
  name: string;
  /** Desks and floors: a colorable piece is exported in `defaultColor`. */
  colorable?: boolean;
  defaultColor?: string | null;
  /** Room tables only: whole tiles, horizontal, up to `TABLE.maxFootprint`. */
  footprint?: { w: number; h: number };
  /** Base64 PNG (no `data:` prefix) per file role of the kind. */
  files: Record<string, string>;
}

export interface UploadedArt {
  id: string;
  kind: ArtUploadKind;
  name: string;
  /** An uploaded plant also became desk decor. */
  decor: boolean;
}

export interface ArtUploadPort {
  upload(input: ArtUploadInput): Promise<UploadedArt>;
}
