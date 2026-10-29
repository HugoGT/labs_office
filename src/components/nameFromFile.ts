/** Same limit as `MAX_NAME_LENGTH` in `server/src/assets/assetUploadRules.ts`. */
export const MAX_ART_NAME_LENGTH = 60;

/** The file name without its extension, cut to what the server accepts as a name. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]*$/, '').trim().slice(0, MAX_ART_NAME_LENGTH);
}
