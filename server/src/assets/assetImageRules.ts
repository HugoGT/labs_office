/**
 * Pure checks of one uploaded PNG (#121): signature, size, the contract of
 * its image kind (`validateArtImage`, docs/art/contract.md) and the re-encode
 * that produces the only bytes the server stores. No storage, no HTTP, so the
 * rules are tested with PNG buffers built in the test.
 *
 * Where #121 and the contract disagree the contract wins (partial alpha
 * allowed, 128 colors per file, 32x52 walk frames): the upload checks the same
 * rules the exporter checks the pack with, so an uploaded piece and a pack
 * piece are drawn by the same code with the same assumptions.
 */

import { createHash } from 'node:crypto';
import { ART_IMAGE_SPECS, sheetSize, validateArtImage, type ArtImageKind, type ArtViolationCode } from '../../../src/game/artContract.ts';
import { PngFormatError, decodePng, encodePng, readPngHeader, type PngFormatErrorCode } from './pngCodec.ts';

/** Per file, as #121 sets it. The largest character sheet of the pack is about 20 KB. */
export const MAX_UPLOAD_FILE_BYTES = 128 * 1024;

export type AssetUploadErrorCode =
  | 'too-large'
  | PngFormatErrorCode
  | ArtViolationCode
  /** A metadata field is missing or has the wrong shape; `field` names it. */
  | 'invalid-metadata'
  /** A contribution (#122) without the rights statement accepted. */
  | 'rights-not-accepted'
  /** The kind needs a file under this role and the body has none. */
  | 'missing-file';

/**
 * Every refusal of an upload, one class with a code like
 * `InvalidArtChoiceError`: each is the same 400 for the route, and the code is
 * what the panel tells apart. `field` is the file role or metadata field.
 */
export class AssetUploadError extends Error {
  readonly code: AssetUploadErrorCode;
  readonly field: string | null;

  constructor(code: AssetUploadErrorCode, field: string | null, message: string) {
    super(message);
    this.name = 'AssetUploadError';
    this.code = code;
    this.field = field;
  }
}

/** What gets stored for one file: content-addressed by the hash of the re-encoded bytes. */
export interface PreparedAssetImage {
  readonly imageKind: ArtImageKind;
  readonly width: number;
  readonly height: number;
  readonly png: Buffer;
  readonly sha256: string;
}

function readable<T>(field: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PngFormatError) throw new AssetUploadError(error.code, field, error.message);
    throw error;
  }
}

/**
 * Checks one file against its image kind and re-encodes it. The size is read
 * from the header first, so a file of the wrong size is refused without
 * inflating anything, and the decoder itself caps what the data may inflate
 * to. The answer is `encodePng` of the decoded pixels: no chunk, metadata or
 * trailing payload of the original reaches storage.
 */
export function prepareAssetImage(imageKind: ArtImageKind, bytes: Uint8Array, field: string): PreparedAssetImage {
  if (bytes.length > MAX_UPLOAD_FILE_BYTES) {
    throw new AssetUploadError('too-large', field, `${field} is ${bytes.length} bytes, the limit is ${MAX_UPLOAD_FILE_BYTES}`);
  }
  const header = readable(field, () => readPngHeader(bytes));
  const expected = sheetSize(ART_IMAGE_SPECS[imageKind]);
  if (header.width !== expected.width || header.height !== expected.height) {
    throw new AssetUploadError(
      'invalid-dimensions',
      field,
      `${imageKind} must be ${expected.width}x${expected.height}, got ${header.width}x${header.height}`,
    );
  }
  const image = readable(field, () => decodePng(bytes));
  const [violation] = validateArtImage(imageKind, image);
  if (violation !== undefined) throw new AssetUploadError(violation.code, field, violation.message);

  const png = encodePng(image);
  return {
    imageKind,
    width: image.width,
    height: image.height,
    png,
    sha256: createHash('sha256').update(png).digest('hex'),
  };
}
