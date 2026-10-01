/**
 * Art contributions (#122) as the office sees them: any signed-in user
 * uploads a character or a decor plant from "Personalizar", and follows its
 * review. Types only, like `artUploadPort.ts`; the adapter is
 * `artContributionClient.ts`. The review side is `artReviewPort.ts`.
 *
 * The checks (format, limits, rights) are the server's; the form only says
 * what each kind needs and asks for the rights statement below.
 */

/** What a contributor may upload; desks and floors stay the Admin's (`ArtUploadPanel`). */
export const CONTRIBUTION_KINDS = ['character', 'plant'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** The rights statement the contributor must accept. The server refuses an upload without it. */
export const RIGHTS_STATEMENT =
  'Confirmo que este arte no infringe derechos de autor y que la oficina puede usarlo libremente.';

export type ContributionStatus = 'pending' | 'approved' | 'rejected';

/** One file of a piece, by the role the preview needs (`walk`, `seated`, `sheet`). */
export interface ContributionFile {
  role: string;
  /** `<sha256>.png`, relative to the preview route. */
  path: string;
}

export interface Contribution {
  id: string;
  kind: string;
  name: string;
  author: string;
  status: ContributionStatus;
  /** The reason of a rejection; `null` otherwise. */
  reviewNote: string | null;
  submittedAt: string;
  /** ISO 8601 once withdrawn from the catalog; `null` while offered or never approved. */
  retiredAt: string | null;
  files: ContributionFile[];
  /** Who uploaded it: only the review queue says. */
  uploadedBy: { id: string; name: string | null; email: string } | null;
}

export interface ContributionInput {
  kind: ContributionKind;
  name: string;
  author: string;
  /** Plants only. */
  material?: string;
  rightsAccepted: boolean;
  /** Base64 PNG (no `data:` prefix) per file role of the kind. */
  files: Record<string, string>;
}

export interface ContributionUsage {
  pending: number;
  lastHour: number;
  maxPending: number;
  maxPerHour: number;
}

export interface ArtContributionPort {
  submit(input: ContributionInput): Promise<Contribution>;
  listMine(): Promise<{ contributions: Contribution[]; usage: ContributionUsage }>;
  /** One file of a contribution as a data URL, read through the authenticated preview route. */
  fileDataUrl(path: string): Promise<string>;
}
