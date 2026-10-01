/**
 * Admin port of the art upload (#121), as the dashboard sees it. Types only,
 * like `terrainAdminPort.ts`; the only adapter is `artUploadClient.ts`.
 *
 * The rules (sizes, colors, alpha, 128 KB) live on the server, which checks
 * and re-encodes every file; the panel only says what each kind needs.
 */

/** The kinds the server accepts from an upload (`server/src/assets/assetUploadRules.ts`). */
export const ART_UPLOAD_KINDS = ['character', 'desk', 'floor', 'plant'] as const;
export type ArtUploadKind = (typeof ART_UPLOAD_KINDS)[number];

export interface ArtUploadInput {
  kind: ArtUploadKind;
  name: string;
  author: string;
  license: string;
  /** Desks, floors and plants. */
  material?: string;
  /** Desks and floors: a colorable piece is exported in `defaultColor`. */
  colorable?: boolean;
  defaultColor?: string | null;
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
