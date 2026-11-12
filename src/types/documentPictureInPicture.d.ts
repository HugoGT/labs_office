/*
 * Document Picture-in-Picture and the `enterpictureinpicture` media session
 * action (#320). Chromium only, and not yet in TypeScript's DOM lib, so they
 * are declared here as optional: every use feature-detects them.
 * https://developer.chrome.com/docs/web-platform/document-picture-in-picture
 * https://developer.chrome.com/blog/automatic-picture-in-picture
 */
interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPicture {
  /** Rejects without a user gesture, unless the browser fired the `enterpictureinpicture` action. */
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
}

interface Window {
  /** Absent outside Chromium (Firefox, Safari) and in insecure contexts. */
  readonly documentPictureInPicture?: DocumentPictureInPicture;
}

interface MediaSession {
  /** Throws a `TypeError` in browsers that do not know the action. */
  setActionHandler(action: 'enterpictureinpicture', handler: MediaSessionActionHandler | null): void;
}
